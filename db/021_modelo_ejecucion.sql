-- 021_modelo_ejecucion.sql — forense.ejecuciones_agente.model_id nunca se
-- asignaba (001 declara la columna, nadie la llenaba en ningún INSERT).
--
-- Encontrado en ejecución real 2026-09-12: el worker (n8n/runtime/nodos/
-- construir-cuerpo.mjs) exige el modelo resuelto de configuración, nunca del
-- prompt, y aborta con "modelo ausente" si `ejecuciones_agente.model_id` llega
-- vacío. Las cinco tareas de un caso real (`select model_id from
-- forense.ejecuciones_agente`) confirmaron la columna en '' para las dos
-- funciones que insertan esa tabla: `crear_tareas_ronda` (ronda 1/2/reintento)
-- y `abrir_tarea_cierre` (auditor/defensor/réplica/redactor).
--
-- La asignación por rol replica, en SQL, `MODELOS_POR_ROL` + `IDS_MODELO` de
-- n8n/runtime/config.mjs (dueño forense-runtime): documental/temporal/externo/
-- redactor → sonnet; financiero/relacional/auditor/defensor/replica → opus.
-- Un cambio de esa tabla en config.mjs exige repetir el cambio aquí a mano;
-- no hay una fuente única compartida entre JS y SQL en este corte.

create or replace function forense.modelo_por_rol(p_rol text)
returns text language sql immutable set search_path = '' as $$
  select case p_rol
    when 'documental' then 'claude-sonnet-5'
    when 'financiero' then 'claude-opus-5'
    when 'relacional' then 'claude-opus-5'
    when 'temporal'   then 'claude-sonnet-5'
    when 'externo'    then 'claude-sonnet-5'
    when 'auditor'    then 'claude-opus-5'
    when 'defensor'   then 'claude-opus-5'
    when 'replica'    then 'claude-opus-5'
    when 'redactor'   then 'claude-sonnet-5'
    when 'editor'     then 'claude-sonnet-5'
    else null
  end;
$$;

create or replace function forense.crear_tareas_ronda(
  p_caso uuid, p_ronda int, p_agentes text[], p_intento int default 0,
  p_deadline_segundos int default 900)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k record; cl record; a text; v_tarea uuid; v_ids uuid[] := '{}'; v_key text;
  v_paso text; v_fam text[]; v_omitidos text[] := '{}'; v_ctx text;
begin
  select * into k from forense.casos where id = p_caso;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  select * into cl from forense.clusters where id = k.cluster_id;
  select familias_evaluables into v_fam from forense.corridas where id = k.corrida_id;

  v_paso := case when p_intento > 0 then 'reintento' else 'ronda' || p_ronda::text end;

  foreach a in array coalesce(p_agentes, '{}'::text[]) loop
    if forense.familia_de_agente(a) is not null and not (forense.familia_de_agente(a) = any(v_fam)) then
      -- Familia no evaluable en este dataset: se omite con motivo, no se finge.
      v_omitidos := v_omitidos || a;
      continue;
    end if;
    v_key := md5(p_caso::text || '|' || p_ronda || '|' || p_intento || '|' || a || '|' ||
                 cl.version_contexto::text);
    insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda, intento,
                                       version_contexto, estado, idempotency_key)
    values (p_caso, k.corrida_id, k.cluster_id, a, p_ronda, p_intento,
            cl.version_contexto, 'pendiente', v_key)
    on conflict (idempotency_key) do nothing
    returning id into v_tarea;
    if v_tarea is null then
      select id into v_tarea from forense.tareas_agente where idempotency_key = v_key;
    end if;
    v_ids := v_ids || v_tarea;

    select hash into v_ctx from forense.artefactos_contexto
     where caso_id = p_caso order by creado desc limit 1;

    insert into forense.ejecuciones_agente (corrida_id, caso_id, tarea_id, rol, context_hash,
                                            model_id, deadline_at)
    values (k.corrida_id, p_caso, v_tarea, a, v_ctx, forense.modelo_por_rol(a),
            now() + make_interval(secs => greatest(coalesce(p_deadline_segundos, 900), 30)))
    on conflict (tarea_id) where tarea_id is not null do nothing;
  end loop;

  insert into forense.pasos_pipeline (caso_id, paso, intento, version_contexto,
                                      tareas_esperadas, snapshot_senales, estado, deadline)
  values (p_caso, v_paso, p_intento, cl.version_contexto, v_ids,
          coalesce((select array_agg(s.id) from forense.senales s where s.cluster_id = k.cluster_id), '{}'),
          'abierto', now() + make_interval(secs => greatest(coalesce(p_deadline_segundos, 900), 30)))
  on conflict (caso_id, paso, intento, version_contexto) do update
    set tareas_esperadas = excluded.tareas_esperadas, estado = 'abierto',
        deadline = excluded.deadline;

  update forense.casos
     set estado = case when p_ronda = 2 then 'ronda2' when p_intento > 0 then 'reintento'
                       else 'ronda1' end
   where id = p_caso;

  perform forense.log(p_caso, 'sistema', 'ronda_inicio',
    jsonb_build_object('ronda', p_ronda, 'intento', p_intento, 'paso', v_paso,
                       'agentes', to_jsonb(p_agentes),
                       'omitidos_no_evaluables', to_jsonb(v_omitidos),
                       'tareas', to_jsonb(v_ids)),
    null, null, null, null, p_ronda, k.cluster_id, null, k.corrida_id);

  return jsonb_build_object('ok', true, 'caso_id', p_caso, 'paso', v_paso,
                            'ronda', p_ronda, 'intento', p_intento,
                            'tareas', to_jsonb(v_ids),
                            'omitidos_no_evaluables', to_jsonb(v_omitidos),
                            'version_contexto', cl.version_contexto);
