-- =====================================================================
-- 004_clusters.sql — Clustering determinista y leases de cluster.
--
-- Fuentes normativas: docs/06 Parte B (armar_clusters / expandir_cluster),
-- docs/05 §Lease persistente, docs/03 (fronteras y una sola expansión),
-- n8n/workflows/MANIFEST.md §3 (firma de forense.reclamar_cluster).
--
-- Reglas que se mantienen:
--   * Determinista: dos ejecuciones sobre la misma corrida producen los
--     mismos clusters (misma huella) y la segunda no inserta nada.
--   * La huella se calcula UNA vez, sobre las semillas ordenadas, y NO se
--     recalcula al expandir: si cambiara, `armar_clusters` volvería a
--     insertar el cluster pre-expansión con la huella liberada.
--   * Ventana cerrada en corridas.fecha_corte; jamás now().
--   * El lease vive en 002 (lease_cluster_adquirir/renovar/liberar). Aquí
--     solo se envuelve: reimplementar el predicado abriría una carrera.
--   * Todo paso deja bitácora (regla 2 de CLAUDE.md).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Grafo de entidades: facturas ∪ movimientos, no dirigido, en ventana.
--    Lo usan el clustering (004) y forense_relacionados (005).
--
--    Solo CFDI de ingreso (`tipo='I'`), igual que R1/R2/E1 en 003: la
--    nómina (tipo 'N') relaciona a una empresa con sus empleados, no con
--    otras empresas; incluirla metía cada receptor de nómina al cluster.
-- ---------------------------------------------------------------------

drop view if exists forense.v_aristas_rfc;
create or replace view forense.v_aristas_rfc with (security_invoker = true) as
with corte as (
  select id as corrida_id, fecha_corte from forense.corridas
),
cf as (
  select f.corrida_id,
         least(f.emisor_rfc, f.receptor_rfc)    as a,
         greatest(f.emisor_rfc, f.receptor_rfc) as b,
         count(*)::int as n_cfdi,
         sum(f.total)  as monto_cfdi
    from forense.cfdi f
    join corte c on c.corrida_id = f.corrida_id
   where not f.cancelado
     and f.tipo = 'I'
     and f.fecha <= c.fecha_corte
     and f.fecha >  c.fecha_corte - interval '12 months'
     and f.emisor_rfc is not null and f.receptor_rfc is not null
     and f.emisor_rfc <> f.receptor_rfc
   group by 1, 2, 3
),
mv as (
  select m.corrida_id,
         least(co.rfc_titular, cd.rfc_titular)    as a,
         greatest(co.rfc_titular, cd.rfc_titular) as b,
         count(*)::int as n_mov,
         sum(m.monto)  as monto_mov
    from forense.movimientos m
    join corte c on c.corrida_id = m.corrida_id
    join forense.cuentas co on co.corrida_id = m.corrida_id and co.clabe = m.cuenta_origen
    join forense.cuentas cd on cd.corrida_id = m.corrida_id and cd.clabe = m.cuenta_destino
   where m.fecha <= c.fecha_corte
     and m.fecha >  c.fecha_corte - interval '12 months'
     and co.rfc_titular is not null and cd.rfc_titular is not null
     and co.rfc_titular <> cd.rfc_titular
   group by 1, 2, 3
)
select coalesce(cf.corrida_id, mv.corrida_id) as corrida_id,
       coalesce(cf.a, mv.a) as a,
       coalesce(cf.b, mv.b) as b,
       coalesce(cf.n_cfdi, 0)     as n_cfdi,
       coalesce(cf.monto_cfdi, 0) as monto_cfdi,
       coalesce(mv.n_mov, 0)      as n_mov,
       coalesce(mv.monto_mov, 0)  as monto_mov
  from cf
  full join mv
    on mv.corrida_id = cf.corrida_id and mv.a = cf.a and mv.b = cf.b;

-- ---------------------------------------------------------------------
-- 2. Utilidades deterministas de conjuntos
-- ---------------------------------------------------------------------

