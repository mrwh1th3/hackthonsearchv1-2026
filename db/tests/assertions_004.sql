-- =====================================================================
-- Aserciones de 004_clusters.sql sobre el clon del fixture que dejó
-- assertions_003.sql (la corrida 'pistas: clon del fixture', ya con pistas).
-- Puerta de verificación de docs/05: "después de 004, los clusters son
-- estables y dos workers no ganan el mismo lease".
-- =====================================================================

-- 1. Estabilidad: dos ejecuciones producen los mismos clusters
do $$
declare
  v uuid; n1 int; n2 int; c1 int; c2 int; h1 text; h2 text; n int;
begin
  select id into v from forense.corridas where nombre = 'pistas: clon del fixture';
  if v is null then
    perform pruebas.assert('004 requiere el clon de 003', false, 'corrida no encontrada');
    return;
  end if;

  n1 := forense.armar_clusters(v);
  select count(*), md5(string_agg(huella, ',' order by huella)) into c1, h1
    from forense.clusters where corrida_id = v;
  perform pruebas.assert('armar_clusters arma al menos un cluster sobre el clon del fixture',
    n1 >= 1 and c1 >= 1, 'nuevos=' || n1 || ' total=' || c1);

  n2 := forense.armar_clusters(v);
  select count(*), md5(string_agg(huella, ',' order by huella)) into c2, h2
    from forense.clusters where corrida_id = v;
  perform pruebas.assert('una segunda ejecución no inserta clusters nuevos',
    n2 = 0 and c2 = c1, 'nuevos2=' || n2 || ' total=' || c2);
  perform pruebas.assert('los clusters son estables entre dos ejecuciones (misma huella)',
    h1 = h2, coalesce(h1, 'null') || ' vs ' || coalesce(h2, 'null'));

  -- 2. Todo candidato de la regla de dos familias quedó cubierto
  select count(*) into n
    from forense.score_entidad(v) s
   where not exists (select 1 from forense.clusters cl
                      where cl.corrida_id = v and s.rfc = any(cl.rfcs));
  perform pruebas.assert('todo candidato de score_entidad pertenece a algún cluster',
    n = 0, 'candidatos sin cluster=' || n);

  -- 3. Límite de tamaño y coherencia de contadores
  select count(*) into n from forense.clusters
   where corrida_id = v and coalesce(array_length(rfcs, 1), 0) > 40;
  perform pruebas.assert('ningún cluster excede el tope de 40 RFC (partición por densidad)',
    n = 0, 'excedidos=' || n);

  select count(*) into n from forense.clusters
   where corrida_id = v and n_rfcs is distinct from coalesce(array_length(rfcs, 1), 0);
  perform pruebas.assert('n_rfcs coincide con el arreglo de RFC', n = 0, 'inconsistentes=' || n);

  -- 4. Sin evento persistido, el paso no existió (regla 2)
  select count(*) into n from forense.clusters cl
   where cl.corrida_id = v
     and not exists (select 1 from forense.bitacora b
                      where b.cluster_id = cl.id and b.tipo_evento = 'cluster_armado');
  perform pruebas.assert('cada cluster armado dejó su evento en bitacora',
    n = 0, 'sin evento=' || n);

  select count(*) into n from forense.bitacora
   where corrida_id = v and tipo_evento = 'cluster_armado'
     and payload->>'evento_real' = 'armar_clusters';
  perform pruebas.assert('armar_clusters deja su propio evento de resumen',
    n >= 1, 'eventos=' || n);

  -- 5. La frontera no se solapa con los miembros
  select count(*) into n from forense.clusters cl
   where cl.corrida_id = v
     and exists (select 1 from unnest(coalesce(cl.rfcs_frontera, '{}'::text[])) f
                  where f = any(cl.rfcs));
  perform pruebas.assert('ningún RFC está a la vez en el cluster y en su frontera',
    n = 0, 'solapados=' || n);
end $$;

-- 6. expandir_cluster: versión, caché, evento y universo autorizado
do $$
declare
  v uuid; cl record; v_ver int; v_nuevo text; n int; v_cache int; v_rfcs_antes int;
  v_a text; v_b text; v_id uuid;
