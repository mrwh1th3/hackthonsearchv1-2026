-- 027: tablas del estate de jueces (spec/forensic-auditor/estate_schema.sql) que no
-- tenían equivalente canónico, y columnas para conservar los ids originales.
--
-- Los exhibits de una submission citan `record_id` del estate tal cual (INV-00001,
-- BNK-00001, PO-00001, entry_id entero, EMP:0001). `cfdi.uuid` es uuid y
-- `movimientos.id` bigint, así que el id original vive en `id_origen`, único por corrida.
-- Carga: loaders/forensic_to_forense.py.

alter table forense.cfdi add column if not exists id_origen text;
alter table forense.movimientos add column if not exists id_origen text;
alter table forense.movimientos add column if not exists canal text;
create unique index if not exists ux_cfdi_id_origen on forense.cfdi (corrida_id, id_origen) where id_origen is not null;
create unique index if not exists ux_mov_id_origen on forense.movimientos (corrida_id, id_origen) where id_origen is not null;

create table if not exists forense.empleados (
  corrida_id uuid not null references forense.corridas(id) on delete cascade,
  emp_id     text not null,              -- tal cual el estate, p.ej. EMP:0001
  nombre     text,
  puesto     text,
  clabe      text,
  fecha_alta date,
  primary key (corrida_id, emp_id)
);
create index if not exists ix_empleados_clabe on forense.empleados (corrida_id, clabe);
create index if not exists ix_empleados_nombre on forense.empleados (corrida_id, nombre);

create table if not exists forense.polizas (
  corrida_id   uuid not null references forense.corridas(id) on delete cascade,
  entry_id     bigint not null,
  fecha        date,
  cuenta_codigo text,
  cuenta_nombre text,
  cargo        numeric(14,2) not null default 0,
  abono        numeric(14,2) not null default 0,
  descripcion  text,                    -- texto libre: dato no confiable (regla 6)
  cfdi_id_origen text,                  -- invoice_uuid del estate
  centro_costo text,
  aprobador    text,
  primary key (corrida_id, entry_id)
);
create index if not exists ix_polizas_cfdi on forense.polizas (corrida_id, cfdi_id_origen);
create index if not exists ix_polizas_cuenta on forense.polizas (corrida_id, cuenta_codigo, fecha);

create table if not exists forense.ordenes_compra (
  corrida_id    uuid not null references forense.corridas(id) on delete cascade,
  po_id         text not null,
  proveedor_rfc text,
  fecha         date,
  monto         numeric(14,2),
  solicitante   text,
  aprobador     text,
  descripcion   text,                   -- texto libre: dato no confiable (regla 6)
  primary key (corrida_id, po_id)
);
create index if not exists ix_oc_proveedor on forense.ordenes_compra (corrida_id, proveedor_rfc, fecha);
create index if not exists ix_oc_aprobador on forense.ordenes_compra (corrida_id, aprobador, fecha);

create table if not exists forense.contratos (
  corrida_id    uuid not null references forense.corridas(id) on delete cascade,
  contract_id   text not null,
  proveedor_rfc text,
  fecha_inicio  date,
  valor         numeric(14,2),
  alcance       text,                   -- texto libre: dato no confiable (regla 6)
  primary key (corrida_id, contract_id)
);
create index if not exists ix_contratos_proveedor on forense.contratos (corrida_id, proveedor_rfc);

do $$
declare t text;
begin
  foreach t in array array['empleados','polizas','ordenes_compra','contratos'] loop
    execute format('alter table forense.%I enable row level security', t);
    execute format('drop policy if exists lectura on forense.%I', t);
    execute format('create policy lectura on forense.%I for select using (true)', t);
    execute format('grant select on forense.%I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on forense.%I to service_role', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
