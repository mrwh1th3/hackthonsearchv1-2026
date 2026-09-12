-- =====================================================================
-- 008_ingesta.sql — Ingesta asistida (19) e inyección en vivo (21 §3).
--
-- Migración ADITIVA: no renumera ni reescribe 001–007. Fuentes normativas:
--   docs/19 §Contratos persistidos (ingestas, archivos, mapeos, errores,
--     staging privado por ingesta_id)
--   docs/21 §3.2 (forense.inyecciones y clonar_corrida_con_inyeccion)
--   contracts product.inyectar / product.inyeccion (formato del paquete)
--
-- Principio que este archivo hace cumplir: **una inyección nunca muta un
-- snapshot existente**. Crea una corrida nueva clonada con
-- `corrida_origen_id = base`, le añade las filas, y deja la base intacta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Enum de bitácora: 'corrida_cargada' (contracts 1.2.0). Aditivo:
--    se reemplaza la constraint completa conservando todos los valores.
-- ---------------------------------------------------------------------

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
    'inyeccion','corrida_cargada'
  )
);

-- ---------------------------------------------------------------------
-- 1. Modelos de ingesta (19). Ninguna de estas tablas recibe SELECT
--    público: staging y errores conservan valores crudos.
-- ---------------------------------------------------------------------

create table if not exists forense.ingestas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text,
  origen          text not null default 'ui'
                  check (origen in ('ui','api','ensayo','loader')),
  estado          text not null default 'recibida'
                  check (estado in ('recibida','perfilando','requiere_mapeo','validando',
                                    'cargando','lista','requiere_revision','error','cancelada')),
  corrida_base_id uuid references forense.corridas(id) on delete set null,
  corrida_id      uuid references forense.corridas(id) on delete set null,
  perfil_id       uuid,
  hash_payload    text,
  filas_por_tabla jsonb not null default '{}'::jsonb,
  diagnostico     jsonb not null default
                  '{"aceptadas":0,"rechazadas":0,"errores":[],"advertencias":[]}'::jsonb,
  idempotency_key text,
  creado          timestamptz default now(),
  actualizado     timestamptz default now()
);
create unique index if not exists ux_ingestas_idempotency on forense.ingestas (idempotency_key);
create index if not exists ix_ingestas_estado on forense.ingestas (estado, creado);

create table if not exists forense.archivos_ingesta (
  id             bigserial primary key,
  ingesta_id     uuid not null references forense.ingestas(id) on delete cascade,
  file_id        text not null,
  nombre         text not null,
  sha256         text not null,
  bytes          bigint,
  tabla          text check (tabla in ('contribuyentes','cuentas','cfdi','complementos_pago',
                                       'movimientos','atributos_entidad','listas_sat')),
  tipo_declarado text,
  tipo_detectado text,
  creado         timestamptz default now(),
  unique (ingesta_id, file_id)
);

create table if not exists forense.mapeos_ingesta (
  id              bigserial primary key,
  ingesta_id      uuid not null references forense.ingestas(id) on delete cascade,
  schema_version  text not null default 'ingesta.v1',
  adapter_id      text not null,
  adapter_version text not null default '1',
  manifiesto      jsonb not null,
  confianza       text check (confianza in ('alta','media','baja')),
  aprobado_por    text,                       -- backend/humano; nunca el modelo
  aprobado_at     timestamptz,
  creado          timestamptz default now(),
  unique (ingesta_id, adapter_id, adapter_version)
);

create table if not exists forense.errores_ingesta (
  id         bigserial primary key,
  ingesta_id uuid not null references forense.ingestas(id) on delete cascade,
  tabla      text,
  fila       int,
  codigo     text not null,
  mensaje    text not null,
  muestra    jsonb,                            -- privada: valores crudos
  creado     timestamptz default now()
);
create index if not exists ix_errores_ingesta on forense.errores_ingesta (ingesta_id, tabla, fila);

-- Staging privado, aislado por ingesta_id. Todo llega como jsonb con los
-- nombres canónicos ya resueltos por el adaptador; nada se ejecuta.
create table if not exists forense.staging_filas (
  id         bigserial primary key,
  ingesta_id uuid not null references forense.ingestas(id) on delete cascade,
  tabla      text not null check (tabla in ('contribuyentes','cuentas','cfdi','complementos_pago',
                                            'movimientos','atributos_entidad','listas_sat')),
  fila       int not null,
  datos      jsonb not null,
  valida     boolean,
  motivo     text,
  creado     timestamptz default now(),
  unique (ingesta_id, tabla, fila)
);
create index if not exists ix_staging_ingesta on forense.staging_filas (ingesta_id, tabla);

-- ---------------------------------------------------------------------
-- 2. Inyecciones en vivo (21 §3.2 y contracts product.inyeccion)
-- ---------------------------------------------------------------------

