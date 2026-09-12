-- =====================================================================
-- 006_producto_ui.sql — Capa de producto: perfil, investigaciones, vistas
-- guardadas, propuestas de edición, expediente con contenido TipTap y
-- actividad. Fuente normativa: docs/16 §5 y docs/15.
--
-- Migración ADITIVA sobre 001–005. No renombra ni renumera nada.
--
-- Regla de permisos (16 §5): "Tablas nuevas con perfil/teléfono/propuestas/
-- outbox NO heredan SELECT público". Aquí se habilita RLS sin política de
-- lectura: solo service_role (que bypassea RLS) entra, y el BFF valida sesión
-- y propietario antes de servir nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Perfil. El teléfono es privado y nunca sale en una lectura anónima.
-- ---------------------------------------------------------------------

create table if not exists forense.perfiles (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  organizacion        text,
  correo              text,
  telefono_e164       text check (telefono_e164 is null or telefono_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  timezone            text not null default 'America/Monterrey',
  preferencias        jsonb not null default '{}'::jsonb,
  llamadas_activadas  boolean not null default false,
  permiso_aviso       boolean not null default false,
  permiso_aviso_at    timestamptz,
  demo_compartido     boolean not null default true,   -- 16 §5: no se finge identidad fuerte
  creado              timestamptz default now(),
  actualizado         timestamptz default now()
);

-- El teléfono enmascarado es lo único que puede salir fuera del propio perfil.
create or replace function forense.telefono_enmascarado(p_tel text)
returns text language sql immutable set search_path = '' as $$
  select case when p_tel is null or length(p_tel) < 4 then null
              else repeat('•', greatest(length(p_tel) - 4, 0)) || right(p_tel, 4) end
$$;

-- ---------------------------------------------------------------------
-- 2. Investigaciones: la unidad de notificación (16 §1)
--    Su estado de ENTREGA es distinto de casos.nivel y de corridas.estado.
-- ---------------------------------------------------------------------

create table if not exists forense.investigaciones (
  id                     uuid primary key default gen_random_uuid(),
  perfil_id              uuid references forense.perfiles(id) on delete set null,
  modo                   text not null check (modo in ('caso','corrida')),
  corrida_id             uuid references forense.corridas(id) on delete cascade,
  caso_id                uuid references forense.casos(id) on delete cascade,
  investigacion_padre_id uuid references forense.investigaciones(id) on delete set null,
  manifiesto             jsonb not null default '{"objetivos":[]}'::jsonb,
  estado                 text not null default 'en_cola'
                         check (estado in ('en_cola','investigando','generando_reporte',
                                           'investigacion_completa','parcial','error','cancelada')),
  mensaje                text,
  directriz_id           uuid,
  directriz_version      int,
  contexto_resuelto      jsonb,
  contexto_hash          text,
  idempotency_key        text,
  reporte_manifest       jsonb not null default '[]'::jsonb,
  version_entregada      int,
  creado                 timestamptz default now(),
  actualizado            timestamptz default now(),
  completada_at          timestamptz,
  constraint ck_investigaciones_modo check (
    (modo = 'caso'    and caso_id is not null) or
    (modo = 'corrida' and corrida_id is not null))
);
create unique index if not exists ux_investigaciones_idempotency
  on forense.investigaciones (idempotency_key);
create index if not exists ix_investigaciones_perfil
  on forense.investigaciones (perfil_id, creado desc);
create index if not exists ix_investigaciones_estado
  on forense.investigaciones (estado, creado desc);

-- ---------------------------------------------------------------------
-- 3. Vistas guardadas (15): filtros y visualización de una ruta
-- ---------------------------------------------------------------------

create table if not exists forense.vistas_guardadas (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid not null references forense.perfiles(id) on delete cascade,
  nombre         text not null,
  ruta           text not null,
  filtros        jsonb not null default '{}'::jsonb,
  visualizacion  jsonb not null default '{}'::jsonb,
  version_esquema int not null default 1,
  creado         timestamptz default now(),
  actualizado    timestamptz default now(),
  unique (perfil_id, nombre)
);

-- ---------------------------------------------------------------------
-- 4. Expediente: contenido TipTap + estado de revisión (16 §5)
--    El Markdown se conserva. La entrega exige una versión `validado`;
--    el autoguardado puede dejar `borrador`.
-- ---------------------------------------------------------------------

alter table forense.expedientes add column if not exists contenido_json jsonb;
alter table forense.expedientes add column if not exists estado_revision text
  not null default 'borrador';
alter table forense.expedientes add column if not exists version_base int;
alter table forense.expedientes add column if not exists propuesta_id uuid;
alter table forense.expedientes add column if not exists actualizado timestamptz default now();

alter table forense.expedientes drop constraint if exists ck_expedientes_revision;
alter table forense.expedientes add constraint ck_expedientes_revision
  check (estado_revision in ('borrador','validado'));

-- `v_casos_lista` no toca expedientes, pero la vista de historial sí: se
-- recrea aquí por la misma razón que en 005 (select k.* cambia de forma).
drop view if exists forense.v_casos_lista;
create view forense.v_casos_lista with (security_invoker = true) as
select k.*, c.razon_social, c.giro,
       (select count(*) from forense.evidencia e where e.caso_id = k.id and e.validada) as n_evidencia,
       (select count(*) from forense.defensas d where d.caso_id = k.id and d.resultado <> 'no_refuta') as n_defensas,
       cl.n_rfcs as cluster_tamano
from forense.casos k
left join forense.contribuyentes c on c.rfc = k.rfc_principal and c.corrida_id = k.corrida_id
left join forense.clusters cl on cl.id = k.cluster_id;

do $$
declare rol text;
begin
  foreach rol in array array['service_role','anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = rol) then
      execute format('grant select on forense.v_casos_lista to %I', rol);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Propuestas de edición: el chat PROPONE, Aplicar versiona (regla 11)
-- ---------------------------------------------------------------------

create table if not exists forense.propuestas_edicion (
  id             uuid primary key default gen_random_uuid(),
  caso_id        uuid not null references forense.casos(id) on delete cascade,
  perfil_id      uuid references forense.perfiles(id) on delete set null,
  version_base   int not null,
  seleccion      text,
  seleccion_hash text,
  mensaje        text,
  directriz_id   uuid,
  modo           text not null default 'propuesta' check (modo in ('pregunta','propuesta')),
  patch          jsonb,
  diff           jsonb,
  citas          jsonb not null default '[]'::jsonb,
  estado         text not null default 'propuesta'
                 check (estado in ('propuesta','aplicada','descartada','conflicto')),
  request_id     text,
  version_resultante int,
  creado         timestamptz default now(),
  aplicada_at    timestamptz
);
create index if not exists ix_propuestas_caso on forense.propuestas_edicion (caso_id, creado desc);
create unique index if not exists ux_propuestas_request
  on forense.propuestas_edicion (request_id);

-- ---------------------------------------------------------------------
-- 6. Actividad de producto. Los hechos forenses siguen en `bitacora`;
--    esta tabla registra lo que hace la PERSONA (16 §5).
-- ---------------------------------------------------------------------

create table if not exists forense.actividad_producto (
  id              bigserial primary key,
  perfil_id       uuid references forense.perfiles(id) on delete set null,
  investigacion_id uuid references forense.investigaciones(id) on delete cascade,
  caso_id         uuid references forense.casos(id) on delete cascade,
  request_id      text,
  evento          text not null check (evento in (
                    'investigacion_solicitada','directriz_aplicada','investigacion_completa',
                    'reporte_propuesto','propuesta_aplicada','reporte_exportado',
                    'llamada_solicitada','llamada_resultado','preferencia_cambiada',
                    'vista_guardada','sesion_iniciada')),
  metadata        jsonb not null default '{}'::jsonb,   -- sin secretos ni teléfonos
  creado          timestamptz default now()
);
create index if not exists ix_actividad_perfil on forense.actividad_producto (perfil_id, creado desc);
create index if not exists ix_actividad_investigacion
  on forense.actividad_producto (investigacion_id, creado);

create or replace function forense.registrar_actividad(
  p_evento text, p_perfil uuid default null, p_investigacion uuid default null,
  p_caso uuid default null, p_request text default null, p_metadata jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_meta jsonb;
begin
  -- Ningún evento de actividad guarda teléfono ni secretos (16 §5).
  v_meta := coalesce(p_metadata, '{}'::jsonb)
            - 'telefono' - 'telefono_e164' - 'to_number' - 'apikey' - 'authorization';
  insert into forense.actividad_producto (perfil_id, investigacion_id, caso_id, request_id, evento, metadata)
  values (p_perfil, p_investigacion, p_caso, p_request, p_evento, v_meta)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 7. Aplicar una propuesta = crear una versión nueva del expediente.
--    Determinista, del BFF; el chat no versiona (regla 11).
-- ---------------------------------------------------------------------

create or replace function forense.aplicar_propuesta(
  p_propuesta uuid, p_perfil uuid default null, p_contenido_json jsonb default null,
  p_markdown text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; v_max int; v_nueva int; v_id bigint;
begin
  select * into p from forense.propuestas_edicion where id = p_propuesta for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  if p.estado = 'aplicada' then
    -- Doble click: aplica una sola vez (16 §7).
    return jsonb_build_object('ok', true, 'aplicada', false, 'motivo', 'ya_aplicada',
                              'version', p.version_resultante);
  end if;
  if p.modo = 'pregunta' then
    return jsonb_build_object('ok', false, 'error', 'argumento_invalido',
                              'detalle', 'una pregunta no versiona el documento');
  end if;

  select coalesce(max(version), 0) into v_max from forense.expedientes where caso_id = p.caso_id;
  if p.version_base <> v_max then
    update forense.propuestas_edicion set estado = 'conflicto' where id = p_propuesta;
    return jsonb_build_object('ok', false, 'error', 'conflicto_version',
                              'version_base', p.version_base, 'version_actual', v_max);
  end if;

  v_nueva := v_max + 1;
  insert into forense.expedientes (caso_id, idempotency_key, version, markdown, contenido_json,
                                   autor, estado_revision, version_base, propuesta_id)
  values (p.caso_id, 'propuesta:' || p_propuesta::text, v_nueva,
          coalesce(p_markdown, (select markdown from forense.expedientes
                                 where caso_id = p.caso_id and version = v_max)),
          coalesce(p_contenido_json, p.patch),
          'humano', 'borrador', v_max, p_propuesta)
  on conflict (idempotency_key) do nothing;

  update forense.propuestas_edicion
     set estado = 'aplicada', aplicada_at = now(), version_resultante = v_nueva
   where id = p_propuesta;

  perform forense.log(p.caso_id, 'editor', 'edicion',
    jsonb_build_object('propuesta_id', p_propuesta, 'version_base', v_max,
                       'version_resultante', v_nueva),
    null, null, null, null, null, null, null,
    (select corrida_id from forense.casos where id = p.caso_id));
  v_id := forense.registrar_actividad('propuesta_aplicada', p_perfil, null, p.caso_id,
            p.request_id, jsonb_build_object('propuesta_id', p_propuesta, 'version', v_nueva));

  return jsonb_build_object('ok', true, 'aplicada', true, 'caso_id', p.caso_id,
                            'version', v_nueva, 'version_base', v_max);
end $$;

-- ---------------------------------------------------------------------
-- 8. RLS y permisos: nada de esto es legible por anon.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['perfiles','investigaciones','vistas_guardadas',
                           'propuestas_edicion','actividad_producto'] loop
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
  forense.registrar_actividad(text, uuid, uuid, uuid, text, jsonb),
  forense.aplicar_propuesta(uuid, uuid, jsonb, text),
  forense.telefono_enmascarado(text)
from public;

-- Fin 006_producto_ui.sql
