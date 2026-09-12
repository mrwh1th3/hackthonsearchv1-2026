-- =====================================================================
-- 018_contraste.sql — `forense.v_contraste_caso`: la respuesta a la
-- pregunta literal del juez principal, "¿por qué esta sí y aquella no?"
-- (21 §2, fila "Por qué esta sí y aquella no": «Panel "Contraste" en cada
-- caso dictaminado: el RFC comparable más cercano (mismo giro, pistas
-- solapadas) con resultado distinto y la razón tipificada. Vista SQL
-- `forense.v_contraste_caso`; sin LLM»).
--
-- El panel de la UI ya estaba construido y probado contra fixture, pero
-- contra datos reales devolvía null porque la vista NO EXISTÍA:
-- `web/lib/data/supabase.ts:648` lo dice con todas las letras y se niega a
-- derivar el contraste en la webapp porque eso violaría la regla 4. Esta
-- migración crea la vista; la webapp sólo tiene que llamarla.
--
-- FORMA. `returns table(...)` con las siete columnas del contrato
-- `product.contraste` (contracts 1.4.0) y del tipo `ContrasteCaso`
-- (`web/lib/data/types.ts:438`), en ese orden y con esos nombres. No
-- devuelve jsonb como sus hermanas `v_grafo` / `v_trayectoria_rfc` por una
-- razón de contrato: "cero filas cuando no hay comparable" (el contrato lo
-- exige y la UI trata la ausencia como "no hay contraste"), y una función
-- que devuelve jsonb no puede devolver cero filas sin inventar un
-- envoltorio `{"error": ...}`. Tampoco se imita ese envoltorio de error de
-- 002: un caso inexistente, sin dictamen o sin comparable es CERO FILAS,
-- nunca una fila de relleno.
--
-- PERMISOS. Se copia el patrón de la hermana que la webapp ya lee,
-- `forense.v_trayectoria_rfc` (`db/002_views.sql:804` y grants en
-- `db/002_views.sql:1183-1190`): `stable`, `security invoker`,
-- `set search_path = ''`, ejecutable por `anon`, `authenticated` y
-- `service_role`. `security invoker` alcanza porque las tres tablas que se
-- leen —`casos`, `pistas`, `contribuyentes`— están en el arreglo `publicas`
-- de `db/001_schema.sql:604-655`, con `policy lectura ... using (true)` y
-- `grant select` a esos roles. El `revoke` es puntual sobre esta función
-- (estilo 016/017) y no un `revoke ... on all functions in schema forense`:
-- 018 no debe tocar los privilegios de funciones que no crea.
--
-- QUIÉN ES EL COMPARABLE (y por qué no es simplemente "otro nivel"):
--   1. Misma corrida. Regla 10: un comparable de otra corrida mezclaría
--      datos de corridas distintas.
--   2. Mismo giro, no vacío. Es el eje de comparabilidad que pide 21 §2 y
--      `giro_compartido` es obligatorio en el contrato (`minLength: 1`).
--      `giro` es campo de catálogo (`forense.catalogo_giro_claves`), no
--      texto libre del contribuyente.
--   3. Nivel ESTRICTAMENTE MENOS GRAVE que el del caso, en el orden
--      sin_hallazgos < anomalia_explicada < no_concluyente < presuncion <
--      presuncion_alta (el mismo arreglo `NIVELES` de
--      `n8n/runtime/auditor-final.mjs:15`). El contrato dice "resultado
--      distinto", pero su enum de `razon_tipificada` sólo tipifica por qué
--      el comparable quedó EXONERADO: los tres valores describen al vecino
--      que cayó por debajo. Con un comparable MÁS grave ninguna de las tres
--      razones encaja y la fila sería una etiqueta falsa. "Distinto" se
--      estrecha a "menos grave"; es un subconjunto, así que no rompe el
--      contrato. Si el caso ya es el menos grave de su corrida: cero filas.
--   4. Al menos una pista en común. El contrato declara `pistas_solapadas`
--      con `minItems: 1`: una intersección vacía violaría el contrato y
--      además no sería un "comparable más cercano" de nada.
--   5. Con razón tipificable. Si ninguno de los tres criterios aplica, no
--      hay fila: inventar una razón para poder pintar el panel es
--      exactamente lo que prohíbe la regla 4.
--
-- RAZÓN TIPIFICADA — PRECEDENCIA. Cuando aplican varias, se devuelve la que
-- CAUSÓ el nivel del comparable según el dictaminador determinista
-- (`n8n/runtime/auditor-final.mjs:50-55`), que decide en este orden:
--     if (!completo) -> no_concluyente                  (a)
--     else if (todasDescartadas) -> anomalia_explicada  (b)
--     else ... familias.size >= 2 / >= 3                (c)
-- De ahí: `cobertura_insuficiente` > `defensa_aceptada` > `familia_faltante`.
-- Con la cobertura en false el nivel está forzado y no lo deciden ni la
-- defensa ni las familias; por eso va primero.
--
-- COSTURA CONOCIDA (declarada, no resuelta aquí): `pistas_solapadas` se
-- calcula por RFC principal de cada caso, mientras que
-- `familias_confirmadas` —que alimenta `familia_faltante`— es de ámbito
-- CLUSTER (`paquete_auditor_final` lee `p.rfc = any(cl.rfcs)`). Las dos
-- granularidades conviven a propósito: `rfc_comparable` es un RFC y el giro
-- también es del RFC, así que el solape se mide al mismo nivel que el eje
-- de comparación.
--
-- REGLA 6. Ninguna columna de salida lleva texto escrito por el
-- contribuyente: ni `razon_social`, ni `descripcion`, ni `referencia`, ni
-- el `detalle->>'resumen'` de la pista. `explicacion` se arma con RFC,
-- códigos de pista, conteos y niveles. Por eso ninguna columna necesita el
-- sufijo `_untrusted`.
--
-- ADITIVA E IDEMPOTENTE: sólo crea una función nueva con `create or
-- replace` y reafirma sus permisos en bloques `do`. No toca tablas, ni
-- firmas existentes, ni catálogos `check`.
-- =====================================================================

