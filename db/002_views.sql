-- =====================================================================
-- 002_views.sql — Utilidades compartidas, presupuesto, leases, helpers de
-- runtime (docs/17 §4) y vistas/agregados.
--
-- Orden: primero next_seq/log, después presupuesto y leases, después los
-- helpers de runtime, al final vistas. Así 003_pistas y 004_clusters dejan
-- bitácora sin depender de 005_rpc (docs/05, docs/06).
--
-- Orden de locks fijo en todo el archivo: caso -> ejecución -> cuota/slot.
-- Idempotente: todo es CREATE OR REPLACE / IF NOT EXISTS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Secuencia de bitácora y logger (firma exacta de docs/06)
-- ---------------------------------------------------------------------

create or replace function forense.next_seq(p_caso uuid) returns int
language sql set search_path = '' as $$
  update forense.casos
     set bitacora_seq = bitacora_seq + 1
   where id = p_caso
   returning bitacora_seq
$$;

create or replace function forense.log(
  p_caso uuid, p_agente text, p_tipo text, p_payload jsonb,
  p_dur int default null, p_tin int default null, p_tout int default null,
  p_modelo text default null, p_ronda int default null, p_cluster uuid default null,
  p_tarea uuid default null, p_corrida uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into forense.bitacora
    (caso_id, cluster_id, seq, ronda, agente, tipo_evento, payload, duracion_ms, tokens_in, tokens_out, modelo, tarea_id, intento, corrida_id)
  values
    (p_caso, coalesce(p_cluster, (select cluster_id from forense.casos where id=p_caso)),
     forense.next_seq(p_caso), p_ronda, p_agente, p_tipo, p_payload, p_dur, p_tin, p_tout, p_modelo,
     p_tarea, coalesce((select intento from forense.tareas_agente where id=p_tarea),0),
     coalesce((select corrida_id from forense.casos where id=p_caso),
              (select corrida_id from forense.tareas_agente where id=p_tarea), p_corrida))
$$;

-- ---------------------------------------------------------------------
-- 2. Presupuesto de herramientas (docs/03 §Presupuestos, docs/06 §control)
-- ---------------------------------------------------------------------

create or replace function forense.limite_tool(p_agente text, p_ronda int)
returns int language sql stable set search_path = '' as $$
  select coalesce(
    (select l.limite from forense.limites_agente l where l.agente = p_agente and l.ronda = p_ronda),
    (select l.limite from forense.limites_agente l where l.agente = p_agente order by l.ronda desc limit 1),
    0)
$$;

create or replace function forense.bolsa_agente(p_agente text)
returns text language sql stable set search_path = '' as $$
  select coalesce((select l.bolsa from forense.limites_agente l where l.agente = p_agente order by l.ronda limit 1),
                  'investigacion')
$$;

create or replace function forense.config_int(p_clave text, p_default int default 0)
returns int language sql stable set search_path = '' as $$
  select coalesce((select c.valor from forense.config_presupuesto c where c.clave = p_clave), p_default)
$$;

create or replace function forense.args_hash(p_args jsonb)
returns text language sql immutable set search_path = '' as $$
  select md5(coalesce(p_args, '{}'::jsonb)::text)
$$;

-- reservar_tool: bloquea el caso (FOR UPDATE), valida tarea/lease/contexto,
-- comprueba límite por tarea y techo del caso con reserva de cierre,
-- incrementa contadores y escribe tool_call en la MISMA transacción.
-- Devuelve el contexto de docs/06 o {"error":"presupuesto agotado"}.
create or replace function forense.reservar_tool(
  p_caso uuid, p_tarea uuid, p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k record; t record;
  v_limite int; v_bolsa text; v_total int; v_reserva int; v_techo int;
  v_corte timestamptz;
begin
  select * into k from forense.casos where id = p_caso for update;                    -- lock 1: caso
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'caso inexistente');
  end if;

  select * into t from forense.tareas_agente where id = p_tarea for update;           -- lock 2: tarea
  if not found or t.caso_id <> p_caso then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'tarea no pertenece al caso');
  end if;
  if t.corrida_id <> k.corrida_id then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'tarea y caso de corridas distintas');
  end if;
  if t.estado not in ('pendiente', 'ejecutando') then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'tarea en estado ' || t.estado);
  end if;
  if t.lease_owner is not null and t.lease_expires_at is not null and t.lease_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'lease_vencido',
                              'detalle', 'lease de tarea vencido');
  end if;

  v_limite  := forense.limite_tool(t.agente, t.ronda);
  v_bolsa   := forense.bolsa_agente(t.agente);
  v_total   := forense.config_int('tools_por_caso', 120);
  v_reserva := forense.config_int('reserva_cierre_tools', 27);
  -- La bolsa de cierre (Auditor/Defensor) puede llegar al techo total;
  -- la exploración se detiene antes para no consumir su reserva.
  v_techo   := case when v_bolsa = 'cierre' then v_total else v_total - v_reserva end;

  if t.tool_calls >= v_limite then
    perform forense.log(p_caso, t.agente, 'presupuesto_agotado',
      jsonb_build_object('alcance','tarea','tool',p_tool,'limite',v_limite,'usadas',t.tool_calls),
      null, null, null, null, t.ronda, k.cluster_id, p_tarea);
    return jsonb_build_object('ok', false, 'error', 'presupuesto agotado',
                              'alcance', 'tarea', 'limite', v_limite, 'usadas', t.tool_calls);
  end if;

  if k.tool_calls >= v_techo then
    update forense.casos set presupuesto_agotado = true where id = p_caso;
    perform forense.log(p_caso, t.agente, 'presupuesto_agotado',
      jsonb_build_object('alcance','caso','tool',p_tool,'techo',v_techo,'usadas',k.tool_calls,'bolsa',v_bolsa),
      null, null, null, null, t.ronda, k.cluster_id, p_tarea);
    return jsonb_build_object('ok', false, 'error', 'presupuesto agotado',
                              'alcance', 'caso', 'techo', v_techo, 'usadas', k.tool_calls);
  end if;

  update forense.tareas_agente
     set tool_calls = tool_calls + 1,
         estado     = case when estado = 'pendiente' then 'ejecutando' else estado end,
         iniciado   = coalesce(iniciado, now())
   where id = p_tarea;
  update forense.casos set tool_calls = tool_calls + 1 where id = p_caso;

  select c.fecha_corte into v_corte from forense.corridas c where c.id = k.corrida_id;

  perform forense.log(p_caso, t.agente, 'tool_call',
    jsonb_build_object('tool', p_tool, 'args', coalesce(p_args,'{}'::jsonb), 'tarea_id', p_tarea),
    null, null, null, null, t.ronda, k.cluster_id, p_tarea);

  return jsonb_build_object(
    'ok', true,
    'caso_id', p_caso,
    'tarea_id', p_tarea,
    'corrida_id', k.corrida_id,
    'cluster_id', k.cluster_id,
    'fecha_corte', v_corte,
    'version_contexto', t.version_contexto,
    'ronda', t.ronda,
    'intento', t.intento,
    'agente', t.agente,
    'bolsa', v_bolsa,
    'restante_tarea', v_limite - (t.tool_calls + 1),
    'restante_caso', v_techo - (k.tool_calls + 1));
