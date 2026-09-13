-- =====================================================================
-- 029_eliminar_datos.sql — Borrado de investigaciones y de corridas
-- (datasets), a pedido explícito del usuario (2026-09-12).
--
-- Regla 2 (CLAUDE.md): todo deja rastro. `forense.bitacora` cuelga de
-- `corrida_id` con `on delete cascade` (001), así que un evento insertado
-- ahí ANTES de borrar una corrida desaparece con ella — no sirve como
-- rastro de un borrado. `forense.auditoria_borrados` es la tabla aparte,
-- sin foreign key a `corridas`/`investigaciones`, que sobrevive al cascade
-- y deja constancia de qué se borró, cuándo y con qué resumen.
--
-- Solo service_role ejecuta estas funciones (mismo patrón que 005_rpc.sql):
-- el BFF (`web/lib/data/privado-supabase.ts`) es el único llamador, nunca
-- el cliente anon.
-- =====================================================================

-- `corrida_origen_id` (001) se creó sin `on delete`, es decir `no action`:
-- borrar una corrida que sirvió de base a una inyección en vivo (regla 12,
-- `corrida_origen_id` apuntando a ella) revienta con violación de FK antes
-- de llegar aquí. La corrida clonada sigue siendo válida sin su origen, así
-- que `set null` en vez de cascada.
alter table forense.corridas drop constraint if exists corridas_corrida_origen_id_fkey;
alter table forense.corridas
  add constraint corridas_corrida_origen_id_fkey
  foreign key (corrida_origen_id) references forense.corridas(id) on delete set null;

create table if not exists forense.auditoria_borrados (
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  tipo        text not null check (tipo in ('corrida', 'investigacion')),
  entidad_id  uuid not null,
  resumen     jsonb not null default '{}'::jsonb
);
create index if not exists ix_auditoria_borrados_tipo on forense.auditoria_borrados (tipo, ts desc);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on forense.auditoria_borrados from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on forense.auditoria_borrados from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert on forense.auditoria_borrados to service_role';
    execute 'grant usage, select on sequence forense.auditoria_borrados_id_seq to service_role';
  end if;
end $$;

create or replace function forense.eliminar_corrida(p_corrida_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_resumen jsonb;
begin
  select jsonb_build_object(
    'nombre', c.nombre, 'dataset', c.dataset, 'estado', c.estado,
    'casos', (select count(*) from forense.casos where corrida_id = c.id),
    'investigaciones', (select count(*) from forense.investigaciones where corrida_id = c.id)
  )
  into v_resumen
  from forense.corridas c
  where c.id = p_corrida_id;

  if v_resumen is null then
    raise exception 'corrida % no existe', p_corrida_id;
  end if;

  insert into forense.auditoria_borrados (tipo, entidad_id, resumen)
  values ('corrida', p_corrida_id, v_resumen);

  delete from forense.corridas where id = p_corrida_id;
end $$;

create or replace function forense.eliminar_investigacion(p_investigacion_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_resumen jsonb;
begin
  select jsonb_build_object(
    'perfil_id', i.perfil_id, 'corrida_id', i.corrida_id, 'caso_id', i.caso_id,
    'titulo', i.titulo, 'estado', i.estado
  )
  into v_resumen
  from forense.investigaciones i
  where i.id = p_investigacion_id;

  if v_resumen is null then
    raise exception 'investigacion % no existe', p_investigacion_id;
  end if;

  insert into forense.auditoria_borrados (tipo, entidad_id, resumen)
  values ('investigacion', p_investigacion_id, v_resumen);

  delete from forense.investigaciones where id = p_investigacion_id;
end $$;

do $$
declare
  firmas text[] := array[
    'forense.eliminar_corrida(uuid)',
    'forense.eliminar_investigacion(uuid)'
  ];
  f text;
  rol text;
begin
  foreach f in array firmas loop
    execute format('revoke execute on function %s from public', f);
    foreach rol in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = rol) then
        execute format('revoke execute on function %s from %I', f, rol);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Fin 029_eliminar_datos.sql