set search_path = '';

create or replace function forense.v_contraste_caso(p_caso uuid)
returns table(caso_id uuid, rfc_comparable text, giro_compartido text,
              pistas_solapadas text[], resultado_comparable text,
              razon_tipificada text, explicacion text)
language sql stable security invoker set search_path = '' as $$
  with orden as (
    -- Gravedad: mismo arreglo que n8n/runtime/auditor-final.mjs:15. El
    -- máximo del sistema es `presuncion_alta` (regla 7).
    select array['sin_hallazgos','anomalia_explicada','no_concluyente',
                 'presuncion','presuncion_alta']::text[] as niveles
  ),
  k as (
    -- El caso consultado. `nivel is not null` = ya dictaminado: sólo
    -- `guardar_dictamen` escribe esa columna. Sin giro no hay eje de
    -- comparación, así que tampoco hay contraste.
    select c.id, c.corrida_id, c.rfc_principal, c.nivel,
           cardinality(coalesce(c.familias_confirmadas, '{}'::text[])) as n_fam,
           t.giro, array_position(o.niveles, c.nivel) as grav
      from forense.casos c
      cross join orden o
      join forense.contribuyentes t
        on t.corrida_id = c.corrida_id and t.rfc = c.rfc_principal
     where c.id = p_caso
       and c.nivel is not null
       and t.giro is not null and t.giro <> ''
  ),
  pistas_caso as (
    select distinct p.codigo
      from k, forense.pistas p
     where p.corrida_id = k.corrida_id
       and p.rfc = k.rfc_principal
       and p.estado = 'disparada'
       and p.codigo is not null
  ),
  cand as (
    select c.id, c.rfc_principal as rfc, c.nivel, c.cobertura_completa,
           c.evaluacion_pistas, t.giro,
           cardinality(coalesce(c.familias_confirmadas, '{}'::text[])) as n_fam,
           jsonb_array_length(coalesce(c.pendientes, '[]'::jsonb)) as n_pend,
           array_position(o.niveles, c.nivel) as grav
      from k
      cross join orden o
      join forense.casos c
        on c.corrida_id = k.corrida_id        -- regla 10: misma corrida
      join forense.contribuyentes t
        on t.corrida_id = c.corrida_id and t.rfc = c.rfc_principal
     where c.id <> k.id
       and c.nivel is not null
       and c.rfc_principal is distinct from k.rfc_principal
       and t.giro = k.giro
       and array_position(o.niveles, c.nivel) < k.grav
  ),
  solape as (
    -- INTERSECCIÓN, no unión: sólo los códigos que dispararon en LOS DOS.
    select d.id, array_agg(distinct p.codigo order by p.codigo) as codigos
      from cand d
      join k on true
      join forense.pistas p
        on p.corrida_id = k.corrida_id
       and p.rfc = d.rfc
       and p.estado = 'disparada'
     where p.codigo in (select codigo from pistas_caso)
     group by d.id
  ),
  tip as (
    select d.*, s.codigos,
           (select count(*) from jsonb_each(coalesce(d.evaluacion_pistas, '{}'::jsonb)) e)
             as n_eval,
           (select count(*) from jsonb_each(coalesce(d.evaluacion_pistas, '{}'::jsonb)) e
             where e.value->>'resultado' = 'descartada') as n_desc
      from cand d
      join solape s on s.id = d.id
  ),
  razonado as (
    select t.*,
           case
             -- (a) cobertura primero: con ella en false el dictaminador
             -- devuelve no_concluyente y ni la defensa ni las familias
             -- deciden nada (auditor-final.mjs:50).
             when t.cobertura_completa is not true then 'cobertura_insuficiente'
             -- (b) defensa: `aplicar_resolucion_replica` escribe
             -- `casos.evaluacion_pistas` indexado por ID de pista (017).
             when t.n_desc > 0 then 'defensa_aceptada'
             -- (c) familias confirmadas del dictamen.
             when t.n_fam < (select n_fam from k) then 'familia_faltante'
           end as razon
      from tip t
  )
  select (select id from k),
         r.rfc,
         r.giro,
         r.codigos,
         r.nivel,
         r.razon,
         -- `explicacion`: derivada de datos (reglas 4 y 6). El `left`
         -- respeta el `maxLength: 600` del contrato; con 14 códigos y un
         -- RFC de 160 caracteres la frase queda muy por debajo.
         left(case r.razon
           when 'cobertura_insuficiente' then
             format('%s comparte el giro del caso y disparó las mismas pistas %s, pero su cobertura quedó incompleta (%s %s): cerró en %s frente a %s del caso.',
                    r.rfc, array_to_string(r.codigos, ', '), r.n_pend,
                    case when r.n_pend = 1 then 'limitación abierta'
                         else 'limitaciones abiertas' end,
                    r.nivel, (select nivel from k))
           when 'defensa_aceptada' then
             format('%s comparte el giro del caso y disparó las mismas pistas %s, pero su defensa descartó %s de %s pistas evaluadas: cerró en %s frente a %s del caso.',
                    r.rfc, array_to_string(r.codigos, ', '), r.n_desc, r.n_eval,
                    r.nivel, (select nivel from k))
           else
             format('%s comparte el giro del caso y disparó las mismas pistas %s, pero confirmó %s %s frente a %s del caso: cerró en %s frente a %s del caso.',
                    r.rfc, array_to_string(r.codigos, ', '), r.n_fam,
                    case when r.n_fam = 1 then 'familia' else 'familias' end,
                    (select n_fam from k), r.nivel, (select nivel from k))
         end, 600)
    from razonado r
   where r.razon is not null
   -- "El comparable más cercano": primero el que comparte más pistas;
   -- a igualdad, el más exonerado (menor gravedad), y el RFC como
   -- desempate para que la fila sea estable entre consultas.
   order by cardinality(r.codigos) desc, r.grav asc, r.rfc asc
   limit 1
$$;

comment on function forense.v_contraste_caso(uuid) is
  'Panel Contraste (21 §2): el RFC comparable más cercano de la MISMA corrida, mismo giro, con al menos una pista en común y nivel estrictamente menos grave, más la razón tipificada de su exoneración (cobertura_insuficiente > defensa_aceptada > familia_faltante, en el orden de decisión de auditor-final.mjs). Cero filas si no hay comparable. Sin LLM y sin texto del contribuyente.';

-- ---------------------------------------------------------------------
-- Permisos: los de `v_trayectoria_rfc` (002 §9), revocados en puntual
-- sobre esta función (estilo 016/017) para no alterar privilegios ajenos.
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

-- Fin 018_contraste.sql
