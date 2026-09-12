-- =====================================================================
-- Aserciones de 006_producto_ui.sql y 007_notificaciones_voz.sql (16 §7).
--   * Un cambio único de estado produce UN evento y UN aviso.
--   * Cinco entregas repetidas del webhook NO generan cinco llamadas.
--   * Editar el reporte NO reemite.
--   * Perfil sin número / toggle apagado: aviso in-app y llamada `omitida`.
-- =====================================================================

-- 1. Completitud: no se declara completa una investigación con trabajo abierto
do $$
declare
  v_perfil uuid := '00000000-0000-4000-8000-0000000006a1';
  v_caso uuid := '00000000-0000-4000-8000-000000000100';
  v_caso2 uuid := '00000000-0000-4000-8000-000000000102';
  v_inv uuid; r jsonb; n int;
begin
  -- Investigación sobre un caso SIN expediente validado
  insert into forense.investigaciones (id, perfil_id, modo, corrida_id, caso_id, manifiesto,
                                       estado, idempotency_key)
  values ('00000000-0000-4000-8000-00000000070a', v_perfil, 'caso',
          '00000000-0000-4000-8000-000000000001', v_caso2,
          jsonb_build_object('objetivos', jsonb_build_array(jsonb_build_object('caso_id', v_caso2))),
          'investigando', 'aser-007-incompleta')
  on conflict (idempotency_key) do nothing;

  r := forense.completar_investigacion('00000000-0000-4000-8000-00000000070a');
  perform pruebas.assert('una investigación sin reporte validado no se declara completa',
    (r->>'ok')::boolean = false and (r->>'cambio')::boolean = false, r::text);
  perform pruebas.assert('el motivo del rechazo nombra los casos sin reporte validado',
    jsonb_array_length(r->'casos_sin_reporte_validado') >= 1, r::text);
  perform pruebas.assert('una investigación incompleta no emite evento de salida',
    not exists (select 1 from forense.eventos_salida
                 where investigacion_id = '00000000-0000-4000-8000-00000000070a'), '');
end $$;

-- 2. Un cambio único de estado produce un evento y un aviso
do $$
declare
  v_perfil uuid := '00000000-0000-4000-8000-0000000006a1';
  v_caso uuid := '00000000-0000-4000-8000-000000000100';
  v_inv uuid := '00000000-0000-4000-8000-00000000070b';
  r jsonb; n int; v_event uuid; v_ver int;