end $$;

-- ---------------------------------------------------------------------
-- 3. Leases persistentes de cluster y de tarea (docs/05 §Lease persistente)
--    Adquiere si está libre, vencido o es del mismo dueño. Solo el dueño
--    renueva o libera.
-- ---------------------------------------------------------------------

create or replace function forense.lease_cluster_adquirir(p_cluster uuid, p_owner text, p_segundos int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update forense.clusters
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => greatest(p_segundos, 1))
   where id = p_cluster
     and (lease_owner is null or lease_owner = p_owner
          or lease_expires_at is null or lease_expires_at < now())
  returning * into r;
  if found then
    return jsonb_build_object('ok', true, 'owner', p_owner, 'lease_expires_at', r.lease_expires_at);
  end if;
  select * into r from forense.clusters where id = p_cluster;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido', 'detalle', 'cluster inexistente');
  end if;
  return jsonb_build_object('ok', false, 'error', 'lease_ocupado',
                            'owner', r.lease_owner, 'lease_expires_at', r.lease_expires_at);
end $$;

create or replace function forense.lease_cluster_renovar(p_cluster uuid, p_owner text, p_segundos int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update forense.clusters
     set lease_expires_at = now() + make_interval(secs => greatest(p_segundos, 1))
   where id = p_cluster and lease_owner = p_owner and lease_expires_at > now()
  returning * into r;
  if found then
    return jsonb_build_object('ok', true, 'lease_expires_at', r.lease_expires_at);
  end if;
  return jsonb_build_object('ok', false, 'error', 'lease_vencido');
end $$;

create or replace function forense.lease_cluster_liberar(p_cluster uuid, p_owner text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update forense.clusters set lease_owner = null, lease_expires_at = null
   where id = p_cluster and lease_owner = p_owner;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;

create or replace function forense.lease_tarea_adquirir(p_tarea uuid, p_owner text, p_segundos int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update forense.tareas_agente
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => greatest(p_segundos, 1)),
         estado = case when estado = 'pendiente' then 'ejecutando' else estado end,
         iniciado = coalesce(iniciado, now())
   where id = p_tarea
     and estado in ('pendiente','ejecutando')
     and (lease_owner is null or lease_owner = p_owner
          or lease_expires_at is null or lease_expires_at < now())
  returning * into r;
  if found then
    return jsonb_build_object('ok', true, 'owner', p_owner, 'lease_expires_at', r.lease_expires_at,
                              'caso_id', r.caso_id, 'agente', r.agente, 'ronda', r.ronda,
                              'intento', r.intento, 'version_contexto', r.version_contexto);
  end if;
  select * into r from forense.tareas_agente where id = p_tarea;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido', 'detalle', 'tarea inexistente');
  end if;
  return jsonb_build_object('ok', false, 'error', 'lease_ocupado',
                            'owner', r.lease_owner, 'estado', r.estado);
end $$;

create or replace function forense.lease_tarea_renovar(p_tarea uuid, p_owner text, p_segundos int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update forense.tareas_agente
     set lease_expires_at = now() + make_interval(secs => greatest(p_segundos, 1))
   where id = p_tarea and lease_owner = p_owner and lease_expires_at > now()
  returning * into r;
  if found then
    return jsonb_build_object('ok', true, 'lease_expires_at', r.lease_expires_at);
  end if;
  return jsonb_build_object('ok', false, 'error', 'lease_vencido');
end $$;

create or replace function forense.lease_tarea_liberar(p_tarea uuid, p_owner text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update forense.tareas_agente set lease_owner = null, lease_expires_at = null
   where id = p_tarea and lease_owner = p_owner;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;

-- ---------------------------------------------------------------------
-- 4. Helpers de caché de herramientas (docs/03 §Caché)
--    Solo lecturas de hechos inmutables; nunca señales ni escrituras.
-- ---------------------------------------------------------------------

create or replace function forense.cache_get(
  p_corrida uuid, p_cluster uuid, p_version int, p_tool text, p_args_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select tc.resultado from forense.tool_cache tc
   where tc.corrida_id = p_corrida and tc.cluster_id = p_cluster
     and tc.version_contexto = p_version and tc.herramienta = p_tool
     and tc.args_hash = p_args_hash
$$;

create or replace function forense.cache_put(
  p_corrida uuid, p_cluster uuid, p_version int, p_tool text, p_args_hash text, p_resultado jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into forense.tool_cache (corrida_id, cluster_id, version_contexto, herramienta, args_hash, resultado)
  values (p_corrida, p_cluster, p_version, p_tool, p_args_hash, p_resultado)
  on conflict (corrida_id, cluster_id, version_contexto, herramienta, args_hash) do nothing
$$;

-- Al expandir un cluster se invalida el contexto anterior (docs/06 Parte B)
create or replace function forense.cache_invalidar(p_cluster uuid, p_version_anterior int)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from forense.tool_cache
   where cluster_id = p_cluster and version_contexto <= p_version_anterior;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5. Helpers de runtime (docs/17 §4). Firmas congeladas:
--    claim_step(execution_id, owner)
--    reserve_request(execution_id, fence, request_id)
--    claim_tool(execution_id, fence, request_id, tool_use_id, args_hash)
--    save_checkpoint(execution_id, fence, revision_expected, patch)
--    finish_step(execution_id, fence, revision_expected, estado_interno, patch, error)
--    advance_case_if_ready(caso_id, revision_expected)
--    recover_expired(now)
--    Los argumentos extra llevan DEFAULT: la firma corta sigue siendo válida.
--    Ninguna acepta un rol elegido por el LLM: el rol vive en la ejecución.
-- ---------------------------------------------------------------------

create or replace function forense.claim_step(
  p_execution_id uuid, p_owner text, p_lease_segundos int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; v_fence bigint;
begin
  select * into e from forense.ejecuciones_agente where id = p_execution_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido', 'detalle', 'ejecucion inexistente');
  end if;
  if e.cancelada then
    return jsonb_build_object('ok', false, 'error', 'cancelada');
  end if;
  if e.estado_interno in ('terminado','error','timeout') then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'ejecucion terminal', 'estado_interno', e.estado_interno);
  end if;
  if e.lease_owner is not null and e.lease_owner <> p_owner
     and e.lease_expires_at is not null and e.lease_expires_at > now() then
    return jsonb_build_object('ok', false, 'error', 'lease_ocupado', 'owner', e.lease_owner);
  end if;

  -- Toma de un lease libre/vencido o de otro dueño: incrementa el fencing token.
  -- Renovación del mismo dueño: conserva token (el owner identifica al proceso).
  if e.lease_owner is distinct from p_owner then
    v_fence := e.fence_token + 1;
  else
    v_fence := greatest(e.fence_token, 1);
  end if;

  update forense.ejecuciones_agente
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_segundos, 1)),
         fence_token = v_fence,
         actualizado = now()
   where id = p_execution_id;

  return jsonb_build_object(
    'ok', true, 'execution_id', p_execution_id, 'fence', v_fence,
    'revision', e.revision, 'paso', e.paso, 'estado_interno', e.estado_interno,
    'rol', e.rol, 'tarea_id', e.tarea_id, 'caso_id', e.caso_id, 'corrida_id', e.corrida_id,
    'editor_operacion_id', e.editor_operacion_id,
    'checkpoint', e.checkpoint_json, 'deadline_at', e.deadline_at,
    'lease_expires_at', now() + make_interval(secs => greatest(p_lease_segundos, 1)));
end $$;

create or replace function forense.reserve_request(
  p_execution_id uuid, p_fence bigint, p_request_id text,
  p_paso int default null, p_modelo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; s record; v_usadas int; v_total int; v_reserva int; v_techo int; v_bolsa text;
begin
  select * into e from forense.ejecuciones_agente where id = p_execution_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  if p_fence is distinct from e.fence_token then
    return jsonb_build_object('ok', false, 'error', 'lease_vencido', 'fence_actual', e.fence_token);
  end if;

  select * into s from forense.llm_solicitudes where request_id = p_request_id;
  if found then
    -- reintento de transporte con el mismo request_id: no consume cuota nueva
    update forense.llm_solicitudes
       set intento_transporte = intento_transporte + 1, actualizado = now()
     where request_id = p_request_id;
    return jsonb_build_object('ok', true, 'duplicado', true, 'request_id', p_request_id,
                              'estado', s.estado, 'intento_transporte', s.intento_transporte + 1);
  end if;

  v_bolsa := forense.bolsa_agente(e.rol);
  if e.editor_operacion_id is not null then
    v_bolsa := 'editor';
    v_techo := 3;                                   -- docs/17 §6: editor, 3 requests por operación
    select count(*) into v_usadas from forense.llm_solicitudes where ejecucion_id = p_execution_id;
  else
    v_total   := forense.config_int('requests_por_caso', 100);
    v_reserva := forense.config_int('reserva_cierre_requests', 34);
    v_techo   := case when v_bolsa = 'cierre' then v_total else v_total - v_reserva end;
    select count(*) into v_usadas
      from forense.llm_solicitudes l
      join forense.ejecuciones_agente x on x.id = l.ejecucion_id
     where x.caso_id = e.caso_id;
  end if;

  if v_usadas >= v_techo then
    if e.caso_id is not null then
      update forense.casos set presupuesto_agotado = true where id = e.caso_id;
      perform forense.log(e.caso_id, e.rol, 'presupuesto_agotado',
        jsonb_build_object('alcance','requests','techo',v_techo,'usadas',v_usadas,'bolsa',v_bolsa),
        null, null, null, null, null, null, e.tarea_id, e.corrida_id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'presupuesto agotado',
                              'alcance', 'requests', 'techo', v_techo, 'usadas', v_usadas);
  end if;

  insert into forense.llm_solicitudes (request_id, ejecucion_id, paso, estado, bolsa, modelo)
  values (p_request_id, p_execution_id, coalesce(p_paso, e.paso), 'reservado', v_bolsa, p_modelo);

  return jsonb_build_object('ok', true, 'duplicado', false, 'request_id', p_request_id,
                            'bolsa', v_bolsa, 'restante', v_techo - (v_usadas + 1));
end $$;

create or replace function forense.claim_tool(
  p_execution_id uuid, p_fence bigint, p_request_id text, p_tool_use_id text,
  p_args_hash text, p_nombre text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; v_id bigint; t record;
begin
  select * into e from forense.ejecuciones_agente where id = p_execution_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  if p_fence is distinct from e.fence_token then
    return jsonb_build_object('ok', false, 'error', 'lease_vencido', 'fence_actual', e.fence_token);
  end if;

  insert into forense.tool_ejecuciones (ejecucion_id, request_id, tool_use_id, nombre, args_hash, estado)
  values (p_execution_id, p_request_id, p_tool_use_id, p_nombre, p_args_hash, 'ejecutando')
  on conflict (request_id, tool_use_id) do nothing
  returning id into v_id;

  if v_id is null then
    select * into t from forense.tool_ejecuciones
      where request_id = p_request_id and tool_use_id = p_tool_use_id;
    -- Re-entrega del mismo tool_use_id: se devuelve el resultado registrado
    -- y NO se vuelve a consumir cuota ni a insertar señal (docs/06, docs/17).
    return jsonb_build_object('ok', false, 'duplicado', true, 'tool_ejecucion_id', t.id,
                              'estado', t.estado, 'resultado_ref', t.resultado_ref);
  end if;
  return jsonb_build_object('ok', true, 'duplicado', false, 'tool_ejecucion_id', v_id);
end $$;

create or replace function forense.finish_tool(
  p_tool_ejecucion_id bigint, p_estado text, p_resultado_ref jsonb default null,
  p_duracion_ms int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update forense.tool_ejecuciones
     set estado = p_estado, resultado_ref = coalesce(p_resultado_ref, resultado_ref),
         duracion_ms = coalesce(p_duracion_ms, duracion_ms), terminado = now()
   where id = p_tool_ejecucion_id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;

create or replace function forense.save_checkpoint(
  p_execution_id uuid, p_fence bigint, p_revision_expected int, p_patch jsonb,
  p_lease_segundos int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  select * into e from forense.ejecuciones_agente where id = p_execution_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  if p_fence is distinct from e.fence_token then
    -- Fencing: un proceso viejo con lease reasignado no puede escribir.
    return jsonb_build_object('ok', false, 'error', 'lease_vencido',
                              'fence_actual', e.fence_token, 'fence_recibido', p_fence);
  end if;
  if p_revision_expected is distinct from e.revision then
    return jsonb_build_object('ok', false, 'error', 'revision_conflicto',
                              'revision_actual', e.revision);
  end if;

  update forense.ejecuciones_agente
     set checkpoint_json = checkpoint_json || coalesce(p_patch, '{}'::jsonb),
         revision = revision + 1,
         estado_interno = coalesce(p_patch->>'estado_interno', estado_interno),
         paso = coalesce((p_patch->>'paso')::int, paso),
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_segundos, 1)),
         actualizado = now()
   where id = p_execution_id;

  return jsonb_build_object('ok', true, 'revision', e.revision + 1);
end $$;

create or replace function forense.finish_step(
  p_execution_id uuid, p_fence bigint, p_revision_expected int, p_estado_interno text,
  p_patch jsonb default '{}'::jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; v_estado_tarea text;
begin
  select * into e from forense.ejecuciones_agente where id = p_execution_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  if p_fence is distinct from e.fence_token then
    return jsonb_build_object('ok', false, 'error', 'lease_vencido', 'fence_actual', e.fence_token);
  end if;
  if p_revision_expected is distinct from e.revision then
    return jsonb_build_object('ok', false, 'error', 'revision_conflicto', 'revision_actual', e.revision);
  end if;

  update forense.ejecuciones_agente
     set checkpoint_json = checkpoint_json || coalesce(p_patch, '{}'::jsonb),
         revision = revision + 1,
         paso = paso + 1,
         estado_interno = p_estado_interno,
         lease_owner = null,
         lease_expires_at = null,
         actualizado = now()
   where id = p_execution_id;

  if p_estado_interno in ('terminado','error','timeout') and e.tarea_id is not null then
    v_estado_tarea := case p_estado_interno
                        when 'terminado' then 'completada'
                        when 'timeout'   then 'timeout'
                        else 'error' end;
    update forense.tareas_agente
       set estado = v_estado_tarea, terminado = now(), error = p_error,
           lease_owner = null, lease_expires_at = null
     where id = e.tarea_id;
  end if;

  return jsonb_build_object('ok', true, 'revision', e.revision + 1,
                            'estado_interno', p_estado_interno, 'tarea_id', e.tarea_id,
                            'caso_id', e.caso_id);
end $$;

-- Barrera: cierra el paso solo si TODAS las tareas esperadas están en estado
-- terminal. CAS sobre (caso_id, paso, revision) para que dos callbacks no
-- disparen dos auditores (docs/17 §3).
create or replace function forense.advance_case_if_ready(
  p_caso_id uuid, p_revision_expected int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k record; p record; v_pend uuid[]; v_total int;
begin
  select * into k from forense.casos where id = p_caso_id for update;                  -- lock 1: caso
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;

  select * into p from forense.pasos_pipeline
   where caso_id = p_caso_id and estado = 'abierto'
   order by creado desc, id desc limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', true, 'avanzo', false, 'motivo', 'sin_paso_abierto');
  end if;
  if p_revision_expected is not null and p_revision_expected is distinct from p.revision then
    return jsonb_build_object('ok', false, 'error', 'revision_conflicto',
                              'revision_actual', p.revision, 'paso', p.paso);
  end if;

  v_total := coalesce(array_length(p.tareas_esperadas, 1), 0);
  select coalesce(array_agg(t.id), '{}') into v_pend
    from forense.tareas_agente t
   where t.id = any(p.tareas_esperadas)
     and t.estado not in ('completada','error','timeout','omitida');

  if coalesce(array_length(v_pend, 1), 0) > 0 then
    return jsonb_build_object('ok', true, 'avanzo', false, 'paso', p.paso,
                              'revision', p.revision, 'esperadas', v_total,
                              'pendientes', to_jsonb(v_pend));
  end if;

  update forense.pasos_pipeline
     set estado = 'cerrado', cerrado = now(), revision = revision + 1
   where id = p.id;

  perform forense.log(p_caso_id, 'sistema', 'ronda_fin',
    jsonb_build_object('paso', p.paso, 'revision', p.revision + 1, 'tareas', v_total),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  return jsonb_build_object('ok', true, 'avanzo', true, 'paso', p.paso,
                            'revision', p.revision + 1, 'esperadas', v_total);
end $$;

-- Reconciliador: libera leases vencidos (cluster, tarea, ejecución, slot),
-- marca solicitudes ambiguas y pasos vencidos. Recibe el reloj como
-- parámetro para poder probar vencimientos sin esperar.
create or replace function forense.recover_expired(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_cl int; n_ta int; n_ej int; n_sl int; n_rq int; n_pa int;
begin
  update forense.clusters set lease_owner = null, lease_expires_at = null
   where lease_owner is not null and lease_expires_at is not null and lease_expires_at < p_now;
  get diagnostics n_cl = row_count;

  update forense.tareas_agente
     set lease_owner = null, lease_expires_at = null,
         estado = case when estado = 'ejecutando' then 'pendiente' else estado end
   where lease_owner is not null and lease_expires_at is not null and lease_expires_at < p_now;
  get diagnostics n_ta = row_count;

  -- La ejecución conserva su fence_token: el siguiente claim_step lo incrementa
  -- y con eso invalida a cualquier proceso viejo que intente escribir.
  update forense.ejecuciones_agente set lease_owner = null, lease_expires_at = null
   where lease_owner is not null and lease_expires_at is not null and lease_expires_at < p_now
     and estado_interno not in ('terminado','error','timeout');
  get diagnostics n_ej = row_count;

  update forense.slots_runtime set owner = null
   where owner is not null and lease_expires_at is not null and lease_expires_at < p_now;
  get diagnostics n_sl = row_count;

  update forense.llm_solicitudes set estado = 'desconocido', actualizado = now()
   where estado = 'enviado' and creado < p_now - interval '3 minutes';
  get diagnostics n_rq = row_count;

  update forense.pasos_pipeline set estado = 'timeout', cerrado = p_now
   where estado = 'abierto' and deadline is not null and deadline < p_now;
  get diagnostics n_pa = row_count;

  return jsonb_build_object('ok', true, 'now', p_now,
    'clusters', n_cl, 'tareas', n_ta, 'ejecuciones', n_ej,
    'slots', n_sl, 'solicitudes', n_rq, 'pasos', n_pa);
end $$;

-- Slots de concurrencia con fencing (docs/17 §4)
create or replace function forense.claim_slot(p_recurso text, p_owner text, p_segundos int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select * into r from forense.slots_runtime
   where recurso = p_recurso
     and (owner is null or owner = p_owner or lease_expires_at is null or lease_expires_at < now())
   order by slot
   for update skip locked
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sin_slot', 'recurso', p_recurso);
  end if;
  update forense.slots_runtime
     set owner = p_owner,
         lease_expires_at = now() + make_interval(secs => greatest(p_segundos, 1)),
         fencing_token = case when owner is distinct from p_owner then fencing_token + 1 else fencing_token end,
         actualizado = now()
   where recurso = r.recurso and slot = r.slot
  returning * into r;
  return jsonb_build_object('ok', true, 'recurso', r.recurso, 'slot', r.slot,
                            'fencing_token', r.fencing_token, 'lease_expires_at', r.lease_expires_at);
end $$;

create or replace function forense.release_slot(p_recurso text, p_slot int, p_owner text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update forense.slots_runtime set owner = null, actualizado = now()
   where recurso = p_recurso and slot = p_slot and owner = p_owner;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;

-- ---------------------------------------------------------------------
-- 6. Vistas de lectura
-- ---------------------------------------------------------------------

create or replace view forense.v_casos_lista with (security_invoker = true) as
select k.*, c.razon_social, c.giro,
       (select count(*) from forense.evidencia e where e.caso_id = k.id and e.validada) as n_evidencia,
       (select count(*) from forense.defensas d where d.caso_id = k.id and d.resultado <> 'no_refuta') as n_defensas,
       cl.n_rfcs as cluster_tamano
from forense.casos k
left join forense.contribuyentes c on c.rfc = k.rfc_principal and c.corrida_id = k.corrida_id
left join forense.clusters cl on cl.id = k.cluster_id;

-- Agregado real por RFC en ventana de 12 meses cerrada en fecha_corte.
-- LEFT JOIN desde contribuyentes: los RFC sin actividad conservan su fila en 0.
create or replace view forense.v_agregado_rfc with (security_invoker = true) as
with base as (
  select c.corrida_id, c.rfc, coalesce(c.giro, 'sin_giro') as giro, r.fecha_corte
    from forense.contribuyentes c
    join forense.corridas r on r.id = c.corrida_id
),
agg as (
  select b.corrida_id, b.rfc, b.giro, b.fecha_corte,
    coalesce(sum(f.total) filter (where f.emisor_rfc = b.rfc and f.tipo = 'I' and not f.cancelado), 0) as facturacion_12m,
    coalesce(sum(f.total) filter (where f.receptor_rfc = b.rfc and f.tipo = 'I' and not f.cancelado), 0) as compras_12m,
    coalesce(sum(f.total) filter (where f.emisor_rfc = b.rfc and f.tipo = 'N' and not f.cancelado), 0) as nomina_12m,
    count(distinct f.receptor_rfc) filter (where f.emisor_rfc = b.rfc and f.tipo = 'I' and not f.cancelado) as n_clientes,
    count(distinct f.emisor_rfc)   filter (where f.receptor_rfc = b.rfc and f.tipo = 'I' and not f.cancelado) as n_proveedores,
    count(*) filter (where f.emisor_rfc = b.rfc and f.tipo = 'I') as n_emitidas,
    count(*) filter (where f.emisor_rfc = b.rfc and f.tipo = 'I' and f.cancelado) as n_canceladas
  from base b
  left join forense.cfdi f
    on f.corrida_id = b.corrida_id
   and (f.emisor_rfc = b.rfc or f.receptor_rfc = b.rfc)
   and f.fecha >  b.fecha_corte - interval '12 months'
   and f.fecha <= b.fecha_corte
  group by b.corrida_id, b.rfc, b.giro, b.fecha_corte
)
select corrida_id, rfc, giro, fecha_corte,
       facturacion_12m, compras_12m, nomina_12m,
       n_clientes, n_proveedores, n_emitidas, n_canceladas,
       case when facturacion_12m > 0 then round(nomina_12m / facturacion_12m, 4) end as ratio_nomina,
       case when n_emitidas > 0 then round(n_canceladas::numeric / n_emitidas, 4) else 0 end as tasa_cancelacion
from agg;

drop materialized view if exists forense.v_pares_giro;
create materialized view forense.v_pares_giro as
select corrida_id, giro,
  count(*) as n_pares,
  percentile_cont(0.1) within group (order by facturacion_12m)  as fact_p10,
  percentile_cont(0.5) within group (order by facturacion_12m)  as fact_p50,
  percentile_cont(0.9) within group (order by facturacion_12m)  as fact_p90,
  percentile_cont(0.1) within group (order by ratio_nomina)     as nomina_p10,
  percentile_cont(0.5) within group (order by ratio_nomina)     as nomina_p50,
  percentile_cont(0.1) within group (order by compras_12m)      as compras_p10,
  percentile_cont(0.9) within group (order by tasa_cancelacion) as cancel_p90,
  percentile_cont(0.5) within group (order by n_clientes)       as clientes_p50
from forense.v_agregado_rfc
group by corrida_id, giro;

create unique index if not exists ux_pares_giro on forense.v_pares_giro (corrida_id, giro);

-- Grafo para la UI: nodos y aristas hasta N saltos desde un RFC.
create or replace function forense.v_grafo(p_corrida uuid, p_rfc text, p_prof int default 2)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_prof int := least(greatest(coalesce(p_prof, 2), 1), 4); v_corte timestamptz; v_out jsonb;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;
  if v_corte is null then
    return jsonb_build_object('error', 'corrida no encontrada');
  end if;

  with recursive aristas as (
    select emisor_rfc as a, receptor_rfc as b, count(*)::int as n, sum(total) as monto
      from forense.cfdi
     where corrida_id = p_corrida and not cancelado
       and fecha <= v_corte
       and emisor_rfc is not null and receptor_rfc is not null
     group by 1, 2
  ),
  alcance as (
    select p_rfc as rfc, 0 as prof
    union
    select case when ar.a = al.rfc then ar.b else ar.a end, al.prof + 1
      from alcance al
      join aristas ar on ar.a = al.rfc or ar.b = al.rfc
     where al.prof < v_prof
  ),
  nodos as (select rfc, min(prof) as prof from alcance group by rfc),
  nodos_json as (
    select jsonb_agg(jsonb_build_object(
             'rfc', n.rfc, 'prof', n.prof,
             'razon_social_untrusted', c.razon_social,
             'giro', c.giro,
             'existe', (c.rfc is not null),
             'en_69b', exists (select 1 from forense.listas_sat l
                                where l.corrida_id = p_corrida and l.rfc = n.rfc
                                  and l.lista like '69B%' and l.fecha_publicacion <= v_corte::date),
             'frontera', (n.prof = v_prof and exists (
                            select 1 from aristas ar
                             where (ar.a = n.rfc or ar.b = n.rfc)
                               and case when ar.a = n.rfc then ar.b else ar.a end
                                   not in (select rfc from nodos)))
           ) order by n.prof, n.rfc) as j
      from nodos n
      left join forense.contribuyentes c on c.corrida_id = p_corrida and c.rfc = n.rfc
  ),
  aristas_json as (
    select jsonb_agg(jsonb_build_object(
             'tipo', 'cfdi', 'de', ar.a, 'a', ar.b,
             'n_cfdi', ar.n, 'monto', ar.monto::text) order by ar.a, ar.b) as j
      from aristas ar
     where ar.a in (select rfc from nodos) and ar.b in (select rfc from nodos)
  ),
  cuentas_nodo as (
    select cu.clabe, cu.rfc_titular, cu.banco, cu.tipo
      from forense.cuentas cu
     where cu.corrida_id = p_corrida and cu.rfc_titular in (select rfc from nodos)
  ),
  cuentas_json as (
    select jsonb_agg(jsonb_build_object('clabe', clabe, 'rfc_titular', rfc_titular,
                                        'banco', banco, 'tipo', tipo) order by clabe) as j
      from cuentas_nodo
  ),
  mov_json as (
    select jsonb_agg(x.j order by x.origen, x.destino) as j from (
      select m.cuenta_origen as origen, m.cuenta_destino as destino,
             jsonb_build_object('tipo','movimiento','de',m.cuenta_origen,'a',m.cuenta_destino,
                                'n_mov', count(*)::int, 'monto', sum(m.monto)::text,
                                'moneda', min(m.moneda)) as j
        from forense.movimientos m
       where m.corrida_id = p_corrida and m.fecha <= v_corte
         and (m.cuenta_origen in (select clabe from cuentas_nodo)
              or m.cuenta_destino in (select clabe from cuentas_nodo))
       group by m.cuenta_origen, m.cuenta_destino
    ) x
  )
  select jsonb_build_object(
    'corrida_id', p_corrida, 'rfc', p_rfc, 'profundidad', v_prof, 'fecha_corte', v_corte,
    'nodos', coalesce((select j from nodos_json), '[]'::jsonb),
    'aristas_cfdi', coalesce((select j from aristas_json), '[]'::jsonb),
    'cuentas', coalesce((select j from cuentas_json), '[]'::jsonb),
    'aristas_dinero', coalesce((select j from mov_json), '[]'::jsonb))
  into v_out;

  return v_out;
end $$;

-- Trayectoria (docs/21 §2): serie mensual con eventos marcados.
-- El Redactor la cita; nunca la inventa.
create or replace function forense.v_trayectoria_rfc(p_corrida uuid, p_rfc text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_corte timestamptz; v_alta date; v_primer timestamptz; v_inicio timestamptz;
  v_serie jsonb; v_eventos jsonb := '[]'::jsonb; v_pico record; v_elem jsonb;
  v_cero_desde text := null; v_cero_n int := 0; v_activo boolean := false;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;
  if v_corte is null then
    return jsonb_build_object('error', 'corrida no encontrada');
  end if;
  select fecha_alta into v_alta from forense.contribuyentes
   where corrida_id = p_corrida and rfc = p_rfc;
  select min(fecha) into v_primer from forense.cfdi
   where corrida_id = p_corrida and emisor_rfc = p_rfc and not cancelado and fecha <= v_corte;

  v_inicio := date_trunc('month', coalesce(v_alta::timestamptz, v_primer, v_corte - interval '23 months'));
  if v_inicio > date_trunc('month', v_corte) then
    v_inicio := date_trunc('month', v_corte);
  end if;

  with meses as (
    select generate_series(v_inicio, date_trunc('month', v_corte), interval '1 month') as mes
  ),
  cf as (
    select date_trunc('month', fecha) as mes,
           coalesce(sum(total) filter (where emisor_rfc = p_rfc and tipo = 'I' and not cancelado), 0) as emitido,
           coalesce(sum(total) filter (where receptor_rfc = p_rfc and tipo = 'I' and not cancelado), 0) as recibido,
           coalesce(sum(total) filter (where emisor_rfc = p_rfc and tipo = 'N' and not cancelado), 0) as nomina,
           count(*) filter (where emisor_rfc = p_rfc and tipo = 'I' and not cancelado) as n_emitidos,
           count(*) filter (where receptor_rfc = p_rfc and tipo = 'I' and not cancelado) as n_recibidos
      from forense.cfdi
     where corrida_id = p_corrida and fecha <= v_corte
       and (emisor_rfc = p_rfc or receptor_rfc = p_rfc)
     group by 1
  ),
  cu as (
    select clabe from forense.cuentas where corrida_id = p_corrida and rfc_titular = p_rfc
  ),
  mv as (
    select date_trunc('month', m.fecha) as mes,
           coalesce(sum(m.monto) filter (where m.cuenta_destino in (select clabe from cu)), 0) as entrada,
           coalesce(sum(m.monto) filter (where m.cuenta_origen  in (select clabe from cu)), 0) as salida
      from forense.movimientos m
     where m.corrida_id = p_corrida and m.fecha <= v_corte
       and (m.cuenta_origen in (select clabe from cu) or m.cuenta_destino in (select clabe from cu))
     group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'mes', to_char(m.mes, 'YYYY-MM'),
           'emitido', coalesce(cf.emitido, 0)::text,
           'recibido', coalesce(cf.recibido, 0)::text,
           'nomina', coalesce(cf.nomina, 0)::text,
           'n_cfdi_emitidos', coalesce(cf.n_emitidos, 0),
           'n_cfdi_recibidos', coalesce(cf.n_recibidos, 0),
           'dinero_entrada', coalesce(mv.entrada, 0)::text,
           'dinero_salida', coalesce(mv.salida, 0)::text
         ) order by m.mes)
    into v_serie
    from meses m
    left join cf on cf.mes = m.mes
    left join mv on mv.mes = m.mes;

  v_serie := coalesce(v_serie, '[]'::jsonb);

  if v_alta is not null then
    v_eventos := v_eventos || jsonb_build_array(jsonb_build_object(
      'tipo', 'alta', 'mes', to_char(v_alta, 'YYYY-MM'), 'fecha', v_alta));
  end if;
  if v_primer is not null then
    v_eventos := v_eventos || jsonb_build_array(jsonb_build_object(
      'tipo', 'primer_cfdi', 'mes', to_char(v_primer, 'YYYY-MM'), 'fecha', v_primer));
  end if;

  select to_char(date_trunc('month', fecha), 'YYYY-MM') as mes, sum(total) as monto
    into v_pico
    from forense.cfdi
   where corrida_id = p_corrida and emisor_rfc = p_rfc and tipo = 'I'
     and not cancelado and fecha <= v_corte
   group by 1 order by 2 desc, 1 limit 1;
  if v_pico.mes is not null then
    v_eventos := v_eventos || jsonb_build_array(jsonb_build_object(
      'tipo', 'pico', 'mes', v_pico.mes, 'monto', v_pico.monto::text));
  end if;

  -- silencio: dos o más meses consecutivos sin emisión después de haber emitido
  for v_elem in select * from jsonb_array_elements(v_serie) loop
    if (v_elem->>'n_cfdi_emitidos')::int > 0 then
      if v_activo and v_cero_n >= 2 then
        v_eventos := v_eventos || jsonb_build_array(jsonb_build_object(
          'tipo', 'silencio', 'mes', v_cero_desde, 'meses', v_cero_n));
      end if;
      v_activo := true; v_cero_n := 0; v_cero_desde := null;
    else
      if v_activo then
        if v_cero_n = 0 then v_cero_desde := v_elem->>'mes'; end if;
        v_cero_n := v_cero_n + 1;
      end if;
    end if;
  end loop;
  if v_activo and v_cero_n >= 2 then
    v_eventos := v_eventos || jsonb_build_array(jsonb_build_object(
      'tipo', 'silencio', 'mes', v_cero_desde, 'meses', v_cero_n));
  end if;

  v_eventos := v_eventos || coalesce((
    select jsonb_agg(jsonb_build_object(
             'tipo', 'publicacion_69b', 'mes', to_char(l.fecha_publicacion, 'YYYY-MM'),
             'fecha', l.fecha_publicacion, 'lista', l.lista, 'estatus', l.estatus)
           order by l.fecha_publicacion)
      from forense.listas_sat l
     where l.corrida_id = p_corrida and l.rfc = p_rfc
       and l.fecha_publicacion <= v_corte::date), '[]'::jsonb);

  return jsonb_build_object(
    'corrida_id', p_corrida, 'rfc', p_rfc, 'fecha_corte', v_corte,
    'serie', v_serie, 'eventos', v_eventos,
    'cobertura', jsonb_build_object(
      'desde', to_char(v_inicio, 'YYYY-MM'), 'hasta', to_char(v_corte, 'YYYY-MM'),
      'entidad_en_padron', (v_alta is not null)));
end $$;

-- ---------------------------------------------------------------------
-- 7. Clonado de corrida (docs/05 §Control de experimentos)
--    Copia SOLO dominio + ground_truth, conserva IDs/hash/fecha_corte y
--    deja la corrida nueva en 'lista'. Pistas, clusters, señales, casos,
--    caché y tareas empiezan vacíos.
-- ---------------------------------------------------------------------

create or replace function forense.clonar_corrida(p_origen uuid, p_nombre text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o record; v_nueva uuid; v_filas jsonb := '{}'::jsonb; n int;
begin
  select * into o from forense.corridas where id = p_origen;
  if not found then
    raise exception 'corrida origen % no existe', p_origen using errcode = '22023';
  end if;

  insert into forense.corridas (
    nombre, dataset, dataset_hash, fecha_corte, corrida_origen_id, estado,
    version_prompts, version_reglas, modo, familias_evaluables, notas)
  values (
    p_nombre, o.dataset, o.dataset_hash, o.fecha_corte, p_origen, 'preparando',
    o.version_prompts, o.version_reglas, o.modo, o.familias_evaluables,
    'clon de ' || p_origen::text)
  returning id into v_nueva;

  insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta, domicilio, cp,
                                      representante, email, telefono, empleados_declarados, corrida_id)
  select rfc, razon_social, giro, tipo_persona, fecha_alta, domicilio, cp,
         representante, email, telefono, empleados_declarados, v_nueva
    from forense.contribuyentes where corrida_id = p_origen;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('contribuyentes', n);

  insert into forense.cuentas (clabe, rfc_titular, banco, tipo, moneda, saldo_inicial, fecha_saldo_inicial, corrida_id)
  select clabe, rfc_titular, banco, tipo, moneda, saldo_inicial, fecha_saldo_inicial, v_nueva
    from forense.cuentas where corrida_id = p_origen;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('cuentas', n);

  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total, moneda,
                            metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion, cancelado,
                            fecha_cancelacion, motivo_cancelacion, uuid_sustituye, corrida_id)
  select uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total, moneda,
         metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion, cancelado,
         fecha_cancelacion, motivo_cancelacion, uuid_sustituye, v_nueva
    from forense.cfdi where corrida_id = p_origen;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('cfdi', n);

  insert into forense.complementos_pago (uuid_pago, uuid_cfdi, fecha, monto, corrida_id)
  select uuid_pago, uuid_cfdi, fecha, monto, v_nueva
    from forense.complementos_pago where corrida_id = p_origen;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('complementos_pago', n);

  insert into forense.movimientos (id, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, referencia, corrida_id)
  select id, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, referencia, v_nueva
    from forense.movimientos where corrida_id = p_origen;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('movimientos', n);

  insert into forense.atributos_entidad (rfc, atributo, valor, fuente, corrida_id)
  select rfc, atributo, valor, fuente, v_nueva
    from forense.atributos_entidad where corrida_id = p_origen;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('atributos_entidad', n);

  insert into forense.listas_sat (rfc, lista, estatus, fecha_publicacion, oficio, razon_social, corrida_id)
  select rfc, lista, estatus, fecha_publicacion, oficio, razon_social, v_nueva
    from forense.listas_sat where corrida_id = p_origen;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('listas_sat', n);

  insert into forense.ground_truth (rfc, corrida_id, es_fraude, tipologia, es_trampa_legitima, nota)
  select rfc, v_nueva, es_fraude, tipologia, es_trampa_legitima, nota
    from forense.ground_truth where corrida_id = p_origen;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('ground_truth', n);

  update forense.corridas set estado = 'lista' where id = v_nueva;

  -- Rastro obligatorio: ningún paso del pipeline existe si no dejó bitácora.
  perform forense.log(null, 'sistema', 'pista_cargada',
    jsonb_build_object('evento_real', 'corrida_clonada', 'origen', p_origen,
                       'destino', v_nueva, 'filas_por_tabla', v_filas,
                       'dataset_hash', o.dataset_hash, 'fecha_corte', o.fecha_corte),
    null, null, null, null, null, null, null, v_nueva);

  return v_nueva;
end $$;

-- ---------------------------------------------------------------------
-- 8. Métricas de corrida — IMPLEMENTACIÓN PARCIAL (docs/10)
--    Calcula lo que ya es calculable con 001+002 y declara 'parcial': true
--    con la lista de lo que falta. Denominador cero => null, nunca 0% ficticio.
--    Vive en forense (NO en public con prefijo forense_): lee ground_truth.
-- ---------------------------------------------------------------------

create or replace function forense.v_metricas_corrida(p_corrida uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c record; m jsonb;
begin
  select * into c from forense.corridas where id = p_corrida;
  if not found then
    return jsonb_build_object('error', 'corrida no encontrada');
  end if;

  with res_rfc as (
    -- resultados por RFC: primero la atribución explícita de resultado_por_rfc,
    -- si el caso aún no la tiene, el nivel del RFC principal. Nunca se propaga
    -- el nivel del caso a los satélites.
    select k.id as caso_id, k.terminado, k.tipologia as caso_tipologia,
           x.rfc, x.nivel
      from forense.casos k
      cross join lateral (
        select e->>'rfc' as rfc, e->>'nivel' as nivel
          from jsonb_array_elements(k.resultado_por_rfc) e
         where e ? 'rfc'
        union all
        select k.rfc_principal, k.nivel
         where jsonb_array_length(k.resultado_por_rfc) = 0 and k.rfc_principal is not null
      ) x
     where k.corrida_id = p_corrida
  ),
  vigente as (
    select distinct on (rfc) rfc, nivel, caso_id, caso_tipologia
      from res_rfc
     order by rfc, terminado desc nulls last, caso_id
  ),
  gt as (
    select g.rfc, g.es_fraude, g.tipologia, g.es_trampa_legitima,
           v.nivel,
           case
             when v.nivel in ('presuncion','presuncion_alta') then 'positivo'
             when v.nivel in ('sin_hallazgos','anomalia_explicada') then 'negativo'
             else 'sin_conclusion'
           end as prediccion,
           v.caso_tipologia
      from forense.ground_truth g
      left join vigente v on v.rfc = g.rfc
     where g.corrida_id = p_corrida
  ),
  agg as (
    select
      count(*) as total_gt,
      count(*) filter (where es_fraude) as total_fraude,
      count(*) filter (where es_trampa_legitima) as total_trampas,
      count(*) filter (where prediccion = 'positivo' and es_fraude) as tp,
      count(*) filter (where prediccion = 'positivo' and not es_fraude) as fp,
      count(*) filter (where prediccion = 'negativo' and es_fraude) as fn_selectivo,
      count(*) filter (where prediccion = 'negativo' and not es_fraude) as tn,
      count(*) filter (where prediccion = 'sin_conclusion') as sin_conclusion,
      count(*) filter (where es_trampa_legitima and prediccion = 'positivo') as trampas_fp,
      count(*) filter (where es_trampa_legitima and prediccion <> 'sin_conclusion') as trampas_concluyentes,
      count(*) filter (where es_trampa_legitima and prediccion = 'sin_conclusion') as trampas_sin_conclusion,
      count(*) filter (where prediccion = 'positivo' and es_fraude
                         and caso_tipologia is not distinct from tipologia) as tp_tipologia_ok
      from gt
  ),
  por_tipologia as (
    select coalesce(jsonb_object_agg(t.tipologia, jsonb_build_object(
             'total', t.total, 'tp', t.tp,
             'recall', case when t.total > 0 then round(t.tp::numeric / t.total, 4) end)), '{}'::jsonb) as j
      from (
        select coalesce(tipologia, 'sin_tipologia') as tipologia,
               count(*) as total,
               count(*) filter (where prediccion = 'positivo') as tp
          from gt where es_fraude group by 1
      ) t
  ),
  casos_agg as (
    select count(*) as n_casos,
           count(*) filter (where presupuesto_agotado) as n_presupuesto_agotado,
           coalesce(sum(tool_calls), 0) as tool_calls,
           coalesce(sum(tokens_total), 0) as tokens_total,
           coalesce(sum(n_reintentos), 0) as reintentos,
           percentile_cont(0.5) within group (order by duracion_ms) as duracion_p50,
           percentile_cont(0.95) within group (order by duracion_ms) as duracion_p95,
           coalesce(jsonb_object_agg(nivel, n) filter (where nivel is not null), '{}'::jsonb) as por_nivel
      from (
        select presupuesto_agotado, tool_calls, tokens_total, n_reintentos, duracion_ms, nivel,
               count(*) over (partition by nivel) as n
          from forense.casos where corrida_id = p_corrida
      ) s
  )
  select jsonb_build_object(
    'corrida_id', p_corrida,
    'dataset', c.dataset,
    'dataset_hash', c.dataset_hash,
    'fecha_corte', c.fecha_corte,
    'corrida_origen_id', c.corrida_origen_id,
    'version_prompts', c.version_prompts,
    'version_reglas', c.version_reglas,
    'modo', c.modo,
    'estado_corrida', c.estado,
    'terminal', (c.estado in ('completada','error')),
    'parcial', true,
    'cohorte', jsonb_build_object(
      'total_ground_truth', a.total_gt,
      'total_fraude', a.total_fraude,
      'total_trampas', a.total_trampas,
      'sin_conclusion', a.sin_conclusion),
    'selectivas', jsonb_build_object(
      'tp', a.tp, 'fp', a.fp, 'fn_selectivo', a.fn_selectivo, 'tn', a.tn,
      'precision', case when (a.tp + a.fp) > 0 then round(a.tp::numeric / (a.tp + a.fp), 4) end,
      'recall',    case when (a.tp + a.fn_selectivo) > 0 then round(a.tp::numeric / (a.tp + a.fn_selectivo), 4) end,
      'f1', case when (2*a.tp + a.fp + a.fn_selectivo) > 0
                 then round((2.0 * a.tp) / (2*a.tp + a.fp + a.fn_selectivo), 4) end),
    'extremo_a_extremo', jsonb_build_object(
      'fn_conservador', a.total_fraude - a.tp,
      'recall_conservador', case when a.total_fraude > 0 then round(a.tp::numeric / a.total_fraude, 4) end),
    'cobertura', jsonb_build_object(
      'concluyentes', a.total_gt - a.sin_conclusion,
      'ratio', case when a.total_gt > 0 then round((a.total_gt - a.sin_conclusion)::numeric / a.total_gt, 4) end,
      'trampas_investigadas', a.trampas_concluyentes),
    'fpr_trampas', jsonb_build_object(
      'fp', a.trampas_fp, 'n', a.total_trampas,
      'concluyentes', a.trampas_concluyentes,
      'sin_conclusion', a.trampas_sin_conclusion,
      'fpr_concluyentes', case when a.trampas_concluyentes > 0
                               then round(a.trampas_fp::numeric / a.trampas_concluyentes, 4) end,
      'rango_min', case when a.total_trampas > 0 then round(a.trampas_fp::numeric / a.total_trampas, 4) end,
      'rango_max', case when a.total_trampas > 0
                        then round((a.trampas_fp + a.trampas_sin_conclusion)::numeric / a.total_trampas, 4) end,
      'texto', case when a.total_trampas > 0
                    then a.trampas_fp::text || '/' || a.total_trampas::text end),
    'recall_por_tipologia', pt.j,
    'acierto_tipologia', case when a.tp > 0 then round(a.tp_tipologia_ok::numeric / a.tp, 4) end,
    'operacion', jsonb_build_object(
      'casos', ca.n_casos, 'presupuesto_agotado', ca.n_presupuesto_agotado,
      'tool_calls', ca.tool_calls, 'tokens_total', ca.tokens_total,
      'reintentos', ca.reintentos,
      'duracion_ms_p50', ca.duracion_p50, 'duracion_ms_p95', ca.duracion_p95,
      'casos_por_nivel', ca.por_nivel),
    'no_implementado', jsonb_build_array(
      'negativos_del_selector (requiere barrido de pistas de 003)',
      'acierto_de_cache (requiere instrumentacion de 005)',
      'tasa_de_ronda_2 y fronteras (requiere 004/runtime)',
      'costo_usd (requiere version de precios y usage real)',
      'baseline_dos_pistas (requiere 003)')
  ) into m
  from agg a, por_tipologia pt, casos_agg ca;

  return m;
end $$;

-- ---------------------------------------------------------------------
-- 9. Permisos: mutadores y helpers privados no son ejecutables por anon.
-- ---------------------------------------------------------------------

revoke execute on all functions in schema forense from public;

do $$
declare rol text; f text;
  lectura text[] := array[
    'v_grafo(uuid,text,integer)',
    'v_trayectoria_rfc(uuid,text)',
    'v_metricas_corrida(uuid)'
  ];
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema forense to service_role';
    execute 'grant select on forense.v_casos_lista to service_role';
    execute 'grant select on forense.v_agregado_rfc to service_role';
    execute 'grant select on forense.v_pares_giro to service_role';
  end if;
  foreach rol in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = rol) then
      execute format('grant select on forense.v_casos_lista to %I', rol);
      execute format('grant select on forense.v_agregado_rfc to %I', rol);
      execute format('grant select on forense.v_pares_giro to %I', rol);
      foreach f in array lectura loop
        execute format('grant execute on function forense.%s to %I', f, rol);
      end loop;
    end if;
  end loop;
end $$;

-- Fin 002_views.sql
