-- =====================================================================
-- 016_permisos_cobertura.sql — cierra los tres hallazgos que dejó la
-- oleada 5 (hotfix H11) sobre 014/015. Migración del coordinador:
-- 014 y 015 ya están verificadas cuerpo a cuerpo contra el proyecto
-- remoto, así que NO se editan; lo que falta se añade aquí.
--
-- 1. PERMISOS (bloqueo de forense-qa). 002–006 y 010 terminan revocando
--    `execute ... from public`; 014 y 015 no lo hicieron, y sus tres
--    funciones nuevas quedaron con `proacl '=X'` (ejecutables por
--    cualquiera, `anon` incluido). En una base con el esquema `forense`
--    expuesto en PostgREST eso es una función SECURITY DEFINER al
--    alcance de la llave pública.
--
-- 2. FRONTERA (hallazgo alto de forense-db, confirmado por el
--    verificador). La condición (c) de `forense.cobertura_caso` medía
--    `clusters.rfcs_frontera`, que NO es la frontera que pidieron las
--    señales: es la LISTA DE CANDIDATOS que `construir_clusters` (004)
--    dejó anotada, o sea los vecinos a un salto que quedaron fuera.
--    Esa lista casi nunca está vacía —el verificador midió 61 RFC
--    residuales tras la única expansión permitida—, así que la condición
--    exigía una expansión que ninguna señal había pedido y
--    `cobertura_completa` se quedaba en false para todo caso real. Con
--    ella en false el dictaminador determinista devuelve
--    `no_concluyente` SIEMPRE (n8n/runtime/auditor-final.mjs), que es
--    exactamente el bug que 015 venía a corregir.
--
--    La frontera de la que responde el caso es la de `forense.senales`
--    (03 §"El campo frontera"): los RFC que los especialistas señalaron
--    fuera del cluster. Es la misma que `cerrar_ronda` calcula y
--    registra en bitácora, así que la regla y el pipeline miden lo
--    mismo. Frontera residual DESPUÉS de gastar la expansión no es falta
--    de cobertura: 03 §127 la manda anotar en el expediente como "la
--    cadena continúa hacia N RFC no investigados".
--
-- 3. CUOTA DE EXPANSIÓN. `max_expansiones_caso` no estaba sembrada en
--    `config_presupuesto` y los tres lugares que la leen caían en su
--    default de código, 2. 03 §127 y 03 §219 dicen "máximo UNA expansión
--    de frontera por cluster". Código y documento normativo no pueden
--    discrepar en silencio: la clave se siembra en 1.
--
-- Aditiva: siembra una clave de configuración y hace `create or replace`
-- de dos funciones con su cuerpo de 015/010 más el cambio descrito. No
-- toca tablas ni firmas.
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 1. Cuota de expansión: una por cluster (03 §127).
-- ---------------------------------------------------------------------
insert into forense.config_presupuesto (clave, valor, nota) values
  ('max_expansiones_caso', 1, 'docs/03 §127: máximo una expansión de frontera por cluster')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- 2. La regla de cobertura, con la frontera correcta.
--    Cuerpo de 015 §1; sólo cambia el cálculo de (c).
-- ---------------------------------------------------------------------
create or replace function forense.cobertura_caso(p_caso uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  k record; cl record; v_tot int; v_no_term int; v_pend_frontera int;
  v_exp_usadas int; v_max_exp int; v_lim int;
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    return false;
  end if;
  select * into cl from forense.clusters c where c.id = k.cluster_id;

  -- (a) y (b): el caso despachó tareas y todas están en estado terminal.
  select count(*)::int,
         count(*) filter (where t.estado not in ('completada','omitida'))::int
    into v_tot, v_no_term
    from forense.tareas_agente t where t.caso_id = p_caso;

  -- (c) Frontera PENDIENTE = RFC que las señales de este caso pidieron
  -- mirar y que siguen fuera del cluster. NO es cl.rfcs_frontera (la
  -- lista de candidatos de 004): esa incluye vecinos que nadie pidió y
  -- dejaría la cobertura en false para siempre.
  select count(distinct f)::int into v_pend_frontera
    from forense.senales s, unnest(coalesce(s.frontera, '{}'::text[])) f
   where s.caso_id = p_caso
     and not (f = any(coalesce(cl.rfcs, '{}'::text[])));

  select count(*)::int into v_exp_usadas from forense.bitacora b
   where b.caso_id = p_caso and b.tipo_evento = 'cluster_expandido';
  v_max_exp := forense.config_int('max_expansiones_caso', 1);

  -- (d) Mismo criterio que el dictaminador: lista de pendientes vacía.
  v_lim := jsonb_array_length(coalesce(k.pendientes, '[]'::jsonb));

  -- Queda expansión pendiente sólo si alguna señal pidió frontera Y
  -- todavía hay cuota para ir por ella. Gastada la cuota, la frontera
  -- residual es una limitación declarada, no un hueco de cobertura.
  return v_tot > 0
     and v_no_term = 0
     and not (v_pend_frontera > 0 and v_exp_usadas < v_max_exp)
     and v_lim = 0;
end $$;

comment on function forense.cobertura_caso(uuid) is
  'Regla determinista de cobertura: tareas despachadas terminales (completada|omitida), sin frontera pedida por las señales que siga fuera del cluster teniendo cuota de expansión, y sin limitaciones abiertas. El LLM no participa.';

-- ---------------------------------------------------------------------
-- 3. Un solo escritor para forense.casos.cobertura_completa.
--    Cuerpo de 010 §3 (guardar_dictamen) con la asignación cambiada.
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
         -- 016: la cobertura la decide la REGLA, no el payload del
         -- dictaminador (regla 4). Antes se leía
         -- `p_dictamen->>'cobertura_completa'`, con lo que la columna
         -- tenía dos escritores y podía divergir de forense.cobertura_caso.
         cobertura_completa = forense.cobertura_caso(p_caso),
         pendientes = coalesce(p_dictamen->'pendientes', pendientes),
         estado = 'dictaminado'
   where id = p_caso;

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
-- 4. Permisos. Lo que 014 y 015 no revocaron.
--    `create or replace` conserva privilegios, así que los revokes se
--    reafirman aquí para que una base que ya tenía 014/015 aplicadas
--    quede igual que una instalación limpia.
-- ---------------------------------------------------------------------

revoke execute on function forense.analizar_snapshot(uuid) from public;
revoke execute on function forense.cobertura_caso(uuid) from public;
revoke execute on function forense.recalcular_cobertura(uuid, text) from public;
revoke execute on function forense.guardar_dictamen(uuid, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.analizar_snapshot(uuid) to service_role';
    execute 'grant execute on function forense.cobertura_caso(uuid) to service_role';
    execute 'grant execute on function forense.recalcular_cobertura(uuid,text) to service_role';
    execute 'grant execute on function forense.guardar_dictamen(uuid,jsonb) to service_role';
  end if;
end $$;

-- Fin 016_permisos_cobertura.sql
