-- =====================================================================
-- Aserciones de db/012_inyeccion_clusters.sql que NO dependen del
-- snapshot gen-v1 (el ensayo con los paquetes reales vive en
-- assertions_012_gen.sql).
--
--   * forma de las funciones nuevas / modificadas;
--   * estado_corrida: 6 clusters, 4 despachados -> cola_restante = 2 y la
--     corrida NO se cierra (hallazgo alto de db, decisión H9 07:32);
--   * asegurar_clusters_inyectados: guardas (corrida base intocable) e
--     idempotencia.
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 1. Forma: el nodo hace SELECT *; las columnas son contrato.
-- ---------------------------------------------------------------------
do $$
declare
  esperado jsonb := jsonb_build_object(
    'asegurar_clusters_inyectados', 'cluster_id,rfc,creado',
    'cola_corrida', 'corrida_id,clusters_total,cola_restante,casos_activos',
    'estado_corrida', 'corrida_id,terminada,estado_final,completados,en_cola,errores',
    'clusters_por_prioridad_inyeccion',
      'cluster_id,corrida_id,inyeccion_id,investigacion_id,afectado,score');
  k text; v text; v_cols text; v_falt text := '';
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
  perform pruebas.assert('012 devuelve las columnas exactas del contrato de nodos',
    v_falt = '', v_falt);
end $$;

-- ---------------------------------------------------------------------
-- 2. estado_corrida cuenta la cola de CLUSTERS, no sólo la de casos.
--    Escenario del hallazgo: 6 clusters, 4 despachados.
-- ---------------------------------------------------------------------
do $$
declare
  v_c uuid; i int; v_cl uuid; ids uuid[] := '{}'; e record; q record;
begin
  insert into forense.corridas (nombre, dataset, dataset_hash, fecha_corte, estado, modo)
  values ('012: cola de clusters', 'fixture-012',
          repeat('c', 64), timestamptz '2025-12-31 23:59:59-06', 'procesando', 'fixture')
  returning id into v_c;

  for i in 1..6 loop
    insert into forense.clusters (corrida_id, rfcs, rfc_semilla, n_rfcs, n_cfdi,
                                  n_movimientos, score, huella, estado)
    values (v_c, array['RFC012' || i], 'RFC012' || i, 1, 0, 0, 1.0,
            'h012-' || i, 'pendiente')
    returning id into v_cl;
    ids := ids || v_cl;
  end loop;

  -- Cuatro despachados: caso creado, todavía en cola de investigación.
  for i in 1..4 loop
    insert into forense.casos (corrida_id, cluster_id, rfc_principal, origen, estado)
    values (v_c, ids[i], 'RFC012' || i, 'selector', 'en_cola');
  end loop;

  select * into q from forense.cola_corrida(v_c);
  select * into e from forense.estado_corrida(v_c);
  perform pruebas.assert('cola_corrida: 6 clusters y 4 despachados dejan cola_restante = 2',
    q.cola_restante = 2 and q.clusters_total = 6 and q.casos_activos = 4,
    'cola_restante=' || coalesce(q.cola_restante::text, 'null') ||
    ' total=' || q.clusters_total || ' activos=' || q.casos_activos);
  perform pruebas.assert('una corrida con clusters sin despachar no está terminada',
    e.terminada = false and e.estado_final = 'en_curso',
    'terminada=' || e.terminada || ' estado_final=' || e.estado_final);

  -- Los cuatro casos terminan. Los dos clusters sin despachar SIGUEN ahí:
  -- terminar de despachar no cierra la corrida (regla 9/10).
  update forense.casos set estado = 'dictaminado', nivel = 'presuncion'
   where corrida_id = v_c;
  select * into q from forense.cola_corrida(v_c);
  select * into e from forense.estado_corrida(v_c);
  perform pruebas.assert('cerrar los casos no cierra la corrida si quedan clusters pendientes',
    e.terminada = false and e.estado_final = 'en_curso'
    and e.completados = 4 and e.en_cola = 0 and q.cola_restante = 2,
    'completados=' || e.completados || ' en_cola=' || e.en_cola ||
    ' cola_restante=' || q.cola_restante || ' final=' || e.estado_final);

  -- Se despachan y cierran los dos que faltaban.
  insert into forense.casos (corrida_id, cluster_id, rfc_principal, origen, estado, nivel)
  select v_c, ids[i], 'RFC012' || i, 'selector', 'dictaminado', 'sin_hallazgos'
    from generate_series(5, 6) i;
  select * into q from forense.cola_corrida(v_c);
  select * into e from forense.estado_corrida(v_c);
  perform pruebas.assert('con la cola de clusters drenada la corrida sí queda terminada',
    e.terminada and e.estado_final = 'completada' and q.cola_restante = 0
    and e.completados = 6,
    'completados=' || e.completados || ' cola_restante=' || q.cola_restante ||
    ' final=' || e.estado_final);

  -- Lectura pura: estado_corrida no puede dejar rastro (no es un paso).
  perform pruebas.assert('estado_corrida y cola_corrida siguen sin escribir en la bitácora',
    not exists (select 1 from forense.bitacora b where b.corrida_id = v_c), '');
end $$;

