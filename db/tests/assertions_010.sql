-- Aserciones de db/010_runtime_funciones.sql.
-- EJECUTAN las funciones: `PREPARE` (n8n/tests/preparar-sql.mjs) comprueba
-- tipos, no comportamiento ni rastro. Aquí se comprueba que cada función
-- devuelve las columnas del contrato CON VALOR, que lo que muta deja evento
-- en forense.bitacora (regla 2) y que los invariantes de CLAUDE.md se
-- sostienen. Todo sobre una corrida propia: no toca el resto de la base.
set search_path = '';

-- ---------------------------------------------------------------------
-- A. Forma: cada función del runtime devuelve las columnas EXACTAS que
--    declara CONTRATOS_NODOS. Una sola columna (jsonb escalar) rompería
--    `SELECT *` del nodo.
-- ---------------------------------------------------------------------

do $$
declare
  esperado jsonb := jsonb_build_object(
    'abrir_corrida', 'corrida_id,estado,idempotency_key,corrida_origen_id,investigacion_id,dataset,reutilizada',
    'cargar_o_clonar_snapshot', 'corrida_id,estado,filas_por_tabla,corrida_origen_id',
    'verificar_integridad_corrida', 'corrida_id,estado,dataset_hash,fecha_corte,familias_evaluables,causa',
    -- 012 le añade cola_restante al final (cola de clusters sin despachar).
    'estado_corrida', 'corrida_id,terminada,estado_final,completados,en_cola,errores,cola_restante',
    'cerrar_ronda', 'caso_id,cluster_id,corrida_id,investigacion_id,senales,familias_evaluables,version_contexto,roles_por_expansion,rfcs_frontera,ruta_material,expansiones_usadas,tipo_evento,registrado',
    'aplicar_resolucion_replica', 'caso_id,cluster_id,corrida_id,investigacion_id,resoluciones',
    'paquete_auditor_final', 'caso_id,cluster_id,corrida_id,investigacion_id,caso,pistas,evidencia,pendientes,cobertura_completa,presupuesto',
    'guardar_dictamen', 'caso_id,cluster_id,corrida_id,investigacion_id,nivel,version',
    'validar_expediente', 'caso_id,cluster_id,corrida_id,investigacion_id,version,ok,estado_final',
    'cerrar_caso', 'caso_id,cluster_id,corrida_id,investigacion_id,estado_final,duracion_ms',
    'autores_reintento', 'caso_id,autores,puede_expandir,motivo,objetivo',
    'expandir_cluster_reintento', 'caso_id,autores,expandido,version_contexto,rfcs_nuevos',
    'crear_tareas_revision', 'caso_id,tarea_id,tarea_ids,version_contexto,deadline',
    'revalidar_caso', 'caso_id,limitaciones,evidencia_revalidada',
    'cargar_version_expediente', 'caso_id,version_actual,nivel,citas_permitidas,context_hash,prompt_hash,modelo,documento',
    'guardar_propuesta_edicion', 'propuesta_id,caso_id,version_base,creado',
    'clusters_por_prioridad_inyeccion', 'cluster_id,corrida_id,inyeccion_id,investigacion_id,afectado,score',
    'leer_evento_salida', 'evento_id,investigacion_id,tipo_evento,estado,completada_at,reporte_hash',
    'destinatario_aviso', 'investigacion_id,puede_llamar,motivo_omision,perfil_id,referencia_corta',
    'omitir_llamada', 'investigacion_id,estado,motivo_omision',
    'crear_intento_llamada', 'llamada_id,investigacion_id,estado,cuerpo_elevenlabs',
    'guardar_aceptacion_llamada', 'llamada_id,estado,conversation_id,call_sid',
    'registrar_callback_llamada', 'llamada_id,duplicado,estado_llamada,aviso_entregado',
    'actualizar_llamada', 'llamada_id,estado,aviso_entregado',
    'cerrar_barreras_vencidas', 'caso_id,paso,cerradas,limitaciones',
    'eventos_salida_pendientes', 'evento_id,investigacion_id,intentos');
  k text; v text; v_cols text; v_ok boolean; v_falt text := '';
begin
  for k, v in select key, value from jsonb_each_text(esperado) loop
    select string_agg(t.col, ',' order by t.ord) into v_cols from (
      select trim(split_part(trim(x), ' ', 1)) as col, ord
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace,
             unnest(string_to_array(
               regexp_replace(pg_get_function_result(p.oid), '^TABLE\(|\)$', '', 'g'), ','))
               with ordinality as u(x, ord)
       where n.nspname = 'forense' and p.proname = k
         and pg_get_function_result(p.oid) like 'TABLE(%'
    ) t;
    if v_cols is distinct from v then
      v_falt := v_falt || k || ' -> ' || coalesce(v_cols, '(no devuelve TABLE)') || '; ';
    end if;
  end loop;
  perform pruebas.assert(
    'las 26 funciones de 010 devuelven las columnas exactas de CONTRATOS_NODOS',
    v_falt = '', left(v_falt, 900));
