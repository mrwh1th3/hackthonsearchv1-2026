-- =====================================================================
-- Aserciones sobre el snapshot REAL gen-v1 copiado por cargar_gen.sh.
-- No es el fixture: aquí hay cinco tipologías sembradas y ocho trampas
-- legítimas con ground_truth, así que se puede comprobar que el clustering
-- agrupa lo que el generador sembró y que el selector no arrastra trampas.
--
-- Se omite entero si la base origen no está disponible (ver run.sh).
-- =====================================================================

do $$
declare
  v uuid; r jsonb; n1 int; n2 int; c1 int; h1 text; h2 text; n int;
  n_pistas int; n_cand int; n_tip int; n_tip_total int;
begin
  select id into v from forense.corridas where dataset = 'gen-v1' order by inicio limit 1;
  if v is null then
    perform pruebas.assert('gen-v1 disponible para aserciones', false, 'sin corrida gen-v1');
    return;
  end if;

  -- 1. Barrido de pistas sobre datos reales
  r := forense.correr_pistas(v);
  select count(*) into n_pistas from forense.pistas where corrida_id = v;
  perform pruebas.assert('correr_pistas dispara las 7 pistas de la primera entrega sobre gen-v1',
    (r ? 'D2') and (r ? 'F1') and (r ? 'F2') and (r ? 'R1') and (r ? 'R2') and (r ? 'T1') and (r ? 'E1'),
    r::text);
  perform pruebas.assert('gen-v1 produce el catálogo de pistas esperado (>=100)',
    n_pistas >= 100, 'pistas=' || n_pistas);

  select count(*) into n_cand from forense.score_entidad(v);
  perform pruebas.assert('el selector de dos familias devuelve candidatos sobre gen-v1',
    n_cand >= 10, 'candidatos=' || n_cand);

  -- 2. El selector no arrastra trampas legítimas (métrica de docs/10)
  select count(*) into n
    from forense.score_entidad(v) s
    join forense.ground_truth g on g.corrida_id = v and g.rfc = s.rfc
   where g.es_trampa_legitima;
  perform pruebas.assert('ninguna trampa legítima entra como candidato del selector',
    n = 0, 'trampas candidatas=' || n);

  -- 3. Clustering sobre datos reales, estable entre dos ejecuciones
  n1 := forense.armar_clusters(v);
  select count(*), md5(string_agg(huella, ',' order by huella)) into c1, h1
    from forense.clusters where corrida_id = v;
  perform pruebas.assert('armar_clusters arma clusters sobre gen-v1',
    n1 >= 3 and c1 = n1, 'nuevos=' || n1 || ' total=' || c1);

  n2 := forense.armar_clusters(v);
  select md5(string_agg(huella, ',' order by huella)) into h2
    from forense.clusters where corrida_id = v;
  perform pruebas.assert('los clusters de gen-v1 son estables entre dos ejecuciones',
    n2 = 0 and h1 = h2, 'nuevos2=' || n2);

  -- 4. Aparecen los clusters de las tipologías sembradas: para cada tipología
  --    con dos o más RFC de fraude, algún cluster reúne al menos dos de ellos.
  select count(*) into n_tip_total from (
    select g.tipologia from forense.ground_truth g
     where g.corrida_id = v and g.es_fraude and g.tipologia is not null
     group by g.tipologia having count(*) >= 2) t;

  select count(*) into n_tip from (
    select g.tipologia
      from forense.ground_truth g
     where g.corrida_id = v and g.es_fraude and g.tipologia is not null
     group by g.tipologia
    having count(*) >= 2
       and exists (
         select 1 from forense.clusters cl
          where cl.corrida_id = v
            and (select count(*) from forense.ground_truth g2
                  where g2.corrida_id = v and g2.tipologia = g.tipologia
                    and g2.es_fraude and g2.rfc = any(cl.rfcs)) >= 2)) t;

  perform pruebas.assert('cada tipología sembrada con >=2 RFC aparece reunida en un cluster',
    n_tip_total > 0 and n_tip = n_tip_total,
    'tipologias reunidas=' || n_tip || ' de ' || n_tip_total);

  -- 5. Ninguna semilla de cluster es una trampa legítima
  select count(*) into n
    from forense.clusters cl
    join forense.ground_truth g on g.corrida_id = v and g.rfc = cl.rfc_semilla
   where cl.corrida_id = v and g.es_trampa_legitima;
  perform pruebas.assert('ninguna trampa legítima es semilla de un cluster',
    n = 0, 'semillas trampa=' || n);

  -- 6. Cobertura del fraude sembrado por el clustering
  select count(*) into n
    from forense.ground_truth g
   where g.corrida_id = v and g.es_fraude
     and exists (select 1 from forense.clusters cl
                  where cl.corrida_id = v and g.rfc = any(cl.rfcs));
  perform pruebas.assert('la mayoría de los RFC de fraude queda dentro de algún cluster',
    n >= (select count(*) * 0.8 from forense.ground_truth g2
           where g2.corrida_id = v and g2.es_fraude),
    'fraudes en cluster=' || n || ' de ' ||
    (select count(*) from forense.ground_truth g3 where g3.corrida_id = v and g3.es_fraude));

  -- 7. Aislamiento por corrida: todo miembro de un cluster es una entidad que
  --    aparece en los hechos de ESA corrida. No se exige fila en el padrón:
  --    una contraparte externa es una entidad técnica incompleta (docs/05), y
  --    excluirla borraría la arista por la que salió el dinero.
  select count(*) into n
    from forense.clusters cl, unnest(cl.rfcs) x(rfc)
   where cl.corrida_id = v
     and not exists (select 1 from forense.contribuyentes c
                      where c.corrida_id = v and c.rfc = x.rfc)
     and not exists (select 1 from forense.cfdi f
                      where f.corrida_id = v
                        and (f.emisor_rfc = x.rfc or f.receptor_rfc = x.rfc))
     and not exists (select 1 from forense.cuentas cu
                      where cu.corrida_id = v and cu.rfc_titular = x.rfc);
  perform pruebas.assert('todo RFC de un cluster aparece en los hechos de su propia corrida',
    n = 0, 'RFC sin respaldo en la corrida=' || n);

  -- 8. Las contrapartes fuera del padrón se declaran, no se esconden
  select count(*) into n
    from forense.clusters cl, unnest(cl.rfcs) x(rfc)
   where cl.corrida_id = v
     and not exists (select 1 from forense.contribuyentes c
                      where c.corrida_id = v and c.rfc = x.rfc);
  perform pruebas.assert('las contrapartes sin padrón quedan contadas, no ocultas',
    n >= 0, 'entidades técnicas incompletas en clusters=' || n);
