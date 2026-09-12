-- =====================================================================
-- 001_schema.sql — Tablas, índices, RLS, grants y realtime
-- Fuente normativa: docs/05-esquema-db.md (tablas de dominio, detección,
-- pizarrón, casos/trazabilidad), docs/17-runtime-n8n.md §4 (tablas de
-- control de runtime) y docs/21 §3.2 (tipo_evento 'inyeccion').
--
-- Reglas de aplicación:
--   * Idempotente: se puede reaplicar sin error (IF NOT EXISTS / OR REPLACE /
--     drop+create de políticas). Todos los índices llevan nombre explícito.
--   * Portátil: corre en Postgres local (sin roles anon/authenticated/
--     service_role ni publicación supabase_realtime) y en Supabase. Todo lo
--     que dependa de esos objetos va dentro de bloques DO con comprobación.
--   * Sin datos de dominio: solo configuración determinista (límites de
--     presupuesto y slots de concurrencia de docs/03).
-- =====================================================================

create schema if not exists forense;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Control de experimentos
-- ---------------------------------------------------------------------

create table if not exists forense.corridas (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  dataset           text not null,
  dataset_hash      text not null,
  fecha_corte       timestamptz not null,
  corrida_origen_id uuid references forense.corridas(id),
  estado            text not null default 'preparando'
                    check (estado in ('preparando','lista','procesando','completada','error')),
  version_prompts   text,
  version_reglas    text,
  modo              text not null default 'fiscal'
                    check (modo in ('fiscal','exploratorio_financiero','fixture')),
  familias_evaluables text[] not null default '{D,F,R,T,E}',
  inicio            timestamptz default now(),
  fin               timestamptz,
  metricas          jsonb,
  notas             text
);
create index if not exists ix_corridas_estado on forense.corridas (estado);
create index if not exists ix_corridas_origen on forense.corridas (corrida_origen_id);

-- ---------------------------------------------------------------------
-- Datos del dominio (los llenan los loaders; un snapshot por corrida)
-- ---------------------------------------------------------------------

create table if not exists forense.catalogo_giro_claves (
  version_reglas  text not null,
  giro            text not null,
  clave_prod_serv text not null,
  primary key (version_reglas, giro, clave_prod_serv)
);

create table if not exists forense.contribuyentes (
  rfc                  text not null,
  razon_social         text,               -- UNTRUSTED
  giro                 text,
  tipo_persona         text,
  fecha_alta           date,
  domicilio            text,
  cp                   text,
  representante        text,
  email                text,
  telefono             text,
  empleados_declarados int,
  corrida_id           uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, rfc)
);
create index if not exists ix_contribuyentes_giro on forense.contribuyentes (corrida_id, giro);

create table if not exists forense.cuentas (
  clabe               text not null,
  rfc_titular         text,
  banco               text,
  tipo                text,
  moneda              text,
  saldo_inicial       numeric(14,2),
  fecha_saldo_inicial timestamptz,
  corrida_id          uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, clabe)
);
create index if not exists ix_cuentas_titular on forense.cuentas (corrida_id, rfc_titular);

create table if not exists forense.cfdi (
  uuid               uuid not null,
  tipo               text,
  emisor_rfc         text,
  receptor_rfc       text,
  fecha              timestamptz,
  subtotal           numeric(14,2),
  iva                numeric(14,2),
  total              numeric(14,2),
  moneda             text,
  metodo_pago        text,
  forma_pago         text,
  uso_cfdi           text,
  clave_prod_serv    text,
  descripcion        text,                 -- UNTRUSTED
  cancelado          boolean default false,
  fecha_cancelacion  timestamptz,
  motivo_cancelacion text,
  uuid_sustituye     uuid,
  corrida_id         uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, uuid)
);
create index if not exists ix_cfdi_emisor on forense.cfdi (corrida_id, emisor_rfc, fecha);
create index if not exists ix_cfdi_receptor on forense.cfdi (corrida_id, receptor_rfc, fecha);
create index if not exists ix_cfdi_tipo on forense.cfdi (corrida_id, tipo);

create table if not exists forense.complementos_pago (
  uuid_pago  uuid,
  uuid_cfdi  uuid not null,
  fecha      timestamptz,
  monto      numeric(14,2),
  corrida_id uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, uuid_pago, uuid_cfdi),
  foreign key (corrida_id, uuid_cfdi) references forense.cfdi(corrida_id, uuid) on delete cascade
);
create index if not exists ix_complementos_cfdi on forense.complementos_pago (corrida_id, uuid_cfdi);