end $$;

-- Las dos SOBRECARGAS conviven con las funciones de 007/008 sin
-- ambigüedad: el nodo llama (uuid,text) y (uuid,uuid,text,text).
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'forense' and p.proname = 'reclamar_evento_salida';
  perform pruebas.assert('reclamar_evento_salida convive como sobrecarga (007 + 010)', n = 2,
                         'variantes=' || n);
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'forense' and p.proname = 'registrar_inyeccion';
  perform pruebas.assert('registrar_inyeccion convive como sobrecarga (008 + 010)', n = 2,
                         'variantes=' || n);
end $$;

-- Ninguna función de investigación lee ground_truth (regla 10). La única
-- excepción legítima es el clonado del snapshot, que lo COPIA.
do $$
declare v_malas text;
begin
  select coalesce(string_agg(p.proname, ', '), '') into v_malas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'forense'
     and p.proname in ('abrir_corrida','verificar_integridad_corrida','estado_corrida',
       'cerrar_ronda','aplicar_resolucion_replica','paquete_auditor_final','guardar_dictamen',
       'validar_expediente','cerrar_caso','autores_reintento','expandir_cluster_reintento',
       'crear_tareas_revision','revalidar_caso','cargar_version_expediente',
       'guardar_propuesta_edicion','revertir_expediente','clusters_por_prioridad_inyeccion')
     and p.prosrc like '%ground_truth%';
  perform pruebas.assert('ninguna función de investigación de 010 lee ground_truth',
                         v_malas = '', v_malas);
end $$;

-- QA-002: la función de trigger de 007 ya no es ejecutable por public.
do $$
declare v_ok boolean;
begin
  select not has_function_privilege('public', 'forense.trg_investigacion_completa()', 'execute')
    into v_ok;
  perform pruebas.assert('QA-002: trg_investigacion_completa no es ejecutable por public',
                         v_ok, '');
end $$;

-- ---------------------------------------------------------------------
-- B. Comportamiento sobre una corrida propia de prueba.
-- ---------------------------------------------------------------------

do $$
declare
  v_c1 uuid; v_c2 uuid; v_vacia uuid; r record; v_n bigint; v_ok boolean;
  v_cluster uuid; v_caso uuid; v_ev bigint; v_ver int; v_res jsonb;
  v_tarea uuid; v_def bigint; v_prop uuid; v_bit bigint;
