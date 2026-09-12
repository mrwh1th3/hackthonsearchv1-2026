-- =====================================================================
-- 016_permisos_cobertura.sql — los tres hallazgos que cerró el hotfix.
--
-- 1. Ninguna función de 014/015 queda ejecutable por PUBLIC.
-- 2. La cuota de expansión vale 1 (03 §127), sembrada y no por default.
-- 3. `cobertura_completa` tiene UN escritor: la regla. El payload del
--    dictaminador ya no puede subirla ni bajarla (regla 4).
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 1. Permisos. El bloqueo que reportó forense-qa: `proacl '=X'` deja la
--    función SECURITY DEFINER al alcance de anon en un esquema expuesto.
-- ---------------------------------------------------------------------
do $$
declare f text; v_acl text[]; v_pub text; n_mal int := 0; detalle text := '';
begin
  foreach f in array array['analizar_snapshot','cobertura_caso','recalcular_cobertura',
                           'guardar_dictamen']
  loop
    select p.proacl::text[] into v_acl
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'forense' and p.proname = f;

    -- Dos formas del hallazgo: proacl null (nadie revocó, así que rige el
    -- default de Postgres = execute para PUBLIC) o una entrada cuyo
    -- beneficiario está vacío, '=X/owner', que es PUBLIC explícito. Un
    -- 'postgres=X/postgres' NO es el hallazgo: ese es el dueño.
    if v_acl is null then
      n_mal := n_mal + 1;
      detalle := detalle || f || '=proacl_null(PUBLIC por default) ';
    else
      select a into v_pub from unnest(v_acl) a where a like '=%' limit 1;
      if v_pub is not null then
        n_mal := n_mal + 1;
        detalle := detalle || f || '=' || v_pub || ' ';
      end if;
      v_pub := null;
    end if;
  end loop;
  perform pruebas.assert(
    'ninguna función de 014/015/016 queda ejecutable por PUBLIC',
    n_mal = 0, coalesce(nullif(detalle, ''), 'las cuatro con revoke aplicado'));
end $$;

do $$
declare n int;
begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'forense'
     and p.proname in ('analizar_snapshot','cobertura_caso','recalcular_cobertura')
     and p.prosecdef
     and coalesce(p.proconfig::text, '') like '%search_path=%';
  perform pruebas.assert(
    'las tres funciones nuevas son SECURITY DEFINER con search_path fijado',
    n = 3, 'con proconfig search_path=' || n || ' de 3');
end $$;

-- ---------------------------------------------------------------------
-- 2. Cuota de expansión sembrada en 1, no heredada del default de código.
-- ---------------------------------------------------------------------
do $$
declare v int; v_sembrada int;
begin
  select valor into v_sembrada from forense.config_presupuesto
   where clave = 'max_expansiones_caso';
  -- El segundo argumento es un default imposible: si la clave no
  -- estuviera sembrada, config_int lo devolvería y la aserción caería.
  v := forense.config_int('max_expansiones_caso', 99);
  perform pruebas.assert(
    'max_expansiones_caso está sembrada en 1 (03 §127: una expansión por cluster)',
    v_sembrada = 1 and v = 1,
    'config_presupuesto=' || coalesce(v_sembrada::text, 'ausente') || ' config_int=' || v);
end $$;

-- ---------------------------------------------------------------------
-- 3. Un solo escritor de cobertura_completa: guardar_dictamen ya no
--    acepta el valor del payload.
-- ---------------------------------------------------------------------
do $$
declare
  v_corrida uuid; v_cluster uuid; v_caso uuid; v_cob boolean; v_nivel text;
  sufijo text := substr(md5(random()::text), 1, 8);
begin
  select k.id into v_corrida from forense.corridas k
   where exists (select 1 from forense.cfdi f where f.corrida_id = k.id)
   order by k.inicio nulls last limit 1;
  if v_corrida is null then
    perform pruebas.omitir('016: escritor único de cobertura', 'no hay corrida con dominio');
    return;
  end if;

  insert into forense.clusters (corrida_id, rfcs, rfc_semilla, n_rfcs, score, estado,
                                version_contexto, rfcs_frontera, huella)
  values (v_corrida, array['EEE050505EEE'], 'EEE050505EEE', 1, 7.0, 'ronda2', 1,
          array['ZZZ090909ZZZ'], 'huella-test-016-' || sufijo)
  returning id into v_cluster;

  insert into forense.casos (corrida_id, cluster_id, rfc_principal, origen, estado,
                             bitacora_seq)
  values (v_corrida, v_cluster, 'EEE050505EEE', 'pipeline', 'validando', 0)
  returning id into v_caso;

  insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda,
                                     intento, version_contexto, estado, idempotency_key)
  select v_caso, v_corrida, v_cluster, a, 1, 0, 1, 'completada',
         'test-016-' || sufijo || '-' || a
    from unnest(array['facturacion','flujo','red','temporal','listas']) a;

  -- A. El caso está cubierto por la regla; el dictamen dice lo contrario.
  --    Manda la regla.
  perform pruebas.assert('016: el caso de prueba está cubierto según la regla',
    forense.cobertura_caso(v_caso), 'cinco tareas completadas, sin frontera pedida');

  select nivel into v_nivel from forense.guardar_dictamen(v_caso, jsonb_build_object(
    'nivel', 'presuncion', 'familias', jsonb_build_array('F','R'),
    'cobertura_completa', false, 'regla', 'prueba_016'));
  select cobertura_completa into v_cob from forense.casos where id = v_caso;
  perform pruebas.assert(
    'guardar_dictamen NO baja cobertura_completa con el valor del payload',
    v_cob, 'payload cobertura_completa=false, columna=' || v_cob::text
           || ', nivel=' || v_nivel);

  -- B. Y tampoco la sube: una tarea en error deja la cobertura en false
  --    aunque el dictamen afirme que está completa.
  update forense.tareas_agente set estado = 'error', error = 'timeout del proveedor'
   where caso_id = v_caso and agente = 'listas';
  perform forense.guardar_dictamen(v_caso, jsonb_build_object(
    'nivel', 'presuncion_alta', 'familias', jsonb_build_array('F','R','T'),
    'cobertura_completa', true, 'regla', 'prueba_016_inversa'));
  select cobertura_completa into v_cob from forense.casos where id = v_caso;
  perform pruebas.assert(
    'guardar_dictamen NO sube cobertura_completa con el valor del payload',
    not v_cob, 'payload cobertura_completa=true, tarea listas en error, columna='
               || v_cob::text);
end $$;
