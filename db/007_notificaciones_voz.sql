-- =====================================================================
-- 007_notificaciones_voz.sql — Outbox durable, notificaciones in-app y
-- llamadas de aviso. Fuente normativa: docs/16 §1, §2, §5 y §7.
--
-- Migración ADITIVA sobre 001–006.
--
-- Las tres reglas que este archivo hace cumplir en la base:
--   1. Un cambio ÚNICO de estado produce UN evento de salida. La unicidad
--      (investigacion_id, tipo) lo garantiza aunque el trigger corra dos veces.
--   2. Cinco entregas repetidas del webhook NO crean cinco llamadas: solo
--      puede haber un intento activo por evento.
--   3. Editar el reporte NO reemite: la transición ya ocurrió y el trigger
--      solo actúa cuando el estado ANTERIOR no era investigacion_completa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Outbox. Ninguna llamada HTTP ocurre dentro de la transacción.
-- ---------------------------------------------------------------------

create table if not exists forense.eventos_salida (
  id               uuid primary key default gen_random_uuid(),
  investigacion_id uuid not null references forense.investigaciones(id) on delete cascade,
  tipo             text not null,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','reclamado','entregado','error','descartado')),
  intentos         int not null default 0,
  lease_owner      text,
  lease_expires_at timestamptz,
  proximo_intento  timestamptz default now(),
  payload          jsonb not null default '{}'::jsonb,   -- sin teléfono ni secretos
  error            text,
  creado           timestamptz default now(),
  actualizado      timestamptz default now(),
  unique (investigacion_id, tipo)
);
create index if not exists ix_eventos_salida_pendientes
  on forense.eventos_salida (estado, proximo_intento);

-- ---------------------------------------------------------------------
-- 2. Notificación in-app: existe aunque no haya llamada.
-- ---------------------------------------------------------------------

create table if not exists forense.notificaciones (
  id        uuid primary key default gen_random_uuid(),
  perfil_id uuid references forense.perfiles(id) on delete cascade,
  event_id  uuid references forense.eventos_salida(id) on delete cascade,
  tipo      text not null,
  recurso   text,
  titulo    text not null,
  cuerpo    text,
  leida_at  timestamptz,
  creado    timestamptz default now(),
  unique (perfil_id, event_id, tipo)
);
create index if not exists ix_notificaciones_perfil
  on forense.notificaciones (perfil_id, creado desc);

-- ---------------------------------------------------------------------
-- 3. Llamadas. `destino` es el teléfono congelado en el intento: privado.
-- ---------------------------------------------------------------------

create table if not exists forense.llamadas_notificacion (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references forense.eventos_salida(id) on delete cascade,
  intento          int not null default 1,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','solicitando','aceptada','en_curso','finalizada',
                                     'fallida','sin_respuesta','omitida','resultado_desconocido')),
  motivo           text,
  destino          text,
  perfil_id        uuid references forense.perfiles(id) on delete set null,
  agent_id         text,
  conversation_id  text,
  call_sid         text,
  provider_payload jsonb not null default '{}'::jsonb,
  aviso_entregado  boolean,                       -- null = desconocido, nunca se asume
  error            text,
  creado           timestamptz default now(),
  actualizado      timestamptz default now(),
  unique (event_id, intento)
);
-- Un solo intento ACTIVO por evento: el webhook repetido no marca dos veces.
create unique index if not exists ux_llamada_activa
  on forense.llamadas_notificacion (event_id)
  where estado in ('pendiente','solicitando','aceptada','en_curso');
create index if not exists ix_llamadas_conversation
  on forense.llamadas_notificacion (conversation_id);

-- ---------------------------------------------------------------------
-- 4. Trigger de outbox (16 §2 paso 2). Compara estado anterior y nuevo;
--    no actúa si ya estaba completa. Insert idempotente por la unicidad.
-- ---------------------------------------------------------------------