-- ---------------------------------------------------------------------
-- 3. asegurar_clusters_inyectados: guardas e idempotencia sobre el clon
--    del fixture (sin depender de gen-v1).
-- ---------------------------------------------------------------------
do $$
declare
  v_base uuid; v_nueva uuid; v_ing uuid; v_iny uuid; r jsonb;
  n_creados int; n_total int; n_ev int; n_ev2 int; v_rfc text;
begin
  select id into v_base from forense.corridas where nombre = 'pistas: clon del fixture';
  if v_base is null then
    perform pruebas.assert('012: hay clon del fixture para el ensayo de inyección',
      false, 'falta la corrida «pistas: clon del fixture»');
    return;
  end if;

  select rfc into v_rfc from forense.contribuyentes where corrida_id = v_base order by rfc limit 1;

  r := forense.registrar_inyeccion(v_base, jsonb_build_object(
    'corrida_base_id', v_base, 'origen', 'ensayo',
    'idempotency_key', '00000000-0000-4000-8000-0000000012a1',
    'tablas', jsonb_build_object(
      'contribuyentes', jsonb_build_array(
        jsonb_build_object('rfc', 'IXC121212XX1', 'razon_social', 'Inyectada 012 SA de CV',
                           'giro', 'comercializadora', 'tipo_persona', 'moral',
                           'fecha_alta', '2025-09-10')),
      'cfdi', jsonb_build_array(
        jsonb_build_object('uuid', '12120001-0000-4000-8000-000000000001', 'tipo', 'I',
                           'emisor_rfc', 'IXC121212XX1', 'receptor_rfc', v_rfc,
                           'fecha', '2025-11-15T10:00:00-06:00',
                           'subtotal', '100000.00', 'iva', '16000.00', 'total', '116000.00',
                           'moneda', 'MXN', 'metodo_pago', 'PUE', 'forma_pago', '03',
                           'uso_cfdi', 'G03', 'clave_prod_serv', '80121600',
                           'descripcion', 'Servicios de consultoria', 'cancelado', false)))),
    'ensayo', '00000000-0000-4000-8000-0000000012a1'::uuid);

  if not coalesce((r->>'ok')::boolean, false) then
    perform pruebas.assert('012: el paquete de prueba se registra sobre el clon del fixture',
      false, r::text);
    return;
  end if;
  v_ing := (r->>'ingesta_id')::uuid;
  v_iny := (r->>'inyeccion_id')::uuid;

  r := forense.validar_inyeccion(v_ing);
  perform pruebas.assert('012: el paquete de prueba pasa la validación determinista',
    (r->>'ok')::boolean and (r->>'estado') = 'validada', r::text);

  v_nueva := forense.clonar_corrida_con_inyeccion(v_base, v_ing);

  -- Guarda: la corrida BASE nunca recibe clusters garantizados (regla 10).
  begin
    perform 1 from forense.asegurar_clusters_inyectados(v_base, v_iny);
    perform pruebas.assert('asegurar_clusters_inyectados rechaza la corrida base',
      false, 'no lanzó excepción');
  exception when others then
    perform pruebas.assert('asegurar_clusters_inyectados rechaza la corrida base', true, sqlerrm);
  end;

  -- Primera pasada: el RFC inyectado no tiene cluster (nadie corrió el
  -- selector sobre la corrida nueva) y se le garantiza uno.
  select count(*) filter (where creado), count(*) into n_creados, n_total
    from forense.asegurar_clusters_inyectados(v_nueva, v_iny);
  perform pruebas.assert('asegurar_clusters_inyectados garantiza un cluster por RFC inyectado',
    n_total >= 1 and n_creados >= 1, 'creados=' || n_creados || ' total=' || n_total);

  perform pruebas.assert('el RFC inyectado queda dentro de un cluster de la corrida nueva',
    exists (select 1 from forense.clusters c
             where c.corrida_id = v_nueva and 'IXC121212XX1' = any(c.rfcs)), '');

  select count(*) into n_ev from forense.bitacora b
   where b.corrida_id = v_nueva and b.tipo_evento = 'inyeccion'
     and b.payload->>'evento_real' = 'cluster_garantizado';
  perform pruebas.assert('cada cluster garantizado deja su evento en la bitácora (regla 2)',
    n_ev = n_creados, 'eventos=' || n_ev || ' creados=' || n_creados);

  -- Segunda pasada: idempotente. Ni un cluster más, ni un evento más.
  select count(*) filter (where creado) into n_creados
    from forense.asegurar_clusters_inyectados(v_nueva, v_iny);
  select count(*) into n_ev2 from forense.bitacora b
   where b.corrida_id = v_nueva and b.tipo_evento = 'inyeccion'
     and b.payload->>'evento_real' = 'cluster_garantizado';
  perform pruebas.assert('llamarla dos veces no duplica clusters ni eventos',
    n_creados = 0 and n_ev2 = n_ev,
    'creados_2=' || n_creados || ' eventos=' || n_ev2);

  -- El cluster garantizado sale PRIMERO en la cola de la inyección.
  perform pruebas.assert('clusters_por_prioridad_inyeccion devuelve primero el garantizado',
    (select p.afectado from forense.clusters_por_prioridad_inyeccion(v_nueva, v_iny) p limit 1),
    'la primera fila no está marcada como afectada');
end $$;
