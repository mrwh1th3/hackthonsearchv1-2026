-- =====================================================================
-- 014_estadisticas.sql — el clon nace con estadísticas.
--
-- HALLAZGO (verificación de db5, criterio del juez: latencia de inyección
-- en vivo). Tras `clonar_corrida` / `clonar_corrida_con_inyeccion` las
-- tablas de dominio son COMPARTIDAS entre corridas y llevan miles de
-- filas nuevas con un `corrida_id` que el planeador nunca ha visto: el
-- estimador cree que la corrida nueva tiene ~1 fila, elige nested loop en
-- todas partes y `pista_f1` se va de 243 ms a minutos. Medido en este
-- worktree (Postgres 17 local, snapshot gen-v1, clon recién creado):
-- `correr_pistas` NO terminó en 300 s (statement_timeout, atascada en
-- F1); con `analyze` previo el mismo barrido corre en ~1 s. Ver
-- db/README.md §Rendimiento.
--
-- NO es la formulación de F1 (esa ya se arregló en 013 y su equivalencia
-- está comprobada con EXCEPT): es estadística rancia. La prueba es que la
-- MISMA función sobre la MISMA corrida baja a segundos sólo con analyze.
--
-- Arreglo: `forense.analizar_snapshot()` y una llamada al final de cada
-- camino que materializa un snapshot, más una llamada defensiva como
-- primer paso del barrido (una corrida cargada por el loader, por
-- restore o por un camino futuro también llega analizada).
--
-- ANALYZE (sin VACUUM) es válido dentro de una función y dentro de una
-- transacción; toma ShareUpdateExclusiveLock, que no bloquea lecturas ni
-- escrituras normales.
--
-- Aditiva: sólo `create or replace` de funciones existentes (cuerpo
-- idéntico + la llamada) y funciones nuevas. No toca tablas ni firmas.
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 1. forense.analizar_snapshot — las siete tablas de dominio que leen
--    las pistas. `security definer` porque ANALYZE exige ser dueño de la
--    tabla y `correr_pistas` no lo es.
--    Deja rastro (regla 2) cuando se le dice de qué corrida es el
--    snapshot; sin corrida no hay fila válida en forense.bitacora
--    (corrida_id es not null), así que en ese caso no se inventa una.
-- ---------------------------------------------------------------------
create or replace function forense.analizar_snapshot(p_corrida uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare t0 timestamptz := clock_timestamp(); v_ms int;
begin
  analyze forense.cfdi, forense.movimientos, forense.cuentas,
          forense.complementos_pago, forense.contribuyentes,
          forense.atributos_entidad, forense.listas_sat;
  v_ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;

  if p_corrida is not null
     and exists (select 1 from forense.corridas c where c.id = p_corrida) then
    perform forense.log(null, 'sistema', 'corrida_cargada',
      jsonb_build_object('evento_real', 'estadisticas_analizadas',
                         'tablas', jsonb_build_array('cfdi','movimientos','cuentas',
                           'complementos_pago','contribuyentes','atributos_entidad','listas_sat'),
                         'duracion_ms', v_ms),
      v_ms, null, null, null, null, null, null, p_corrida);
  end if;

  return v_ms;
end $$;

comment on function forense.analizar_snapshot(uuid) is
  'Refresca estadísticas de las tablas de dominio tras materializar un snapshot. Sin esto el planeador estima 1 fila para la corrida nueva y F1 se va a minutos.';

-- ---------------------------------------------------------------------
-- 2. v_pares_giro: índice por corrida_id.
--    La matview es GLOBAL (una fila por corrida × giro). Las lecturas de
--    D1/D2/D4 y 005 filtran `where corrida_id = ?`, que ya está servido
--    por el índice ÚNICO `ux_pares_giro (corrida_id, giro)` como columna
--    principal. Añadir un segundo índice sólo por corrida_id sería
--    redundante y encarecería cada `refresh` (un índice más que
--    reconstruir por clon). Se comprueba y se declara en la bitácora de
--    la migración: si algún día se cambia la clave única, este bloque
--    crea el índice que falta.
-- ---------------------------------------------------------------------
do $$
declare v_ok boolean;
begin
  select exists (
    select 1 from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
     where n.nspname = 'forense' and t.relname = 'v_pares_giro'
       and a.attname = 'corrida_id') into v_ok;
  if not v_ok then
    execute 'create index if not exists ix_pares_giro_corrida
               on forense.v_pares_giro (corrida_id)';
    raise notice '014: creado ix_pares_giro_corrida (no había índice con corrida_id como primera columna)';
  else
    raise notice '014: v_pares_giro ya se lee por corrida_id con ux_pares_giro (corrida_id, giro); no se añade índice redundante';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- forense.clonar_corrida (002 §7) + analyze del clon
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

  -- Estadísticas del clon: sin esto el planeador cree que la corrida nueva
  -- no tiene filas y F1 se va a minutos (ver db/README.md §Rendimiento).
  perform forense.analizar_snapshot(v_nueva);

  return v_nueva;
end $$;

-- ---------------------------------------------------------------------
-- forense.clonar_corrida_con_inyeccion (008 §5) + analyze del clon
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

  -- Mismo motivo que en clonar_corrida: el clon inyectado nace sin
  -- estadísticas y la primera pista pagaría el plan equivocado.
  perform forense.analizar_snapshot(v_nueva);

  return v_nueva;
end $$;

-- ---------------------------------------------------------------------
-- forense.cargar_o_clonar_snapshot (010 §1) + analyze del snapshot
-- ---------------------------------------------------------------------
create or replace function forense.cargar_o_clonar_snapshot(
  p_corrida uuid, p_origen uuid default null)
returns table(corrida_id uuid, estado text, filas_por_tabla jsonb,
              corrida_origen_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare c record; v_filas jsonb := '{}'::jsonb; n int; v_origen uuid;
begin
  select * into c from forense.corridas k where k.id = p_corrida for update;
  if not found then
    raise exception 'corrida % no existe', p_corrida using errcode = '22023';
  end if;
  v_origen := coalesce(p_origen, c.corrida_origen_id);

  if v_origen is not null
     and not exists (select 1 from forense.cfdi f where f.corrida_id = p_corrida) then
    insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta,
      domicilio, cp, representante, email, telefono, empleados_declarados, corrida_id)
    select rfc, razon_social, giro, tipo_persona, fecha_alta, domicilio, cp,
           representante, email, telefono, empleados_declarados, p_corrida
      from forense.contribuyentes where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('contribuyentes', n);

    insert into forense.cuentas (clabe, rfc_titular, banco, tipo, moneda,
                                 saldo_inicial, fecha_saldo_inicial, corrida_id)
    select clabe, rfc_titular, banco, tipo, moneda, saldo_inicial, fecha_saldo_inicial, p_corrida
      from forense.cuentas where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('cuentas', n);

    insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
      moneda, metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion, cancelado,
      fecha_cancelacion, motivo_cancelacion, uuid_sustituye, corrida_id)
    select uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total, moneda,
           metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion, cancelado,
           fecha_cancelacion, motivo_cancelacion, uuid_sustituye, p_corrida
      from forense.cfdi where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('cfdi', n);

    insert into forense.complementos_pago (uuid_pago, uuid_cfdi, fecha, monto, corrida_id)
    select uuid_pago, uuid_cfdi, fecha, monto, p_corrida
      from forense.complementos_pago where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('complementos_pago', n);

    insert into forense.movimientos (id, cuenta_origen, cuenta_destino, fecha, monto,
                                     moneda, tipo, referencia, corrida_id)
    select id, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, referencia, p_corrida
      from forense.movimientos where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('movimientos', n);

    insert into forense.atributos_entidad (rfc, atributo, valor, fuente, corrida_id)
    select rfc, atributo, valor, fuente, p_corrida
      from forense.atributos_entidad where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('atributos_entidad', n);

    insert into forense.listas_sat (rfc, lista, estatus, fecha_publicacion, oficio,
                                    razon_social, corrida_id)
    select rfc, lista, estatus, fecha_publicacion, oficio, razon_social, p_corrida
      from forense.listas_sat where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('listas_sat', n);

    insert into forense.ground_truth (rfc, corrida_id, es_fraude, tipologia,
                                      es_trampa_legitima, nota)
    select rfc, p_corrida, es_fraude, tipologia, es_trampa_legitima, nota
      from forense.ground_truth where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('ground_truth', n);

    update forense.corridas
       set dataset_hash = coalesce(dataset_hash, (select dataset_hash from forense.corridas
                                                   where id = v_origen)),
           fecha_corte = coalesce(fecha_corte, (select fecha_corte from forense.corridas
                                                  where id = v_origen)),
           corrida_origen_id = v_origen
     where id = p_corrida;
  else
    -- Snapshot ya cargado por el loader: se cuenta, no se duplica.
    v_filas := (
      select jsonb_object_agg(t.tabla, t.n) from (
        select 'contribuyentes' tabla, count(*) n from forense.contribuyentes where corrida_id = p_corrida
        union all select 'cuentas', count(*) from forense.cuentas where corrida_id = p_corrida
        union all select 'cfdi', count(*) from forense.cfdi where corrida_id = p_corrida
        union all select 'complementos_pago', count(*) from forense.complementos_pago where corrida_id = p_corrida
        union all select 'movimientos', count(*) from forense.movimientos where corrida_id = p_corrida
        union all select 'atributos_entidad', count(*) from forense.atributos_entidad where corrida_id = p_corrida
        union all select 'listas_sat', count(*) from forense.listas_sat where corrida_id = p_corrida
      ) t);
  end if;

  perform forense.log_corrida(p_corrida, 'sistema', 'corrida_cargada',
    jsonb_build_object('evento_real', 'snapshot_cargado', 'origen', v_origen,
                       'filas_por_tabla', v_filas));

  -- Se cargue por clon o por loader, la corrida queda analizada antes de
  -- que el runtime dispare el barrido.
  perform forense.analizar_snapshot(p_corrida);

  return query select p_corrida, c.estado, coalesce(v_filas, '{}'::jsonb), v_origen;
