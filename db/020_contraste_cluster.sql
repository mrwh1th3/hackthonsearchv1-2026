-- =====================================================================
-- 020_contraste_cluster.sql — el comparable del panel Contraste se busca
-- PRIMERO dentro del cluster del caso, y sólo si ahí no hay, se cae al
-- emparejamiento caso-a-caso de 018.
--
-- POR QUÉ. 018 exigía que el comparable fuese OTRO CASO. Medido: no se
-- puede llenar por volumen de datos. `armar_clusters` agrupa por vecindad
-- de grafo con tope de 40 RFC, así que 100 contribuyentes dan 4 clusters y
-- 300 dan 6: con 4–6 casos por corrida, "otro caso del mismo giro, con
-- solape y menos grave" tiene techo 1 de 4 (medición del corte A, gen-v1).
-- Un cluster, en cambio, trae hasta 40 RFC con su nivel propio en
-- `casos.resultado_por_rfc`, y para el jurado la respuesta es más fuerte:
-- las dos entidades están en la MISMA investigación.
--
-- FUENTE DEL NIVEL POR RFC. `casos.resultado_por_rfc`, que escribe
-- `guardar_dictamen` (`db/010_runtime_funciones.sql:621`) con lo que emite
-- `n8n/runtime/auditor-final.mjs` desde el commit a708225: un elemento por
-- RFC del cluster con la forma `{rfc, nivel, tipologia, evidencia_ids,
-- cobertura_completa}`. El nivel por RFC lo decide el MISMO `decidirNivel()`
-- que decide el del caso (regla 4: el nivel sale de código determinista, no
-- de SQL y no de un modelo). Esta vista lo LEE; no lo recalcula.
--
-- NIVEL DE REFERENCIA del lado "esta sí": el del `rfc_principal` en
-- `resultado_por_rfc` y, si el caso todavía no lo tiene, `casos.nivel`. Es
-- el precedente ya establecido en `db/002_views.sql:1026-1038` y
-- `db/011_metricas_corrida.sql:137-148` ("primero la atribución explícita de
-- resultado_por_rfc, si el caso aún no la tiene, el nivel del RFC
-- principal"). Medido sobre `forense_rt`: con una referencia o con la otra
-- el resultado de hoy es idéntico, así que la decisión se toma por
-- precedente y no por una cifra que no distingue.
--
-- RAZÓN TIPIFICADA en el camino de cluster, por RFC y sin inventar nada:
--   * `cobertura_insuficiente`: el propio elemento trae
--     `cobertura_completa` por RFC (lo calcula el runtime filtrando las
--     limitaciones que NOMBRAN a ese RFC; una limitación sin `objetivo.rfcs`
--     afecta a todo el cluster).
--   * `defensa_aceptada`: alguna pista DE ESE RFC aparece con
--     `resultado='descartada'` en `casos.evaluacion_pistas` (indexada por ID
--     de pista, 017). Es el texto literal del contrato ("alguna pista
--     descartada"), y por eso puede darse en un RFC que NO quedó en
--     `anomalia_explicada`: `decidirNivel` sólo llega a ese nivel cuando
--     TODAS las evaluables están descartadas. Discrepancia esperada, no bug.
--   * `familia_faltante`: familias distintas de la evidencia que el propio
--     elemento enumera en `evidencia_ids`, comparadas con las del elemento
--     del `rfc_principal`. Se unen por ID a propósito: el runtime calcula
--     `famRfc` sobre ESA misma evidencia (ya filtrada por
--     `valida_tecnica and not refutada and validada`, auditor-final.mjs:20-21),
--     así que SQL no puede discrepar de él por reimplementar el filtro.
--   Precedencia idéntica a 018 y por la misma razón (el orden de decisión de
--   `auditor-final.mjs:55-62`): cobertura > defensa > familias.
--
-- RESPALDO, NO SUSTITUCIÓN. Si el cluster no da comparable (corrida vieja
-- sin `resultado_por_rfc`, cluster de un solo RFC, nadie del mismo giro,
-- nadie menos grave, sin solape o sin razón tipificable), se usa el
-- emparejamiento caso-a-caso de 018 tal cual. Cero filas sigue siendo cero
-- filas: si ninguno de los dos caminos da comparable, no hay fila. La
-- procedencia viaja dentro de `explicacion` ("del mismo cluster" / "de otro
-- caso de la misma corrida") porque las siete columnas del contrato
-- `product.contraste` son fijas y no admiten una octava.
--
-- FIRMA IDÉNTICA. `create or replace` conserva nombre, argumento y las siete
-- columnas exactas de 018: la webapp ya está cableada a esta rpc
-- (`web/lib/data/supabase.ts`, `getContraste`) y no debe llamar a dos. 018
-- sigue siendo el archivo que documenta el camino caso-a-caso.
--
-- LO QUE ESTA MIGRACIÓN NO ARREGLA (medido en `forense_rt`, 15 casos
-- dictaminados, 15 con `resultado_por_rfc` poblada): hoy el camino de
-- cluster devuelve 0 filas, y el respaldo también. No es por esta consulta.
--
-- El cuello de botella es la POBREZA DE EVIDENCIA de ese snapshot: 5 filas
-- en `forense.evidencia` para 15 casos, 0 elementos de `resultado_por_rfc`
-- con `evidencia_ids`, y sólo 2 casos con `evaluacion_pistas` no vacía. Sin
-- evidencia no hay familias que contar y sin defensa no hay descartes, así
-- que ninguna de las tres razones puede tipificarse. `forense_rt` es un
-- smoke de runtime, no una investigación.
--
-- Corrección de una cifra que circuló antes de medirla con la razón
-- exigida: relajar `pistas_solapadas` a `minItems 0` daría **1 de 15**, no
-- 9 de 15 (de los 17 candidatos con giro y nivel menos grave, sólo 1 tiene
-- razón tipificable). Así que el contrato NO es la palanca dominante y no
-- se toca; la palanca es una corrida con evidencia y defensas reales.
--
-- Lo que sí es estructural, y es un subconjunto: los vecinos
-- `sin_hallazgos` —los "aquella no" más limpios— tienen CERO pistas propias
-- por construcción de `decidirNivel` (ese nivel exige `nEv===0 &&
-- nPistas===0`), así que nunca pueden solapar una pista y `minItems 1` los
-- excluye siempre. No bloquea el panel: un vecino con UNA familia cae en
-- `no_concluyente` mientras el principal con dos presume, o sea comparte
-- pista Y es menos grave, que es justo la fila que este camino devuelve
-- (hay aserción de ello en `db/tests/assertions_020.sql`).
--
-- ADITIVA E IDEMPOTENTE: un solo `create or replace` y la reafirmación de
-- permisos de 018. No toca tablas, ni firmas, ni catálogos `check`.
-- =====================================================================

set search_path = '';

create or replace function forense.v_contraste_caso(p_caso uuid)
returns table(caso_id uuid, rfc_comparable text, giro_compartido text,
              pistas_solapadas text[], resultado_comparable text,
              razon_tipificada text, explicacion text)
language sql stable security invoker set search_path = '' as $$
  with orden as (
    -- Gravedad: el arreglo `NIVELES` de n8n/runtime/auditor-final.mjs:15.
    -- El máximo del sistema es `presuncion_alta` (regla 7).
    select array['sin_hallazgos','anomalia_explicada','no_concluyente',
                 'presuncion','presuncion_alta']::text[] as niveles
  ),
  k as (
    select c.id, c.corrida_id, c.cluster_id, c.rfc_principal, c.nivel,
           c.evaluacion_pistas, c.resultado_por_rfc as rxr,
           cardinality(coalesce(c.familias_confirmadas, '{}'::text[])) as n_fam_caso,
           t.giro
      from forense.casos c
      join forense.contribuyentes t
        on t.corrida_id = c.corrida_id and t.rfc = c.rfc_principal
     where c.id = p_caso
       and c.nivel is not null
       and t.giro is not null and t.giro <> ''
  ),
  -- Elemento del propio rfc_principal: de ahí salen su nivel de referencia y
  -- sus familias de referencia.
  propio as (
    select e as elem
      from k, jsonb_array_elements(coalesce(k.rxr, '[]'::jsonb)) e
     where e->>'rfc' = k.rfc_principal
     limit 1
  ),
  -- El cast va en el SELECT con un `case`, nunca en el ON: un
  -- `evidencia_ids` con algo que no sea un entero no puede abortar la
  -- consulta (null no empareja con ningún id y la fila se descarta sola).
  fam_propio as (
    select count(distinct ev.familia) as n_fam
      from (select case when y ~ '^[0-9]+$' then y::bigint end as ev_id
              from propio,
                   jsonb_array_elements_text(
                     coalesce(propio.elem->'evidencia_ids', '[]'::jsonb)) y) z
      join forense.evidencia ev on ev.id = z.ev_id
  ),
  ref as (
    select k.id, k.corrida_id, k.rfc_principal, k.nivel, k.giro, k.evaluacion_pistas,
           k.rxr, k.n_fam_caso,
           coalesce((select elem->>'nivel' from propio), k.nivel) as nivel_ref,
           -- OJO: `fam_propio` es un agregado sin GROUP BY, así que devuelve
           -- una fila con 0 incluso cuando el caso no tiene elemento propio.
           -- Sin este `exists` la referencia caería a 0 y `familia_faltante`
           -- sería inalcanzable en toda corrida sin `resultado_por_rfc`.
           case when exists (select 1 from propio)
                then coalesce((select n_fam from fam_propio), 0)
                else k.n_fam_caso end as n_fam_ref,
           array_position(o.niveles, coalesce((select elem->>'nivel' from propio), k.nivel))
             as grav_ref
      from k cross join orden o
  ),
  pistas_caso as (
    select distinct p.codigo
      from ref, forense.pistas p
     where p.corrida_id = ref.corrida_id
       and p.rfc = ref.rfc_principal
       and p.estado = 'disparada'
       and p.codigo is not null
  ),
  -- =================================================================
  -- Camino PRIMARIO: los RFC del cluster, con su nivel por RFC.
  -- =================================================================
  cl_cand as (
    select e->>'rfc' as rfc,
           e->>'nivel' as nivel,
           coalesce((e->>'cobertura_completa')::boolean, false) as cobertura,
           coalesce(e->'evidencia_ids', '[]'::jsonb) as ev_ids,
           t.giro,
           array_position(o.niveles, e->>'nivel') as grav
      from ref
      cross join orden o
      cross join lateral jsonb_array_elements(coalesce(ref.rxr, '[]'::jsonb)) e
      join forense.contribuyentes t
        on t.corrida_id = ref.corrida_id and t.rfc = e->>'rfc'   -- regla 10
     where (e->>'rfc') is distinct from ref.rfc_principal
       and t.giro = ref.giro
       and array_position(o.niveles, e->>'nivel') < ref.grav_ref
  ),
  cl_sol as (
    -- INTERSECCIÓN, no unión: sólo los códigos que dispararon en LOS DOS.
    select d.rfc, array_agg(distinct p.codigo order by p.codigo) as codigos
      from cl_cand d
      join ref on true
      join forense.pistas p
        on p.corrida_id = ref.corrida_id and p.rfc = d.rfc and p.estado = 'disparada'
     where p.codigo in (select codigo from pistas_caso)
     group by d.rfc
  ),
  cl_fam as (
    select z.rfc, count(distinct ev.familia) as n_fam
      from (select d.rfc, case when y ~ '^[0-9]+$' then y::bigint end as ev_id
              from cl_cand d
              cross join lateral jsonb_array_elements_text(d.ev_ids) y) z
      join forense.evidencia ev on ev.id = z.ev_id
     group by z.rfc
  ),
  cl_def as (
    -- Pistas DE ESE RFC evaluadas por la réplica (017 indexa por ID).
    select d.rfc,
           count(*) as n_eval,
           count(*) filter (
             where ref.evaluacion_pistas->(p.id::text)->>'resultado' = 'descartada'
           ) as n_desc
      from cl_cand d
      join ref on true
      join forense.pistas p
        on p.corrida_id = ref.corrida_id and p.rfc = d.rfc
     where ref.evaluacion_pistas ? (p.id::text)
     group by d.rfc
  ),
  primario as (
    select 1 as fuente, d.rfc, d.giro, s.codigos, d.nivel, d.grav,
           case
             when not d.cobertura then 'cobertura_insuficiente'
             when coalesce(f.n_desc, 0) > 0 then 'defensa_aceptada'
             when coalesce(m.n_fam, 0) < ref.n_fam_ref then 'familia_faltante'
           end as razon,
           coalesce(f.n_desc, 0) as n_desc, coalesce(f.n_eval, 0) as n_eval,
           coalesce(m.n_fam, 0) as n_fam, ref.n_fam_ref, null::int as n_pend,
           'del mismo cluster' as origen
      from cl_cand d
      join cl_sol s on s.rfc = d.rfc
      join ref on true
      left join cl_fam m on m.rfc = d.rfc
      left join cl_def f on f.rfc = d.rfc
  ),
  -- =================================================================
  -- RESPALDO: el emparejamiento caso-a-caso de 018, sin cambios.
  -- =================================================================
  ca_cand as (
    select c.id, c.rfc_principal as rfc, c.nivel, c.cobertura_completa,
           c.evaluacion_pistas, t.giro,
           cardinality(coalesce(c.familias_confirmadas, '{}'::text[])) as n_fam,
           jsonb_array_length(coalesce(c.pendientes, '[]'::jsonb)) as n_pend,
           array_position(o.niveles, c.nivel) as grav
      from ref
      cross join orden o
      join forense.casos c
        on c.corrida_id = ref.corrida_id        -- regla 10: misma corrida
      join forense.contribuyentes t
        on t.corrida_id = c.corrida_id and t.rfc = c.rfc_principal
     where c.id <> ref.id
       and c.nivel is not null
       and c.rfc_principal is distinct from ref.rfc_principal
       and t.giro = ref.giro
       and array_position(o.niveles, c.nivel) < ref.grav_ref
  ),
  ca_sol as (
    select d.id, array_agg(distinct p.codigo order by p.codigo) as codigos
      from ca_cand d
      join ref on true
      join forense.pistas p
        on p.corrida_id = ref.corrida_id and p.rfc = d.rfc and p.estado = 'disparada'
     where p.codigo in (select codigo from pistas_caso)
     group by d.id
  ),
  respaldo as (
    select 2 as fuente, d.rfc, d.giro, s.codigos, d.nivel, d.grav,
           case
             when d.cobertura_completa is not true then 'cobertura_insuficiente'
             when (select count(*) from jsonb_each(coalesce(d.evaluacion_pistas, '{}'::jsonb)) e
                    where e.value->>'resultado' = 'descartada') > 0 then 'defensa_aceptada'
             when d.n_fam < ref.n_fam_ref then 'familia_faltante'
           end as razon,
           (select count(*) from jsonb_each(coalesce(d.evaluacion_pistas, '{}'::jsonb)) e
             where e.value->>'resultado' = 'descartada') as n_desc,
           (select count(*) from jsonb_each(coalesce(d.evaluacion_pistas, '{}'::jsonb)) e)
             as n_eval,
           d.n_fam, ref.n_fam_ref, d.n_pend,
           'de otro caso de la misma corrida' as origen
      from ca_cand d
      join ca_sol s on s.id = d.id
      join ref on true
  ),
  todo as (
    select * from primario
    union all
    select * from respaldo
  )
  select (select id from ref),
         u.rfc,
         u.giro,
         u.codigos,
         u.nivel,
         u.razon,
         -- `explicacion`: RFC, códigos de pista, conteos y niveles. Nada de
         -- `razon_social`, `descripcion` ni `referencia` (regla 6). El `left`
         -- respeta el `maxLength: 600` del contrato.
         left(format(
           '%s, %s, comparte el giro de %s y disparó las mismas pistas %s, pero %s: quedó en %s frente a %s.',
           u.rfc, u.origen, (select rfc_principal from ref),
           array_to_string(u.codigos, ', '),
           case u.razon
             when 'cobertura_insuficiente' then
               case when u.n_pend is null then 'su cobertura quedó incompleta'
                    else format('su cobertura quedó incompleta (%s %s)', u.n_pend,
                                case when u.n_pend = 1 then 'limitación abierta'
                                     else 'limitaciones abiertas' end) end
             when 'defensa_aceptada' then
               format('su defensa descartó %s de %s pistas evaluadas', u.n_desc, u.n_eval)
             else
               format('confirmó %s %s frente a %s', u.n_fam,
                      case when u.n_fam = 1 then 'familia' else 'familias' end,
                      u.n_fam_ref) end,
           u.nivel, (select nivel_ref from ref)), 600)
    from todo u
   where u.razon is not null
   -- El cluster manda; el respaldo sólo entra si el cluster no dio nada.
   -- Dentro de cada fuente: más pistas en común, luego el más exonerado, y
   -- el RFC como desempate para que la fila sea estable.
   order by u.fuente asc, cardinality(u.codigos) desc, u.grav asc, u.rfc asc
   limit 1
$$;

comment on function forense.v_contraste_caso(uuid) is
  'Panel Contraste (21 §2). Comparable PRIMARIO: un RFC del mismo cluster con su nivel en casos.resultado_por_rfc (020), mismo giro, al menos una pista en común y nivel estrictamente menos grave que el del rfc_principal. RESPALDO: el emparejamiento caso-a-caso de 018. Razón tipificada cobertura_insuficiente > defensa_aceptada > familia_faltante, en el orden de decisión de auditor-final.mjs. Cero filas si ninguno de los dos caminos da comparable. Sin LLM y sin texto del contribuyente.';

-- ---------------------------------------------------------------------
-- Permisos: los mismos de 018 (y de `v_trayectoria_rfc`, 002 §9).
-- `create or replace` los conserva; se reafirman para una base que ya
-- tenía 018 aplicada.
-- ---------------------------------------------------------------------

revoke execute on function forense.v_contraste_caso(uuid) from public;

do $$
declare rol text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.v_contraste_caso(uuid) to service_role';
  end if;
  foreach rol in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = rol) then
      execute format('grant execute on function forense.v_contraste_caso(uuid) to %I', rol);
    end if;
  end loop;
end $$;

-- Fin 020_contraste_cluster.sql