begin
  -- Caso listo: expediente validado y tareas terminales
  update forense.expedientes set estado_revision = 'validado' where caso_id = v_caso;
  update forense.tareas_agente set estado = 'completada'
   where caso_id = v_caso and estado in ('pendiente','ejecutando');

  insert into forense.investigaciones (id, perfil_id, modo, corrida_id, caso_id, manifiesto,
                                       estado, idempotency_key)
  values (v_inv, v_perfil, 'caso', '00000000-0000-4000-8000-000000000001', v_caso,
          jsonb_build_object('objetivos', jsonb_build_array(jsonb_build_object('caso_id', v_caso))),
          'generando_reporte', 'aser-007-completa')
  on conflict (idempotency_key) do nothing;

  r := forense.completar_investigacion(v_inv,
        jsonb_build_array(jsonb_build_object('caso_id', v_caso, 'version', 1)), 1);
  perform pruebas.assert('una investigación con reporte validado sí se declara completa',
    (r->>'ok')::boolean and (r->>'cambio')::boolean, r::text);

  select count(*) into n from forense.eventos_salida where investigacion_id = v_inv;
  perform pruebas.assert('un cambio único de estado produce UN evento de salida',
    n = 1, 'eventos=' || n);

  select id into v_event from forense.eventos_salida where investigacion_id = v_inv;
  select count(*) into n from forense.notificaciones where event_id = v_event;
  perform pruebas.assert('el evento trae su notificación in-app',
    n = 1, 'notificaciones=' || n);

  perform pruebas.assert('el payload del outbox no lleva teléfono ni secretos',
    not ((select payload from forense.eventos_salida where id = v_event)
         ?| array['telefono','telefono_e164','to_number','apikey']), '');

  -- Idempotencia de la transición: recarga de página / reintento
  r := forense.completar_investigacion(v_inv);
  perform pruebas.assert('completar dos veces no cambia nada ni emite otro evento',
    (r->>'ok')::boolean and (r->>'cambio')::boolean = false, r::text);
  select count(*) into n from forense.eventos_salida where investigacion_id = v_inv;
  perform pruebas.assert('sigue habiendo un solo evento tras el segundo intento',
    n = 1, 'eventos=' || n);

  -- 3. Cinco entregas repetidas del webhook NO crean cinco llamadas
  for n in 1..5 loop
    r := forense.solicitar_llamada(v_event, 'n8n', 'agente-demo');
  end loop;
  select count(*) into n from forense.llamadas_notificacion where event_id = v_event;
  perform pruebas.assert('cinco entregas repetidas del webhook no crean cinco llamadas',
    n = 1, 'llamadas=' || n);

  -- Perfil demo: sin teléfono y con llamadas desactivadas => omitida con motivo
  perform pruebas.assert('sin teléfono ni preferencia la llamada queda omitida con motivo',
    (select estado = 'omitida' and motivo is not null and destino is null
       from forense.llamadas_notificacion where event_id = v_event), '');
  perform pruebas.assert('el aviso in-app se mantiene aunque la llamada se omita',
    exists (select 1 from forense.notificaciones where event_id = v_event), '');

  -- 4. Editar el reporte NO reemite
  select coalesce(max(version), 0) into v_ver from forense.expedientes where caso_id = v_caso;
  insert into forense.expedientes (caso_id, idempotency_key, version, markdown, autor,
                                   estado_revision, version_base)
  values (v_caso, 'aser-007-edicion', v_ver + 1, '# editado', 'humano', 'validado', v_ver)
  on conflict (idempotency_key) do nothing;
  update forense.investigaciones set actualizado = now(), version_entregada = v_ver + 1
   where id = v_inv;
  select count(*) into n from forense.eventos_salida where investigacion_id = v_inv;
  perform pruebas.assert('editar el reporte no reemite el evento de salida',
    n = 1, 'eventos=' || n);
end $$;

-- 5. Llamada con perfil completo: se solicita y su resultado se registra
do $$
declare
  v_perfil uuid := '00000000-0000-4000-8000-00000000071a';
  v_inv uuid := '00000000-0000-4000-8000-00000000071b';
  v_caso uuid := '00000000-0000-4000-8000-000000000101';
  v_event uuid; r jsonb; n int; v_llamada uuid;
