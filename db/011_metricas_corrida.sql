-- =====================================================================
-- db/011_metricas_corrida.sql — `forense.v_metricas_corrida` COMPLETA.
--
-- ADITIVA: solo `create or replace function` sobre la de 002 (misma
-- firma y mismo tipo de retorno jsonb, así que no hace falta drop).
--
-- 002 la dejó `parcial: true` con cinco huecos declarados. Aquí se
-- cierran los cinco portando a SQL exactamente lo que calcula
-- eval/metricas.py (docs/10):
--
--   * baseline_dos_pistas   — «positivo = RFC con >= 2 pistas disparadas»,
--                             la regla base explícita sin agentes.
--   * selector_dos_familias — forense.score_entidad, que exige dos
--                             familias distintas.
--   * acierto_de_cache      — reuso real de forense.tool_cache.
--   * tasa_de_ronda_2       — casos que abrieron ronda 2 y fronteras.
--   * reintentos            — ya estaba; ahora con desglose por motivo.
--
-- Reglas de docs/10 que no se negocian:
--   - Denominador cero ⇒ null, NUNCA un 0% ficticio.
--   - El recall conservador usa el total de RFC de fraude: un fraude que
--     no se investigó cuenta como FN.
--   - La FPR sobre trampas se publica con numerador y denominador
--     visibles ("1/8") y con el rango [FP/N, (FP+sin_conclusion)/N].
--   - Las pistas `no_evaluable` declaran una limitación, no una señal: no
--     suman al baseline.
--   - `costo_usd` sigue fuera: exige una tabla de precios y usage real.
--     No se inventa; se publica `null` con el motivo, que es lo honesto.
-- =====================================================================