create table if not exists forense.inyecciones (
  id               uuid primary key default gen_random_uuid(),
  ingesta_id       uuid not null references forense.ingestas(id) on delete cascade,
  corrida_base_id  uuid not null references forense.corridas(id) on delete cascade,
  corrida_nueva_id uuid references forense.corridas(id) on delete set null,
  perfil_id        uuid,
  origen           text not null default 'ui' check (origen in ('ui','api','ensayo')),
  hash_payload     text not null,
  filas_por_tabla  jsonb not null default '{}'::jsonb,
  rfcs_afectados   text[] not null default '{}',
  estado           text not null default 'recibida'
                   check (estado in ('recibida','validada','rechazada','snapshot_creado',
                                     'pistas_recalculadas','investigando','completada','error')),
  diagnostico      jsonb not null default
                   '{"aceptadas":0,"rechazadas":0,"errores":[],"advertencias":[]}'::jsonb,
  latencias_ms     jsonb not null default '{}'::jsonb,
  idempotency_key  uuid,
  creado           timestamptz default now(),
  terminado        timestamptz
);
create unique index if not exists ux_inyecciones_idempotency on forense.inyecciones (idempotency_key);
create index if not exists ix_inyecciones_base on forense.inyecciones (corrida_base_id, creado);

do $$
declare t text;
begin
  foreach t in array array['ingestas','archivos_ingesta','mapeos_ingesta','errores_ingesta',
                           'staging_filas','inyecciones'] loop
    execute format('alter table forense.%I enable row level security', t);
    -- Sin política de SELECT: estas tablas NO heredan la lectura pública de la
    -- demo (19 §Protección de muestra). El BFF sirve el diagnóstico redactado.
    execute format('drop policy if exists lectura on forense.%I', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on all tables in schema forense to service_role';
    execute 'grant all on all sequences in schema forense to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Registro de una inyección desde un paquete product.inyectar
-- ---------------------------------------------------------------------

create or replace function forense.registrar_inyeccion(
  p_base uuid, p_payload jsonb, p_origen text default 'ui',
  p_idempotency uuid default null, p_perfil uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ingesta uuid; v_iny uuid; v_hash text; v_tabla text; v_fila jsonb; i int;
  v_filas jsonb := '{}'::jsonb; v_n int; v_existente record;
begin
  if not exists (select 1 from forense.corridas where id = p_base) then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'corrida base inexistente');
  end if;
  if p_payload is null or jsonb_typeof(p_payload->'tablas') <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'argumento_invalido',
                              'detalle', 'el paquete debe traer un objeto tablas');
  end if;

  if p_idempotency is not null then
    select * into v_existente from forense.inyecciones where idempotency_key = p_idempotency;
    if found then
      return jsonb_build_object('ok', true, 'creada', false, 'inyeccion_id', v_existente.id,
                                'ingesta_id', v_existente.ingesta_id,
                                'estado', v_existente.estado);
    end if;
  end if;

  v_hash := encode(sha256(convert_to(p_payload::text, 'utf8')), 'hex');

  insert into forense.ingestas (nombre, origen, estado, corrida_base_id, perfil_id,
                                hash_payload, idempotency_key)
  values (coalesce(p_payload->>'nota', 'inyección en vivo'),
          case when p_origen in ('ui','api','ensayo') then p_origen else 'api' end,
          'validando', p_base, p_perfil, v_hash,
          coalesce(p_idempotency::text, v_hash))
  returning id into v_ingesta;

  for v_tabla in
    select k from jsonb_object_keys(p_payload->'tablas') k
     where k in ('contribuyentes','cuentas','cfdi','complementos_pago',
                 'movimientos','atributos_entidad','listas_sat')
     order by k
  loop
    i := 0;
    for v_fila in select value from jsonb_array_elements(p_payload->'tablas'->v_tabla) loop
      i := i + 1;
      insert into forense.staging_filas (ingesta_id, tabla, fila, datos)
      values (v_ingesta, v_tabla, i, v_fila)
      on conflict (ingesta_id, tabla, fila) do nothing;
    end loop;
    v_filas := v_filas || jsonb_build_object(v_tabla, i);
  end loop;

  update forense.ingestas set filas_por_tabla = v_filas, actualizado = now()
   where id = v_ingesta;

  insert into forense.inyecciones (ingesta_id, corrida_base_id, perfil_id, origen,
                                   hash_payload, filas_por_tabla, estado, idempotency_key)
  values (v_ingesta, p_base, p_perfil,
          case when p_origen in ('ui','api','ensayo') then p_origen else 'api' end,
          v_hash, v_filas, 'recibida', p_idempotency)
  returning id into v_iny;

  select coalesce(sum((value)::int), 0) into v_n from jsonb_each_text(v_filas);

  perform forense.log(null, 'sistema', 'inyeccion',
    jsonb_build_object('evento_real', 'inyeccion_recibida', 'inyeccion_id', v_iny,
                       'ingesta_id', v_ingesta, 'corrida_base_id', p_base,
                       'hash_payload', v_hash, 'filas_por_tabla', v_filas, 'filas', v_n),
    null, null, null, null, null, null, null, p_base);

  return jsonb_build_object('ok', true, 'creada', true, 'inyeccion_id', v_iny,
                            'ingesta_id', v_ingesta, 'estado', 'recibida',
                            'hash_payload', v_hash, 'filas_por_tabla', v_filas);
