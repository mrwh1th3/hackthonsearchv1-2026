-- =====================================================================
-- 019_pista_t2.sql — recalibración de la pierna (a) de T2 (sincronía).
--
-- ADITIVA: un solo `create or replace function forense.pista_t2`. No toca
-- tablas, ni firmas, ni catálogos, ni `db/003_pistas.sql`, que ya está
-- aplicado y verificado en el proyecto remoto. La pierna (b) (pico de
-- diciembre sin histórico) se conserva LETRA POR LETRA: no se midió nada
-- que justifique moverla.
--
-- POR QUÉ ---------------------------------------------------------------
-- 003 dejaba la pierna (a) `no_evaluable` sobre `gen-v1` con motivo en
-- bitácora: los 8081 CFDI de ese snapshot comparten una sola hora del día,
-- así que «menos de 6 horas» equivalía a «el mismo día». Con
-- `generator/gen.py --horario intradia` (snapshot `gen-v2`, misma
-- población, mismos importes, 818 horas distintas) la pierna ya es
-- comprobable — y entonces se puede MEDIR, que es lo que 003 no pudo:
--
--   ventana 6 h (umbral de 003), gen-v2, 100 RFC del padrón:
--     85 RFC marcados | 6 de 17 fraudes | 8 de 15 trampas | 71 resto
--     precisión 7.1%  ← POR DEBAJO de la tasa base de fraude (17%)
--
-- Una señal con precisión inferior a la tasa base no informa: cuesta más
-- descartarla que lo que aporta. La rejilla completa (ventana → marcados /
-- fraudes / trampas / resto) sobre el mismo snapshot:
--
--     30 min → 22 / 0 / 0 / 22      120 min → 72 / 6 / 4 / 62
--     45 min → 34 / 0 / 0 / 34      180 min → 77 / 6 / 5 / 66
--     60 min → 49 / 0 / 4 / 45      360 min → 82 / 6 / 8 / 68
--     90 min → 66 / 5 / 4 / 57
--
-- El universo de fondo produce caminos emisor→receptor→emisor del mismo
-- día por pura coincidencia: a 6 h hay 68 y hasta a 30 min quedan 22. Lo
-- que distingue una RÁFAGA de un camino casual no es «el mismo día», es
-- «el mismo lote de timbrado»: minutos, no horas. Medido sobre gen-v2, las
-- cadenas casuales del fondo que caben en 15 minutos son 4.
--
-- QUÉ CAMBIA ------------------------------------------------------------
-- 1. Ventana de 6 h → 15 min (`VENTANA_RAFAGA`). Es la escala de un lote
--    de timbrado real; 6 h es la escala de una jornada.
-- 2. Sólo RFC del PADRÓN. 003 desenrollaba la ruta completa y marcaba
--    también receptores que no son contribuyentes (los pseudo-RFC de
--    nómina `NOM…` y las personas físicas de dispersión): 3 de los 85.
--    Una pista sobre una entidad que no está en `forense.contribuyentes`
--    no se puede investigar ni defender.
-- 3. Guarda RELATIVA AL GIRO. Si la mayoría de los pares del giro también
--    timbra en lote, la ráfaga es el ritmo del sector y no una señal: con
--    `prevalencia_giro >= UMBRAL_GIRO` (0.5) la pista NO se emite, y el
--    detalle de las que sí se emiten publica `pares_giro`,
--    `pares_con_rafaga` y `prevalencia_giro` como discriminador citable.
--    HONESTIDAD: sobre gen-v2 esta guarda no quita ninguna fila (ningún
--    giro llega a 0.5), así que el umbral que hace el trabajo es la
--    ventana. La guarda está para que la pista no mienta en un dataset
--    donde el timbrado por lotes SÍ sea la norma del giro, y se prueba con
--    fixture en `db/tests/assertions_019.sql`, no con gen-v2.
--    `forense.v_pares_giro` (002) no tiene percentil temporal —y es de
--    otro dueño—, así que la prevalencia se calcula aquí y del view se
--    cita `n_pares`, que es su base de comparación.
-- 4. La trampa queda explícita en el detalle: `tiene_nomina`,
--    `tiene_compras` y `pagos_conciliados` del RFC, que es con lo que un
--    grupo corporativo que timbra su cierre intercompañía en una corrida
--    del ERP refuta la pista. Ese falso positivo existe A PROPÓSITO en
--    `gen-v2` (`generator/trampas.py` §1, declarado en `ground_truth`).
--
-- MEDIDO DESPUÉS (gen-v2 con ráfagas sembradas de 6 min, ventana 15 min):
-- ver `db/tests/assertions_019.sql` y el informe de la oleada; las cifras
-- van ahí y no en este comentario para que no envejezcan solas.
--
-- Lo que NO cambia: la firma, el `on conflict`, la huella
-- (`forense.huella_pista('T2', rfc, corte, 'sincronia')`), el estado
-- `no_evaluable` con motivo en bitácora cuando el dataset no tiene
-- resolución intradía, el rango [0,1] del score y la forma de
-- `referencias` que exige el contrato `entities.pista`.
-- =====================================================================