create table if not exists forense.movimientos (
  id             bigint not null,
  cuenta_origen  text,
  cuenta_destino text,
  fecha          timestamptz,
  monto          numeric(14,2),
  moneda         text,
  tipo           text,
  referencia     text,                     -- UNTRUSTED
  corrida_id     uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, id)
);
create index if not exists ix_mov_origen on forense.movimientos (corrida_id, cuenta_origen, fecha);
create index if not exists ix_mov_destino on forense.movimientos (corrida_id, cuenta_destino, fecha);

create table if not exists forense.atributos_entidad (
  rfc        text,
  atributo   text,
  valor      text,
  fuente     text,
  corrida_id uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, rfc, atributo, valor)
);
create index if not exists ix_atributos_valor on forense.atributos_entidad (corrida_id, atributo, valor);

create table if not exists forense.listas_sat (
  rfc               text,
  lista             text,
  estatus           text,
  fecha_publicacion date,
  oficio            text,
  razon_social      text,                  -- UNTRUSTED
  corrida_id        uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, rfc, lista, estatus, fecha_publicacion)
);
create index if not exists ix_listas_rfc on forense.listas_sat (corrida_id, rfc);

-- ground_truth: NUNCA accesible desde las RPC de herramientas (docs/05, docs/06 regla 2)
create table if not exists forense.ground_truth (
  rfc                text,
  corrida_id         uuid not null references forense.corridas(id) on delete cascade,
  es_fraude          boolean,
  tipologia          text,
  es_trampa_legitima boolean default false,
  nota               text,
  primary key (rfc, corrida_id)
);

-- ---------------------------------------------------------------------
-- Capa de detección
-- ---------------------------------------------------------------------

create table if not exists forense.pistas (
  id         bigserial primary key,
  corrida_id uuid not null references forense.corridas(id) on delete cascade,
  codigo     text,
  familia    text,
  rfc        text,
  score      numeric,
  detalle    jsonb,
  huella     text not null,
  estado     text default 'disparada' check (estado in ('disparada','no_evaluable')),
  creado     timestamptz default now(),
  constraint ux_pistas_huella unique (corrida_id, codigo, rfc, huella)
);
create index if not exists ix_pistas_rfc on forense.pistas (corrida_id, rfc);
create index if not exists ix_pistas_codigo on forense.pistas (corrida_id, codigo);

create table if not exists forense.clusters (
  id               uuid primary key default gen_random_uuid(),
  corrida_id       uuid not null references forense.corridas(id) on delete cascade,
  rfcs             text[],
  rfc_semilla      text,
  n_rfcs           int,
  n_cfdi           int,
  n_movimientos    int,
  score            numeric,
  expandido        boolean default false,
  version_contexto int not null default 1,
  lease_owner      text,
  lease_expires_at timestamptz,
  huella           text not null,
  rfcs_frontera    text[],
  estado           text default 'pendiente'
                   check (estado in ('pendiente','ronda1','ronda2','auditando','cerrado','error')),
  creado           timestamptz default now(),
  constraint ux_clusters_huella unique (corrida_id, huella),
  constraint ux_clusters_corrida_id unique (corrida_id, id)
);
create index if not exists ix_clusters_score on forense.clusters (corrida_id, score desc);

-- ---------------------------------------------------------------------
-- El pizarrón
-- ---------------------------------------------------------------------

create table if not exists forense.senales (
  id               bigserial primary key,
  cluster_id       uuid references forense.clusters(id) on delete cascade,
  caso_id          uuid,
  ronda            int,
  intento          int not null default 0,
  version_contexto int not null default 1,
  idempotency_key  text unique,
  familia          text,
  agente           text,
  titular          text,
  detalle          jsonb,
  rfcs             text[],
  ids              text[],
  frontera         text[],
  confianza        text check (confianza in ('alta','media','baja')),
  refuta           boolean default false,
  creado           timestamptz default now()
);
create index if not exists ix_senales_cluster on forense.senales (cluster_id, ronda);

-- ---------------------------------------------------------------------
-- Casos y trazabilidad
-- ---------------------------------------------------------------------

