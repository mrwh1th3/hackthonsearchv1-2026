-- Helpers de prueba. Viven en el schema `pruebas`, nunca en `forense`.
create schema if not exists pruebas;

create table if not exists pruebas.resultado (
  id      serial primary key,
  nombre  text not null,
  ok      boolean not null,
  detalle text,
  ts      timestamptz default now()
);

-- Una comprobación que no se pudo ejecutar NO es una comprobación que
-- pasó. `omitida` la separa en el resumen: no suma a las fallidas (no
-- rompe el exit code) pero tampoco se cuenta como PASA.
alter table pruebas.resultado add column if not exists omitida boolean not null default false;

create or replace function pruebas.assert(p_nombre text, p_ok boolean, p_detalle text default '')
returns void language sql as $$
  insert into pruebas.resultado (nombre, ok, detalle)
  values (p_nombre, coalesce(p_ok, false), p_detalle)
$$;

create or replace function pruebas.omitir(p_nombre text, p_motivo text default '')
returns void language sql as $$
  insert into pruebas.resultado (nombre, ok, detalle, omitida)
  values (p_nombre, true, 'OMITIDA: ' || coalesce(p_motivo, ''), true)
$$;

create or replace function pruebas.conteos()
returns table(t text, n bigint) language sql as $$
  select 'contribuyentes', count(*) from forense.contribuyentes
  union all select 'cuentas', count(*) from forense.cuentas
  union all select 'cfdi', count(*) from forense.cfdi
  union all select 'complementos_pago', count(*) from forense.complementos_pago
  union all select 'movimientos', count(*) from forense.movimientos
  union all select 'atributos_entidad', count(*) from forense.atributos_entidad
  union all select 'listas_sat', count(*) from forense.listas_sat
  union all select 'ground_truth', count(*) from forense.ground_truth
  union all select 'pistas', count(*) from forense.pistas
  union all select 'clusters', count(*) from forense.clusters
  union all select 'senales', count(*) from forense.senales
  union all select 'casos', count(*) from forense.casos
  union all select 'tareas_agente', count(*) from forense.tareas_agente
  union all select 'bitacora', count(*) from forense.bitacora
  union all select 'evidencia', count(*) from forense.evidencia
  union all select 'defensas', count(*) from forense.defensas
  union all select 'expedientes', count(*) from forense.expedientes
  union all select 'expediente_chat', count(*) from forense.expediente_chat
$$;

create table if not exists pruebas.seq_concurrencia (
  worker text,
  valor  int
);
