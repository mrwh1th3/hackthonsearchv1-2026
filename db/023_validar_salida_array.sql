-- 023_validar_salida_array.sql — `validar_salida_rol` (005) reventaba cuando la
-- salida del modelo no era un objeto JSON: `v_err || 'salida no es un objeto
-- JSON'` concatena text[] con un literal SIN tipo, y Postgres lo interpreta
-- como literal de array → "malformed array literal". Encontrado en ejecución
-- real 2026-09-12 con respuestas 200 de claude-opus-5 (financiero/relacional):
-- en vez de devolver ok=false y dejar que el worker repare, el paso moría.
-- Único cambio frente a 005: `array['salida no es un objeto JSON']`.

create or replace function forense.validar_salida_rol(
  p_ejecucion uuid, p_rol text, p_salida jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e record; k record; v_err text[] := '{}'; v_ids text[]; x text;
  v_corrida uuid; v_rol text;
begin
  select * into e from forense.ejecuciones_agente where id = p_ejecucion;
  if not found then
    return jsonb_build_object('ok', false, 'errores', to_jsonb(array['ejecucion inexistente']));
  end if;
  v_corrida := e.corrida_id;
  -- El rol vive en la ejecución: un rol enviado por el runner no lo cambia.
  v_rol := e.rol;
  if p_rol is not null and p_rol <> v_rol then
    v_err := v_err || ('rol declarado (' || p_rol || ') distinto del de la ejecución (' || v_rol || ')');
  end if;

  if p_salida is null or jsonb_typeof(p_salida) <> 'object' then
    return jsonb_build_object('ok', false, 'rol', v_rol,
                              'errores', to_jsonb(v_err || array['salida no es un objeto JSON']));
  end if;

  if v_rol in ('documental','financiero','relacional','temporal','externo') then
    if not (p_salida ? 'titular') or length(coalesce(p_salida->>'titular', '')) = 0 then
      v_err := v_err || array['falta titular'];
    end if;
    if coalesce(p_salida->>'titular', '') ~ '[\r\n]' then
      v_err := v_err || array['el titular debe ser UNA línea'];
    end if;
    if not (p_salida ? 'confianza') or (p_salida->>'confianza') not in ('alta','media','baja') then
      v_err := v_err || array['confianza fuera del catálogo'];
    end if;
    if jsonb_typeof(p_salida->'ids') is distinct from 'array'
       or coalesce(jsonb_array_length(p_salida->'ids'), 0) = 0 then
      v_err := v_err || array['una señal sin IDs no es citable'];
    end if;
    if forense.familia_de_agente(v_rol) is distinct from (p_salida->>'familia') then
      v_err := v_err || array['la familia no corresponde al rol de la ejecución'];
    end if;
  elsif v_rol = 'auditor' then
    if not (p_salida ? 'hipotesis') then v_err := v_err || array['falta hipotesis']; end if;
    if (p_salida ? 'nivel') then
      v_err := v_err || array['el auditor no fija el nivel: lo calcula el dictaminador determinista'];
    end if;
  elsif v_rol = 'defensor' then
    if not (p_salida ? 'resultado')
       or (p_salida->>'resultado') not in ('refuta','parcial','no_refuta') then
      v_err := v_err || array['resultado de defensa fuera del catálogo'];
    end if;
  elsif v_rol = 'redactor' then
    if not (p_salida ? 'markdown') and not (p_salida ? 'contenido_json') then
      v_err := v_err || array['el expediente necesita markdown o contenido_json'];
    end if;
    if position('Trayectoria' in coalesce(p_salida->>'markdown', '')) = 0
       and jsonb_typeof(p_salida->'secciones') is distinct from 'array' then
      v_err := v_err || array['falta la sección obligatoria Trayectoria (21 §2)'];
    end if;
    if position('Cadena de explicación' in coalesce(p_salida->>'markdown', '')) = 0
       and jsonb_typeof(p_salida->'secciones') is distinct from 'array' then
      v_err := v_err || array['falta la sección obligatoria Cadena de explicación (21 §4)'];
    end if;
  end if;

  -- Nivel: nunca 'definitivo' (regla 7 de CLAUDE.md).
  if p_salida::text ~* '"definitivo"' and v_rol <> 'externo' then
    v_err := v_err || array['la palabra definitivo no es un nivel de salida del sistema'];
  end if;

  -- IDs citados: espacio de nombres del contrato y existencia en ESTA corrida.
  select coalesce(array_agg(distinct t.v), '{}') into v_ids from (
    select jsonb_array_elements_text(p_salida->'ids') as v
     where jsonb_typeof(p_salida->'ids') = 'array'
    union all
    select jsonb_array_elements_text(p_salida->'referencias') as v
     where jsonb_typeof(p_salida->'referencias') = 'array') t;

  foreach x in array v_ids loop
    if x !~ '^(CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR):[^[:space:]]+$' then
      v_err := v_err || ('referencia fuera del espacio de nombres: ' || left(x, 80));
    elsif x like 'CFDI:%' then
      if not exists (select 1 from forense.cfdi f
                      where f.corrida_id = v_corrida
                        and f.uuid::text = replace(x, 'CFDI:', '')) then
        v_err := v_err || ('CFDI citado que no existe en la corrida: ' || left(x, 80));
      end if;
    elsif x like 'MOV:%' then
      if not exists (select 1 from forense.movimientos m
                      where m.corrida_id = v_corrida
                        and m.id::text = replace(x, 'MOV:', '')) then
        v_err := v_err || ('movimiento citado que no existe en la corrida: ' || left(x, 80));
      end if;
    end if;
  end loop;

  -- Unidades: los importes viajan como cadena decimal, no como float.
  if jsonb_typeof(p_salida->'monto_en_riesgo') = 'number'
     or jsonb_typeof(p_salida->'monto') = 'number' then
    v_err := v_err || array['los importes viajan como cadena decimal, no como número'];
  end if;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_err, 1), 0) = 0,
    'rol', v_rol, 'ejecucion_id', p_ejecucion,
    'errores', coalesce(to_jsonb(v_err), '[]'::jsonb),
    'ids_verificados', coalesce(array_length(v_ids, 1), 0));
end $$;

-- Fin 023_validar_salida_array.sql