begin
  select id into v from forense.corridas where nombre = 'pistas: clon del fixture';

  -- Cluster de prueba de un solo miembro con su vecino declarado frontera.
  -- El fixture es tan pequeño que los clusters reales lo abarcan entero y se
  -- quedan sin frontera; esto ejercita la función, no el tamaño del fixture.
  select ar.a, ar.b into v_a, v_b from forense.v_aristas_rfc ar
   where ar.corrida_id = v order by ar.a, ar.b limit 1;

  if v_a is null then
    perform pruebas.assert('expandir_cluster: el fixture tiene al menos una arista',
      false, 'sin aristas en el clon del fixture');
    return;
  end if;

  delete from forense.clusters where corrida_id = v and huella = 'prueba-004-expansion';
  insert into forense.clusters (corrida_id, rfcs, rfc_semilla, n_rfcs, n_cfdi, n_movimientos,
                                score, version_contexto, huella, rfcs_frontera, estado)
  values (v, array[v_a], v_a, 1, 0, 0, 0.5, 1, 'prueba-004-expansion', array[v_b], 'pendiente')
  returning id into v_id;

  select * into cl from forense.clusters where id = v_id;
  v_ver := cl.version_contexto;
  v_nuevo := cl.rfcs_frontera[1];
  v_rfcs_antes := coalesce(array_length(cl.rfcs, 1), 0);

  -- caché del contexto vigente, que la expansión debe invalidar
  insert into forense.tool_cache (corrida_id, cluster_id, version_contexto, herramienta, args_hash, resultado)
  values (v, cl.id, v_ver, 'perfil', 'prueba-004', '{"x":1}'::jsonb)
  on conflict do nothing;

  -- un RFC que no es frontera ni vecino no entra: el LLM no amplía su universo
  n := forense.expandir_cluster(cl.id, array['RFC:NO:AUTORIZADO:004']);
  perform pruebas.assert('expandir_cluster rechaza RFC fuera de la frontera autorizada',
    n = 0, 'agregados=' || n);
  perform pruebas.assert('un rechazo de expansión no toca version_contexto',
    (select version_contexto from forense.clusters where id = cl.id) = v_ver, '');

  n := forense.expandir_cluster(cl.id, array[v_nuevo]);
  perform pruebas.assert('expandir_cluster agrega el RFC de frontera', n = 1, 'agregados=' || n);

  select count(*) into v_cache from forense.tool_cache
   where cluster_id = cl.id and version_contexto <= v_ver;
  perform pruebas.assert('la expansión invalida el caché del contexto anterior',
    v_cache = 0, 'filas=' || v_cache);

  perform pruebas.assert('la expansión incrementa version_contexto y marca expandido',
    (select version_contexto = v_ver + 1 and expandido
       from forense.clusters where id = cl.id), '');

  perform pruebas.assert('la expansión no cambia la huella del cluster',
    (select huella from forense.clusters where id = cl.id) = cl.huella, '');

  perform pruebas.assert('el RFC expandido salió de la frontera y entró a rfcs',
    (select v_nuevo = any(rfcs) and not (v_nuevo = any(coalesce(rfcs_frontera, '{}'::text[])))
       from forense.clusters where id = cl.id), v_nuevo);

  select count(*) into n from forense.bitacora
   where cluster_id = cl.id and tipo_evento = 'cluster_expandido';
  perform pruebas.assert('la expansión dejó evento cluster_expandido', n >= 1, 'eventos=' || n);

  -- Estabilidad tras expandir: armar_clusters no reinserta el cluster original
  n := forense.armar_clusters(v);
  perform pruebas.assert('armar_clusters no duplica un cluster ya expandido',
    n = 0, 'nuevos=' || n);
end $$;

-- 7. reclamar_cluster: resolución, lease y ausencia de caso duplicado
do $$
declare
  v uuid; cl uuid; r1 jsonb; r2 jsonb; r3 jsonb; v_rfc text; n_casos int;
begin
  select id into v from forense.corridas where nombre = 'pistas: clon del fixture';
  select id, rfc_semilla into cl, v_rfc from forense.clusters
   where corrida_id = v order by score desc nulls last, id limit 1;

  perform forense.lease_cluster_liberar(cl, 'w-004-a');
  update forense.clusters set lease_owner = null, lease_expires_at = null where id = cl;

  r1 := forense.reclamar_cluster(v, cl, 'w-004-a', 'pipeline', null);
  perform pruebas.assert('reclamar_cluster reclama un cluster libre',
    (r1->>'ok')::boolean and (r1->>'estado') = 'reclamado', r1::text);

  r2 := forense.reclamar_cluster(v, cl, 'w-004-b', 'pipeline', null);
  perform pruebas.assert('un segundo worker no gana el mismo lease: queda en_cola, no falla',
    (r2->>'ok')::boolean and (r2->>'estado') = 'en_cola' and (r2->>'reclamado')::boolean = false,
    r2::text);

  select count(*) into n_casos from forense.casos where cluster_id = cl;
  perform pruebas.assert('un reclamo en cola no duplica el caso del cluster',
    n_casos <= 1, 'casos=' || n_casos);

  -- resolución por RFC: arma el cluster manual si no existía
  r3 := forense.reclamar_cluster(v, null, 'w-004-c', 'rfc', v_rfc);
  perform pruebas.assert('reclamar_cluster resuelve un cluster desde un RFC',
    (r3->>'ok')::boolean and (r3->>'cluster_id') is not null, r3::text);

  perform pruebas.assert('reclamar_cluster rechaza una corrida inexistente',
    ((forense.reclamar_cluster('00000000-0000-4000-8000-00000000dead'::uuid, null,
                               'w-004-d', 'pipeline', null))->>'ok')::boolean = false, '');

  perform pruebas.assert('renovar_cluster solo funciona para el dueño',
    ((forense.renovar_cluster(cl, 'w-004-b'))->>'ok')::boolean = false
    and ((forense.renovar_cluster(cl, 'w-004-a'))->>'ok')::boolean = true, '');

  perform pruebas.assert('liberar_cluster solo funciona para el dueño',
    ((forense.liberar_cluster(cl, 'w-004-b'))->>'ok')::boolean = false
    and ((forense.liberar_cluster(cl, 'w-004-a'))->>'ok')::boolean = true, '');
end $$;

-- 8. El grafo de entidades no mezcla corridas ni se sale de la ventana
do $$
declare n int;
begin
  select count(*) into n from forense.v_aristas_rfc ar
   where ar.a = ar.b or ar.a is null or ar.b is null or ar.a > ar.b;
  perform pruebas.assert('v_aristas_rfc es no dirigida, canónica y sin lazos',
    n = 0, 'aristas malformadas=' || n);

  select count(*) into n from forense.v_aristas_rfc ar
   join forense.corridas c on c.id = ar.corrida_id
   where not exists (select 1 from forense.cfdi f
                      where f.corrida_id = ar.corrida_id
                        and ((f.emisor_rfc = ar.a and f.receptor_rfc = ar.b)
                             or (f.emisor_rfc = ar.b and f.receptor_rfc = ar.a)))
     and ar.n_cfdi > 0;
  perform pruebas.assert('toda arista de factura corresponde a CFDI de su propia corrida',
    n = 0, 'aristas sin respaldo=' || n);
end $$;
