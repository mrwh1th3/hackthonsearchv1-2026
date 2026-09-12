-- =====================================================================
-- 015_cobertura.sql — la cobertura del caso se decide en código.
--
-- HALLAZGO (solicitud de runtime, bloqueante para el demo):
-- `forense.casos.cobertura_completa` nace en false y NADA la ponía en
-- true. El dictaminador determinista (07 §auditor final,
-- n8n/runtime/auditor-final.mjs) arranca con
-- `completo = cobertura_completa && pendientes.length === 0` y, si no está
-- completo, el nivel es `no_concluyente` SIEMPRE. Es decir: todo caso
-- salía no_concluyente por una columna que nadie escribía.
--
-- REGLA (determinista, en SQL; el LLM no decide el nivel ni la
-- cobertura — regla 4):
--   cobertura_completa = true  cuando y sólo cuando
--     a) el caso despachó al menos una tarea, y
--     b) TODAS las tareas del caso están en estado terminal:
--        'completada' u 'omitida' (omitida = familia no evaluable, la
--        omisión está declarada). 'error' y 'timeout' NO son terminales
--        para este efecto: dejan la cobertura en false porque ausencia de
--        señal no es ausencia de fraude (07), y
--     c) no queda expansión pendiente: ningún RFC de frontera fuera del
--        cluster mientras aún quede presupuesto de expansión
--        (`max_expansiones_caso`), y
--     d) no hay limitaciones abiertas: `casos.pendientes` vacío. Se usa
--        EXACTAMENTE el mismo criterio que el dictaminador
--        (`pendientes.length === 0`), no un campo `resuelta` que el
--        runtime no conoce.
--
-- Dónde se calcula: al cerrar la última ronda (`cerrar_ronda`), en la
-- revalidación previa al dictamen (`revalidar_caso`, que envuelve a
-- `public.forense_validar_evidencia`) y —sobre todo— se EXPONE calculada
-- en `paquete_auditor_final`, que es lo que lee el dictaminador. Los
-- caminos que ya ponían false (barrera vencida, reintento sin autores
-- evaluables) siguen igual: ambos escriben además en `pendientes`, así
-- que la regla viva también da false.
--
-- Aditiva: funciones nuevas y `create or replace` con el cuerpo idéntico
-- de 010 más la llamada. No toca tablas ni firmas.
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 1. La regla. Lectura pura: se puede llamar desde una función `stable`.
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

  select count(*)::int,
         count(*) filter (where t.estado not in ('completada','omitida'))::int
    into v_tot, v_no_term
    from forense.tareas_agente t where t.caso_id = p_caso;

  select count(*)::int into v_pend_frontera
    from unnest(coalesce(cl.rfcs_frontera, '{}'::text[])) f
   where not (f = any(coalesce(cl.rfcs, '{}'::text[])));

  select count(*)::int into v_exp_usadas from forense.bitacora b
   where b.caso_id = p_caso and b.tipo_evento = 'cluster_expandido';
  v_max_exp := forense.config_int('max_expansiones_caso', 2);

  v_lim := jsonb_array_length(coalesce(k.pendientes, '[]'::jsonb));

  return v_tot > 0
     and v_no_term = 0
     and not (v_pend_frontera > 0 and v_exp_usadas < v_max_exp)
     and v_lim = 0;
end $$;

comment on function forense.cobertura_caso(uuid) is
  'Regla determinista de cobertura: tareas despachadas terminales (completada|omitida), sin expansión pendiente y sin limitaciones abiertas. El LLM no participa.';

