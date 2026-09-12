-- =====================================================================
-- 017_evaluacion_pistas.sql — `anomalia_explicada` vuelve a ser
-- alcanzable, y la cobertura se recalcula después del dictamen.
--
-- HALLAZGO H11-b (alto, destapado al arreglar la cobertura en 016; antes
-- quedaba oculto porque `cobertura_completa=false` mandaba TODO caso a
-- `no_concluyente`):
--
--   `n8n/runtime/auditor-final.mjs` llegaba a `anomalia_explicada` por una
--   sola vía: `pistas.every(p => p.estado === 'refutada')`. Pero
--   `forense.pistas.estado` (001) sólo admite 'disparada' | 'no_evaluable'
--   —y el contrato `entities.pista.estado` declara exactamente ese par—,
--   así que 'refutada' no existe en ninguna parte y la condición era
--   siempre falsa. El nivel que representa la CAPA DE DESCARTE DE FALSOS
--   POSITIVOS era inalcanzable: una empresa legítima cuya defensa refuta
--   todas sus pistas terminaba en `no_concluyente`.
--
--   La defensa NO escribe el estado global de la pista (y hace bien:
--   `aplicar_resolucion_replica` lo dice, "evaluación POR CASO, nunca el
--   estado global"). Escribe en `casos.evaluacion_pistas`:
--     { "<pista_id>": {"resultado": "descartada"|"sostenida",
--                      "defensa_id": n, "trampa_codigo": "..."} }
--
--   Y ahí estaba el segundo error: `paquete_auditor_final` exponía ese
--   objeto leyéndolo por `p.codigo` ('R1'), cuando la clave es el ID de la
--   pista. `pista_objetivo` es un bigint por contrato
--   (contracts/schemas/agents.schema.json → $defs/argumento) y el ejemplo
--   de `n8n/prompts/defensor.md` lo confirma ("pista_objetivo": "501").
--   Es decir: `evaluacion_caso` viajaba en null SIEMPRE, y el dictaminador
--   no tenía de dónde leer el resultado de la defensa ni aunque lo
--   intentara.
--
--   Esta migración corrige la clave. El cambio en la regla del nivel va en
--   `n8n/runtime/auditor-final.mjs` (el nivel lo decide código, no SQL:
--   regla 4).
--
-- HALLAZGO H11-c (medio, en mi propio 016): `guardar_dictamen` calculaba
--   la cobertura DENTRO del UPDATE que escribe `pendientes`. Las
--   expresiones de un SET se evalúan contra la instantánea previa a la
--   sentencia, así que leía los `pendientes` viejos: un dictamen que
--   declara una limitación nueva persistía `cobertura_completa = true`
--   junto a ella. Ahora se recalcula después, con
--   `recalcular_cobertura`, que además deja el evento que pide la regla 2.
--
-- Aditiva: `create or replace` de dos funciones con el cuerpo de 015/016
-- más los cambios descritos. No toca tablas, ni firmas, ni catálogos.
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 1. paquete_auditor_final: `evaluacion_caso` indexada por ID de pista.
--    Cuerpo de 015 §4; sólo cambia esa lectura.
-- ---------------------------------------------------------------------
create or replace function forense.paquete_auditor_final(p_caso uuid)
returns table(caso_id uuid, cluster_id uuid, corrida_id uuid, investigacion_id uuid,
              caso jsonb, pistas jsonb, evidencia jsonb, pendientes jsonb,
              cobertura_completa boolean, presupuesto jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare k record; cl record; v_inv uuid; v_pistas jsonb; v_ev jsonb; v_pres jsonb;
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  select * into cl from forense.clusters c where c.id = k.cluster_id;
  select i.id into v_inv from forense.investigaciones i where i.caso_id = p_caso
   order by i.creado limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'pista_id', p.id, 'codigo', p.codigo, 'familia', p.familia, 'rfc', p.rfc,
           'score', p.score, 'estado', p.estado,
           'resumen_untrusted', p.detalle->>'resumen',
           'referencias', coalesce(p.detalle->'referencias', '[]'::jsonb),
           -- 017: la clave es el ID de la pista. `pista_objetivo` es un
           -- bigint por contrato (contracts agents.argumento) y
           -- `aplicar_resolucion_replica` indexa por él; leer por
           -- `codigo` devolvía null SIEMPRE.
           'evaluacion_caso',
             coalesce(k.evaluacion_pistas->(p.id::text), 'null'::jsonb))
         order by p.score desc, p.id), '[]'::jsonb)
    into v_pistas
    from forense.pistas p
   where p.corrida_id = k.corrida_id
     and p.rfc = any(coalesce(cl.rfcs, array[k.rfc_principal]));

  -- monto_centavos: entero. Sin él, `dictaminar` no puede sumar el monto
  -- en riesgo y el nodo falla (hallazgo alto del runtime, oleada 2b).
  select coalesce(jsonb_agg(jsonb_build_object(
           'evidencia_id', e.id, 'tipo', e.tipo, 'ref_id', e.ref_id,
           'monto_centavos', case when e.monto is null then null
                                  else round(e.monto * 100)::bigint end,
           'pista_id', e.pista_id, 'pista_codigo', e.pista_codigo, 'familia', e.familia,
           'rfcs_afectados', to_jsonb(e.rfcs_afectados),
           'descripcion_untrusted', e.descripcion,
           'agente', e.agente, 'ronda', e.ronda, 'intento', e.intento,
           'valida_tecnica', e.valida_tecnica, 'refutada', e.refutada,
           'validada', e.validada, 'hecho_validado', e.hecho_validado,
           'motivo_descartada', e.motivo_descartada)
         order by e.id), '[]'::jsonb)
    into v_ev
    from forense.evidencia e
   where e.caso_id = p_caso and coalesce(e.refutada, false) = false;

  v_pres := jsonb_build_object(
    'tool_calls', coalesce(k.tool_calls, 0),
    'techo_caso', forense.config_int('techo_tool_calls_caso', 0),
    'agotado', coalesce(k.presupuesto_agotado, false),
    'n_reintentos', coalesce(k.n_reintentos, 0),
    'tokens_total', coalesce(k.tokens_total, 0));

  return query select p_caso, k.cluster_id, k.corrida_id, v_inv,
    jsonb_build_object(
      'caso_id', k.id, 'rfc_principal', k.rfc_principal,
      'rfcs_satelite', to_jsonb(coalesce(k.rfcs_satelite, '{}'::text[])),
      'rfcs_cluster', to_jsonb(coalesce(cl.rfcs, '{}'::text[])),
      'tipologia', k.tipologia, 'hipotesis_untrusted', k.hipotesis,
      'familias_confirmadas', to_jsonb(coalesce(k.familias_confirmadas, '{}'::text[])),
      'estado', k.estado, 'version_contexto', cl.version_contexto),
    v_pistas, v_ev,
    coalesce(k.pendientes, '[]'::jsonb),
    -- La cobertura se CALCULA aquí, no se lee de la columna: el
    -- dictaminador determinista recibe el estado real del caso aunque
    -- ningún paso previo haya recalculado la columna. `pendientes` viaja
    -- crudo y la regla usa el mismo criterio (lista vacía), así que SQL y
    -- el dictaminador no pueden discrepar.
    forense.cobertura_caso(p_caso),
    v_pres;
