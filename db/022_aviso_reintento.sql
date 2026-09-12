-- 022_aviso_reintento.sql — el nodo n8n «Registrar aviso de reintento» hacía
-- un `WITH vals AS (...), ev AS (...) SELECT ...` en línea con 9 parámetros.
--
-- Encontrado en ejecución real 2026-09-12: con los 9 valores exactos
-- reproducidos a mano en psql (PREPARE/EXECUTE) la consulta corre bien, pero
-- el nodo Postgres v2 de n8n la ejecutaba con "invalid input syntax for type
-- uuid: '1'" de forma consistente (sobrevivió a reescribir la consulta para
-- no repetir ningún $N, y a cambiar de puerto del pooler de Supabase). El
-- patrón común entre TODOS los demás nodos del worker que sí funcionan es que
-- llaman a una función (`SELECT * FROM forense.fn(...)`), nunca un `WITH`
-- multi-CTE en línea; éste era el único. En vez de seguir adivinando el
-- comportamiento interno del nodo, se sigue el mismo patrón que ya funciona.

create or replace function forense.registrar_aviso_reintento(
  p_aviso text, p_corrida uuid, p_caso uuid, p_tarea uuid,
  p_ronda int, p_intento int, p_rol text, p_variante_prompt text, p_prompt_hash text)
returns table(caso_id uuid, tarea_id uuid, variante_prompt text, tipo_evento text,
              evento_real text, registrado boolean)
language plpgsql security definer set search_path = '' as $$
declare v_registrado boolean := false;
begin
  if p_aviso is not null and p_aviso <> '' and p_aviso <> 'null' then
    insert into forense.bitacora (corrida_id, caso_id, tarea_id, ronda, intento, agente, tipo_evento, payload)
    values (p_corrida, p_caso, p_tarea, p_ronda, p_intento, p_rol, 'razonamiento',
            jsonb_build_object('evento_real', 'aviso_reintento', 'aviso', p_aviso,
                               'variante_prompt', p_variante_prompt, 'prompt_hash', p_prompt_hash));
    v_registrado := true;
  end if;
  return query select p_caso, p_tarea, p_variante_prompt,
                      'razonamiento'::text, 'aviso_reintento'::text, v_registrado;
end $$;

revoke execute on function forense.registrar_aviso_reintento(
  text, uuid, uuid, uuid, int, int, text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.registrar_aviso_reintento(' ||
            'text, uuid, uuid, uuid, int, int, text, text, text) to service_role';
  end if;
end $$;

-- Fin 022_aviso_reintento.sql