create or replace function forense.trg_investigacion_completa()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  if new.estado = 'investigacion_completa'
     and (old.estado is distinct from 'investigacion_completa') then

    insert into forense.eventos_salida (investigacion_id, tipo, estado, payload)
    values (new.id, 'investigacion.completa', 'pendiente',
            jsonb_build_object(
              'investigacion_id', new.id,
              'modo', new.modo,
              'perfil_id', new.perfil_id,
              'completada_at', new.completada_at,
              'version_entregada', new.version_entregada,
              'n_reportes', jsonb_array_length(coalesce(new.reporte_manifest, '[]'::jsonb))))
    on conflict (investigacion_id, tipo) do nothing
    returning id into v_event;

    if v_event is not null then
      insert into forense.notificaciones (perfil_id, event_id, tipo, recurso, titulo, cuerpo)
      values (new.perfil_id, v_event, 'investigacion.completa',
              '/investigaciones/' || new.id::text,
              'Tu investigación terminó',
              'El reporte ya está disponible en el historial.')
      on conflict (perfil_id, event_id, tipo) do nothing;

      perform forense.registrar_actividad('investigacion_completa', new.perfil_id, new.id,
        new.caso_id, null, jsonb_build_object('event_id', v_event));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_investigacion_completa on forense.investigaciones;
create trigger trg_investigacion_completa
  after update of estado on forense.investigaciones
  for each row execute function forense.trg_investigacion_completa();

-- ---------------------------------------------------------------------
-- 5. Transición transaccional de finalización (16 §1 y §2 paso 1).
--    Condición de completitud: todos los objetivos tratados, sin tareas ni
--    errores operativos pendientes, reporte VALIDADO y persistido por cada
--    caso del manifiesto. Un fallo operativo no se disfraza de completa.
-- ---------------------------------------------------------------------

create or replace function forense.completar_investigacion(
  p_investigacion uuid, p_reporte_manifest jsonb default null, p_version int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv record; v_casos uuid[]; v_falt uuid[]; v_sin_reporte uuid[]; v_pendientes int;
begin
  select * into inv from forense.investigaciones where id = p_investigacion for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  if inv.estado = 'investigacion_completa' then
    -- Recarga de página o reintento: no se emite un segundo evento.
    return jsonb_build_object('ok', true, 'cambio', false, 'motivo', 'ya_completa',
                              'investigacion_id', p_investigacion);
  end if;
  if inv.estado in ('cancelada','error') then
    return jsonb_build_object('ok', false, 'error', 'conflicto_version',
                              'detalle', 'la investigación está en ' || inv.estado);
  end if;

  -- Objetivos del manifiesto: en modo caso basta ese caso.
  if inv.modo = 'caso' then
    v_casos := array[inv.caso_id];
  else
    select coalesce(array_agg((o->>'caso_id')::uuid), '{}') into v_casos
      from jsonb_array_elements(coalesce(inv.manifiesto->'objetivos', '[]'::jsonb)) o
     where o ? 'caso_id';
    if coalesce(array_length(v_casos, 1), 0) = 0 then
      select coalesce(array_agg(k.id), '{}') into v_casos
        from forense.casos k where k.corrida_id = inv.corrida_id;
    end if;
  end if;

  -- Casos sin estado terminal
  select coalesce(array_agg(k.id order by k.id), '{}') into v_falt
    from forense.casos k
   where k.id = any(v_casos) and k.estado not in ('dictaminado','error');

  -- Casos sin expediente VALIDADO persistido (16 §1)
  select coalesce(array_agg(x order by x), '{}') into v_sin_reporte
    from unnest(v_casos) x
   where not exists (select 1 from forense.expedientes e
                      where e.caso_id = x and e.estado_revision = 'validado');

  -- Tareas operativas sin resolver
  select count(*) into v_pendientes
    from forense.tareas_agente t
   where t.caso_id = any(v_casos) and t.estado in ('pendiente','ejecutando');

  if coalesce(array_length(v_falt, 1), 0) > 0
     or coalesce(array_length(v_sin_reporte, 1), 0) > 0
     or v_pendientes > 0 then
    update forense.investigaciones
       set estado = case when inv.estado = 'en_cola' then 'investigando' else inv.estado end,
           actualizado = now()
     where id = p_investigacion;
    return jsonb_build_object(
      'ok', false, 'cambio', false, 'error', 'no_evaluable',
      'motivo', 'la investigación no cumple la condición de completitud',
      'casos_no_terminales', to_jsonb(v_falt),
      'casos_sin_reporte_validado', to_jsonb(v_sin_reporte),
      'tareas_pendientes', v_pendientes);
  end if;

  update forense.investigaciones
     set estado = 'investigacion_completa',
         completada_at = now(),
         reporte_manifest = coalesce(p_reporte_manifest, reporte_manifest),
         version_entregada = coalesce(p_version, version_entregada),
         actualizado = now()
   where id = p_investigacion;

  return jsonb_build_object('ok', true, 'cambio', true,
                            'investigacion_id', p_investigacion,
                            'estado', 'investigacion_completa',
                            'casos', to_jsonb(v_casos));
end $$;

-- ---------------------------------------------------------------------
-- 6. Reclamo del outbox con lease (16 §2 paso 4)
-- ---------------------------------------------------------------------

create or replace function forense.reclamar_evento_salida(
  p_owner text, p_segundos int default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  select * into e from forense.eventos_salida
   where estado in ('pendiente','error')
     and coalesce(proximo_intento, now()) <= now()
     and (lease_owner is null or lease_expires_at is null or lease_expires_at < now())
   order by creado
   for update skip locked
   limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'hay_evento', false);
  end if;

  update forense.eventos_salida
     set estado = 'reclamado', lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => greatest(p_segundos, 10)),
         intentos = intentos + 1, actualizado = now()
   where id = e.id;

  return jsonb_build_object('ok', true, 'hay_evento', true, 'event_id', e.id,
                            'investigacion_id', e.investigacion_id, 'tipo', e.tipo,
                            'intentos', e.intentos + 1, 'payload', e.payload);