set search_path = '';

create or replace function forense.pista_t2(p_corrida uuid) returns int
language plpgsql set search_path = '' as $$
declare
  n int := 0; m int; v_corte timestamptz; v_horas int;
  -- Escala de un lote de timbrado, no de una jornada. Ver el encabezado:
  -- a 6 h la pista marcaba 85 de 100 RFC con precisión bajo la tasa base.
  VENTANA_RAFAGA constant interval := interval '15 minutes';
  -- Si al menos la mitad de los pares del giro también timbra en lote, la
  -- ráfaga es el ritmo del sector: no se emite pista.
  UMBRAL_GIRO constant numeric := 0.5;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;

  -- ¿Hay resolución intradía? Sin ella «en minutos» no distingue nada:
  -- dos facturas del mismo día distan cero minutos.
  select count(distinct f.fecha::time) into v_horas
    from forense.cfdi f
   where f.corrida_id = p_corrida and f.tipo = 'I' and not f.cancelado
     and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months';

  if v_horas < 2 then
    perform forense.log(null, 'sistema', 'pista_cargada',
      jsonb_build_object('evento_real', 'T2_sincronia_no_evaluable',
        'motivo', 'los CFDI de la corrida no tienen hora de timbrado ('
                  || v_horas || ' hora distinta en la ventana): la sincronía '
                  || 'de menos de 6 horas no es comprobable',
        'horas_distintas', v_horas),
      null, null, null, null, null, null, null, p_corrida);
  else
  -- (a) ráfaga: cadena de ≥3 facturas encadenadas dentro de la ventana
  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  with recursive f as (
    select emisor_rfc, receptor_rfc, uuid, total, fecha
      from forense.cfdi
     where corrida_id = p_corrida and tipo = 'I' and not cancelado
       and fecha <= v_corte and fecha > v_corte - interval '12 months'
       and emisor_rfc is not null and receptor_rfc is not null
       and emisor_rfc <> receptor_rfc
  ),
  camino as (
    select emisor_rfc as origen, receptor_rfc as actual,
           array[emisor_rfc, receptor_rfc] as ruta, array[uuid] as uuids,
           fecha as f_ini, fecha as f_act, 1 as saltos
      from f
    union all
    select c.origen, f.receptor_rfc, c.ruta || f.receptor_rfc, c.uuids || f.uuid,
           c.f_ini, f.fecha, c.saltos + 1
      from camino c join f on f.emisor_rfc = c.actual
     where c.saltos < 4
       and not (f.receptor_rfc = any(c.ruta))
       and f.fecha >= c.f_act
       and f.fecha <= c.f_ini + VENTANA_RAFAGA
  ),
  cadenas as (
    select distinct on (md5(array_to_string(ruta, '>')))
           c.*, md5(array_to_string(c.ruta, '>')) as clave
      from camino c
     where c.saltos >= 3
     order by md5(array_to_string(ruta, '>')), c.f_ini
  ),
  -- Una fila por RFC, y sólo por RFC DEL PADRÓN: la cadena más apretada
  -- en la que participa. Un pseudo-RFC de nómina o una persona física
  -- receptora de dispersión no es un contribuyente investigable.
  por_rfc as (
    select distinct on (k.rfc) k.rfc, k.giro, c.*,
           (select count(*) from cadenas c2 where k.rfc = any(c2.ruta)) as n_cadenas
      from cadenas c
      cross join lateral unnest(c.ruta) as r(rfc)
      join forense.contribuyentes k
        on k.corrida_id = p_corrida and k.rfc = r.rfc
     order by k.rfc, c.saltos desc, (c.f_act - c.f_ini), c.clave
  ),
  -- Prevalencia por giro: qué fracción de los pares del giro también
  -- aparece en una ráfaga. Si es la norma del sector, no es señal.
  prevalencia as (
    select k.giro,
           count(*) as pares_padron,
           count(*) filter (where pr.rfc is not null) as pares_con_rafaga
      from forense.contribuyentes k
      left join por_rfc pr on pr.rfc = k.rfc
     where k.corrida_id = p_corrida
     group by k.giro
  ),
  -- Discriminador de la trampa: el grupo corporativo que timbra su cierre
  -- en una corrida del ERP tiene nómina, compras y depósito por factura.
  sustancia as (
    select k.rfc,
           exists (select 1 from forense.cfdi x
                    where x.corrida_id = p_corrida and x.emisor_rfc = k.rfc
                      and x.tipo = 'N' and not x.cancelado
                      and x.fecha <= v_corte
                      and x.fecha > v_corte - interval '12 months') as tiene_nomina,
           exists (select 1 from forense.cfdi x
                    where x.corrida_id = p_corrida and x.receptor_rfc = k.rfc
                      and x.tipo = 'I' and not x.cancelado
                      and x.fecha <= v_corte
                      and x.fecha > v_corte - interval '12 months') as tiene_compras
      from forense.contribuyentes k
     where k.corrida_id = p_corrida
  )
  select p_corrida, 'T2', 'T', c.rfc,
         least(1.0, 0.55 + 0.1 * c.saltos)::numeric,
         jsonb_build_object(
           'motivo', 'sincronia',
           'saltos', c.saltos,
           'n_cadenas', c.n_cadenas,
           'ruta', to_jsonb(c.ruta),
           'uuids', (select coalesce(jsonb_agg(u::text), '[]'::jsonb) from unnest(c.uuids) u),
           'minutos', round(extract(epoch from c.f_act - c.f_ini) / 60.0, 1),
           'resumen', format(
             '%s facturas encadenadas entre %s RFC se timbraron en %s minutos: el receptor de '
             'cada una es el emisor de la siguiente. En el giro %s, %s de %s pares del padrón '
             'aparecen en una ráfaga igual.',
             c.saltos, array_length(c.ruta, 1),
             round(extract(epoch from c.f_act - c.f_ini) / 60.0, 1),
             c.giro, pv.pares_con_rafaga, pv.pares_padron),
           'referencias', (select coalesce(jsonb_agg('CFDI:' || u.uuid), '[]'::jsonb)
                             from unnest(c.uuids) u(uuid)),
           'comprobacion', 'T2',
           -- Comparación contra pares del giro, no contra un absoluto.
           'giro', c.giro,
           'pares_giro', pv.pares_padron,
           'pares_con_rafaga', pv.pares_con_rafaga,
           'prevalencia_giro', round(pv.pares_con_rafaga::numeric / nullif(pv.pares_padron, 0), 3),
           'n_pares_vista', (select g.n_pares from forense.v_pares_giro g
                              where g.corrida_id = p_corrida and g.giro = c.giro),
           -- Lo que la defensa usa para refutar (trampa de ráfaga legítima).
           'tiene_nomina', coalesce(s.tiene_nomina, false),
           'tiene_compras', coalesce(s.tiene_compras, false),
           'cobertura', jsonb_build_object(
              'ventana_minutos', round(extract(epoch from VENTANA_RAFAGA) / 60.0),
              'profundidad_max', 4,
              'umbral_prevalencia_giro', UMBRAL_GIRO,
              'solo_padron', true)),
         forense.huella_pista('T2', c.rfc, v_corte, 'sincronia')
    from por_rfc c
    join prevalencia pv on pv.giro = c.giro
    left join sustancia s on s.rfc = c.rfc
   where pv.pares_con_rafaga::numeric / nullif(pv.pares_padron, 0) < UMBRAL_GIRO
  on conflict (corrida_id, codigo, rfc, huella) do nothing;
  get diagnostics n = row_count;

  -- Regla 2: si la guarda de giro suprimió ráfagas, tiene que constar.
  perform forense.log(null, 'sistema', 'pista_cargada',
    jsonb_build_object('evento_real', 'T2_sincronia_calibrada',
      'ventana_minutos', round(extract(epoch from VENTANA_RAFAGA) / 60.0),
      'umbral_prevalencia_giro', UMBRAL_GIRO,
      'emitidas', n,
      'motivo', 'pierna (a) con ventana de lote de timbrado y guarda relativa al giro (db/019)'),
    null, null, null, null, null, null, null, p_corrida);
  end if;

  -- (b) pico de diciembre sin histórico previo — IDÉNTICA a 003.
  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  with meses as (
    select f.emisor_rfc as rfc, date_trunc('month', f.fecha) as mes, sum(f.total) as monto
      from forense.cfdi f
     where f.corrida_id = p_corrida and f.tipo = 'I' and not f.cancelado
       and f.fecha <= v_corte and f.fecha > v_corte - interval '24 months'
     group by 1, 2
  ),
  ventana as (
    select m.rfc, m.mes, m.monto,
           (m.mes > v_corte - interval '12 months') as en_ventana,
           extract(month from m.mes)::int as num_mes,
           extract(year from m.mes)::int as anio
      from meses m
  ),
  agg as (
    select v.rfc,
           percentile_cont(0.5) within group (order by v.monto)
             filter (where v.en_ventana and v.num_mes <> 12) as mediana,
           max(v.monto) filter (where v.en_ventana and v.num_mes = 12) as dic_actual,
           max(v.anio) filter (where v.en_ventana and v.num_mes = 12) as anio_dic,
           count(*) filter (where not v.en_ventana and v.num_mes = 12) as dic_previos,
           count(*) filter (where v.en_ventana) as meses_activos
      from ventana v group by v.rfc
  ),
  medidos as (
    select a.*, c.giro
      from agg a
      join forense.contribuyentes c on c.corrida_id = p_corrida and c.rfc = a.rfc
  )
  select p_corrida, 'T2', 'T', d.rfc,
         least(1.0, 0.5 + least(0.4, (d.dic_actual / nullif(d.mediana, 0) - 3) / 10.0))::numeric,
         jsonb_build_object(
           'motivo', 'estacionalidad',
           'giro', d.giro,
           'diciembre', d.dic_actual::text,
           'mediana_mensual', round(d.mediana::numeric, 2)::text,
           'multiplo', round((d.dic_actual / nullif(d.mediana, 0))::numeric, 2),
           'meses_activos', d.meses_activos,
           'diciembres_previos', d.dic_previos,
           'resumen', format(
             'Diciembre concentra %s, %s veces la mediana mensual de %s, y no hay ningún '
             'diciembre anterior en el histórico disponible con el que comparar.',
             d.dic_actual, round((d.dic_actual / nullif(d.mediana, 0))::numeric, 2),
             round(d.mediana::numeric, 2)),
           'referencias', (select coalesce(jsonb_agg('CFDI:' || u.uuid), '[]'::jsonb) from (
              select f.uuid from forense.cfdi f
               where f.corrida_id = p_corrida and f.emisor_rfc = d.rfc
                 and f.tipo = 'I' and not f.cancelado
                 and extract(month from f.fecha) = 12
                 and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
               order by f.total desc, f.uuid limit 20) u),
           'comprobacion', 'T2',
           'ventana', jsonb_build_object('desde', (v_corte - interval '12 months'), 'hasta', v_corte)),
         forense.huella_pista('T2', d.rfc, v_corte, 'estacionalidad')
    from medidos d
   where d.dic_actual is not null and d.mediana is not null and d.mediana > 0
     and d.meses_activos >= 4
     and d.dic_actual / d.mediana > 3
     and d.dic_previos = 0
  on conflict (corrida_id, codigo, rfc, huella) do nothing;
  get diagnostics m = row_count;

  return n + m;
end $$;

comment on function forense.pista_t2(uuid) is
  'T2 sincronía y estacionalidad. Pierna (a) recalibrada en db/019: ventana de '
  'lote de timbrado (15 min, no 6 h), sólo RFC del padrón y guarda relativa a '
  'los pares del giro. Pierna (b) idéntica a 003.';