-- Solape de Szymkiewicz–Simpson: |A ∩ B| / min(|A|,|B|). docs/06 pide
-- "solape > 50%"; con el mínimo como denominador, un ego pequeño contenido
-- en uno grande sí funde (que es lo que se quiere), cosa que Jaccard no hace.
create or replace function forense.solape(p_a text[], p_b text[])
returns numeric language sql immutable set search_path = '' as $$
  select case
           when coalesce(array_length(p_a, 1), 0) = 0 or coalesce(array_length(p_b, 1), 0) = 0 then 0::numeric
           else (
             select count(*)::numeric
               from unnest(p_a) x
              where x = any(p_b)
           ) / least(array_length(p_a, 1), array_length(p_b, 1))
         end
$$;

create or replace function forense.huella_cluster(p_semillas text[])
returns text language sql immutable set search_path = '' as $$
  select md5('clusters.v1|' || array_to_string(
    (select coalesce(array_agg(distinct s order by s), '{}'::text[]) from unnest(p_semillas) s), ','))
$$;

-- ---------------------------------------------------------------------
-- 3. Ego-network de 2 saltos sobre facturas ∪ movimientos.
--    Los hubs (grado > p_max_grado) no se atraviesan en el segundo salto:
--    un solo nodo muy conectado arrastraría medio dataset al cluster.
-- ---------------------------------------------------------------------

create or replace function forense.ego_network(
  p_corrida uuid, p_rfc text, p_saltos int default 2, p_max_grado int default 40)
returns text[] language sql stable set search_path = '' as $$
  with recursive grado as (
    select x.rfc, count(*)::int as g
      from (select a as rfc from forense.v_aristas_rfc where corrida_id = p_corrida
            union all
            select b from forense.v_aristas_rfc where corrida_id = p_corrida) x
     group by x.rfc
  ),
  alcance as (
    select p_rfc as rfc, 0 as salto
    union
    select case when ar.a = al.rfc then ar.b else ar.a end, al.salto + 1
      from alcance al
      join forense.v_aristas_rfc ar
        on ar.corrida_id = p_corrida and (ar.a = al.rfc or ar.b = al.rfc)
      join grado g on g.rfc = al.rfc
     where al.salto < least(greatest(coalesce(p_saltos, 2), 1), 3)
       and (al.salto = 0 or g.g <= p_max_grado)
  )
  select coalesce(array_agg(distinct rfc order by rfc), array[p_rfc])
    from alcance
$$;

-- ---------------------------------------------------------------------
-- 4. armar_clusters — docs/06 Parte B, pasos 1..5.
--
--    1. candidatos := forense.score_entidad (regla de dos familias)
--    2. ego-network de 2 saltos sobre facturas ∪ movimientos
--    3. fusión de ego-networks con solape > 50%
--    4. si |cluster| > p_max_rfcs: se conserva el núcleo denso (mayor grado
--       interno) y los cortes se declaran frontera, no se pierden
--    5. insert con huella determinista y score = suma de sus candidatos
--
--    Los tres parámetros llevan DEFAULT: `select forense.armar_clusters($1)`
--    (la llamada del MANIFEST §6 nodo 7) sigue siendo válida.
-- ---------------------------------------------------------------------

create or replace function forense.armar_clusters(
  p_corrida uuid, p_max_grado int default 40, p_max_rfcs int default 40)
returns int language plpgsql set search_path = '' as $$
declare
  v_corte timestamptz;
  v_estado text;
  n_nuevos int := 0;
  n_total  int := 0;
  i record; j record; r record;
  v_fundidos int := 0;
  v_cortados int := 0;
  t0 timestamptz := clock_timestamp();