end $$;

-- ---------------------------------------------------------------------
-- 7. Solicitar la llamada. El destinatario se resuelve en BACKEND desde el
--    perfil propietario; jamás de un teléfono que venga en el payload.
--    Sin número, sin preferencia o sin permiso: `omitida` con motivo, y el
--    aviso in-app se mantiene.
-- ---------------------------------------------------------------------

create or replace function forense.solicitar_llamada(
  p_event_id uuid, p_owner text default 'n8n', p_agent_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e record; inv record; p record; v_intento int; v_id uuid; v_motivo text;
begin
  select * into e from forense.eventos_salida where id = p_event_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;

  -- Una llamada por investigación: si ya hay un intento activo o finalizado,
  -- una entrega repetida del webhook no crea otro.
  if exists (select 1 from forense.llamadas_notificacion l
              where l.event_id = p_event_id
                and l.estado not in ('fallida','sin_respuesta','resultado_desconocido')) then
    select * into p from forense.llamadas_notificacion
     where event_id = p_event_id order by intento desc limit 1;
    return jsonb_build_object('ok', true, 'creada', false, 'motivo', 'intento_existente',
                              'llamada_id', p.id, 'estado', p.estado);
  end if;

  select * into inv from forense.investigaciones where id = e.investigacion_id;
  select * into p from forense.perfiles where id = inv.perfil_id;

  select coalesce(max(intento), 0) + 1 into v_intento
    from forense.llamadas_notificacion where event_id = p_event_id;

  v_motivo := case
    when p.id is null then 'la investigación no tiene perfil propietario'
    when p.telefono_e164 is null then 'el perfil no tiene teléfono configurado'
    when not p.llamadas_activadas then 'el perfil tiene las llamadas desactivadas'
    when not p.permiso_aviso then 'no hay permiso de aviso registrado'
    else null end;

  insert into forense.llamadas_notificacion (
    event_id, intento, estado, motivo, destino, perfil_id, agent_id)
  values (p_event_id, v_intento,
          case when v_motivo is null then 'solicitando' else 'omitida' end,
          v_motivo,
          case when v_motivo is null then p.telefono_e164 else null end,
          p.id, p_agent_id)
  returning id into v_id;

  perform forense.registrar_actividad('llamada_solicitada', p.id, inv.id, inv.caso_id, null,
    jsonb_build_object('event_id', p_event_id, 'intento', v_intento,
                       'estado', case when v_motivo is null then 'solicitando' else 'omitida' end,
                       'motivo', v_motivo,
                       'destino_enmascarado', forense.telefono_enmascarado(p.telefono_e164)));

  return jsonb_build_object(
    'ok', true, 'creada', true, 'llamada_id', v_id, 'intento', v_intento,
    'estado', case when v_motivo is null then 'solicitando' else 'omitida' end,
    'motivo', v_motivo,
    'destino_enmascarado', forense.telefono_enmascarado(
      case when v_motivo is null then p.telefono_e164 else null end));
end $$;

-- ---------------------------------------------------------------------
-- 8. Resultado de la llamada. Solo hechos realmente recibidos: sin callback
--    de timbrado no se muestra "Sonando"; `aviso_entregado` solo es true si
--    el callback lo respalda. Un fallo de voz NO altera el estado forense.
-- ---------------------------------------------------------------------

create or replace function forense.resultado_llamada(
  p_llamada uuid, p_estado text, p_provider_payload jsonb default '{}'::jsonb,
  p_conversation_id text default null, p_call_sid text default null,
  p_aviso_entregado boolean default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  if p_estado not in ('aceptada','en_curso','finalizada','fallida','sin_respuesta',
                      'omitida','resultado_desconocido') then
    return jsonb_build_object('ok', false, 'error', 'argumento_invalido');
  end if;
  select * into l from forense.llamadas_notificacion where id = p_llamada for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;

  update forense.llamadas_notificacion
     set estado = p_estado,
         conversation_id = coalesce(p_conversation_id, conversation_id),
         call_sid = coalesce(p_call_sid, call_sid),
         provider_payload = provider_payload || coalesce(p_provider_payload, '{}'::jsonb),
         -- null se conserva como DESCONOCIDO: la ausencia de dato no es un no
         aviso_entregado = coalesce(p_aviso_entregado, aviso_entregado),
         error = coalesce(p_error, error),
         actualizado = now()
   where id = p_llamada;

  if p_estado in ('finalizada','fallida','sin_respuesta','omitida','resultado_desconocido') then
    update forense.eventos_salida
       set estado = case when p_estado = 'finalizada' then 'entregado' else 'entregado' end,
           lease_owner = null, lease_expires_at = null, actualizado = now()
     where id = l.event_id;
  end if;

  perform forense.registrar_actividad('llamada_resultado', l.perfil_id, null, null, null,
    jsonb_build_object('llamada_id', p_llamada, 'estado', p_estado,
                       'aviso_entregado', p_aviso_entregado));

  return jsonb_build_object('ok', true, 'llamada_id', p_llamada, 'estado', p_estado,
                            'aviso_entregado', coalesce(p_aviso_entregado, l.aviso_entregado));
end $$;

-- Preferencia "no llamar" pedida durante la llamada: se aplica tras verificar
-- el callback, y queda auditada (16 §4).
create or replace function forense.desactivar_llamadas(p_perfil uuid, p_origen text default 'callback')
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update forense.perfiles set llamadas_activadas = false, actualizado = now() where id = p_perfil;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  perform forense.registrar_actividad('preferencia_cambiada', p_perfil, null, null, null,
    jsonb_build_object('llamadas_activadas', false, 'origen', p_origen));
  return jsonb_build_object('ok', true, 'perfil_id', p_perfil, 'llamadas_activadas', false);
end $$;

-- ---------------------------------------------------------------------
-- 9. RLS y permisos: outbox, notificaciones y llamadas son privadas.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['eventos_salida','notificaciones','llamadas_notificacion'] loop
    execute format('alter table forense.%I enable row level security', t);
    execute format('drop policy if exists lectura on forense.%I', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on all tables in schema forense to service_role';
    execute 'grant all on all sequences in schema forense to service_role';
    execute 'grant execute on all functions in schema forense to service_role';
  end if;
end $$;

revoke execute on function
  forense.completar_investigacion(uuid, jsonb, int),
  forense.reclamar_evento_salida(text, int),
  forense.solicitar_llamada(uuid, text, text),
  forense.resultado_llamada(uuid, text, jsonb, text, text, boolean, text),
  forense.desactivar_llamadas(uuid, text)
from public;

-- Fin 007_notificaciones_voz.sql
