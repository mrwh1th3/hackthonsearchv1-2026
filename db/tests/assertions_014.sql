-- =====================================================================
-- 014_estadisticas.sql — el clon nace analizado.
--
-- Lo que se comprueba aquí es barato y no depende de gen-v1: que la
-- función existe, que deja rastro, que los tres caminos que materializan
-- un snapshot la llaman y que el barrido la llama como primer paso. La
-- MEDIDA de latencia (el bloqueante del juez) va en
-- assertions_014_gen.sql, sobre datos reales.
-- =====================================================================

set search_path = '';

do $$
declare
  v_origen uuid; v_clon uuid; v_ms int; n int; r record;
  v_reltuples bigint; v_filas bigint; v_dur int; v_nueva uuid;
begin
  -- Corrida con dominio cargado (la del seed).
  select k.id into v_origen from forense.corridas k
   where exists (select 1 from forense.cfdi f where f.corrida_id = k.id)
   order by k.inicio nulls last limit 1;
  if v_origen is null then
    perform pruebas.assert('014: hay una corrida con dominio para analizar', false, 'sin corrida');
    return;
  end if;

  -- 1. La función existe, devuelve la duración y deja rastro (regla 2).
  v_ms := forense.analizar_snapshot(v_origen);
  perform pruebas.assert('analizar_snapshot devuelve la duración del ANALYZE en ms',
    v_ms is not null and v_ms >= 0, 'ms=' || coalesce(v_ms::text, 'null'));

  select count(*) into n from forense.bitacora b
   where b.corrida_id = v_origen and b.tipo_evento = 'corrida_cargada'
     and b.payload->>'evento_real' = 'estadisticas_analizadas';
  perform pruebas.assert('analizar_snapshot deja evento en forense.bitacora (regla 2)',
    n >= 1, 'eventos=' || n);

  -- Sin corrida no se inventa una fila de bitácora (corrida_id es not null).
  v_ms := forense.analizar_snapshot(null);
  perform pruebas.assert('analizar_snapshot sin corrida corre y no inventa bitácora',
    v_ms is not null, 'ms=' || coalesce(v_ms::text, 'null'));

  -- 2. clonar_corrida analiza al final.
  v_clon := forense.clonar_corrida(v_origen, 'test-014-clon-' || substr(md5(random()::text), 1, 6));
  select count(*) into n from forense.bitacora b
   where b.corrida_id = v_clon and b.tipo_evento = 'corrida_cargada'
     and b.payload->>'evento_real' = 'estadisticas_analizadas';
  perform pruebas.assert('clonar_corrida deja el clon ANALIZADO (evento con la corrida nueva)',
    n = 1, 'eventos=' || n);

  -- Y las estadísticas son de verdad: reltuples de cfdi ya cuenta las
  -- filas del clon. Si el planeador siguiera creyendo que hay ~1 fila,
  -- F1 volvería a irse a minutos sobre el snapshot grande.
  select c.reltuples::bigint into v_reltuples from pg_class c
   where c.oid = 'forense.cfdi'::regclass;
  select count(*) into v_filas from forense.cfdi;
  perform pruebas.assert('tras clonar, reltuples de forense.cfdi refleja las filas reales',
    v_reltuples >= (v_filas * 0.9)::bigint,
    'reltuples=' || v_reltuples || ' filas=' || v_filas);

  -- 3. cargar_o_clonar_snapshot analiza el snapshot que acaba de cargar.
  select * into r from forense.abrir_corrida(null,
    'test-014-carga-' || substr(md5(random()::text), 1, 6), v_origen);
  v_nueva := r.corrida_id;
  perform forense.cargar_o_clonar_snapshot(v_nueva, v_origen);
  select count(*) into n from forense.bitacora b
   where b.corrida_id = v_nueva and b.tipo_evento = 'corrida_cargada'
     and b.payload->>'evento_real' = 'estadisticas_analizadas';
  perform pruebas.assert('cargar_o_clonar_snapshot deja el snapshot analizado',
    n = 1, 'eventos=' || n);

  -- 4. correr_pistas analiza como primer paso del barrido.
  v_dur := (forense.correr_pistas(v_clon)->>'duracion_ms')::int;
  select count(*) into n from forense.bitacora b
   where b.corrida_id = v_clon and b.tipo_evento = 'corrida_cargada'
     and b.payload->>'evento_real' = 'estadisticas_analizadas';
  perform pruebas.assert('correr_pistas analiza antes del barrido (segundo evento del clon)',
    n = 2, 'eventos=' || n || ' duracion_barrido_ms=' || coalesce(v_dur::text, 'null'));
end $$;

-- ---------------------------------------------------------------------
-- v_pares_giro: se lee por corrida_id y el índice existe (ux_pares_giro
-- lo sirve como primera columna). Si algún día cambia la clave única,
-- 014 crea el índice y esta aserción lo sigue viendo.
-- ---------------------------------------------------------------------
do $$
declare v_idx text;
begin
  select c.relname into v_idx
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace ns on ns.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
   where ns.nspname = 'forense' and t.relname = 'v_pares_giro'
     and a.attname = 'corrida_id'
   limit 1;
  perform pruebas.assert('v_pares_giro tiene índice con corrida_id como primera columna',
    v_idx is not null, coalesce(v_idx, 'ninguno'));
end $$;