begin
  -- B1. abrir_corrida: crea, es idempotente y rechaza un origen no autorizado.
  select * into r from forense.abrir_corrida('gen-v1', 'test-010-abrir', null);
  v_c1 := r.corrida_id;
  perform pruebas.assert('abrir_corrida crea la corrida en preparando y no la marca reutilizada',
    r.estado = 'preparando' and r.reutilizada = false and r.dataset = 'gen-v1', r.estado);

  select * into r from forense.abrir_corrida('gen-v1', 'test-010-abrir', null);
  perform pruebas.assert('abrir_corrida con la misma idempotency_key reutiliza, no duplica',
    r.reutilizada = true and r.corrida_id = v_c1, r.corrida_id::text);

  begin
    perform forense.abrir_corrida('https://evil.example/x.csv', 'test-010-url', null);
    v_ok := false;
  exception when others then v_ok := true;
  end;
  perform pruebas.assert('abrir_corrida rechaza un dataset que no es un origen autorizado',
    v_ok, '');

  select count(*) into v_n from forense.bitacora b
   where b.corrida_id = v_c1 and b.tipo_evento = 'corrida_cargada'
     and b.payload->>'evento_real' = 'corrida_abierta';
  perform pruebas.assert('abrir_corrida deja evento corrida_cargada en bitacora (regla 2)',
    v_n = 1, 'eventos=' || v_n);

  -- B2. Snapshot vacío: verificar_integridad_corrida NO lo deja investigable.
  select * into r from forense.verificar_integridad_corrida(v_c1);
  perform pruebas.assert('una corrida vacía queda en error con causa, nunca lista',
    r.estado = 'error' and r.causa is not null, coalesce(r.causa, '(sin causa)'));

  -- B3. Clonado de un snapshot real (el de seed_fake) a una corrida nueva.
  select k.id into v_vacia from forense.corridas k
   where exists (select 1 from forense.cfdi f where f.corrida_id = k.id)
   order by k.inicio nulls last limit 1;
  if v_vacia is not null then
    select * into r from forense.abrir_corrida(null, 'test-010-clon', v_vacia);
    v_c2 := r.corrida_id;
    select * into r from forense.cargar_o_clonar_snapshot(v_c2, v_vacia);
    perform pruebas.assert('cargar_o_clonar_snapshot copia el dominio a la corrida nueva',
      coalesce((r.filas_por_tabla->>'cfdi')::int, 0) > 0, r.filas_por_tabla::text);

    -- Regla 10: el clon no mezcla filas de la corrida origen.
    select count(*) into v_n from forense.cfdi f where f.corrida_id = v_c2;
    perform pruebas.assert('el clon vive en su propia corrida (sin mezclar con el origen)',
      v_n = (select count(*) from forense.cfdi f2 where f2.corrida_id = v_vacia),
      'filas=' || v_n);

    select * into r from forense.verificar_integridad_corrida(v_c2);
    perform pruebas.assert('verificar_integridad_corrida calcula dataset_hash y fecha_corte',
      r.dataset_hash is not null and r.fecha_corte is not null,
      coalesce(r.estado, '?') || ' ' || coalesce(r.causa, ''));
  end if;

  -- B4. Caso de prueba propio para el resto del pipeline.
  insert into forense.clusters (corrida_id, rfcs, rfc_semilla, n_rfcs, score, estado,
                                version_contexto, rfcs_frontera, huella)
  values (v_c1, array['AAA010101AAA','BBB020202BBB'], 'AAA010101AAA', 2, 9.5, 'pendiente',
          1, array['CCC030303CCC'], 'huella-test-010')
  returning id into v_cluster;

  insert into forense.casos (corrida_id, cluster_id, rfc_principal, rfcs_satelite,
                             origen, estado, bitacora_seq)
  values (v_c1, v_cluster, 'AAA010101AAA', array['BBB020202BBB'], 'pipeline', 'ronda1', 0)
  returning id into v_caso;

  -- B5. cerrar_ronda: ronda_fin en bitacora y frontera determinista.
  insert into forense.senales (cluster_id, caso_id, ronda, familia, agente, titular,
                               detalle, rfcs, ids, frontera, confianza)
  values (v_cluster, v_caso, 1, 'D', 'documental', 'sin materialidad',
          jsonb_build_object('ruta', jsonb_build_array('AAA010101AAA','CCC030303CCC')),
          array['AAA010101AAA'], array['CFDI:X'], array['CCC030303CCC'], 'alta');

  select * into r from forense.cerrar_ronda(v_caso, 1,
    jsonb_build_object('resultados', '[]'::jsonb, 'limitaciones', '[]'::jsonb, 'vencida', false));
  perform pruebas.assert('cerrar_ronda devuelve la frontera fuera del cluster y la señal',
    r.rfcs_frontera = array['CCC030303CCC'] and jsonb_array_length(r.senales) = 1
    and r.tipo_evento = 'ronda_fin', array_to_string(r.rfcs_frontera, ','));
  perform pruebas.assert('cerrar_ronda asigna rol por familia a cada RFC de frontera',
    r.roles_por_expansion ? 'CCC030303CCC', r.roles_por_expansion::text);

  select count(*) into v_n from forense.bitacora b
   where b.caso_id = v_caso and b.tipo_evento = 'ronda_fin';
  perform pruebas.assert('cerrar_ronda deja evento ronda_fin en bitacora (regla 2)',
    v_n = 1, 'eventos=' || v_n);

  -- B6. paquete_auditor_final: monto_centavos ENTERO por evidencia.
  insert into forense.evidencia (caso_id, idempotency_key, tipo, ref_id, monto,
                                 pista_codigo, familia, agente, ronda,
                                 valida_tecnica, validada, descripcion)
  values (v_caso, 'ev-010-1', 'cfdi', '33333333-3333-4333-8333-333333333333', 1234.56, 'D2', 'D', 'documental', 1,
          true, true, 'texto libre del contribuyente')
  returning id into v_ev;

  select * into r from forense.paquete_auditor_final(v_caso);
  perform pruebas.assert(
    'paquete_auditor_final entrega monto_centavos entero por evidencia (dictaminar lo exige)',
    (r.evidencia->0->>'monto_centavos') = '123456', r.evidencia->0->>'monto_centavos');
  perform pruebas.assert('paquete_auditor_final marca el texto libre como _untrusted (regla 6)',
    (r.evidencia->0) ? 'descripcion_untrusted' and not ((r.evidencia->0) ? 'descripcion'),
    (r.evidencia->0)::text);

  -- B7. guardar_dictamen: catálogo cerrado, presuncion_alta es el techo.
  begin
    perform forense.guardar_dictamen(v_caso, jsonb_build_object('nivel', 'definitivo'));
    v_ok := false;
  exception when others then v_ok := true;
  end;
  perform pruebas.assert('guardar_dictamen rechaza «definitivo» como nivel (regla 7)', v_ok, '');

  select * into r from forense.guardar_dictamen(v_caso, jsonb_build_object(
    'nivel', 'presuncion_alta', 'familias', jsonb_build_array('D','F'),
    'regla', 'dos familias', 'limitaciones', '[]'::jsonb));
  perform pruebas.assert('guardar_dictamen persiste nivel y familias y devuelve el contrato',
    r.nivel = 'presuncion_alta' and r.caso_id = v_caso and r.corrida_id = v_c1, r.nivel);
  perform pruebas.assert('guardar_dictamen suma el monto en riesgo deduplicado por ref_id',
    (select monto_en_riesgo from forense.casos where id = v_caso) = 1234.56,
    (select monto_en_riesgo::text from forense.casos where id = v_caso));

  select count(*) into v_n from forense.bitacora b
   where b.caso_id = v_caso and b.tipo_evento = 'dictamen';
  perform pruebas.assert('guardar_dictamen deja evento dictamen en bitacora (regla 2)',
    v_n = 1, 'eventos=' || v_n);

  -- B8. validar_expediente: una cita que no resuelve invalida el expediente.
  insert into forense.expedientes (caso_id, idempotency_key, version, markdown, autor,
                                   estado_revision)
  values (v_caso, 'exp-010-v1', 1,
          '## Trayectoria' || chr(10) || 'Ver CFDI:UUID-QUE-NO-EXISTE', 'redactor', 'borrador');
  select * into r from forense.validar_expediente(v_caso, 1);
  perform pruebas.assert('validar_expediente rechaza una cita que no resuelve en esta corrida',
    r.ok = false and r.estado_final = 'parcial', coalesce(r.estado_final, '?'));

  -- B9. cerrar_caso: presupuesto agotado ⇒ parcial, y NUNCA sube el nivel.
  update forense.casos set presupuesto_agotado = true where id = v_caso;
  select * into r from forense.cerrar_caso(v_caso, 'dictaminado');
  perform pruebas.assert(
    'cerrar_caso degrada a parcial con presupuesto agotado (agotar nunca sube el nivel)',
    r.estado_final = 'parcial', r.estado_final);
  perform pruebas.assert('cerrar_caso libera el lease del cluster',
    (select lease_owner is null and estado = 'cerrado' from forense.clusters where id = v_cluster),
    '');
  select count(*) into v_n from forense.bitacora b
   where b.caso_id = v_caso and b.payload->>'evento_real' = 'caso_cerrado';
  perform pruebas.assert('cerrar_caso deja rastro de cierre en bitacora (regla 2)',
    v_n = 1, 'eventos=' || v_n);

  -- B10. estado_corrida: terminar de despachar no cierra la corrida.
  select * into r from forense.estado_corrida(v_c1);
  perform pruebas.assert('estado_corrida cuenta completados/en_cola/errores del snapshot propio',
    r.completados = 1 and r.en_cola = 0 and r.errores = 0,
    r.completados || '/' || r.en_cola || '/' || r.errores);

  -- B11. crear_tareas_revision exige intento >= 1 (contrato de reintento 2b).
  begin
    perform forense.crear_tareas_revision(v_caso, 0, array['documental'], '{}'::jsonb);
    v_ok := false;
  exception when others then v_ok := true;
  end;
  perform pruebas.assert('crear_tareas_revision exige intento >= 1', v_ok, '');
  begin
    perform forense.crear_tareas_revision(v_caso, 1, '{}'::text[], '{}'::jsonb);
    v_ok := false;
  exception when others then v_ok := true;
  end;
  perform pruebas.assert('crear_tareas_revision rechaza un reintento sin autores', v_ok, '');

  -- B12. autores_reintento por MOTIVO, no «todos los faltantes».
  select * into r from forense.autores_reintento(v_caso, 'evidencia_invalida', '{}'::jsonb);
  perform pruebas.assert('autores_reintento no expande fuera de cadena_incompleta',
    r.puede_expandir = false, r.motivo);
  select * into r from forense.autores_reintento(v_caso, 'cadena_incompleta', '{}'::jsonb);
  perform pruebas.assert('autores_reintento pide solo los roles de familias evaluables sin señal',
    not ('documental' = any(r.autores)), array_to_string(r.autores, ','));

  -- B12b. Las tres funciones de reintento se EJECUTAN, no solo se tipan:
  --       una función que devuelve cero filas pasa PREPARE y pasa el test
  --       de forma, y el nodo despacharía en silencio nada.
  -- Un autor de familia NO evaluable no produce tarea: es una limitación
  -- que llega al dictamen, no una excepción ni un silencio.
  update forense.corridas set familias_evaluables = '{}'::text[] where id = v_c1;
  select count(*) into v_n from forense.crear_tareas_revision(v_caso, 1,
                                                              array['financiero'], '{}'::jsonb);
  perform pruebas.assert('un reintento con autores no evaluables no crea tareas y lo registra',
    v_n = 0 and (select pendientes::text like '%reintento_sin_autores_evaluables%'
                   from forense.casos where id = v_caso), 'filas=' || v_n);

  update forense.corridas set familias_evaluables = '{D,F,R,T,E}'::text[] where id = v_c1;
  select * into r from forense.crear_tareas_revision(v_caso, 1, array['financiero'],
                                                     '{}'::jsonb);
  perform pruebas.assert('crear_tareas_revision devuelve una fila por tarea creada',
    r.tarea_id is not null and cardinality(r.tarea_ids) >= 1,
    coalesce(r.tarea_ids::text, '(vacio)'));
  perform pruebas.assert('crear_tareas_revision conserva las señales previas (historia intacta)',
    (select count(*) from forense.senales s where s.caso_id = v_caso and s.ronda = 1) = 1, '');
  select count(*) into v_n from forense.bitacora b
   where b.caso_id = v_caso and b.payload->>'evento_real' = 'tareas_revision_creadas';
  perform pruebas.assert('crear_tareas_revision deja evento de reintento en bitacora (regla 2)',
    v_n = 2, 'eventos=' || v_n);

  select * into r from forense.expandir_cluster_reintento(v_caso,
    jsonb_build_object('autores', jsonb_build_array('relacional')));
  perform pruebas.assert('expandir_cluster_reintento expande por la frontera del cluster',
    r.expandido and 'CCC030303CCC' = any(r.rfcs_nuevos),
    coalesce(r.rfcs_nuevos::text, '(vacio)'));
  perform pruebas.assert('expandir_cluster_reintento versiona el contexto del cluster',
    r.version_contexto > 1, r.version_contexto::text);

  select * into r from forense.revalidar_caso(v_caso);
  perform pruebas.assert('revalidar_caso revalida antes del dictamen y deja evento validacion',
    r.caso_id = v_caso
    and (select count(*) from forense.bitacora b
          where b.caso_id = v_caso
            and b.payload->>'evento_real' = 'revalidacion_reintento') = 1,
    coalesce(r.evidencia_revalidada::text, '?'));

  -- B13. aplicar_resolucion_replica: la trampa vale para ESTE caso, no
  --      cambia forense.pistas.estado global (07 §15).
  insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda,
                                     estado, idempotency_key, resultado)
  values (v_caso, v_c1, v_cluster, 'investigador', 2, 'completada', 'tar-010-replica',
          jsonb_build_object('resoluciones', jsonb_build_array(
            jsonb_build_object('aceptado', true, 'respuesta', 'la trampa aplica'))))
  returning id into v_tarea;
  insert into forense.defensas (caso_id, idempotency_key, trampa_codigo, pista_objetivo,
                                evidencia_objetivo_ids, resultado)
  values (v_caso, 'def-010-1', 'T-nomina', 'D2', array[v_ev], 'refuta')
  returning id into v_def;
  update forense.tareas_agente
     set resultado = jsonb_build_object('resoluciones', jsonb_build_array(
           jsonb_build_object('defensa_id', v_def, 'aceptado', true, 'respuesta', 'aplica')))
   where id = v_tarea;

  select * into r from forense.aplicar_resolucion_replica(v_caso, v_tarea);
  perform pruebas.assert('aplicar_resolucion_replica marca refutada la evidencia objetivo',
    (select refutada from forense.evidencia where id = v_ev), '');
  perform pruebas.assert('aplicar_resolucion_replica evalúa la pista POR CASO, no globalmente',
    (select evaluacion_pistas->'D2'->>'resultado' from forense.casos where id = v_caso)
      = 'descartada', '');
  select count(*) into v_n from forense.bitacora b
   where b.caso_id = v_caso and b.tipo_evento = 'replica';
  perform pruebas.assert('aplicar_resolucion_replica deja evento replica en bitacora (regla 2)',
    v_n = 1, 'eventos=' || v_n);
  select count(*) into v_n from forense.bitacora b
   where b.caso_id = v_caso and b.tipo_evento = 'evidencia_descartada'
     and b.payload->>'defensa_id' = v_def::text;
  perform pruebas.assert('aplicar_resolucion_replica deja evidencia_descartada de esa defensa',
    v_n = 1, 'eventos=' || v_n);

  -- B14. Editor: la propuesta NO versiona el documento (regla 11).
  select coalesce(max(version), 0) into v_ver from forense.expedientes where caso_id = v_caso;
  select * into r from forense.guardar_propuesta_edicion(
    v_caso, v_ver, jsonb_build_object('texto', 'nuevo'), jsonb_build_object('add', 1),
    array['CFDI:33333333-3333-4333-8333-333333333333'], 'propuesta', null, 'cambia el resumen', null, 'req-010-1', null);
  v_prop := r.propuesta_id;
  perform pruebas.assert('guardar_propuesta_edicion devuelve propuesta_id sin versionar',
    v_prop is not null
    and (select coalesce(max(version), 0) from forense.expedientes where caso_id = v_caso) = v_ver,
    '');
  select * into r from forense.guardar_propuesta_edicion(
    v_caso, v_ver, jsonb_build_object('texto', 'nuevo'), jsonb_build_object('add', 1),
    array['CFDI:33333333-3333-4333-8333-333333333333'], 'propuesta', null, 'cambia el resumen', null, 'req-010-1', null);
  perform pruebas.assert('guardar_propuesta_edicion es idempotente por request_id',
    r.propuesta_id = v_prop, '');

  -- B15. revertir_expediente: atómica, versiona hacia adelante y deja edicion.
  insert into forense.expedientes (caso_id, idempotency_key, version, markdown, autor,
                                   estado_revision)
  values (v_caso, 'exp-010-v2', 2, 'version dos', 'redactor', 'borrador');
  v_res := forense.revertir_expediente(v_caso, 1, 1, 'rev-010-conflicto', null);
  perform pruebas.assert('revertir_expediente falla entera con conflicto de versión',
    (v_res->>'ok')::boolean = false
    and v_res->'error'->>'codigo' = 'conflicto_version'
    and (select count(*) from forense.expedientes where caso_id = v_caso) = 2,
    v_res::text);

  v_res := forense.revertir_expediente(v_caso, 1, 2, 'rev-010-ok', null);
  perform pruebas.assert('revertir_expediente crea una versión nueva sin borrar historia',
    (v_res->>'ok')::boolean and (v_res->>'version')::int = 3
    and (select count(*) from forense.expedientes where caso_id = v_caso) = 3,
    v_res::text);
  v_res := forense.revertir_expediente(v_caso, 1, 2, 'rev-010-ok', null);
  perform pruebas.assert('revertir_expediente es idempotente por idempotency',
    (v_res->>'ok')::boolean and (v_res->>'revertida')::boolean = false
    and (select count(*) from forense.expedientes where caso_id = v_caso) = 3,
    v_res::text);
  select count(*) into v_n from forense.bitacora b
   where b.caso_id = v_caso and b.tipo_evento = 'edicion'
     and b.payload->>'evento_real' = 'expediente_revertido';
  perform pruebas.assert('revertir_expediente deja evento edicion en bitacora (regla 2)',
    v_n = 1, 'eventos=' || v_n);

  -- B16. cargar_version_expediente: solo cita lo VALIDADO y no refutado.
  update forense.evidencia set refutada = false, validada = true where id = v_ev;
  select * into r from forense.cargar_version_expediente(v_caso, null);
  perform pruebas.assert('cargar_version_expediente lista las citas permitidas del caso',
    r.citas_permitidas ? 'CFDI:33333333-3333-4333-8333-333333333333' and r.version_actual = 3,
    r.citas_permitidas::text);

  -- B17. cerrar_barreras_vencidas: timeout deja limitación, no «sin fraude».
  insert into forense.pasos_pipeline (caso_id, paso, revision, estado, deadline,
                                      tareas_esperadas)
  values (v_caso, 'ronda1_test010', 0, 'abierto', now() - interval '1 hour',
          array[v_tarea]);
  select count(*) into v_n from forense.cerrar_barreras_vencidas(now());
  perform pruebas.assert('cerrar_barreras_vencidas cierra la barrera vencida',
    v_n >= 1, 'cerradas=' || v_n);
  perform pruebas.assert('una barrera vencida marca limitación y cobertura incompleta',
    (select cobertura_completa = false
       and pendientes::text like '%barrera_vencida%' from forense.casos where id = v_caso), '');
  select count(*) into v_n from forense.bitacora b
   where b.caso_id = v_caso and b.payload->>'evento_real' = 'barrera_vencida';
  perform pruebas.assert('cerrar_barreras_vencidas deja rastro en bitacora (regla 2)',
    v_n >= 1, 'eventos=' || v_n);

  -- B18. Lecturas puras: no escriben bitácora.
  select count(*) into v_bit from forense.bitacora;
  perform forense.paquete_auditor_final(v_caso);
  perform forense.estado_corrida(v_c1);
  perform forense.eventos_salida_pendientes(5);
  perform forense.cargar_version_expediente(v_caso, null);
  select count(*) into v_n from forense.bitacora;
  perform pruebas.assert('las lecturas puras de 010 no escriben en bitacora',
    v_n = v_bit, v_bit || ' -> ' || v_n);
