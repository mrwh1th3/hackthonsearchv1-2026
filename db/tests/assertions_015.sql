-- =====================================================================
-- 015_cobertura.sql — la cobertura se decide en código.
--
-- El caso que importa (bloqueante del demo): 5 tareas completadas, sin
-- frontera pendiente y sin limitaciones -> cobertura_completa = true, y
-- el paquete del auditor final lo lleva. Con una tarea en error, false.
-- El nivel lo sigue calculando el dictaminador determinista del runtime
-- (regla 4): aquí se comprueba lo que ese dictaminador LEE.
-- =====================================================================

set search_path = '';

do $$
declare
  v_corrida uuid; v_cluster uuid; v_caso uuid; r record; n int;
  v_cob boolean; v_fam int; v_pend int;
  sufijo text := substr(md5(random()::text), 1, 8);
begin
  select k.id into v_corrida from forense.corridas k
   where exists (select 1 from forense.cfdi f where f.corrida_id = k.id)
   order by k.inicio nulls last limit 1;
  if v_corrida is null then
    perform pruebas.omitir('015: caso de cobertura', 'no hay corrida con dominio');
    return;
  end if;

  insert into forense.clusters (corrida_id, rfcs, rfc_semilla, n_rfcs, score, estado,
                                version_contexto, rfcs_frontera, huella)
  values (v_corrida, array['AAA010101AAA','BBB020202BBB'], 'AAA010101AAA', 2, 8.0,
          'ronda2', 1, '{}', 'huella-test-015-' || sufijo)
  returning id into v_cluster;

  insert into forense.casos (corrida_id, cluster_id, rfc_principal, rfcs_satelite,
                             origen, estado, bitacora_seq)
  values (v_corrida, v_cluster, 'AAA010101AAA', array['BBB020202BBB'],
          'pipeline', 'validando', 0)
  returning id into v_caso;

  -- 5 tareas despachadas y completadas (los 5 especialistas de la ronda 1).
  insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda,
                                     intento, version_contexto, estado, idempotency_key)
  select v_caso, v_corrida, v_cluster, a, 1, 0, 1, 'completada',
         'test-015-' || sufijo || '-' || a
    from unnest(array['facturacion','flujo','red','temporal','listas']) a;

  -- A. El caso del demo.
  v_cob := forense.cobertura_caso(v_caso);
  perform pruebas.assert(
    'cobertura_completa = true con 5 tareas completadas, sin frontera pendiente y sin limitaciones',
    v_cob, 'cobertura=' || v_cob::text);

  perform forense.recalcular_cobertura(v_caso, 'prueba_015');
  select cobertura_completa into v_cob from forense.casos where id = v_caso;
  perform pruebas.assert('recalcular_cobertura persiste el true en forense.casos',
    v_cob, 'columna=' || v_cob::text);

  select count(*) into n from forense.bitacora b
   where b.caso_id = v_caso and b.tipo_evento = 'validacion'
     and b.payload->>'evento_real' = 'cobertura_recalculada';
  perform pruebas.assert('recalcular_cobertura deja evento en forense.bitacora (regla 2)',
    n >= 1, 'eventos=' || n);

  -- B. El paquete del auditor final lo expone calculado. Es lo que lee
  --    n8n/runtime/auditor-final.mjs: `cobertura_completa && pendientes
  --    vacío`; con dos familias validadas su regla da `presuncion`.
  -- `ref_id` de una evidencia 'cfdi' tiene que ser un UUID real de la
  -- corrida: `forense_validar_evidencia` lo castea (y en el reintento de
  -- abajo se vuelve a ejecutar).
  insert into forense.evidencia (caso_id, idempotency_key, tipo, ref_id, monto,
                                 pista_codigo, familia, rfcs_afectados, descripcion,
                                 agente, ronda, valida_tecnica, refutada, validada)
  select v_caso, 'test-015-ev-f-' || sufijo, 'cfdi',
         'CFDI:' || (select f.uuid::text from forense.cfdi f
                      where f.corrida_id = v_corrida order by f.fecha limit 1),
         1000.00, 'F1', 'F', array['AAA010101AAA'], 'facturas sin conciliar',
         'facturacion', 1, true, false, true
  union all
  select v_caso, 'test-015-ev-r-' || sufijo, 'atributo',
         'ATRIBUTO:domicilio:' || md5('domicilio de prueba ' || sufijo), null,
         'R1', 'R', array['AAA010101AAA'], 'domicilio compartido', 'red', 1,
         true, false, true;

  select p.cobertura_completa,
         jsonb_array_length(p.pendientes),
         (select count(distinct e->>'familia')
            from jsonb_array_elements(p.evidencia) e
           where (e->>'valida_tecnica')::boolean and (e->>'validada')::boolean
             and not (e->>'refutada')::boolean)
    into v_cob, v_pend, v_fam
    from forense.paquete_auditor_final(v_caso) p;
  perform pruebas.assert(
    'paquete_auditor_final expone cobertura_completa=true y pendientes vacío',
    v_cob and v_pend = 0, 'cobertura=' || v_cob::text || ' pendientes=' || v_pend);
  perform pruebas.assert(
    'con cobertura completa y dos familias validadas el dictamen determinista da presuncion',
    v_cob and v_pend = 0 and v_fam = 2,
    'familias=' || v_fam || ' (nivel máximo del sistema: presuncion_alta, regla 7)');

  -- C. Una tarea en error deja la cobertura en false: ausencia de señal
  --    no es ausencia de fraude.
  update forense.tareas_agente set estado = 'error', error = 'timeout del proveedor'
   where caso_id = v_caso and agente = 'listas';
  perform pruebas.assert('una tarea en error deja cobertura_completa = false',
    not forense.cobertura_caso(v_caso), 'tarea listas en error');

  select p.cobertura_completa into v_cob from forense.paquete_auditor_final(v_caso) p;
  perform pruebas.assert('el paquete del auditor refleja el false del error',
    not v_cob, 'cobertura=' || v_cob::text);

  -- D. Una tarea OMITIDA (familia no evaluable, omisión declarada) sí es
  --    terminal: la cobertura vuelve a true.
  update forense.tareas_agente set estado = 'omitida'
   where caso_id = v_caso and agente = 'listas';
  perform pruebas.assert('una tarea omitida por familia no evaluable es terminal',
    forense.cobertura_caso(v_caso), 'tarea listas omitida');

  -- E. Frontera (semántica corregida en 016). La que cuenta es la que
  --    PIDIERON LAS SEÑALES, no la lista de candidatos del cluster.
  --
  -- E1. Regresión del hallazgo alto: `clusters.rfcs_frontera` es la lista
  --     de vecinos a un salto que 004 dejó anotada. Casi nunca está
  --     vacía en datos reales (el verificador midió 61 RFC residuales), y
  --     nadie pidió mirarlos. No puede bloquear la cobertura.
  update forense.clusters set rfcs_frontera = array['CCC030303CCC'] where id = v_cluster;
  perform pruebas.assert(
    'la lista de candidatos del cluster NO bloquea la cobertura si ninguna señal la pidió',
    forense.cobertura_caso(v_caso),
    'cl.rfcs_frontera={CCC030303CCC} y cero señales con frontera');

  -- E2. Una señal que sí pide salir del cluster, con cuota disponible:
  --     el caso debe la expansión, así que no está cubierto.
  insert into forense.senales (cluster_id, caso_id, ronda, intento, version_contexto,
                               idempotency_key, familia, agente, titular, detalle,
                               rfcs, ids, frontera, confianza, refuta)
  values (v_cluster, v_caso, 1, 0, 1, 'test-015-senal-' || sufijo, 'R', 'red',
          'la cadena sigue fuera del cluster', '{}'::jsonb,
          array['AAA010101AAA'], '{}', array['CCC030303CCC'], 'media', false);
  perform pruebas.assert(
    'una frontera pedida por una señal, con cuota de expansión, deja cobertura_completa = false',
    not forense.cobertura_caso(v_caso), 'señal con frontera CCC030303CCC sin expandir');

  -- E3. Gastada la única expansión (03 §127), la frontera residual es una
  --     limitación declarada en el expediente, no un hueco de cobertura.
  perform forense.log(v_caso, 'sistema', 'cluster_expandido',
    jsonb_build_object('evento_real', 'prueba_cuota_agotada',
                       'agregados', to_jsonb(array['DDD040404DDD']), 'n_agregados', 1),
    null, null, null, null, null, v_cluster, null, v_corrida);
  perform pruebas.assert(
    'agotada la cuota de expansión, la frontera residual no impide la cobertura (03 §127)',
    forense.cobertura_caso(v_caso),
    'una expansión usada, max_expansiones_caso=' || forense.config_int('max_expansiones_caso', 1));

  delete from forense.senales where caso_id = v_caso;
  delete from forense.bitacora where caso_id = v_caso and tipo_evento = 'cluster_expandido';
  update forense.clusters set rfcs_frontera = '{}' where id = v_cluster;

  -- F. Limitación abierta: false. Mismo criterio que el dictaminador
  --    (pendientes.length === 0), no un campo inventado.
  update forense.casos
     set pendientes = jsonb_build_array(jsonb_build_object(
           'codigo', 'barrera_vencida', 'motivo', 'evidencia_insuficiente'))
   where id = v_caso;
  perform pruebas.assert('una limitación abierta deja cobertura_completa = false',
    not forense.cobertura_caso(v_caso), 'pendientes con una limitación');

  update forense.casos set pendientes = '[]'::jsonb where id = v_caso;

  -- G. Un caso sin tareas despachadas NO está cubierto por vacío.
  perform pruebas.assert('un caso sin tareas despachadas no queda cubierto por vacío',
    not forense.cobertura_caso((select c.id from forense.casos c
                                 where c.id <> v_caso
                                   and not exists (select 1 from forense.tareas_agente t
                                                    where t.caso_id = c.id)
                                 limit 1)),
    'caso sin tareas');

  -- H. cerrar_ronda recalcula al cerrar la ÚLTIMA ronda, y sólo esa: en
  --    la ronda 1 la ronda siguiente todavía no existe, así que no se
  --    puede declarar cubierto nada.
  update forense.casos set cobertura_completa = false where id = v_caso;
  perform forense.cerrar_ronda(v_caso, 1, '{}'::jsonb);
  select cobertura_completa into v_cob from forense.casos where id = v_caso;
  perform pruebas.assert('cerrar_ronda de una ronda intermedia NO toca la cobertura',
    not v_cob, 'columna tras cerrar_ronda(1)=' || v_cob::text);

  perform forense.cerrar_ronda(v_caso, 2, '{}'::jsonb);
  select cobertura_completa into v_cob from forense.casos where id = v_caso;
  perform pruebas.assert('cerrar_ronda de la última ronda recalcula la cobertura',
    v_cob, 'columna tras cerrar_ronda(2)=' || v_cob::text);

  -- I. revalidar_caso también la recalcula antes del dictamen.
  update forense.casos set cobertura_completa = false where id = v_caso;
  perform forense.revalidar_caso(v_caso);
  select cobertura_completa into v_cob from forense.casos where id = v_caso;
  perform pruebas.assert('revalidar_caso recalcula la cobertura antes del dictamen',
    v_cob, 'columna tras revalidar_caso=' || v_cob::text);
end $$;