create table if not exists forense.casos (
  id                   uuid primary key default gen_random_uuid(),
  corrida_id           uuid not null references forense.corridas(id) on delete cascade,
  cluster_id           uuid,
  rfc_principal        text,
  rfcs_satelite        text[],
  origen               text,
  origen_valor         text,
  estado               text default 'en_cola'
                       check (estado in ('en_cola','ronda1','ronda2','auditando','defendiendo','replicando',
                                         'validando','dictaminando','redactando','dictaminado','reintento','error')),
  nivel                text check (nivel in ('sin_hallazgos','anomalia_explicada','no_concluyente',
                                             'presuncion','presuncion_alta')),
  tipologia            text,
  hipotesis            text,
  familias_confirmadas text[],
  evaluacion_pistas    jsonb not null default '{}'::jsonb,
  resultado_por_rfc    jsonb not null default '[]'::jsonb,
  monto_en_riesgo      numeric(14,2),
  moneda               text not null default 'MXN',
  cobertura_completa   boolean not null default false,
  pendientes           jsonb default '[]'::jsonb,
  conflictos           jsonb default '[]'::jsonb,
  n_reintentos         int default 0,
  motivo_reintento     text,
  presupuesto_agotado  boolean default false,
  n8n_execution_id     text,
  tool_calls           int not null default 0,
  bitacora_seq         int not null default 0,
  tokens_total         int,
  duracion_ms          int,
  creado               timestamptz default now(),
  terminado            timestamptz,
  constraint ux_casos_corrida_id unique (corrida_id, id),
  constraint fk_casos_cluster foreign key (corrida_id, cluster_id)
    references forense.clusters(corrida_id, id) on delete cascade
);
create index if not exists ix_casos_nivel on forense.casos (corrida_id, nivel);
create index if not exists ix_casos_cluster on forense.casos (cluster_id);

create table if not exists forense.tareas_agente (
  id               uuid primary key default gen_random_uuid(),
  caso_id          uuid not null,
  corrida_id       uuid not null references forense.corridas(id) on delete cascade,
  cluster_id       uuid not null,
  agente           text not null,
  ronda            int not null,
  intento          int not null default 0,
  version_contexto int not null default 1,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','ejecutando','completada','error','timeout','omitida')),
  idempotency_key  text not null unique,
  n8n_execution_id text,
  lease_owner      text,
  lease_expires_at timestamptz,
  tool_calls       int not null default 0,   -- contador por (ronda,intento,version_contexto); docs/06
  iniciado         timestamptz,
  terminado        timestamptz,
  resultado        jsonb,
  error            text,
  unique (caso_id, ronda, intento, agente, version_contexto),
  constraint fk_tareas_caso foreign key (corrida_id, caso_id)
    references forense.casos(corrida_id, id) on delete cascade,
  constraint fk_tareas_cluster foreign key (corrida_id, cluster_id)
    references forense.clusters(corrida_id, id) on delete cascade
);
create index if not exists ix_tareas_caso on forense.tareas_agente (caso_id, ronda, intento, version_contexto, estado);

create table if not exists forense.bitacora (
  id          bigserial primary key,
  corrida_id  uuid not null references forense.corridas(id) on delete cascade,
  caso_id     uuid references forense.casos(id) on delete cascade,
  cluster_id  uuid,
  seq         int,
  ronda       int,
  intento     int default 0,
  tarea_id    uuid references forense.tareas_agente(id),
  ts          timestamptz default now(),
  agente      text,
  tipo_evento text,
  payload     jsonb,
  duracion_ms int,
  tokens_in   int,
  tokens_out  int,
  modelo      text
);
create unique index if not exists ux_bitacora_caso_seq on forense.bitacora (caso_id, seq);
create index if not exists ix_bitacora_cluster on forense.bitacora (cluster_id, ts);
create index if not exists ix_bitacora_corrida on forense.bitacora (corrida_id, id);

-- tipo_evento: enum fijo de docs/05 (27 valores) + 'inyeccion' de docs/21 §3.2.
-- Constraint con nombre, añadida fuera del CREATE TABLE para que una
-- instalación previa reciba el valor nuevo al reaplicar la migración.
alter table forense.bitacora drop constraint if exists ck_bitacora_tipo_evento;
alter table forense.bitacora add constraint ck_bitacora_tipo_evento check (
  tipo_evento is null or tipo_evento in (
    'caso_creado','cluster_armado','pista_cargada','ronda_inicio','ronda_fin',
    'razonamiento','tool_call','tool_result','senal_escrita','senal_leida',
    'despertar','frontera_detectada','cluster_expandido',
    'auditoria','defensa_inicio','defensa_argumento','replica',
    'validacion','evidencia_descartada','dictamen',
    'rechazo_auditor_final','reintento_inicio',
    'redaccion_inicio','redaccion_fin','edicion',
    'error','presupuesto_agotado',
    'inyeccion'
  )
);