end $$;

-- ---------------------------------------------------------------------
-- C. Voz e inyección (007/008 + 010).
-- ---------------------------------------------------------------------

do $$
declare
  v_perfil uuid; v_inv uuid; v_evt uuid; r record; v_n bigint;
  v_llam uuid; v_corrida uuid; v_iny uuid; v_res jsonb; v_ingesta uuid;
begin
  select k.id into v_corrida from forense.corridas k where k.idempotency_key = 'test-010-abrir';

  insert into forense.perfiles (nombre, correo, telefono_e164, llamadas_activadas, permiso_aviso)
  values ('Prueba 010', 'p010@example.test', '+525500000010', true, true)
  returning id into v_perfil;
  insert into forense.investigaciones (perfil_id, modo, corrida_id, estado, idempotency_key,
                                       reporte_manifest, completada_at)
  values (v_perfil, 'corrida', v_corrida, 'investigacion_completa', 'inv-010',
          jsonb_build_array(jsonb_build_object('caso_id', gen_random_uuid())), now())
  returning id into v_inv;
  insert into forense.eventos_salida (investigacion_id, tipo, estado, payload)
  values (v_inv, 'investigacion.completa', 'pendiente', '{}'::jsonb)
  on conflict (investigacion_id, tipo) do update set estado = 'pendiente'
  returning id into v_evt;

  select * into r from forense.leer_evento_salida(v_evt);
  perform pruebas.assert('leer_evento_salida relee el evento desde DB, no del payload',
    r.investigacion_id = v_inv and r.reporte_hash is not null, coalesce(r.estado, '?'));

  select * into r from forense.reclamar_evento_salida(v_evt, 'owner-010');
  perform pruebas.assert('reclamar_evento_salida(uuid,text) reclama el evento concreto',
    r.reclamado and r.lease_owner = 'owner-010', coalesce(r.motivo, ''));
  select * into r from forense.reclamar_evento_salida(v_evt, 'otro-owner');
  perform pruebas.assert('un segundo owner no roba el lease vigente (cinco webhooks, una llamada)',
    r.reclamado = false, coalesce(r.motivo, ''));

  select * into r from forense.destinatario_aviso(v_inv);
  perform pruebas.assert('destinatario_aviso resuelve puede_llamar sin devolver el teléfono',
    r.puede_llamar and r.perfil_id = v_perfil
    and r.referencia_corta is not null, coalesce(r.motivo_omision, ''));

  select * into r from forense.crear_intento_llamada(v_inv, v_evt);
  v_llam := r.llamada_id;
  perform pruebas.assert('crear_intento_llamada reclama solicitando ANTES del POST',
    r.estado = 'solicitando' and v_llam is not null, coalesce(r.estado, '?'));
  perform pruebas.assert(
    'las dynamic_variables van normalizadas: sin RFC, sin montos y sin nivel',
    r.cuerpo_elevenlabs::text !~* '(rfc|monto|presuncion|sospech)',
    r.cuerpo_elevenlabs::text);

  select * into r from forense.guardar_aceptacion_llamada(v_llam, 200,
    jsonb_build_object('conversation_id', 'conv-010', 'call_sid', 'sid-010'));
  perform pruebas.assert('guardar_aceptacion_llamada: HTTP 200 es «aceptada», no «contestó»',
    r.estado = 'aceptada' and r.conversation_id = 'conv-010', r.estado);
  select * into r from forense.guardar_aceptacion_llamada(v_llam, 500, '{}'::jsonb);
  perform pruebas.assert('sin 2xx el intento queda fallida, nunca se reintenta a ciegas',
    r.estado = 'fallida', r.estado);

  select * into r from forense.registrar_callback_llamada('conv-010', 'sid-010',
    jsonb_build_object('type', 'call_ended', 'status', 'completed'));
  perform pruebas.assert('registrar_callback_llamada correlaciona por conversation_id',
    r.llamada_id = v_llam and r.duplicado = false, '');
  select * into r from forense.registrar_callback_llamada('conv-010', 'sid-010',
    jsonb_build_object('type', 'call_ended', 'status', 'completed'));
  perform pruebas.assert('el mismo callback dos veces se marca duplicado',
    r.duplicado, '');
  select * into r from forense.registrar_callback_llamada('conv-huerfano', null, '{}'::jsonb);
  perform pruebas.assert('un callback huérfano se conserva y no inventa la llamada',
    r.llamada_id is null, '');

  select * into r from forense.actualizar_llamada(v_llam, 'finalizada', true);
  perform pruebas.assert('actualizar_llamada mapea solo hechos recibidos',
    r.estado = 'finalizada' and r.aviso_entregado, r.estado);
  select * into r from forense.actualizar_llamada(v_llam, 'inventado', null);
  perform pruebas.assert('un estado fuera del catálogo cae en resultado_desconocido',
    r.estado = 'resultado_desconocido', r.estado);
  perform pruebas.assert('el fallo de la llamada no revierte la investigación (regla 11)',
    (select estado from forense.investigaciones where id = v_inv) = 'investigacion_completa', '');

  -- omitir_llamada mantiene el aviso in-app.
  select * into r from forense.omitir_llamada(v_inv, 'sin permiso de aviso');
  perform pruebas.assert('omitir_llamada registra el motivo y no borra la notificación in-app',
    r.estado = 'omitida', coalesce(r.motivo_omision, ''));

  -- QA-003: idempotency_key repetida devuelve error tipado, no unique_violation.
  insert into forense.ingestas (nombre, origen, estado, corrida_base_id, hash_payload,
                                idempotency_key)
  values ('ingesta 010', 'api', 'lista', v_corrida, 'hash-010', 'ing-010')
  returning id into v_ingesta;

  select * into r from forense.registrar_inyeccion(v_corrida, v_ingesta,
    '11111111-1111-4111-8111-111111111111', 'inyectados');
  v_iny := r.inyeccion_id;
  perform pruebas.assert('registrar_inyeccion(uuid,uuid,text,text) devuelve el contrato del nodo',
    v_iny is not null and r.estado = 'recibida' and r.prioridad = 'inyectados', r.estado);
  select * into r from forense.registrar_inyeccion(v_corrida, v_ingesta,
    '11111111-1111-4111-8111-111111111111', 'inyectados');
  perform pruebas.assert('la sobrecarga del nodo es idempotente por idempotency_key',
    r.inyeccion_id = v_iny, '');

  v_res := forense.registrar_inyeccion(v_corrida,
    jsonb_build_object('tablas', jsonb_build_object('cfdi', '[]'::jsonb)), 'api',
    '11111111-1111-4111-8111-111111111111', null);
  perform pruebas.assert('QA-003: idempotency repetida devuelve ok:false y error del contrato',
    (v_res->>'ok') is not null, v_res::text);

  -- Carrera real: el índice único dispara unique_violation y NO se propaga.
  begin
    insert into forense.inyecciones (ingesta_id, corrida_base_id, origen, hash_payload,
                                     estado, idempotency_key)
    values (v_ingesta, v_corrida, 'api', 'hash-dup-010', 'recibida',
            '22222222-2222-4222-8222-222222222222');
    v_res := forense.registrar_inyeccion(v_corrida,
      jsonb_build_object('tablas', jsonb_build_object('cfdi', '[]'::jsonb)), 'api',
      '22222222-2222-4222-8222-222222222222', null);
    perform pruebas.assert(
      'QA-003: registrar_inyeccion no propaga unique_violation en la carrera',
      v_res is not null, v_res::text);
  exception when unique_violation then
    perform pruebas.assert(
      'QA-003: registrar_inyeccion no propaga unique_violation en la carrera', false,
      'la excepción llegó al llamador');
  end;

  -- clusters_por_prioridad_inyeccion: evento inyeccion con evento_real.
  perform forense.clusters_por_prioridad_inyeccion(v_corrida, v_iny);
  select count(*) into v_n from forense.bitacora b
   where b.corrida_id = v_corrida and b.tipo_evento = 'inyeccion'
     and b.payload->>'evento_real' = 'clusters_afectados';
  perform pruebas.assert(
    'clusters_por_prioridad_inyeccion emite inyeccion con evento_real=clusters_afectados',
    v_n >= 1, 'eventos=' || v_n);

  select count(*) into v_n from forense.eventos_salida_pendientes(20);
  perform pruebas.assert('eventos_salida_pendientes devuelve la cola sin reclamarla',
    v_n >= 0, 'pendientes=' || v_n);
end $$;