-- ---------------------------------------------------------------------
-- 2. Persistencia + rastro. Regla 2: si no dejó bitácora, no pasó.
-- ---------------------------------------------------------------------
create or replace function forense.recalcular_cobertura(
  p_caso uuid, p_motivo text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare k record; v boolean; v_antes boolean;
begin
  select * into k from forense.casos c where c.id = p_caso for update;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  v_antes := coalesce(k.cobertura_completa, false);
  v := forense.cobertura_caso(p_caso);

  update forense.casos set cobertura_completa = v where id = p_caso;

  perform forense.log(p_caso, 'sistema', 'validacion',
    jsonb_build_object('evento_real', 'cobertura_recalculada',
      'motivo', coalesce(p_motivo, 'sin motivo'),
      'antes', v_antes, 'despues', v,
      'tareas', (select jsonb_object_agg(t.estado, t.n) from (
                   select estado, count(*) n from forense.tareas_agente
                    where caso_id = p_caso group by estado) t),
      'limitaciones_abiertas', jsonb_array_length(coalesce(k.pendientes, '[]'::jsonb))),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  return v;
end $$;

-- ---------------------------------------------------------------------
-- forense.cerrar_ronda (010 §3) + recálculo de cobertura en la última ronda
-- ---------------------------------------------------------------------
create or replace function forense.cerrar_ronda(
  p_caso uuid, p_ronda int, p_datos jsonb default '{}'::jsonb)
returns table(caso_id uuid, cluster_id uuid, corrida_id uuid, investigacion_id uuid,
              senales jsonb, familias_evaluables text[], version_contexto int,
              roles_por_expansion jsonb, rfcs_frontera text[], ruta_material jsonb,
              expansiones_usadas int, tipo_evento text, registrado boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  k record; cl record; v_fam text[]; v_inv uuid; v_sen jsonb; v_roles jsonb;
  v_ruta jsonb; v_exp int; v_frontera text[];
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  select * into cl from forense.clusters c where c.id = k.cluster_id;
  select familias_evaluables into v_fam from forense.corridas where id = k.corrida_id;
  select i.id into v_inv from forense.investigaciones i where i.caso_id = p_caso
   order by i.creado limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'senal_id', s.id, 'familia', s.familia, 'agente', s.agente,
           'titular_untrusted', s.titular, 'confianza', s.confianza, 'refuta', s.refuta,
           'ids', to_jsonb(s.ids), 'rfcs', to_jsonb(s.rfcs),
           'frontera', to_jsonb(s.frontera)) order by s.id), '[]'::jsonb)
    into v_sen
    from forense.senales s
   where s.caso_id = p_caso and s.ronda = p_ronda;

  -- Frontera: RFCs que las señales señalan fuera del cluster.
  select coalesce(array_agg(distinct f), '{}') into v_frontera
    from forense.senales s, unnest(coalesce(s.frontera, '{}'::text[])) f
   where s.caso_id = p_caso and s.ronda = p_ronda
     and not (f = any(coalesce(cl.rfcs, '{}'::text[])));

  -- Qué rol debe mirar cada RFC de frontera: se deriva de la familia de la
  -- señal que lo trajo, no de una preferencia del LLM.
  select coalesce(jsonb_object_agg(t.rfc, t.roles), '{}'::jsonb) into v_roles from (
    select f as rfc, jsonb_agg(distinct forense.rol_de_familia(s.familia)) as roles
      from forense.senales s, unnest(coalesce(s.frontera, '{}'::text[])) f
     where s.caso_id = p_caso and s.ronda = p_ronda
     group by f) t;

  select coalesce(jsonb_agg(distinct s.detalle->'ruta') filter (
           where jsonb_typeof(s.detalle->'ruta') = 'array'), '[]'::jsonb)
    into v_ruta
    from forense.senales s where s.caso_id = p_caso and s.ronda = p_ronda;

  select count(*)::int into v_exp from forense.bitacora b
   where b.caso_id = p_caso and b.tipo_evento = 'cluster_expandido';

  perform forense.log(p_caso, 'sistema', 'ronda_fin',
    jsonb_build_object('ronda', p_ronda,
                       'n_senales', jsonb_array_length(v_sen),
                       'rfcs_frontera', to_jsonb(v_frontera),
                       'vencida', coalesce((p_datos->>'vencida')::boolean, false),
                       'limitaciones', coalesce(p_datos->'limitaciones', '[]'::jsonb)),
    null, null, null, null, p_ronda, k.cluster_id, null, k.corrida_id);

  -- Cobertura (015): al cerrar la ÚLTIMA ronda del caso se decide en
  -- CÓDIGO si la investigación cubrió lo despachado. En rondas
  -- intermedias no se toca: la ronda siguiente todavía no existe.
  if p_ronda >= forense.config_int('rondas_por_caso', 2) then
    perform forense.recalcular_cobertura(p_caso, 'cierre_ronda_' || p_ronda);
  end if;

  return query select p_caso, k.cluster_id, k.corrida_id, v_inv, v_sen,
                      coalesce(v_fam, '{}'::text[]), coalesce(cl.version_contexto, 1),
                      v_roles, coalesce(v_frontera, '{}'::text[]), v_ruta, v_exp,
                      'ronda_fin'::text, true;
end $$;

-- ---------------------------------------------------------------------
-- forense.revalidar_caso (010 §3) + recálculo de cobertura antes del dictamen
-- ---------------------------------------------------------------------
create or replace function forense.revalidar_caso(p_caso uuid)
returns table(caso_id uuid, limitaciones jsonb, evidencia_revalidada int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare k record; v_res jsonb; v_n int; v_lim jsonb;
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;

  v_res := public.forense_validar_evidencia(p_caso);
  select count(*)::int into v_n from forense.evidencia e
   where e.caso_id = p_caso and coalesce(e.validada, false) = true;

  select coalesce(jsonb_agg(jsonb_build_object(
           'evidencia_id', e.id, 'motivo',
           coalesce(e.motivo_descartada, 'no validada técnicamente'))), '[]'::jsonb)
    into v_lim
    from forense.evidencia e
   where e.caso_id = p_caso
     and (coalesce(e.valida_tecnica, true) = false or coalesce(e.validada, false) = false)
     and coalesce(e.refutada, false) = false;

  perform forense.log(p_caso, 'sistema', 'validacion',
    jsonb_build_object('evento_real', 'revalidacion_reintento',
                       'validadas', v_n, 'limitaciones', v_lim,
                       'resultado', coalesce(v_res->'data', v_res)),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  -- La revalidación es el último punto antes del dictamen: aquí la
  -- cobertura se vuelve a decidir con las tareas y limitaciones que
  -- realmente quedaron.
  perform forense.recalcular_cobertura(p_caso, 'revalidacion');

  return query select p_caso, v_lim, v_n;
end $$;

-- ---------------------------------------------------------------------
-- forense.paquete_auditor_final (010 §3) + cobertura calculada
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
           'evaluacion_caso', coalesce(k.evaluacion_pistas->p.codigo, 'null'::jsonb))
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
-- Permisos: la cobertura la calcula el backend, no el LLM.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.cobertura_caso(uuid) to service_role';
    execute 'grant execute on function forense.recalcular_cobertura(uuid,text) to service_role';
  end if;
end $$;

-- Fin 015_cobertura.sql