end $$;

-- ---------------------------------------------------------------------
-- forense.correr_pistas (003) + analyze como primer paso
-- ---------------------------------------------------------------------
create or replace function forense.correr_pistas(p_corrida uuid, p_reejecutar boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare
  fam text[]; r jsonb := '{}'::jsonb; v_estado text; t0 timestamptz := clock_timestamp();
  no_evaluables text[] := '{}';
begin
  update forense.corridas
     set estado = 'procesando'
   where id = p_corrida
     and (estado = 'lista' or (p_reejecutar and estado = 'procesando'))
  returning familias_evaluables into fam;

  if not found then
    select estado into v_estado from forense.corridas where id = p_corrida;
    return jsonb_build_object('error', 'corrida no preparada', 'estado', v_estado);
  end if;

  -- Primer paso del barrido, justo después del claim atómico (reclamar
  -- primero es lo que impide dos evaluaciones simultáneas): si la corrida
  -- llegó por un camino que no analizó, aquí se paga una vez ~300 ms en
  -- lugar de minutos en F1.
  perform forense.analizar_snapshot(p_corrida);

  refresh materialized view forense.v_pares_giro;   -- una vez por carga, antes del fan-out

  if 'D' = any(fam) then
    -- D1 necesita el catálogo de claves por giro; sin él no se inventa un
    -- resultado: se declara no evaluable con motivo (docs/05).
    if forense.hay_catalogo_giros(p_corrida) then
      r := r || jsonb_build_object('D1', forense.pista_d1(p_corrida));
    else
      perform forense.marcar_no_evaluable(p_corrida, array['D1'],
        'no hay catálogo de ClaveProdServ por giro para la version_reglas de la corrida');
      no_evaluables := no_evaluables || array['D1'];
    end if;
    r := r || jsonb_build_object('D2', forense.pista_d2(p_corrida),
                                 'D3', forense.pista_d3(p_corrida),
                                 'D4', forense.pista_d4(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['D1','D2','D3','D4']);
    no_evaluables := no_evaluables || array['D1','D2','D3','D4'];
  end if;

  if 'F' = any(fam) then
    r := r || jsonb_build_object('F1', forense.pista_f1(p_corrida),
                                 'F2', forense.pista_f2(p_corrida),
                                 'F3', forense.pista_f3(p_corrida),
                                 'F4', forense.pista_f4(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['F1','F2','F3','F4']);
    no_evaluables := no_evaluables || array['F1','F2','F3','F4'];
  end if;

  if 'R' = any(fam) then
    r := r || jsonb_build_object('R1', forense.pista_r1(p_corrida),
                                 'R2', forense.pista_r2(p_corrida),
                                 'R3', forense.pista_r3(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['R1','R2','R3']);
    no_evaluables := no_evaluables || array['R1','R2','R3'];
  end if;

  if 'T' = any(fam) then
    r := r || jsonb_build_object('T1', forense.pista_t1(p_corrida),
                                 'T2', forense.pista_t2(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['T1','T2']);
    no_evaluables := no_evaluables || array['T1','T2'];
  end if;

  if 'E' = any(fam) then
    r := r || jsonb_build_object('E1', forense.pista_e1(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['E1']);
    no_evaluables := no_evaluables || array['E1'];
  end if;

  r := r || jsonb_build_object(
    'familias_evaluables', to_jsonb(fam),
    'no_evaluables', to_jsonb(no_evaluables),
    'candidatos_dos_familias', (select count(*) from forense.score_entidad(p_corrida)),
    'duracion_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);

  perform forense.log(null, 'sistema', 'pista_cargada',
    jsonb_build_object('evento_real', 'correr_pistas', 'resultado', r),
    (extract(epoch from clock_timestamp() - t0) * 1000)::int,
    null, null, null, null, null, null, p_corrida);

  return r;
end $$;

-- ---------------------------------------------------------------------
-- Permisos: igual que en las migraciones anteriores, nada de esto lo
-- llama el LLM.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.analizar_snapshot(uuid) to service_role';
  end if;
end $$;

-- Fin 014_estadisticas.sql