create table if not exists forense.evidencia (
  id                bigserial primary key,
  caso_id           uuid references forense.casos(id) on delete cascade,
  idempotency_key   text unique,
  tipo              text,
  ref_id            text,
  monto             numeric(14,2),
  pista_id          bigint references forense.pistas(id) on delete set null,
  pista_codigo      text,
  familia           text,
  rfcs_afectados    text[],
  descripcion       text,
  agente            text,
  ronda             int,
  intento           int not null default 0,
  valida_tecnica    boolean,
  refutada          boolean not null default false,
  validada          boolean,
  hecho_validado    jsonb,
  motivo_descartada text
);
create index if not exists ix_evidencia_caso on forense.evidencia (caso_id, validada);

create table if not exists forense.defensas (
  id                     bigserial primary key,
  caso_id                uuid references forense.casos(id) on delete cascade,
  idempotency_key        text unique,
  trampa_codigo          text,
  pista_objetivo         text,
  argumento              text,
  ids                    text[],
  herramientas_usadas    jsonb,
  evidencia_objetivo_ids bigint[],
  resultado              text check (resultado in ('refuta','parcial','no_refuta')),
  respuesta_investigador text,
  aceptado               boolean
);
create index if not exists ix_defensas_caso on forense.defensas (caso_id);

create table if not exists forense.expedientes (
  id              bigserial primary key,
  caso_id         uuid references forense.casos(id) on delete cascade,
  idempotency_key text unique,
  version         int,
  markdown        text,
  autor           text,
  creado          timestamptz default now()
);
create unique index if not exists ux_expedientes_version on forense.expedientes (caso_id, version);

create table if not exists forense.expediente_chat (
  id                 bigserial primary key,
  caso_id            uuid references forense.casos(id) on delete cascade,
  rol                text check (rol in ('user','agente')),
  mensaje            text,
  seleccion          text,
  version_resultante int,
  creado             timestamptz default now()
);
create index if not exists ix_expediente_chat_caso on forense.expediente_chat (caso_id, creado);

create table if not exists forense.tool_cache (
  corrida_id       uuid not null references forense.corridas(id) on delete cascade,
  cluster_id       uuid not null references forense.clusters(id) on delete cascade,
  version_contexto int not null,
  herramienta      text,
  args_hash        text,
  resultado        jsonb,
  creado           timestamptz default now(),
  primary key (corrida_id, cluster_id, version_contexto, herramienta, args_hash)
);

-- ---------------------------------------------------------------------
-- Control de runtime (docs/17 §4). Dependen de casos/tareas_agente.
-- No son herramientas del modelo; no llevan lectura pública.
-- ---------------------------------------------------------------------

create table if not exists forense.ejecuciones_agente (
  id                  uuid primary key default gen_random_uuid(),
  corrida_id          uuid references forense.corridas(id) on delete cascade,
  caso_id             uuid references forense.casos(id) on delete cascade,
  tarea_id            uuid references forense.tareas_agente(id) on delete cascade,
  editor_operacion_id uuid,
  rol                 text not null,
  estado_interno      text not null default 'preparar_contexto'
                      check (estado_interno in ('preparar_contexto','solicitar_modelo','ejecutar_herramienta',
                                                'validar_salida','reparar_json','espera_reintento',
                                                'terminado','error','timeout')),
  paso                int not null default 0,
  revision            int not null default 0,
  checkpoint_json     jsonb not null default '{}'::jsonb,
  context_hash        text,
  prompt_hash         text,
  model_id            text,
  fence_token         bigint not null default 0,
  lease_owner         text,
  lease_expires_at    timestamptz,
  deadline_at         timestamptz,
  cancelada           boolean not null default false,
  creado              timestamptz default now(),
  actualizado         timestamptz default now(),
  constraint ck_ejecuciones_xor check (
    (tarea_id is not null and editor_operacion_id is null)
    or (tarea_id is null and editor_operacion_id is not null)
  )
);
create unique index if not exists ux_ejecuciones_tarea on forense.ejecuciones_agente (tarea_id)
  where tarea_id is not null;