end $$;

-- ---------------------------------------------------------------------
-- 4. Validación determinista (19 §Flujo único paso 7, 21 §3.1)
--    Claves, FK contra base + filas nuevas, moneda, fechas, duplicados y
--    ausencia de etiquetas. Los rechazos llevan tabla/fila/código/mensaje.
-- ---------------------------------------------------------------------

create or replace function forense.validar_inyeccion(p_ingesta uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g record; v_base uuid; v_corte timestamptz; f record;
  n_ok int := 0; n_bad int := 0; v_adv text[] := '{}';
  v_rfcs text[] := '{}'; v_rfcs_nuevos text[] := '{}'; v_clabes_nuevas text[] := '{}';
  v_uuids_nuevos uuid[] := '{}'; v_max_fecha timestamptz; v_iny uuid;
  v_err text; v_cod text; v_d jsonb;
begin
  select * into g from forense.ingestas where id = p_ingesta;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  v_base := g.corrida_base_id;
  select fecha_corte into v_corte from forense.corridas where id = v_base;
  delete from forense.errores_ingesta where ingesta_id = p_ingesta;

  -- Primera pasada: universo de claves nuevas (las FK valen contra base ∪ nuevas)
  select coalesce(array_agg(distinct s.datos->>'rfc'), '{}') into v_rfcs_nuevos
    from forense.staging_filas s
   where s.ingesta_id = p_ingesta and s.tabla = 'contribuyentes' and s.datos ? 'rfc';
  select coalesce(array_agg(distinct s.datos->>'clabe'), '{}') into v_clabes_nuevas
    from forense.staging_filas s
   where s.ingesta_id = p_ingesta and s.tabla = 'cuentas' and s.datos ? 'clabe';
  select coalesce(array_agg(distinct (s.datos->>'uuid')::uuid), '{}') into v_uuids_nuevos
    from forense.staging_filas s
   where s.ingesta_id = p_ingesta and s.tabla = 'cfdi' and s.datos ? 'uuid'
     and (s.datos->>'uuid') ~* '^[0-9a-f-]{36}$';

  for f in select * from forense.staging_filas
            where ingesta_id = p_ingesta order by tabla, fila loop
    v_err := null; v_cod := null; v_d := f.datos;

    -- Ninguna fila puede traer etiquetas de evaluación (19 §Gates)
    if v_d ?| array['es_fraude','tipologia','es_trampa_legitima','ground_truth',
                    'is_laundering','fraud','target','label'] then
      v_cod := 'etiqueta_prohibida';
      v_err := 'la fila trae una columna de etiqueta de evaluación';
    elsif f.tabla = 'contribuyentes' then
      if not (v_d ? 'rfc') or length(coalesce(v_d->>'rfc', '')) = 0 then
        v_cod := 'clave_faltante'; v_err := 'contribuyentes requiere rfc';
      elsif exists (select 1 from forense.contribuyentes c
                     where c.corrida_id = v_base and c.rfc = v_d->>'rfc') then
        v_cod := 'duplicado'; v_err := 'el RFC ya existe en el snapshot base';
      end if;

    elsif f.tabla = 'cuentas' then
      if not (v_d ? 'clabe') or length(coalesce(v_d->>'clabe', '')) = 0 then
        v_cod := 'clave_faltante'; v_err := 'cuentas requiere clabe';
      elsif exists (select 1 from forense.cuentas cu
                     where cu.corrida_id = v_base and cu.clabe = v_d->>'clabe') then
        v_cod := 'duplicado'; v_err := 'la CLABE ya existe en el snapshot base';
      elsif (v_d ? 'moneda') and (v_d->>'moneda') !~ '^[A-Z]{3}$' then
        v_cod := 'moneda_invalida'; v_err := 'la moneda debe ser un código ISO de 3 letras';
      end if;

    elsif f.tabla = 'cfdi' then
      if not (v_d ? 'uuid') or (v_d->>'uuid') !~* '^[0-9a-f-]{36}$' then
        v_cod := 'clave_faltante'; v_err := 'cfdi requiere uuid con formato UUID';
      elsif exists (select 1 from forense.cfdi c2
                     where c2.corrida_id = v_base and c2.uuid = (v_d->>'uuid')::uuid) then
        -- 21 §3.1: mismo UUID que la base = rechazo con motivo, no sobreescritura
        v_cod := 'duplicado'; v_err := 'el UUID ya existe en el snapshot base';
      elsif not (v_d ? 'emisor_rfc') or not (v_d ? 'receptor_rfc') then
        v_cod := 'clave_faltante'; v_err := 'cfdi requiere emisor_rfc y receptor_rfc';
      elsif not (v_d ? 'fecha') then
        v_cod := 'fecha_faltante'; v_err := 'cfdi requiere fecha';
      elsif not (v_d ? 'total') then
        v_cod := 'monto_faltante'; v_err := 'cfdi requiere total';
      elsif (v_d ? 'moneda') and (v_d->>'moneda') !~ '^[A-Z]{3}$' then
        v_cod := 'moneda_invalida'; v_err := 'la moneda debe ser un código ISO de 3 letras';
      end if;

    elsif f.tabla = 'complementos_pago' then
      if not (v_d ? 'uuid_cfdi') then
        v_cod := 'clave_faltante'; v_err := 'complementos_pago requiere uuid_cfdi';
      elsif not ((v_d->>'uuid_cfdi')::uuid = any(v_uuids_nuevos))
        and not exists (select 1 from forense.cfdi c3
                         where c3.corrida_id = v_base and c3.uuid = (v_d->>'uuid_cfdi')::uuid) then
        v_cod := 'fk_rota'; v_err := 'el complemento apunta a un CFDI que no existe ni en la base ni en la inyección';
      end if;

    elsif f.tabla = 'movimientos' then
      if not (v_d ? 'id') then
        v_cod := 'clave_faltante'; v_err := 'movimientos requiere id';
      elsif exists (select 1 from forense.movimientos m
                     where m.corrida_id = v_base and m.id = (v_d->>'id')::bigint) then
        v_cod := 'duplicado'; v_err := 'el id de movimiento ya existe en el snapshot base';
      elsif not (v_d ? 'cuenta_origen') or not (v_d ? 'cuenta_destino') then
        v_cod := 'clave_faltante'; v_err := 'movimientos requiere cuenta_origen y cuenta_destino';
      elsif not (v_d->>'cuenta_origen' = any(v_clabes_nuevas))
        and not exists (select 1 from forense.cuentas cu2
                         where cu2.corrida_id = v_base and cu2.clabe = v_d->>'cuenta_origen') then
        v_cod := 'fk_rota'; v_err := 'cuenta_origen no existe ni en la base ni en la inyección';
      elsif not (v_d->>'cuenta_destino' = any(v_clabes_nuevas))
        and not exists (select 1 from forense.cuentas cu3
                         where cu3.corrida_id = v_base and cu3.clabe = v_d->>'cuenta_destino') then
        v_cod := 'fk_rota'; v_err := 'cuenta_destino no existe ni en la base ni en la inyección';
      elsif (v_d ? 'moneda') and (v_d->>'moneda') !~ '^[A-Z]{3}$' then
        v_cod := 'moneda_invalida'; v_err := 'la moneda debe ser un código ISO de 3 letras';
      end if;

    elsif f.tabla = 'atributos_entidad' then
      if not (v_d ? 'rfc') or not (v_d ? 'atributo') or not (v_d ? 'valor') then
        v_cod := 'clave_faltante'; v_err := 'atributos_entidad requiere rfc, atributo y valor';
      end if;

    elsif f.tabla = 'listas_sat' then
      if not (v_d ? 'rfc') or not (v_d ? 'lista') or not (v_d ? 'estatus')
         or not (v_d ? 'fecha_publicacion') then
        v_cod := 'clave_faltante';
        v_err := 'listas_sat requiere rfc, lista, estatus y fecha_publicacion';
      end if;
    end if;

    if v_err is null then
      n_ok := n_ok + 1;
      update forense.staging_filas set valida = true, motivo = null where id = f.id;
      -- RFC tocados por la inyección (sirve para priorizar clusters, 21 §3.3)
      if v_d ? 'rfc' then v_rfcs := v_rfcs || array[v_d->>'rfc']; end if;
      if v_d ? 'emisor_rfc' then v_rfcs := v_rfcs || array[v_d->>'emisor_rfc']; end if;
      if v_d ? 'receptor_rfc' then v_rfcs := v_rfcs || array[v_d->>'receptor_rfc']; end if;
      if v_d ? 'rfc_titular' then v_rfcs := v_rfcs || array[v_d->>'rfc_titular']; end if;
      if v_d ? 'fecha' then
        v_max_fecha := greatest(v_max_fecha, (v_d->>'fecha')::timestamptz);
      end if;
    else
      n_bad := n_bad + 1;
      update forense.staging_filas set valida = false, motivo = v_err where id = f.id;
      insert into forense.errores_ingesta (ingesta_id, tabla, fila, codigo, mensaje, muestra)
      values (p_ingesta, f.tabla, f.fila, v_cod, v_err, v_d);
    end if;
  end loop;

  -- Fecha fuera de la ventana: la corrida nueva adopta la máxima inyectada y
  -- lo declara. No se descarta la fila ni se finge que el corte no cambió.
  if v_max_fecha is not null and v_max_fecha > v_corte then
    v_adv := v_adv || array['la corrida nueva adopta fecha_corte ' ||
                            forense.fecha_iso(v_max_fecha) ||
                            ' porque una fila inyectada la supera'];
  end if;

  -- RFC nuevos sin fila en contribuyentes: entidad técnica incompleta (21 §3.1)
  if exists (
    select 1 from unnest(v_rfcs) x
     where not exists (select 1 from forense.contribuyentes c
                        where c.corrida_id = v_base and c.rfc = x)
       and not (x = any(v_rfcs_nuevos))) then
    v_adv := v_adv || array['hay RFC inyectados sin fila en contribuyentes: se crean como entidad técnica incompleta y la cobertura queda parcial'];
  end if;

  select coalesce(array_agg(distinct x order by x), '{}') into v_rfcs
    from unnest(v_rfcs) x where x is not null and x <> '';

  update forense.ingestas
     set estado = case when n_bad = 0 and n_ok > 0 then 'lista' else 'requiere_revision' end,
         diagnostico = jsonb_build_object(
           'aceptadas', n_ok, 'rechazadas', n_bad,
           'errores', coalesce((select jsonb_agg(jsonb_build_object(
                          'tabla', e.tabla, 'fila', e.fila, 'codigo', e.codigo,
                          'mensaje', e.mensaje) order by e.tabla, e.fila)
                        from forense.errores_ingesta e where e.ingesta_id = p_ingesta), '[]'::jsonb),
           'advertencias', coalesce(to_jsonb(v_adv), '[]'::jsonb)),
         actualizado = now()
   where id = p_ingesta;

  update forense.inyecciones
     set estado = case when n_bad = 0 and n_ok > 0 then 'validada' else 'rechazada' end,
         rfcs_afectados = v_rfcs,
         diagnostico = (select diagnostico from forense.ingestas where id = p_ingesta)
   where ingesta_id = p_ingesta
  returning id into v_iny;

  perform forense.log(null, 'sistema', 'inyeccion',
    jsonb_build_object('evento_real', 'inyeccion_validada', 'ingesta_id', p_ingesta,
                       'inyeccion_id', v_iny, 'aceptadas', n_ok, 'rechazadas', n_bad,
                       'rfcs_afectados', to_jsonb(v_rfcs),
                       'advertencias', coalesce(to_jsonb(v_adv), '[]'::jsonb)),
    null, null, null, null, null, null, null, v_base);

  return jsonb_build_object(
    'ok', (n_bad = 0 and n_ok > 0),
    'ingesta_id', p_ingesta, 'inyeccion_id', v_iny,
    'estado', case when n_bad = 0 and n_ok > 0 then 'validada' else 'rechazada' end,
    'aceptadas', n_ok, 'rechazadas', n_bad,
    'rfcs_afectados', to_jsonb(v_rfcs),
    'diagnostico', (select diagnostico from forense.ingestas where id = p_ingesta));
end $$;

-- ---------------------------------------------------------------------
-- 5. clonar_corrida_con_inyeccion (21 §3.2)
--    Transacción única: clona dominio + ground_truth, inserta las filas
--    nuevas, crea entidades técnicas para los RFC sin padrón, calcula un
--    dataset_hash nuevo y deja la corrida 'lista'.
--    La corrida base NO se toca.
-- ---------------------------------------------------------------------

create or replace function forense.clonar_corrida_con_inyeccion(p_base uuid, p_ingesta uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o record; g record; iny record; v_nueva uuid; v_corte timestamptz; v_max timestamptz;
  v_filas jsonb := '{}'::jsonb; n int; v_tecnicas text[] := '{}';
  t0 timestamptz := clock_timestamp();
begin
  select * into o from forense.corridas where id = p_base;
  if not found then
    raise exception 'corrida base % no existe', p_base using errcode = '22023';
  end if;
  select * into g from forense.ingestas where id = p_ingesta;
  if not found or g.corrida_base_id is distinct from p_base then
    raise exception 'ingesta % no corresponde a la corrida base %', p_ingesta, p_base
      using errcode = '22023';
  end if;
  select * into iny from forense.inyecciones where ingesta_id = p_ingesta;
  if not found or iny.estado <> 'validada' then
    raise exception 'la inyección % no está validada (estado %)',
      p_ingesta, coalesce(iny.estado, 'sin registro') using errcode = '22023';
  end if;

  -- Fecha de corte: si una fila supera la de la base, la corrida nueva la
  -- adopta y queda declarado en las notas (21 §3.1).
  select max((datos->>'fecha')::timestamptz) into v_max
    from forense.staging_filas
   where ingesta_id = p_ingesta and valida and datos ? 'fecha';
  v_corte := greatest(o.fecha_corte, coalesce(v_max, o.fecha_corte));

  insert into forense.corridas (
    nombre, dataset, dataset_hash, fecha_corte, corrida_origen_id, estado,
    version_prompts, version_reglas, modo, familias_evaluables, notas)
  values (
    o.nombre || ' + inyección ' || left(g.hash_payload, 8),
    o.dataset,
    encode(sha256(convert_to(o.dataset_hash || '|' || g.hash_payload, 'utf8')), 'hex'),
    v_corte, p_base, 'preparando',
    o.version_prompts, o.version_reglas, o.modo, o.familias_evaluables,
    'inyección ' || p_ingesta::text ||
    case when v_corte > o.fecha_corte
         then '; fecha_corte adoptada de la fila inyectada más reciente' else '' end)
  returning id into v_nueva;

  -- Clon del snapshot base (mismas filas, mismos IDs de negocio)
  insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta, domicilio, cp,
                                      representante, email, telefono, empleados_declarados, corrida_id)
  select rfc, razon_social, giro, tipo_persona, fecha_alta, domicilio, cp,
         representante, email, telefono, empleados_declarados, v_nueva
    from forense.contribuyentes where corrida_id = p_base;

  insert into forense.cuentas (clabe, rfc_titular, banco, tipo, moneda, saldo_inicial, fecha_saldo_inicial, corrida_id)
  select clabe, rfc_titular, banco, tipo, moneda, saldo_inicial, fecha_saldo_inicial, v_nueva
    from forense.cuentas where corrida_id = p_base;

  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total, moneda,
                            metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion, cancelado,
                            fecha_cancelacion, motivo_cancelacion, uuid_sustituye, corrida_id)
  select uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total, moneda,
         metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion, cancelado,
         fecha_cancelacion, motivo_cancelacion, uuid_sustituye, v_nueva
    from forense.cfdi where corrida_id = p_base;

  insert into forense.complementos_pago (uuid_pago, uuid_cfdi, fecha, monto, corrida_id)
  select uuid_pago, uuid_cfdi, fecha, monto, v_nueva
    from forense.complementos_pago where corrida_id = p_base;

  insert into forense.movimientos (id, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, referencia, corrida_id)
  select id, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, referencia, v_nueva
    from forense.movimientos where corrida_id = p_base;

  insert into forense.atributos_entidad (rfc, atributo, valor, fuente, corrida_id)
  select rfc, atributo, valor, fuente, v_nueva
    from forense.atributos_entidad where corrida_id = p_base;

  insert into forense.listas_sat (rfc, lista, estatus, fecha_publicacion, oficio, razon_social, corrida_id)
  select rfc, lista, estatus, fecha_publicacion, oficio, razon_social, v_nueva
    from forense.listas_sat where corrida_id = p_base;

  -- ground_truth del base: las filas inyectadas NO reciben etiqueta aquí
  -- (un ensayo de eval/ puede añadirla después, fuera de esta función).
  insert into forense.ground_truth (rfc, corrida_id, es_fraude, tipologia, es_trampa_legitima, nota)
  select rfc, v_nueva, es_fraude, tipologia, es_trampa_legitima, nota
    from forense.ground_truth where corrida_id = p_base;

  -- Filas inyectadas (solo las válidas)
  insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta, domicilio, cp,
                                      representante, email, telefono, empleados_declarados, corrida_id)
  select d->>'rfc', d->>'razon_social', d->>'giro', d->>'tipo_persona',
         nullif(d->>'fecha_alta','')::date, d->>'domicilio', d->>'cp', d->>'representante',
         d->>'email', d->>'telefono', nullif(d->>'empleados_declarados','')::int, v_nueva
    from (select datos as d from forense.staging_filas
           where ingesta_id = p_ingesta and tabla = 'contribuyentes' and valida order by fila) s
  on conflict (corrida_id, rfc) do nothing;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('contribuyentes', n);

  insert into forense.cuentas (clabe, rfc_titular, banco, tipo, moneda, saldo_inicial, fecha_saldo_inicial, corrida_id)
  select d->>'clabe', d->>'rfc_titular', d->>'banco', d->>'tipo',
         coalesce(d->>'moneda','MXN'), nullif(d->>'saldo_inicial','')::numeric,
         nullif(d->>'fecha_saldo_inicial','')::timestamptz, v_nueva
    from (select datos as d from forense.staging_filas
           where ingesta_id = p_ingesta and tabla = 'cuentas' and valida order by fila) s
  on conflict (corrida_id, clabe) do nothing;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('cuentas', n);

  -- Entidades técnicas incompletas para los RFC nuevos sin fila de padrón
  -- (19 §Identidad: no se inventan atributos, solo la existencia).
  insert into forense.contribuyentes (rfc, corrida_id)
  select distinct x.rfc, v_nueva
    from (
      select datos->>'emisor_rfc' as rfc from forense.staging_filas
       where ingesta_id = p_ingesta and tabla = 'cfdi' and valida
      union
      select datos->>'receptor_rfc' from forense.staging_filas
       where ingesta_id = p_ingesta and tabla = 'cfdi' and valida
      union
      select datos->>'rfc_titular' from forense.staging_filas
       where ingesta_id = p_ingesta and tabla = 'cuentas' and valida
      union
      select datos->>'rfc' from forense.staging_filas
       where ingesta_id = p_ingesta and tabla in ('atributos_entidad','listas_sat') and valida
    ) x
   where x.rfc is not null and x.rfc <> ''
     and not exists (select 1 from forense.contribuyentes c
                      where c.corrida_id = v_nueva and c.rfc = x.rfc)
  on conflict (corrida_id, rfc) do nothing;
  get diagnostics n = row_count;
  v_filas := v_filas || jsonb_build_object('entidades_tecnicas', n);

  if n > 0 then
    insert into forense.atributos_entidad (rfc, atributo, valor, fuente, corrida_id)
    select c.rfc, 'entidad_tecnica', 'incompleta', 'inyeccion:' || p_ingesta::text, v_nueva
      from forense.contribuyentes c
     where c.corrida_id = v_nueva and c.giro is null and c.razon_social is null
    on conflict do nothing;
  end if;

  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total, moneda,
                            metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion,
                            cancelado, corrida_id)
  select (d->>'uuid')::uuid, coalesce(d->>'tipo','I'), d->>'emisor_rfc', d->>'receptor_rfc',
         (d->>'fecha')::timestamptz, nullif(d->>'subtotal','')::numeric,
         nullif(d->>'iva','')::numeric, (d->>'total')::numeric, coalesce(d->>'moneda','MXN'),
         d->>'metodo_pago', d->>'forma_pago', d->>'uso_cfdi', d->>'clave_prod_serv',
         d->>'descripcion', coalesce((d->>'cancelado')::boolean, false), v_nueva
    from (select datos as d from forense.staging_filas
           where ingesta_id = p_ingesta and tabla = 'cfdi' and valida order by fila) s
  on conflict (corrida_id, uuid) do nothing;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('cfdi', n);

  insert into forense.complementos_pago (uuid_pago, uuid_cfdi, fecha, monto, corrida_id)
  select coalesce(nullif(d->>'uuid_pago','')::uuid, gen_random_uuid()),
         (d->>'uuid_cfdi')::uuid, nullif(d->>'fecha','')::timestamptz,
         nullif(d->>'monto','')::numeric, v_nueva
    from (select datos as d from forense.staging_filas
           where ingesta_id = p_ingesta and tabla = 'complementos_pago' and valida order by fila) s
  on conflict do nothing;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('complementos_pago', n);

  insert into forense.movimientos (id, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, referencia, corrida_id)
  select (d->>'id')::bigint, d->>'cuenta_origen', d->>'cuenta_destino',
         (d->>'fecha')::timestamptz, (d->>'monto')::numeric, coalesce(d->>'moneda','MXN'),
         coalesce(d->>'tipo','transferencia'), d->>'referencia', v_nueva
    from (select datos as d from forense.staging_filas
           where ingesta_id = p_ingesta and tabla = 'movimientos' and valida order by fila) s
  on conflict (corrida_id, id) do nothing;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('movimientos', n);

  insert into forense.atributos_entidad (rfc, atributo, valor, fuente, corrida_id)
  select d->>'rfc', d->>'atributo', d->>'valor',
         coalesce(d->>'fuente', 'inyeccion'), v_nueva
    from (select datos as d from forense.staging_filas
           where ingesta_id = p_ingesta and tabla = 'atributos_entidad' and valida order by fila) s
  on conflict (corrida_id, rfc, atributo, valor) do nothing;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('atributos_entidad', n);

  insert into forense.listas_sat (rfc, lista, estatus, fecha_publicacion, oficio, razon_social, corrida_id)
  select d->>'rfc', d->>'lista', d->>'estatus', (d->>'fecha_publicacion')::date,
         d->>'oficio', d->>'razon_social', v_nueva
    from (select datos as d from forense.staging_filas
           where ingesta_id = p_ingesta and tabla = 'listas_sat' and valida order by fila) s
  on conflict (corrida_id, rfc, lista, estatus, fecha_publicacion) do nothing;
  get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('listas_sat', n);

  update forense.corridas set estado = 'lista' where id = v_nueva;
  update forense.ingestas set corrida_id = v_nueva, estado = 'lista', actualizado = now()
   where id = p_ingesta;
  update forense.inyecciones
     set corrida_nueva_id = v_nueva, estado = 'snapshot_creado',
         latencias_ms = latencias_ms || jsonb_build_object(
           'snapshot', (extract(epoch from clock_timestamp() - t0) * 1000)::int)
   where ingesta_id = p_ingesta;

  -- Rastro obligatorio, con la corrida NUEVA (21 §3.2)
  perform forense.log(null, 'sistema', 'inyeccion',
    jsonb_build_object('evento_real', 'snapshot_creado', 'ingesta_id', p_ingesta,
                       'inyeccion_id', iny.id, 'corrida_base_id', p_base,
                       'corrida_nueva_id', v_nueva, 'filas_inyectadas', v_filas,
                       'fecha_corte', forense.fecha_iso(v_corte),
                       'fecha_corte_adoptada', (v_corte > o.fecha_corte),
                       'rfcs_afectados', to_jsonb(iny.rfcs_afectados),
                       'duracion_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int),
    (extract(epoch from clock_timestamp() - t0) * 1000)::int,
    null, null, null, null, null, null, v_nueva);

  perform forense.log(null, 'sistema', 'corrida_cargada',
    jsonb_build_object('corrida_id', v_nueva, 'origen', 'inyeccion',
                       'corrida_origen_id', p_base,
                       'dataset', o.dataset,
                       'filas_inyectadas', v_filas, 'estado', 'lista'),
    null, null, null, null, null, null, null, v_nueva);

  return v_nueva;
end $$;

-- ---------------------------------------------------------------------
-- 6. Estado de la inyección para la UI (21 §3.3). No expone staging.
-- ---------------------------------------------------------------------

create or replace function forense.marcar_inyeccion(
  p_inyeccion uuid, p_estado text, p_latencias jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update forense.inyecciones
     set estado = p_estado,
         latencias_ms = latencias_ms || coalesce(p_latencias, '{}'::jsonb),
         terminado = case when p_estado in ('completada','error','rechazada') then now() else terminado end
   where id = p_inyeccion
  returning * into r;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;

  perform forense.log(null, 'sistema', 'inyeccion',
    jsonb_build_object('evento_real', 'estado_' || p_estado, 'inyeccion_id', p_inyeccion,
                       'estado', p_estado, 'latencias_ms', r.latencias_ms),
    null, null, null, null, null, null, null, coalesce(r.corrida_nueva_id, r.corrida_base_id));

  return jsonb_build_object('ok', true, 'inyeccion_id', p_inyeccion, 'estado', p_estado);
end $$;

create or replace function forense.estado_inyeccion(p_inyeccion uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'ingesta_id', i.ingesta_id,
    'corrida_base_id', i.corrida_base_id, 'corrida_nueva_id', i.corrida_nueva_id,
    'perfil_id', i.perfil_id, 'origen', i.origen, 'hash_payload', i.hash_payload,
    'filas_por_tabla', i.filas_por_tabla,
    'rfcs_afectados', coalesce(to_jsonb(i.rfcs_afectados), '[]'::jsonb),
    'estado', i.estado, 'diagnostico', i.diagnostico, 'latencias_ms', i.latencias_ms,
    'creado', forense.fecha_iso(i.creado), 'terminado', forense.fecha_iso(i.terminado),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ts', forense.fecha_iso(b.ts), 'tipo_evento', b.tipo_evento,
               'evento', b.payload->>'evento_real', 'payload', b.payload) order by b.id)
        from forense.bitacora b
       where b.tipo_evento in ('inyeccion','corrida_cargada')
         and (b.payload->>'inyeccion_id' = i.id::text
              or b.payload->>'ingesta_id' = i.ingesta_id::text
              or b.corrida_id = i.corrida_nueva_id)), '[]'::jsonb))
    from forense.inyecciones i where i.id = p_inyeccion