end $$;
-- ---------------------------------------------------------------------
-- 2. guardar_dictamen: la cobertura se recalcula tras el UPDATE.
--    Cuerpo de 016 §3; sólo cambia dónde se decide la cobertura.
-- ---------------------------------------------------------------------
create or replace function forense.guardar_dictamen(p_caso uuid, p_dictamen jsonb)
returns table(caso_id uuid, cluster_id uuid, corrida_id uuid,
              investigacion_id uuid, nivel text, version int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  k record; v_inv uuid; v_nivel text; v_monto numeric; v_ver int;
  v_fam text[]; v_rxr jsonb;
begin
  select * into k from forense.casos c where c.id = p_caso for update;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  select i.id into v_inv from forense.investigaciones i where i.caso_id = p_caso
   order by i.creado limit 1;

  v_nivel := coalesce(p_dictamen->>'nivel', 'no_concluyente');
  if v_nivel not in ('sin_hallazgos','anomalia_explicada','no_concluyente',
                     'presuncion','presuncion_alta') then
    raise exception 'nivel % fuera del catálogo (el máximo es presuncion_alta)', v_nivel
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_fam
    from jsonb_array_elements_text(
           case when jsonb_typeof(p_dictamen->'familias') = 'array'
                then p_dictamen->'familias' else '[]'::jsonb end) x;

  -- Monto deduplicado: se suma cada ref_id UNA vez, en centavos, y se
  -- guarda en pesos. Si el dictamen trae monto, se usa el suyo.
  if (p_dictamen ? 'monto_en_riesgo_centavos') then
    v_monto := round((p_dictamen->>'monto_en_riesgo_centavos')::numeric / 100.0, 2);
  else
    select round(coalesce(sum(m.monto), 0), 2) into v_monto from (
      select distinct on (e.tipo, e.ref_id) e.monto
        from forense.evidencia e
       where e.caso_id = p_caso and coalesce(e.refutada, false) = false
         and coalesce(e.validada, false) = true and e.monto is not null
       order by e.tipo, e.ref_id, e.id) m;
  end if;

  v_rxr := case when jsonb_typeof(p_dictamen->'resultado_por_rfc') = 'array'
                then p_dictamen->'resultado_por_rfc' else '[]'::jsonb end;

  update forense.casos
     set nivel = v_nivel,
         familias_confirmadas = v_fam,
         monto_en_riesgo = v_monto,
         moneda = coalesce(moneda, 'MXN'),
         tipologia = coalesce(p_dictamen->>'tipologia', tipologia),
         resultado_por_rfc = v_rxr,
         pendientes = coalesce(p_dictamen->'pendientes', pendientes),
         estado = 'dictaminado'
   where id = p_caso;

  -- La cobertura se recalcula DESPUÉS del update, no dentro de él: las
  -- expresiones de un SET se evalúan contra la instantánea previa a la
  -- sentencia, así que una cobertura calculada ahí leería los
  -- `pendientes` VIEJOS y podría persistir true junto a una limitación
  -- que este mismo dictamen acaba de declarar. Además `recalcular_cobertura`
  -- deja el evento en bitácora que exige la regla 2.
  perform forense.recalcular_cobertura(p_caso, 'dictamen');

  select coalesce(max(version), 0) into v_ver from forense.expedientes where caso_id = p_caso;

  perform forense.log(p_caso, 'auditor_final', 'dictamen',
    jsonb_build_object('nivel', v_nivel, 'familias', to_jsonb(v_fam),
                       'monto_en_riesgo', v_monto,
                       'regla', p_dictamen->>'regla',
                       'limitaciones', coalesce(p_dictamen->'limitaciones', '[]'::jsonb)),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  return query select p_caso, k.cluster_id, k.corrida_id, v_inv, v_nivel, v_ver;
end $$;
-- ---------------------------------------------------------------------
-- 3. Permisos: igual que 016. `create or replace` los conserva; se
--    reafirman para una base que ya tenía 015/016 aplicadas.
-- ---------------------------------------------------------------------

revoke execute on function forense.paquete_auditor_final(uuid) from public;
revoke execute on function forense.guardar_dictamen(uuid, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.paquete_auditor_final(uuid) to service_role';
    execute 'grant execute on function forense.guardar_dictamen(uuid,jsonb) to service_role';
  end if;
end $$;

-- Fin 017_evaluacion_pistas.sql