create unique index if not exists ux_ejecuciones_editor on forense.ejecuciones_agente (editor_operacion_id)
  where editor_operacion_id is not null;
create index if not exists ix_ejecuciones_lease on forense.ejecuciones_agente (lease_expires_at)
  where lease_owner is not null;

create table if not exists forense.artefactos_contexto (
  id             uuid primary key default gen_random_uuid(),
  hash           text not null,
  schema_version text not null default 'contexto.v1',
  corrida_id     uuid references forense.corridas(id) on delete cascade,
  caso_id        uuid references forense.casos(id) on delete cascade,
  tarea_id       uuid references forense.tareas_agente(id) on delete cascade,
  ejecucion_id   uuid references forense.ejecuciones_agente(id) on delete cascade,
  snapshot       jsonb,
  contenido      jsonb not null,          -- privado: nunca ground_truth ni secretos
  bytes          int,
  tokens         int,
  truncamientos  jsonb not null default '[]'::jsonb,
  creado         timestamptz default now(),
  unique (ejecucion_id, hash)
);

create table if not exists forense.llm_solicitudes (
  request_id          text primary key,
  ejecucion_id        uuid not null references forense.ejecuciones_agente(id) on delete cascade,
  paso                int,
  intento_transporte  int not null default 0,
  estado              text not null default 'reservado'
                      check (estado in ('reservado','enviado','completado','desconocido','error')),
  bolsa               text not null default 'investigacion'
                      check (bolsa in ('investigacion','cierre','editor','voz')),
  provider_request_id text,
  modelo              text,
  usage               jsonb,
  tokens_in           int,
  tokens_out          int,
  duracion_ms         int,
  error               text,
  creado              timestamptz default now(),
  actualizado         timestamptz default now()
);
create index if not exists ix_llm_ejecucion on forense.llm_solicitudes (ejecucion_id, creado);

create table if not exists forense.tool_ejecuciones (
  id            bigserial primary key,
  ejecucion_id  uuid not null references forense.ejecuciones_agente(id) on delete cascade,
  request_id    text not null references forense.llm_solicitudes(request_id) on delete cascade,
  tool_use_id   text not null,
  nombre        text,
  args_hash     text,
  estado        text not null default 'reservado'
                check (estado in ('reservado','ejecutando','completado','error')),
  resultado_ref jsonb,
  duracion_ms   int,
  creado        timestamptz default now(),
  terminado     timestamptz,
  unique (request_id, tool_use_id)
);
create index if not exists ix_tool_ejec_ejecucion on forense.tool_ejecuciones (ejecucion_id, creado);

create table if not exists forense.pasos_pipeline (
  id               bigserial primary key,
  caso_id          uuid not null references forense.casos(id) on delete cascade,
  paso             text not null,
  revision         int not null default 0,
  intento          int not null default 0,
  version_contexto int not null default 1,
  tareas_esperadas uuid[] not null default '{}',
  snapshot_senales bigint[] not null default '{}',
  estado           text not null default 'abierto'
                   check (estado in ('abierto','cerrado','cancelado','timeout')),
  deadline         timestamptz,
  creado           timestamptz default now(),
  cerrado          timestamptz,
  unique (caso_id, paso, intento, version_contexto)
);
create index if not exists ix_pasos_caso on forense.pasos_pipeline (caso_id, estado);

create table if not exists forense.slots_runtime (
  recurso          text not null,
  slot             int not null,
  owner            text,
  lease_expires_at timestamptz,
  fencing_token    bigint not null default 0,
  actualizado      timestamptz default now(),
  primary key (recurso, slot)
);

-- ---------------------------------------------------------------------
-- Configuración determinista de presupuestos (docs/03 §Presupuestos)
-- Fuente única; 07/08 la consumen como configuración.
-- ---------------------------------------------------------------------

create table if not exists forense.limites_agente (
  agente text not null,
  ronda  int  not null,
  limite int  not null,
  bolsa  text not null default 'investigacion'
         check (bolsa in ('investigacion','cierre','editor')),
  primary key (agente, ronda)
);