end $$;

create or replace function forense.abrir_tarea_cierre(
  p_caso uuid, p_rol text, p_deadline_segundos int default 900)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k record; cl record; v_key text; v_tarea uuid; v_ejec uuid; v_ctx text; v_estado text;
begin
  if p_rol not in ('auditor','defensor','replica','redactor') then
    return jsonb_build_object('ok', false, 'error', 'argumento_invalido',
                              'detalle', 'rol de cierre no reconocido');
  end if;
  select * into k from forense.casos where id = p_caso;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  select * into cl from forense.clusters where id = k.cluster_id;

  v_key := md5(p_caso::text || '|cierre|' || p_rol || '|' || cl.version_contexto::text ||
               '|' || k.n_reintentos::text);
  insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda, intento,
                                     version_contexto, estado, idempotency_key)
  values (p_caso, k.corrida_id, k.cluster_id, p_rol, greatest(coalesce(k.n_reintentos, 0), 1),
          coalesce(k.n_reintentos, 0), cl.version_contexto, 'pendiente', v_key)
  on conflict (idempotency_key) do nothing
  returning id into v_tarea;
  if v_tarea is null then
    select id into v_tarea from forense.tareas_agente where idempotency_key = v_key;
  end if;

  select hash into v_ctx from forense.artefactos_contexto
   where caso_id = p_caso order by creado desc limit 1;

  insert into forense.ejecuciones_agente (corrida_id, caso_id, tarea_id, rol, context_hash,
                                          model_id, deadline_at)
  values (k.corrida_id, p_caso, v_tarea, p_rol, v_ctx, forense.modelo_por_rol(p_rol),
          now() + make_interval(secs => greatest(coalesce(p_deadline_segundos, 900), 30)))
  on conflict (tarea_id) where tarea_id is not null do nothing;
  select id into v_ejec from forense.ejecuciones_agente where tarea_id = v_tarea;

  v_estado := case p_rol when 'auditor' then 'auditando' when 'defensor' then 'defendiendo'
                         when 'replica' then 'replicando' else 'redactando' end;
  update forense.casos set estado = v_estado where id = p_caso;

  insert into forense.pasos_pipeline (caso_id, paso, intento, version_contexto,
                                      tareas_esperadas, estado, deadline)
  values (p_caso, p_rol, coalesce(k.n_reintentos, 0), cl.version_contexto,
          array[v_tarea], 'abierto',
          now() + make_interval(secs => greatest(coalesce(p_deadline_segundos, 900), 30)))
  on conflict (caso_id, paso, intento, version_contexto) do update
    set tareas_esperadas = excluded.tareas_esperadas, estado = 'abierto',
        deadline = excluded.deadline;

  perform forense.log(p_caso, p_rol,
    case p_rol when 'auditor' then 'auditoria' when 'defensor' then 'defensa_inicio'
               when 'replica' then 'replica' else 'redaccion_inicio' end,
    jsonb_build_object('tarea_id', v_tarea, 'ejecucion_id', v_ejec, 'rol', p_rol),
    null, null, null, null, null, k.cluster_id, v_tarea, k.corrida_id);

  return jsonb_build_object('ok', true, 'caso_id', p_caso, 'rol', p_rol,
                            'tarea_id', v_tarea, 'ejecucion_id', v_ejec,
                            'paso', p_rol, 'estado_caso', v_estado);
end $$;

-- ---------------------------------------------------------------------
-- Permisos: `crear_tareas_ronda` y `abrir_tarea_cierre` ya tenían su ACL de
-- 005 (create or replace la conserva). `modelo_por_rol` es función nueva y
-- por defecto Postgres da EXECUTE a PUBLIC.
-- ---------------------------------------------------------------------

revoke execute on function forense.modelo_por_rol(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.modelo_por_rol(text) to service_role';
  end if;
end $$;

-- Fin 021_modelo_ejecucion.sql