begin
  select fecha_corte, estado into v_corte, v_estado
    from forense.corridas where id = p_corrida;
  if not found then
    return 0;
  end if;
  if v_estado not in ('lista', 'procesando', 'completada') then
    -- Regla 10: no se arman clusters sobre un snapshot que no está validado.
    return 0;
  end if;

  drop table if exists pg_temp.forense_egos;
  create temp table forense_egos (
    id       serial primary key,
    semillas text[] not null,
    rfcs     text[] not null,
    score    numeric not null
  ) on commit drop;

  -- (1) y (2): un ego por candidato, en orden determinista.
  insert into pg_temp.forense_egos (semillas, rfcs, score)
  select array[c.rfc], forense.ego_network(p_corrida, c.rfc, 2, p_max_grado), c.score
    from (select rfc, score from forense.score_entidad(p_corrida) order by score desc, rfc) c;

  -- (3) fusión por solape > 50%. Cada vuelta elimina un ego, así que el
  -- bucle termina en a lo sumo N vueltas; el par se elige por (id, id) para
  -- que dos ejecuciones fundan en el mismo orden.
  loop
    select e1.id as id1, e2.id as id2 into i
      from pg_temp.forense_egos e1
      join pg_temp.forense_egos e2 on e2.id > e1.id
     where forense.solape(e1.rfcs, e2.rfcs) > 0.5
     order by e1.id, e2.id
     limit 1;
    exit when not found;

    update pg_temp.forense_egos d
       set rfcs = (select coalesce(array_agg(distinct x order by x), '{}'::text[])
                     from unnest(d.rfcs || s.rfcs) x),
           semillas = (select coalesce(array_agg(distinct x order by x), '{}'::text[])
                         from unnest(d.semillas || s.semillas) x),
           score = d.score + s.score
      from pg_temp.forense_egos s
     where d.id = i.id1 and s.id = i.id2;
    delete from pg_temp.forense_egos where id = i.id2;
    v_fundidos := v_fundidos + 1;
  end loop;

  -- (4) y (5): partición por densidad e inserción.
  for r in select * from pg_temp.forense_egos order by score desc, id loop
    declare
      v_nucleo    text[];
      v_frontera  text[];
      v_huella    text;
      v_semilla   text;
      v_id        uuid;
      v_n_cfdi    int;
      v_n_mov     int;
      v_recortado boolean := false;
    begin
      if coalesce(array_length(r.rfcs, 1), 0) > p_max_rfcs then
        -- Densidad = aristas hacia otros miembros. Las semillas nunca se cortan.
        select coalesce(array_agg(m.rfc order by m.rfc), '{}'::text[])
          into v_nucleo
          from (
            select x.rfc,
                   row_number() over (
                     order by (x.rfc = any(r.semillas)) desc,
                              coalesce(g.grado_interno, 0) desc,
                              x.rfc) as rn
              from unnest(r.rfcs) x(rfc)
              left join (
                select y.rfc, count(*)::int as grado_interno
                  from (
                    select ar.a as rfc from forense.v_aristas_rfc ar
                     where ar.corrida_id = p_corrida and ar.a = any(r.rfcs) and ar.b = any(r.rfcs)
                    union all
                    select ar.b from forense.v_aristas_rfc ar
                     where ar.corrida_id = p_corrida and ar.a = any(r.rfcs) and ar.b = any(r.rfcs)
                  ) y
                 group by y.rfc
              ) g on g.rfc = x.rfc
          ) m
         where m.rn <= p_max_rfcs;
        v_recortado := true;
      else
        v_nucleo := r.rfcs;
      end if;

      -- Frontera = cortes por densidad + vecinos a 1 salto que quedaron fuera,
      -- ordenados por número de aristas hacia el núcleo. Tope de 20: es una
      -- lista de candidatos a expansión, no un segundo cluster.
      select coalesce(array_agg(f.rfc order by f.n desc, f.rfc), '{}'::text[])
        into v_frontera
        from (
          select v.rfc, count(*)::int as n
            from (
              select case when ar.a = any(v_nucleo) then ar.b else ar.a end as rfc
                from forense.v_aristas_rfc ar
               where ar.corrida_id = p_corrida
                 and (ar.a = any(v_nucleo) or ar.b = any(v_nucleo))
            ) v
           where not (v.rfc = any(v_nucleo))
           group by v.rfc
           order by n desc, v.rfc
           limit 20
        ) f;

      v_huella  := forense.huella_cluster(r.semillas);
      v_semilla := r.semillas[1];
      select coalesce(array_agg(s order by s), '{}'::text[]) into v_frontera
        from unnest(v_frontera || (select coalesce(array_agg(x order by x), '{}'::text[])
                                     from unnest(r.rfcs) x
                                    where not (x = any(v_nucleo)))) s;

      select count(*)::int into v_n_cfdi
        from forense.cfdi f
       where f.corrida_id = p_corrida and not f.cancelado
         and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
         and (f.emisor_rfc = any(v_nucleo) or f.receptor_rfc = any(v_nucleo));

      select count(*)::int into v_n_mov
        from forense.movimientos m
        left join forense.cuentas co on co.corrida_id = p_corrida and co.clabe = m.cuenta_origen
        left join forense.cuentas cd on cd.corrida_id = p_corrida and cd.clabe = m.cuenta_destino
       where m.corrida_id = p_corrida
         and m.fecha <= v_corte and m.fecha > v_corte - interval '12 months'
         and (co.rfc_titular = any(v_nucleo) or cd.rfc_titular = any(v_nucleo));

      insert into forense.clusters (
        corrida_id, rfcs, rfc_semilla, n_rfcs, n_cfdi, n_movimientos, score,
        version_contexto, huella, rfcs_frontera, estado)
      values (
        p_corrida, v_nucleo, v_semilla, coalesce(array_length(v_nucleo, 1), 0),
        v_n_cfdi, v_n_mov, round(r.score, 4), 1, v_huella, v_frontera, 'pendiente')
      on conflict (corrida_id, huella) do nothing
      returning id into v_id;

      if v_id is not null then
        n_nuevos := n_nuevos + 1;
        if v_recortado then v_cortados := v_cortados + 1; end if;
        perform forense.log(null, 'sistema', 'cluster_armado',
          jsonb_build_object(
            'cluster_id', v_id, 'huella', v_huella, 'rfc_semilla', v_semilla,
            'semillas', to_jsonb(r.semillas),
            'n_rfcs', coalesce(array_length(v_nucleo, 1), 0),
            'n_frontera', coalesce(array_length(v_frontera, 1), 0),
            'n_cfdi', v_n_cfdi, 'n_movimientos', v_n_mov,
            'score', round(r.score, 4),
            'recortado_por_densidad', v_recortado,
            'max_rfcs', p_max_rfcs, 'max_grado', p_max_grado),
          null, null, null, null, null, v_id, null, p_corrida);
      end if;
    end;
  end loop;

  select count(*)::int into n_total from forense.clusters where corrida_id = p_corrida;

  perform forense.log(null, 'sistema', 'cluster_armado',
    jsonb_build_object('evento_real', 'armar_clusters', 'nuevos', n_nuevos,
                       'total_corrida', n_total, 'fusiones', v_fundidos,
                       'recortados_por_densidad', v_cortados,
                       'duracion_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int),
    (extract(epoch from clock_timestamp() - t0) * 1000)::int,
    null, null, null, null, null, null, p_corrida);

  return n_nuevos;
end $$;

-- ---------------------------------------------------------------------
-- 5. armar_cluster_para — entrada manual por RFC (docs/06 §Selección:
--    "la investigación manual por RFC/UUID permite revisar un caso de una
--    sola familia"). No relaja el dictamen: solo crea el cluster.
-- ---------------------------------------------------------------------

create or replace function forense.armar_cluster_para(
  p_corrida uuid, p_rfc text, p_max_grado int default 40, p_max_rfcs int default 40)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_corte timestamptz; v_rfcs text[]; v_frontera text[]; v_huella text;
  v_id uuid; v_n_cfdi int; v_n_mov int; v_score numeric;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;
  if v_corte is null then return null; end if;
  if not exists (select 1 from forense.contribuyentes c
                  where c.corrida_id = p_corrida and c.rfc = p_rfc) then
    return null;
  end if;

  v_huella := forense.huella_cluster(array[p_rfc]);
  select id into v_id from forense.clusters
   where corrida_id = p_corrida and huella = v_huella;
  if v_id is not null then
    return v_id;
  end if;

  v_rfcs := forense.ego_network(p_corrida, p_rfc, 2, p_max_grado);
  if coalesce(array_length(v_rfcs, 1), 0) > p_max_rfcs then
    select coalesce(array_agg(m.rfc order by m.rfc), '{}'::text[]) into v_rfcs
      from (select x.rfc,
                   row_number() over (order by (x.rfc = p_rfc) desc, x.rfc) as rn
              from unnest(v_rfcs) x(rfc)) m
     where m.rn <= p_max_rfcs;
  end if;

  select coalesce(array_agg(f.rfc order by f.n desc, f.rfc), '{}'::text[]) into v_frontera
    from (select v.rfc, count(*)::int as n
            from (select case when ar.a = any(v_rfcs) then ar.b else ar.a end as rfc
                    from forense.v_aristas_rfc ar
                   where ar.corrida_id = p_corrida
                     and (ar.a = any(v_rfcs) or ar.b = any(v_rfcs))) v
           where not (v.rfc = any(v_rfcs))
           group by v.rfc order by n desc, v.rfc limit 20) f;

  select coalesce(sum(p.score), 0) into v_score
    from forense.pistas p
   where p.corrida_id = p_corrida and p.estado = 'disparada' and p.rfc = p_rfc;

  select count(*)::int into v_n_cfdi from forense.cfdi f
   where f.corrida_id = p_corrida and not f.cancelado
     and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
     and (f.emisor_rfc = any(v_rfcs) or f.receptor_rfc = any(v_rfcs));

  select count(*)::int into v_n_mov from forense.movimientos m
    left join forense.cuentas co on co.corrida_id = p_corrida and co.clabe = m.cuenta_origen
    left join forense.cuentas cd on cd.corrida_id = p_corrida and cd.clabe = m.cuenta_destino
   where m.corrida_id = p_corrida
     and m.fecha <= v_corte and m.fecha > v_corte - interval '12 months'
     and (co.rfc_titular = any(v_rfcs) or cd.rfc_titular = any(v_rfcs));

  insert into forense.clusters (
    corrida_id, rfcs, rfc_semilla, n_rfcs, n_cfdi, n_movimientos, score,
    version_contexto, huella, rfcs_frontera, estado)
  values (p_corrida, v_rfcs, p_rfc, coalesce(array_length(v_rfcs, 1), 0),
          v_n_cfdi, v_n_mov, round(v_score, 4), 1, v_huella, v_frontera, 'pendiente')
  on conflict (corrida_id, huella) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from forense.clusters
     where corrida_id = p_corrida and huella = v_huella;
    return v_id;
  end if;

  perform forense.log(null, 'sistema', 'cluster_armado',
    jsonb_build_object('cluster_id', v_id, 'huella', v_huella, 'rfc_semilla', p_rfc,
                       'origen', 'manual', 'n_rfcs', coalesce(array_length(v_rfcs, 1), 0)),
    null, null, null, null, null, v_id, null, p_corrida);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. expandir_cluster — docs/06 Parte B.
--    Agrega RFC de frontera, incrementa version_contexto, invalida el caché
--    del contexto anterior y escribe cluster_expandido. La huella NO cambia.
--    Solo se admiten RFC ya declarados frontera o vecinos a 1 salto del
--    cluster: el LLM no puede ampliar su universo autorizado (docs/06 ACL).
-- ---------------------------------------------------------------------

create or replace function forense.expandir_cluster(p_cluster uuid, p_rfcs text[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  cl record; v_nuevos text[]; v_rfcs text[]; v_frontera text[];
  v_corte timestamptz; v_n_cfdi int; v_n_mov int; v_caso uuid; n int;
begin
  select * into cl from forense.clusters where id = p_cluster for update;
  if not found then
    return 0;
  end if;
  select fecha_corte into v_corte from forense.corridas where id = cl.corrida_id;

  -- Universo autorizado: frontera declarada o vecino directo del cluster.
  select coalesce(array_agg(distinct x order by x), '{}'::text[]) into v_nuevos
    from unnest(coalesce(p_rfcs, '{}'::text[])) x
   where not (x = any(coalesce(cl.rfcs, '{}'::text[])))
     and (x = any(coalesce(cl.rfcs_frontera, '{}'::text[]))
          or exists (select 1 from forense.v_aristas_rfc ar
                      where ar.corrida_id = cl.corrida_id
                        and ((ar.a = x and ar.b = any(cl.rfcs))
                             or (ar.b = x and ar.a = any(cl.rfcs)))));

  if coalesce(array_length(v_nuevos, 1), 0) = 0 then
    return 0;
  end if;

  select coalesce(array_agg(distinct s order by s), '{}'::text[]) into v_rfcs
    from unnest(cl.rfcs || v_nuevos) s;
  select coalesce(array_agg(distinct s order by s), '{}'::text[]) into v_frontera
    from unnest(coalesce(cl.rfcs_frontera, '{}'::text[])) s
   where not (s = any(v_nuevos));

  select count(*)::int into v_n_cfdi from forense.cfdi f
   where f.corrida_id = cl.corrida_id and not f.cancelado
     and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
     and (f.emisor_rfc = any(v_rfcs) or f.receptor_rfc = any(v_rfcs));

  select count(*)::int into v_n_mov from forense.movimientos m
    left join forense.cuentas co on co.corrida_id = cl.corrida_id and co.clabe = m.cuenta_origen
    left join forense.cuentas cd on cd.corrida_id = cl.corrida_id and cd.clabe = m.cuenta_destino
   where m.corrida_id = cl.corrida_id
     and m.fecha <= v_corte and m.fecha > v_corte - interval '12 months'
     and (co.rfc_titular = any(v_rfcs) or cd.rfc_titular = any(v_rfcs));

  update forense.clusters
     set rfcs = v_rfcs,
         rfcs_frontera = v_frontera,
         n_rfcs = coalesce(array_length(v_rfcs, 1), 0),
         n_cfdi = v_n_cfdi,
         n_movimientos = v_n_mov,
         expandido = true,
         version_contexto = cl.version_contexto + 1
   where id = p_cluster;

  -- El contexto anterior deja de ser válido: su caché se borra (docs/06).
  perform forense.cache_invalidar(p_cluster, cl.version_contexto);

  select id into v_caso from forense.casos
   where cluster_id = p_cluster order by creado limit 1;

  n := coalesce(array_length(v_nuevos, 1), 0);
  perform forense.log(v_caso, 'sistema', 'cluster_expandido',
    jsonb_build_object('cluster_id', p_cluster, 'agregados', to_jsonb(v_nuevos),
                       'n_agregados', n,
                       'version_contexto', cl.version_contexto + 1,
                       'n_rfcs', coalesce(array_length(v_rfcs, 1), 0),
                       'cache_invalidado_hasta', cl.version_contexto),
    null, null, null, null, null, p_cluster, null, cl.corrida_id);

  return n;
end $$;

-- ---------------------------------------------------------------------
-- 7. Leases de cluster para el runtime (MANIFEST §3 nodo 4).
--    reclamar_cluster(corrida, cluster, owner, origen, origen_valor):
--    resuelve o arma el cluster en el snapshot y DESPUÉS reclama el lease.
--    Ocupado => {ok:true, estado:'en_cola'} y NO se duplica el caso.
-- ---------------------------------------------------------------------

create or replace function forense.reclamar_cluster(
  p_corrida uuid, p_cluster uuid, p_owner text,
  p_origen text default 'pipeline', p_origen_valor text default null,
  p_segundos int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cluster uuid := p_cluster; v_lease jsonb; cl record; v_estado text; v_caso uuid;
begin
  select estado into v_estado from forense.corridas where id = p_corrida;
  if v_estado is null then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'corrida inexistente');
  end if;

  if v_cluster is null then
    if p_origen = 'rfc' then
      select id into v_cluster from forense.clusters
       where corrida_id = p_corrida and p_origen_valor = any(rfcs)
       order by score desc nulls last, creado, id limit 1;
      if v_cluster is null then
        v_cluster := forense.armar_cluster_para(p_corrida, p_origen_valor);
      end if;
    elsif p_origen = 'uuid' then
      select id into v_cluster from forense.clusters cl2
       where cl2.corrida_id = p_corrida
         and exists (select 1 from forense.cfdi f
                      where f.corrida_id = p_corrida and f.uuid = p_origen_valor::uuid
                        and (f.emisor_rfc = any(cl2.rfcs) or f.receptor_rfc = any(cl2.rfcs)))
       order by cl2.score desc nulls last, cl2.creado, cl2.id limit 1;
      if v_cluster is null then
        v_cluster := forense.armar_cluster_para(
          p_corrida, (select emisor_rfc from forense.cfdi
                       where corrida_id = p_corrida and uuid = p_origen_valor::uuid));
      end if;
    elsif p_origen = 'pista' then
      select forense.armar_cluster_para(p_corrida, p.rfc) into v_cluster
        from forense.pistas p
       where p.corrida_id = p_corrida and p.id = p_origen_valor::bigint;
    end if;
  end if;

  if v_cluster is null then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'no se pudo resolver el cluster',
                              'origen', p_origen);
  end if;

  select * into cl from forense.clusters where id = v_cluster;
  if not found or cl.corrida_id <> p_corrida then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'cluster de otra corrida');
  end if;

  select id into v_caso from forense.casos
   where cluster_id = v_cluster order by creado limit 1;

  v_lease := forense.lease_cluster_adquirir(v_cluster, p_owner, p_segundos);
  if not coalesce((v_lease->>'ok')::boolean, false) then
    -- Sin lease no es fallo: el cluster queda EN COLA y no se duplica el caso.
    return jsonb_build_object(
      'ok', true, 'estado', 'en_cola', 'reclamado', false,
      'cluster_id', v_cluster, 'corrida_id', p_corrida,
      'caso_id', v_caso, 'owner_actual', v_lease->>'owner',
      'motivo', coalesce(v_lease->>'error', 'lease_ocupado'));
  end if;

  return jsonb_build_object(
    'ok', true, 'estado', 'reclamado', 'reclamado', true,
    'cluster_id', v_cluster, 'corrida_id', p_corrida, 'caso_id', v_caso,
    'owner', p_owner, 'lease_expires_at', v_lease->>'lease_expires_at',
    'version_contexto', cl.version_contexto, 'rfcs', to_jsonb(cl.rfcs),
    'rfc_semilla', cl.rfc_semilla, 'n_rfcs', cl.n_rfcs,
    'cluster_estado', cl.estado);
end $$;

create or replace function forense.renovar_cluster(
  p_cluster uuid, p_owner text, p_segundos int default 90)
returns jsonb language sql security definer set search_path = '' as $$
  select forense.lease_cluster_renovar(p_cluster, p_owner, p_segundos)
$$;

create or replace function forense.liberar_cluster(p_cluster uuid, p_owner text)
returns jsonb language sql security definer set search_path = '' as $$
  select forense.lease_cluster_liberar(p_cluster, p_owner)
$$;

-- ---------------------------------------------------------------------
-- 8. Permisos: nada de esto lo llama el LLM ni el frontend anónimo.
-- ---------------------------------------------------------------------

revoke execute on function
  forense.armar_clusters(uuid, int, int),
  forense.armar_cluster_para(uuid, text, int, int),
  forense.expandir_cluster(uuid, text[]),
  forense.reclamar_cluster(uuid, uuid, text, text, text, int),
  forense.renovar_cluster(uuid, text, int),
  forense.liberar_cluster(uuid, text)
from public;

do $$
declare rol text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.armar_clusters(uuid, int, int) to service_role';
    execute 'grant execute on function forense.armar_cluster_para(uuid, text, int, int) to service_role';
    execute 'grant execute on function forense.expandir_cluster(uuid, text[]) to service_role';
    execute 'grant execute on function forense.reclamar_cluster(uuid, uuid, text, text, text, int) to service_role';
    execute 'grant execute on function forense.renovar_cluster(uuid, text, int) to service_role';
    execute 'grant execute on function forense.liberar_cluster(uuid, text) to service_role';
    execute 'grant select on forense.v_aristas_rfc to service_role';
  end if;
  foreach rol in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = rol) then
      -- El grafo agregado ya se publica por forense.v_grafo; la vista cruda
      -- no añade nada a la demo y sí superficie de consulta.
      execute format('revoke all on forense.v_aristas_rfc from %I', rol);
    end if;
  end loop;
end $$;

-- Fin 004_clusters.sql