insert into forense.limites_agente (agente, ronda, limite, bolsa) values
  ('documental', 1, 8, 'investigacion'), ('documental', 2, 4, 'investigacion'),
  ('financiero', 1, 8, 'investigacion'), ('financiero', 2, 4, 'investigacion'),
  ('relacional', 1, 8, 'investigacion'), ('relacional', 2, 4, 'investigacion'),
  ('temporal',   1, 6, 'investigacion'), ('temporal',   2, 3, 'investigacion'),
  ('externo',    1, 4, 'investigacion'), ('externo',    2, 2, 'investigacion'),
  ('auditor',    1, 12, 'cierre'),       ('auditor',    2, 12, 'cierre'),
  ('defensor',   1, 15, 'cierre'),       ('defensor',   2, 15, 'cierre'),
  ('replica',    1, 0,  'cierre'),       ('replica',    2, 0,  'cierre'),
  ('redactor',   1, 0,  'cierre'),       ('redactor',   2, 0,  'cierre'),
  ('editor',     1, 0,  'editor')
on conflict (agente, ronda) do nothing;

create table if not exists forense.config_presupuesto (
  clave text primary key,
  valor int not null,
  nota  text
);

insert into forense.config_presupuesto (clave, valor, nota) values
  ('tools_por_caso',          120, 'docs/03: llamadas a herramientas por caso, incluidos reintentos'),
  ('reserva_cierre_tools',     27, 'docs/03: 12 auditor + 15 defensor reservadas antes de explorar'),
  ('requests_por_caso',       100, 'docs/03/17: solicitudes LLM por caso'),
  ('reserva_cierre_requests',  34, 'docs/17 §6: Auditor 13 + Defensor 16 + Replica 2 + Redactor 3'),
  ('max_clusters_activos',      4, 'docs/03: concurrencia global inicial'),
  ('max_tareas_llm_activas',    8, 'docs/03: concurrencia global inicial')
on conflict (clave) do nothing;

-- Slots de concurrencia con fencing (docs/17 §4)
insert into forense.slots_runtime (recurso, slot)
select 'cluster', g from generate_series(1, 4) g
on conflict (recurso, slot) do nothing;
insert into forense.slots_runtime (recurso, slot)
select 'tarea_llm', g from generate_series(1, 8) g
on conflict (recurso, slot) do nothing;

-- ---------------------------------------------------------------------
-- RLS: se habilita en TODAS las tablas. Solo las tablas de la demo
-- reciben política SELECT pública; el resto queda cerrado salvo
-- service_role (que bypassea RLS).
-- ---------------------------------------------------------------------

do $$
declare
  t text;
  publicas text[] := array[
    'corridas','catalogo_giro_claves','contribuyentes','cuentas','cfdi','complementos_pago',
    'movimientos','atributos_entidad','listas_sat','ground_truth','pistas','clusters',
    'senales','casos','tareas_agente','bitacora','evidencia','defensas','expedientes',
    'expediente_chat','limites_agente','config_presupuesto'
  ];
  privadas text[] := array[
    'tool_cache','ejecuciones_agente','artefactos_contexto','llm_solicitudes',
    'tool_ejecuciones','pasos_pipeline','slots_runtime'
  ];
begin
  foreach t in array publicas || privadas loop
    execute format('alter table forense.%I enable row level security', t);
    execute format('drop policy if exists lectura on forense.%I', t);
  end loop;
  foreach t in array publicas loop
    execute format('create policy lectura on forense.%I for select using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Grants: dependen de roles que no existen en Postgres local.
-- ---------------------------------------------------------------------

do $$
declare
  t text;
  publicas text[] := array[
    'corridas','catalogo_giro_claves','contribuyentes','cuentas','cfdi','complementos_pago',
    'movimientos','atributos_entidad','listas_sat','ground_truth','pistas','clusters',
    'senales','casos','tareas_agente','bitacora','evidencia','defensas','expedientes',
    'expediente_chat','limites_agente','config_presupuesto'
  ];
  rol text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema forense to service_role';
    execute 'grant all on all tables in schema forense to service_role';
    execute 'grant all on all sequences in schema forense to service_role';
  end if;
  foreach rol in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = rol) then
      execute format('grant usage on schema forense to %I', rol);
      foreach t in array publicas loop
        execute format('grant select on forense.%I to %I', t, rol);
      end loop;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Realtime: solo si existe la publicación de Supabase.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['casos','bitacora','senales','clusters','expedientes','pistas'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'forense' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table forense.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Fin 001_schema.sql