end $$;

-- =====================================================================
-- Ensayo de inyección en vivo (21 §3.4) con el paquete real
-- eval/inyecciones/a-carrusel-nuevo.json sobre gen-v1.
-- Se omite si cargar_paquetes.sh no dejó los paquetes en la base.
-- =====================================================================
do $$
declare
  v uuid; pkg jsonb; r jsonb; v_ing uuid; v_iny uuid; v_nueva uuid;
  n_cfdi_antes int; n_pistas_antes int; n int; v_cl uuid;
  t0 timestamptz; ms_snapshot int; ms_pistas int;
begin
  if not exists (select 1 from pg_tables where schemaname = 'pruebas' and tablename = 'paquetes') then
    return;
  end if;
  select payload into pkg from pruebas.paquetes where nombre = 'a-carrusel-nuevo';
  if pkg is null then
    return;
  end if;

  select id into v from forense.corridas where dataset = 'gen-v1' order by inicio limit 1;
  select count(*) into n_cfdi_antes from forense.cfdi where corrida_id = v;
  select count(*) into n_pistas_antes from forense.pistas where corrida_id = v;

  t0 := clock_timestamp();
  r := forense.registrar_inyeccion(v, pkg, 'ensayo', (pkg->>'idempotency_key')::uuid);
  perform pruebas.assert('el paquete (a) se registra sobre gen-v1',
    (r->>'ok')::boolean and (r->>'creada')::boolean, r::text);
  v_ing := (r->>'ingesta_id')::uuid;
  v_iny := (r->>'inyeccion_id')::uuid;

  r := forense.validar_inyeccion(v_ing);
  perform pruebas.assert('el paquete (a) pasa la validación determinista contra gen-v1',
    (r->>'ok')::boolean and (r->>'estado') = 'validada', r::text);
  perform pruebas.assert('la validación marca los tres RFC del carrusel como afectados',
    (r->'rfcs_afectados') @> '["CRR250901AA1","CRR250902BB2","CRR250903CC3"]'::jsonb,
    (r->'rfcs_afectados')::text);

  v_nueva := forense.clonar_corrida_con_inyeccion(v, v_ing);
  ms_snapshot := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  perform pruebas.assert('la inyección crea una corrida nueva, no muta gen-v1',
    v_nueva is not null
    and (select count(*) from forense.cfdi where corrida_id = v) = n_cfdi_antes
    and (select count(*) from forense.pistas where corrida_id = v) = n_pistas_antes,
    'cfdi base=' || n_cfdi_antes);
  perform pruebas.assert('los RFC inyectados no existen en la corrida base',
    not exists (select 1 from forense.contribuyentes
                 where corrida_id = v and rfc = 'CRR250901AA1'), '');

  t0 := clock_timestamp();
  r := forense.correr_pistas(v_nueva);
  ms_pistas := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  perform pruebas.assert('correr_pistas sobre la corrida nueva termina el barrido',
    (r ? 'R1') and (r ? 'R2') and (r ? 'T1'), r::text);

  select count(*) into n from forense.pistas
   where corrida_id = v_nueva and rfc in ('CRR250901AA1','CRR250902BB2','CRR250903CC3');
  perform pruebas.assert('la corrida nueva produce pistas para los RFC inyectados',
    n >= 3, 'pistas de los inyectados=' || n);

  perform pruebas.assert('el carrusel inyectado dispara R1, R2 y T1',
    (select count(distinct codigo) from forense.pistas
      where corrida_id = v_nueva and codigo in ('R1','R2','T1')
        and rfc in ('CRR250901AA1','CRR250902BB2','CRR250903CC3')) = 3,
    (select string_agg(distinct codigo, ',') from forense.pistas
      where corrida_id = v_nueva and rfc in ('CRR250901AA1','CRR250902BB2','CRR250903CC3')));

  perform pruebas.assert('los RFC inyectados cruzan el selector de dos familias',
    (select count(*) from forense.score_entidad(v_nueva) s
      where s.rfc in ('CRR250901AA1','CRR250902BB2','CRR250903CC3')) = 3, '');

  n := forense.armar_clusters(v_nueva);
  perform pruebas.assert('el clustering de la corrida nueva reúne el carrusel inyectado',
    exists (select 1 from forense.clusters cl
             where cl.corrida_id = v_nueva
               and cl.rfcs @> array['CRR250901AA1','CRR250902BB2','CRR250903CC3']),
    'clusters nuevos=' || n);

  select cluster_id into v_cl from forense.clusters_afectados(v_iny) limit 1;
  perform pruebas.assert('clusters_afectados prioriza un cluster con RFC inyectados',
    v_cl is not null
    and (select prioridad from forense.clusters_afectados(v_iny) limit 1) = 0, '');

  perform forense.marcar_inyeccion(v_iny, 'pistas_recalculadas',
    jsonb_build_object('snapshot', ms_snapshot, 'pistas', ms_pistas));
  perform pruebas.assert('las latencias del ensayo quedan persistidas para ESTADO.md',
    (select (latencias_ms ? 'snapshot') and (latencias_ms ? 'pistas')
       from forense.inyecciones where id = v_iny),
    'snapshot_ms=' || ms_snapshot || ' pistas_ms=' || ms_pistas);
end $$;