$$;

-- Clusters a priorizar: los que contienen RFC inyectados (21 §3.3)
create or replace function forense.clusters_afectados(p_inyeccion uuid)
returns table (cluster_id uuid, score numeric, n_rfcs_afectados int, prioridad int)
language sql stable security definer set search_path = '' as $$
  select cl.id, cl.score,
         (select count(*)::int from unnest(i.rfcs_afectados) x where x = any(cl.rfcs)),
         case when exists (select 1 from unnest(i.rfcs_afectados) x where x = any(cl.rfcs))
              then 0 else 1 end
    from forense.inyecciones i
    join forense.clusters cl on cl.corrida_id = i.corrida_nueva_id
   where i.id = p_inyeccion
   order by 4, 2 desc nulls last, 1
$$;

-- ---------------------------------------------------------------------
-- 7. Permisos: la ingesta no la llama el LLM ni el frontend anónimo.
-- ---------------------------------------------------------------------

revoke execute on function
  forense.registrar_inyeccion(uuid, jsonb, text, uuid, uuid),
  forense.validar_inyeccion(uuid),
  forense.clonar_corrida_con_inyeccion(uuid, uuid),
  forense.marcar_inyeccion(uuid, text, jsonb),
  forense.estado_inyeccion(uuid),
  forense.clusters_afectados(uuid)
from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema forense to service_role';
  end if;
end $$;

-- Fin 008_ingesta.sql