begin
  insert into forense.perfiles (id, nombre, telefono_e164, llamadas_activadas, permiso_aviso,
                                permiso_aviso_at)
  values (v_perfil, 'Perfil con aviso', '+528112345678', true, true, now())
  on conflict (id) do update set telefono_e164 = excluded.telefono_e164,
                                 llamadas_activadas = true, permiso_aviso = true;

  -- El caso del despacho contable no trae expediente en el fixture: la
  -- entrega exige uno VALIDADO, así que se crea aquí.
  insert into forense.expedientes (caso_id, idempotency_key, version, markdown, autor,
                                   estado_revision)
  values (v_caso, 'aser-007-exp-101', 1, '# anomalía explicada', 'agente', 'validado')
  on conflict (idempotency_key) do nothing;
  update forense.tareas_agente set estado = 'completada'
   where caso_id = v_caso and estado in ('pendiente','ejecutando');

  insert into forense.investigaciones (id, perfil_id, modo, corrida_id, caso_id, manifiesto,
                                       estado, idempotency_key)
  values (v_inv, v_perfil, 'caso', '00000000-0000-4000-8000-000000000001', v_caso,
          jsonb_build_object('objetivos', jsonb_build_array(jsonb_build_object('caso_id', v_caso))),
          'generando_reporte', 'aser-007-con-telefono')
  on conflict (idempotency_key) do nothing;

  r := forense.completar_investigacion(v_inv, '[]'::jsonb, 1);
  perform pruebas.assert('la segunda investigación también se completa',
    (r->>'ok')::boolean and (r->>'cambio')::boolean, r::text);

  r := forense.reclamar_evento_salida('worker-007');
  perform pruebas.assert('el outbox entrega un evento reclamado con lease',
    (r->>'ok')::boolean and (r->>'hay_evento')::boolean, r::text);
  select id into v_event from forense.eventos_salida where investigacion_id = v_inv;

  r := forense.solicitar_llamada(v_event, 'n8n', 'agente-demo');
  perform pruebas.assert('con teléfono, preferencia y permiso la llamada se solicita',
    (r->>'ok')::boolean and (r->>'estado') = 'solicitando', r::text);
  perform pruebas.assert('la actividad guarda el destino ENMASCARADO, nunca el número',
    exists (select 1 from forense.actividad_producto
             where evento = 'llamada_solicitada'
               and metadata->>'destino_enmascarado' like '%5678')
    and not exists (select 1 from forense.actividad_producto
                     where metadata::text like '%+528112345678%'), '');

  select id into v_llamada from forense.llamadas_notificacion where event_id = v_event;
  r := forense.resultado_llamada(v_llamada, 'finalizada',
        '{"status":"completed"}'::jsonb, 'conv-1', 'CA1', null);
  perform pruebas.assert('sin evidencia de entrega, aviso_entregado queda DESCONOCIDO',
    (r->>'ok')::boolean and (r->'aviso_entregado') = 'null'::jsonb, r::text);

  r := forense.resultado_llamada(v_llamada, 'finalizada', '{"analysis":{"aviso":true}}'::jsonb,
        null, null, true);
  perform pruebas.assert('aviso_entregado solo es true cuando el callback lo respalda',
    (r->>'aviso_entregado')::boolean, r::text);

  perform pruebas.assert('un fallo de voz no altera el estado de la investigación',
    (select estado from forense.investigaciones where id = v_inv) = 'investigacion_completa', '');

  r := forense.desactivar_llamadas(v_perfil, 'callback');
  perform pruebas.assert('una petición de no llamar apaga la preferencia y queda auditada',
    (r->>'ok')::boolean
    and (select not llamadas_activadas from forense.perfiles where id = v_perfil)
    and exists (select 1 from forense.actividad_producto
                 where perfil_id = v_perfil and evento = 'preferencia_cambiada'), r::text);
end $$;

-- 6. Chat propone, Aplicar versiona (regla 11 y 16 §7)
do $$
declare
  v_caso uuid := '00000000-0000-4000-8000-000000000100';
  v_perfil uuid := '00000000-0000-4000-8000-0000000006a1';
  v_prop uuid := '00000000-0000-4000-8000-00000000072a';
  v_preg uuid := '00000000-0000-4000-8000-00000000072b';
  v_base int; r jsonb; n1 int; n2 int;
