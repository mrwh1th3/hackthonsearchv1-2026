-- =====================================================================
-- 017_evaluacion_pistas.sql — la capa de descarte de falsos positivos
-- vuelve a tener de dónde leer, y la cobertura se decide tras el dictamen.
--
-- H11-b: `paquete_auditor_final` leía `evaluacion_pistas->codigo` cuando la
--        clave es el ID de la pista (así la escribe
--        `aplicar_resolucion_replica`, y `pista_objetivo` es un bigint por
--        contrato). `evaluacion_caso` viajaba en null SIEMPRE, así que
--        `anomalia_explicada` era inalcanzable.
-- H11-c: `guardar_dictamen` calculaba la cobertura dentro del UPDATE que
--        escribe `pendientes`, o sea contra los pendientes VIEJOS.
-- =====================================================================

set search_path = '';

do $$
declare
  v_corrida uuid; v_cluster uuid; v_caso uuid; v_pista bigint;
  v_eval jsonb; v_por_codigo jsonb; v_cob boolean; n int;
  sufijo text := substr(md5(random()::text), 1, 8);
begin
  select k.id into v_corrida from forense.corridas k
   where exists (select 1 from forense.cfdi f where f.corrida_id = k.id)
   order by k.inicio nulls last limit 1;
  if v_corrida is null then
    perform pruebas.omitir('017: evaluación por caso', 'no hay corrida con dominio');
    return;
  end if;

  insert into forense.clusters (corrida_id, rfcs, rfc_semilla, n_rfcs, score, estado,
                                version_contexto, rfcs_frontera, huella)
  values (v_corrida, array['FFF060606FFF'], 'FFF060606FFF', 1, 7.5, 'ronda2', 1,
          '{}', 'huella-test-017-' || sufijo)
  returning id into v_cluster;

  insert into forense.casos (corrida_id, cluster_id, rfc_principal, origen, estado,
                             bitacora_seq)
  values (v_corrida, v_cluster, 'FFF060606FFF', 'pipeline', 'validando', 0)
  returning id into v_caso;

  insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda,
                                     intento, version_contexto, estado, idempotency_key)
  select v_caso, v_corrida, v_cluster, a, 1, 0, 1, 'completada',
         'test-017-' || sufijo || '-' || a
    from unnest(array['facturacion','flujo','red','temporal','listas']) a;

  -- La pista se inserta VÁLIDA contra el contrato entities.pista: score en
  -- [0,1], resumen no vacío y referencias como arreglo del espacio de
  -- nombres. `db/tests/contrato_pistas.mjs` valida TODA la tabla al final de
  -- la corrida, así que una pista sintética malformada rompe ese chequeo.
  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  values (v_corrida, 'R1', 'R', 'FFF060606FFF', 0.6,
          jsonb_build_object('resumen', 'domicilio compartido con dos contrapartes',
                             'referencias', jsonb_build_array('ATR:domicilio:' || sufijo)),
          'h-017-' || sufijo)
  returning id into v_pista;

  -- La defensa resuelta por la réplica: clave = ID de la pista.
  update forense.casos
     set evaluacion_pistas = jsonb_build_object(v_pista::text,
           jsonb_build_object('resultado', 'descartada', 'defensa_id', 1,
                              'trampa_codigo', 'despacho_contable'))
   where id = v_caso;

  select (p.pistas->0)->'evaluacion_caso' into v_eval
    from forense.paquete_auditor_final(v_caso) p;
  perform pruebas.assert(
    'paquete_auditor_final expone evaluacion_caso leyendo por ID de pista',
    coalesce(v_eval->>'resultado', '') = 'descartada',
    'evaluacion_caso=' || coalesce(v_eval::text, 'null'));

  -- Regresión explícita del hallazgo: la clave NO es el código.
  select k.evaluacion_pistas->'R1' into v_por_codigo
    from forense.casos k where k.id = v_caso;
  perform pruebas.assert(
    'la clave de evaluacion_pistas no es el código de la pista (era el bug)',
    v_por_codigo is null,
    'evaluacion_pistas->''R1''=' || coalesce(v_por_codigo::text, 'null')
    || ' y ->''' || v_pista::text || '''=' || coalesce(v_eval::text, 'null'));

  -- El estado global de la pista sigue en el catálogo de 001: la defensa no
  -- lo toca. Si algún día lo tocara, el contrato entities.pista lo rechaza.
  select count(*) into n from forense.pistas p
   where p.id = v_pista and p.estado in ('disparada','no_evaluable');
  perform pruebas.assert(
    'la defensa no cambia forense.pistas.estado (sigue disparada|no_evaluable)',
    n = 1, 'estado global intacto');

  -- H11-c: el dictamen declara una limitación NUEVA. La cobertura tiene que
  -- quedar en false, no en el true que se calculaba con los pendientes viejos.
  perform pruebas.assert('017: el caso está cubierto ANTES del dictamen',
    forense.cobertura_caso(v_caso), 'cinco tareas completadas y sin pendientes');

  perform forense.guardar_dictamen(v_caso, jsonb_build_object(
    'nivel', 'presuncion', 'familias', jsonb_build_array('F','R'),
    'pendientes', jsonb_build_array(jsonb_build_object(
      'motivo', 'cadena_incompleta', 'reparable', false,
      'detalle', 'la cadena sigue hacia RFC no investigados'))));

  select cobertura_completa into v_cob from forense.casos where id = v_caso;
  perform pruebas.assert(
    'un dictamen que declara una limitación nueva deja cobertura_completa = false',
    not v_cob, 'columna tras guardar_dictamen=' || v_cob::text);

  select count(*) into n from forense.bitacora b
   where b.caso_id = v_caso and b.payload->>'evento_real' = 'cobertura_recalculada'
     and b.payload->>'motivo' = 'dictamen';
  perform pruebas.assert(
    'guardar_dictamen deja el evento del recálculo de cobertura (regla 2)',
    n >= 1, 'eventos con motivo=dictamen: ' || n);
end $$;