create or replace function forense.v_metricas_corrida(p_corrida uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c record; m jsonb; v_carril jsonb; v_pistas jsonb; v_noeval jsonb;
begin
  select * into c from forense.corridas where id = p_corrida;
  if not found then
    return jsonb_build_object('error', 'corrida no encontrada');
  end if;

  -- ------------------------------------------------------------------
  -- Carril de datos: dos reglas DETERMINISTAS sobre la misma cohorte.
  -- Idéntico a eval/metricas.py §SQL_CARRIL (la aserción de db/tests
  -- comprueba la igualdad campo a campo sobre gen-v1).
  -- ------------------------------------------------------------------
  with gt as (
    select g.rfc, g.es_fraude, g.es_trampa_legitima, g.tipologia
      from forense.ground_truth g where g.corrida_id = p_corrida
  ),
  disparadas as (
    select p.rfc, p.codigo, p.familia, p.score
      from forense.pistas p
     where p.corrida_id = p_corrida
       and coalesce(p.estado, 'disparada') <> 'no_evaluable'
  ),
  base_rfc as (
    select rfc, count(distinct codigo) as n_pistas, count(distinct familia) as n_familias
      from disparadas group by rfc
  ),
  baseline as (select rfc from base_rfc where n_pistas >= 2),
  selector as (select s.rfc from forense.score_entidad(p_corrida) s),
  mm as (
    select 'baseline_dos_pistas'::text as regla, g.rfc, g.es_fraude, g.es_trampa_legitima,
           (g.rfc in (select rfc from baseline)) as positivo from gt g
    union all
    select 'selector_dos_familias', g.rfc, g.es_fraude, g.es_trampa_legitima,
           (g.rfc in (select rfc from selector)) from gt g
  ),
  agg as (
    select regla,
           count(*) as n,
           count(*) filter (where es_fraude) as n_fraude,
           count(*) filter (where es_trampa_legitima) as n_trampas,
           count(*) filter (where positivo and es_fraude) as tp,
           count(*) filter (where positivo and not es_fraude) as fp,
           count(*) filter (where not positivo and es_fraude) as fn,
           count(*) filter (where not positivo and not es_fraude) as tn,
           count(*) filter (where positivo and es_trampa_legitima) as trampas_fp
      from mm group by regla
  ),
  por_tipologia as (
    select regla, jsonb_object_agg(tipologia, jsonb_build_object(
             'n', n, 'detectados', det,
             'recall', case when n > 0 then round(det::numeric / n, 4) end)) as j
      from (
        select mm.regla, coalesce(g.tipologia, 'sin_tipologia') as tipologia,
               count(*) as n, count(*) filter (where mm.positivo) as det
          from mm join gt g on g.rfc = mm.rfc
         where mm.es_fraude
         group by 1, 2
      ) t group by regla
  )
  select jsonb_object_agg(a.regla, jsonb_build_object(
      'tp', a.tp, 'fp', a.fp, 'fn_selectivo', a.fn, 'tn', a.tn,
      'precision', case when (a.tp + a.fp) > 0 then round(a.tp::numeric / (a.tp + a.fp), 4) end,
      'recall',    case when (a.tp + a.fn) > 0 then round(a.tp::numeric / (a.tp + a.fn), 4) end,
      'f1', case when (2 * a.tp + a.fp + a.fn) > 0
                 then round((2.0 * a.tp) / (2 * a.tp + a.fp + a.fn), 4) end,
      'fn_conservador', a.n_fraude - a.tp,
      'recall_conservador', case when a.n_fraude > 0
                                 then round(a.tp::numeric / a.n_fraude, 4) end,
      'cobertura', jsonb_build_object('concluyentes', a.n, 'ratio', 1.0,
        'nota', 'una regla determinista concluye sobre toda la cohorte'),
      'fpr_trampas', jsonb_build_object(
        'fp', a.trampas_fp, 'n', a.n_trampas,
        'sin_conclusion', 0,
        'texto', case when a.n_trampas > 0
                      then a.trampas_fp::text || '/' || a.n_trampas::text end,
        'fpr', case when a.n_trampas > 0
                    then round(a.trampas_fp::numeric / a.n_trampas, 4) end,
        'rango_min', case when a.n_trampas > 0
                          then round(a.trampas_fp::numeric / a.n_trampas, 4) end,
        'rango_max', case when a.n_trampas > 0
                          then round(a.trampas_fp::numeric / a.n_trampas, 4) end),
      'recall_por_tipologia', coalesce(pt.j, '{}'::jsonb)))
    into v_carril
    from agg a left join por_tipologia pt on pt.regla = a.regla;

  select jsonb_build_object(
      'filas', count(*), 'rfcs', count(distinct z.rfc),
      'por_codigo', coalesce(jsonb_object_agg(z.codigo, z.n order by z.codigo), '{}'::jsonb))
    into v_pistas
    from (select p.codigo, p.rfc, count(*) over (partition by p.codigo) as n
            from forense.pistas p
           where p.corrida_id = p_corrida
             and coalesce(p.estado, 'disparada') <> 'no_evaluable') z;

  select coalesce(jsonb_agg(distinct p.codigo order by p.codigo), '[]'::jsonb)
    into v_noeval
    from forense.pistas p
   where p.corrida_id = p_corrida and p.estado = 'no_evaluable';

  -- ------------------------------------------------------------------
  -- Carril de agentes: los dictámenes YA persistidos.
  -- ------------------------------------------------------------------
  with res_rfc as (
    -- Resultados por RFC: primero la atribución explícita de
    -- resultado_por_rfc; si el caso aún no la tiene, el nivel del RFC
    -- principal. Nunca se propaga el nivel del caso a los satélites.
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
           count(*) filter (where n_reintentos > 0) as casos_con_reintento,
           percentile_cont(0.5) within group (order by duracion_ms) as duracion_p50,
           percentile_cont(0.95) within group (order by duracion_ms) as duracion_p95,
           coalesce(jsonb_object_agg(nivel, n) filter (where nivel is not null), '{}'::jsonb) as por_nivel
      from (
        select presupuesto_agotado, tool_calls, tokens_total, n_reintentos, duracion_ms, nivel,
               count(*) over (partition by nivel) as n
          from forense.casos where corrida_id = p_corrida
      ) s
  ),
  -- Ronda 2: un caso llegó a ronda 2 si tiene tareas de ronda 2. La
  -- frontera detectada se cuenta desde la bitácora, que es el único
  -- rastro válido (regla 2).
  ronda2 as (
    select count(distinct k.id) as n_casos,
           count(distinct t.caso_id) filter (where t.ronda = 2) as n_ronda2,
           count(distinct b.caso_id) filter (where b.tipo_evento = 'frontera_detectada') as n_frontera,
           count(distinct b.caso_id) filter (where b.tipo_evento = 'cluster_expandido') as n_expandidos,
           count(distinct b.caso_id) filter (where b.tipo_evento = 'despertar') as n_despertados
      from forense.casos k
      left join forense.tareas_agente t on t.caso_id = k.id
      left join forense.bitacora b on b.caso_id = k.id
     where k.corrida_id = p_corrida
  ),
  -- Caché: reuso REAL. Denominador = tool_call registrados en bitácora
  -- (el único rastro de que la herramienta se pidió); numerador = los que
  -- no necesitaron una entrada nueva en tool_cache. Cero llamadas ⇒ null.
  cache as (
    select (select count(*) from forense.bitacora b
             where b.corrida_id = p_corrida and b.tipo_evento = 'tool_call') as llamadas,
           (select count(*) from forense.bitacora b
             where b.corrida_id = p_corrida and b.tipo_evento = 'tool_call'
               and coalesce((b.payload->>'desde_cache')::boolean, false)) as marcadas,
           (select count(*) from forense.tool_cache tc
             where tc.corrida_id = p_corrida) as entradas
  ),
  reintentos_motivo as (
    select coalesce(jsonb_object_agg(t.motivo, t.n), '{}'::jsonb) as j
      from (select coalesce(motivo_reintento, 'sin_motivo') as motivo, count(*) as n
              from forense.casos
             where corrida_id = p_corrida and coalesce(n_reintentos, 0) > 0
             group by 1) t
  )
  select jsonb_build_object(
    'corrida_id', p_corrida,
    'nombre', c.nombre,
    'dataset', c.dataset,
    'dataset_hash', c.dataset_hash,
    'fecha_corte', c.fecha_corte,
    'corrida_origen_id', c.corrida_origen_id,
    'version_prompts', c.version_prompts,
    'version_reglas', c.version_reglas,
    'modo', c.modo,
    'estado_corrida', c.estado,
    'terminal', (c.estado in ('completada','error')),
    -- Ya no queda nada declarado como hueco: `parcial` es false.
    'parcial', false,
    'cohorte', jsonb_build_object(
      'total_ground_truth', a.total_gt,
      'total_fraude', a.total_fraude,
      'total_trampas', a.total_trampas,
      'sin_conclusion', a.sin_conclusion),
    'pistas', v_pistas,
    'no_evaluables', v_noeval,
    'carril_datos', coalesce(v_carril, '{}'::jsonb),
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
    'acierto_de_cache', jsonb_build_object(
      'llamadas', ch.llamadas,
      'entradas_cache', ch.entradas,
      'hits_marcados', ch.marcadas,
      -- Reuso estructural: llamadas que no crearon entrada nueva.
      'reuso', case when ch.llamadas > 0
                    then round(greatest(ch.llamadas - ch.entradas, 0)::numeric / ch.llamadas, 4) end,
      'tasa_marcada', case when ch.llamadas > 0
                           then round(ch.marcadas::numeric / ch.llamadas, 4) end),
    'tasa_de_ronda_2', jsonb_build_object(
      'casos', r2.n_casos,
      'con_ronda_2', r2.n_ronda2,
      'tasa', case when r2.n_casos > 0 then round(r2.n_ronda2::numeric / r2.n_casos, 4) end,
      'fronteras_detectadas', r2.n_frontera,
      'clusters_expandidos', r2.n_expandidos,
      'despertares', r2.n_despertados),
    'reintentos', jsonb_build_object(
      'total', ca.reintentos,
      'casos_con_reintento', ca.casos_con_reintento,
      'tasa', case when ca.n_casos > 0
                   then round(ca.casos_con_reintento::numeric / ca.n_casos, 4) end,
      'por_motivo', rm.j),
    'operacion', jsonb_build_object(
      'casos', ca.n_casos, 'presupuesto_agotado', ca.n_presupuesto_agotado,
      'tool_calls', ca.tool_calls, 'tokens_total', ca.tokens_total,
      'reintentos', ca.reintentos,
      'duracion_ms_p50', ca.duracion_p50, 'duracion_ms_p95', ca.duracion_p95,
      'casos_por_nivel', ca.por_nivel),
    'costo_usd', null,
    'no_implementado', jsonb_build_array(
      'costo_usd (exige tabla de precios versionada y usage real del proveedor)')
  ) into m
  from agg a, por_tipologia pt, casos_agg ca, ronda2 r2, cache ch, reintentos_motivo rm;

  return m;
end $$;

-- Fin 011_metricas_corrida.sql