begin
  select coalesce(max(version), 0) into v_base from forense.expedientes where caso_id = v_caso;
  select count(*) into n1 from forense.expedientes where caso_id = v_caso;

  insert into forense.propuestas_edicion (id, caso_id, perfil_id, version_base, mensaje, modo,
                                          patch, estado, request_id)
  values (v_preg, v_caso, v_perfil, v_base, '¿De dónde sale el monto?', 'pregunta',
          null, 'propuesta', 'aser-006-pregunta')
  on conflict (id) do nothing;
  r := forense.aplicar_propuesta(v_preg, v_perfil);
  perform pruebas.assert('una pregunta del chat no versiona el documento',
    (r->>'ok')::boolean = false, r::text);
  select count(*) into n2 from forense.expedientes where caso_id = v_caso;
  perform pruebas.assert('una pregunta no crea versión de expediente', n2 = n1, '');

  insert into forense.propuestas_edicion (id, caso_id, perfil_id, version_base, mensaje, modo,
                                          patch, estado, request_id)
  values (v_prop, v_caso, v_perfil, v_base, 'Agrega el número de facturas internas', 'propuesta',
          '{"type":"doc","content":[]}'::jsonb, 'propuesta', 'aser-006-propuesta')
  on conflict (id) do nothing;
  perform pruebas.assert('una propuesta guardada todavía no cambia el expediente',
    (select count(*) from forense.expedientes where caso_id = v_caso) = n1, '');

  r := forense.aplicar_propuesta(v_prop, v_perfil);
  perform pruebas.assert('aplicar crea UNA versión nueva',
    (r->>'ok')::boolean and (r->>'aplicada')::boolean
    and (r->>'version')::int = v_base + 1, r::text);

  r := forense.aplicar_propuesta(v_prop, v_perfil);
  perform pruebas.assert('doble click aplica una sola vez',
    (r->>'ok')::boolean and (r->>'aplicada')::boolean = false, r::text);
  perform pruebas.assert('solo hay una versión nueva tras el doble click',
    (select count(*) from forense.expedientes where caso_id = v_caso) = n1 + 1, '');

  perform pruebas.assert('aplicar deja evento edicion en bitácora y actividad',
    exists (select 1 from forense.bitacora where caso_id = v_caso and tipo_evento = 'edicion')
    and exists (select 1 from forense.actividad_producto
                 where caso_id = v_caso and evento = 'propuesta_aplicada'), '');

  -- Conflicto: una propuesta sobre una versión base vieja conserva el trabajo
  insert into forense.propuestas_edicion (id, caso_id, perfil_id, version_base, mensaje, modo,
                                          patch, estado, request_id)
  values ('00000000-0000-4000-8000-00000000072c', v_caso, v_perfil, v_base, 'Otro cambio',
          'propuesta', '{"type":"doc","content":[]}'::jsonb, 'propuesta', 'aser-006-conflicto')
  on conflict (id) do nothing;
  r := forense.aplicar_propuesta('00000000-0000-4000-8000-00000000072c', v_perfil);
  perform pruebas.assert('una propuesta sobre una versión base vieja da conflicto',
    (r->>'ok')::boolean = false and (r->'error')::text like '%conflicto_version%', r::text);
  perform pruebas.assert('el conflicto conserva la propuesta, no la borra',
    (select estado from forense.propuestas_edicion
      where id = '00000000-0000-4000-8000-00000000072c') = 'conflicto', '');
end $$;

-- 7. Privacidad: ninguna tabla de producto tiene lectura pública
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'forense'
     and tablename in ('perfiles','investigaciones','vistas_guardadas','propuestas_edicion',
                       'actividad_producto','eventos_salida','notificaciones',
                       'llamadas_notificacion');
  perform pruebas.assert('ninguna tabla de producto hereda la lectura pública de la demo',
    n = 0, 'políticas=' || n);

  select count(*) into n from pg_tables
   where schemaname = 'forense'
     and tablename in ('perfiles','investigaciones','vistas_guardadas','propuestas_edicion',
                       'actividad_producto','eventos_salida','notificaciones',
                       'llamadas_notificacion')
     and not rowsecurity;
  perform pruebas.assert('todas las tablas de producto tienen RLS habilitado',
    n = 0, 'sin RLS=' || n);

  perform pruebas.assert('el teléfono sale enmascarado fuera del propio perfil',
    forense.telefono_enmascarado('+528112345678') like '%5678'
    and forense.telefono_enmascarado('+528112345678') not like '%8112%'
    and length(forense.telefono_enmascarado('+528112345678')) = length('+528112345678'),
    forense.telefono_enmascarado('+528112345678'));
end $$;

-- 8. El fixture de producto no marca teléfonos
do $$
declare n int;
begin
  select count(*) into n from forense.llamadas_notificacion l
    join forense.eventos_salida e on e.id = l.event_id
   where e.investigacion_id in ('00000000-0000-4000-8000-0000000006b1',
                                '00000000-0000-4000-8000-0000000006b2',
                                '00000000-0000-4000-8000-0000000006b3');
  perform pruebas.assert('seed_producto no deja ninguna llamada', n = 0, 'llamadas=' || n);

  perform pruebas.assert('el perfil demo no tiene teléfono ni llamadas activadas',
    (select telefono_e164 is null and not llamadas_activadas
       from forense.perfiles where id = '00000000-0000-4000-8000-0000000006a1'), '');

  perform pruebas.assert('el fixture deja historial de investigaciones para la UI',
    (select count(*) from forense.investigaciones
      where perfil_id = '00000000-0000-4000-8000-0000000006a1') >= 3, '');
end $$;
