-- =====================================================================
-- 012_inyeccion_clusters.sql — QA-004 (decisión H9 07:32) + hallazgo alto
-- de db sobre el cierre de corrida.
--
-- Problema (QA-004, criterio del juez): tras clonar la corrida con una
-- inyección, `armar_clusters` sólo admite candidatos que cruzan el
-- selector de DOS FAMILIAS. Un RFC recién inyectado puede no cruzarlo
-- todavía (llegó con una sola familia de señales, o con ninguna pista
-- disparada) y entonces la inyección "entra" a la corrida pero NO se
-- investiga: el juez sube un carrusel y el sistema no lo mira.
--
-- Decisión tomada: NO se baja el umbral del selector (eso rompería la
-- regla de dos familias para todo el dataset y dispararía los falsos
-- positivos). En su lugar se garantiza un cluster por RFC inyectado que
-- no quedó cubierto, por la RUTA MANUAL que ya existe en 004
-- (`forense.armar_cluster_para`, docs/06 §Selección: la investigación
-- manual por RFC permite revisar un caso de una sola familia). El
-- dictamen NO se relaja: el cluster existe, el selector sigue sin
-- marcarlo y el nivel lo decide igual el código determinista de 005/010.
--
-- Aditiva sobre 001–011: no altera tablas ni firmas salvo
-- `estado_corrida`, que gana una columna al final (§3).
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 1. asegurar_clusters_inyectados — un cluster por RFC afectado
--
-- "Sin cluster" es PERTENENCIA, no semilla: un RFC que ya vive dentro
-- del array `rfcs` de otro cluster está cubierto aunque no sea su
-- semilla. Es el mismo predicado que usa `forense.clusters_afectados`
-- (008), así que "afectado" y "cubierto" no pueden discrepar.
--
-- Sólo se escribe el evento `inyeccion`/`cluster_garantizado` cuando el
-- cluster existe de verdad: un evento de bitácora para un cluster que no
-- se creó es la regla 2 rota al revés.
-- ---------------------------------------------------------------------

create or replace function forense.asegurar_clusters_inyectados(
  p_corrida uuid, p_inyeccion uuid)
returns table(cluster_id uuid, rfc text, creado boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare y record; r text; v_id uuid; v_existe uuid; v_nuevos int := 0;
begin
  select * into y from forense.inyecciones i where i.id = p_inyeccion;
  if not found then
    raise exception 'inyección % no existe', p_inyeccion using errcode = '22023';
  end if;
  if not exists (select 1 from forense.corridas c where c.id = p_corrida) then
    raise exception 'corrida % no existe', p_corrida using errcode = '22023';
  end if;
  -- Regla 10: los clusters garantizados van en la corrida NUEVA. La corrida
  -- base es el snapshot de otra corrida y no se toca jamás.
  if p_corrida = y.corrida_base_id then
    raise exception 'la corrida % es la base de la inyección %: no se le agregan clusters',
      p_corrida, p_inyeccion using errcode = '22023';
  end if;
  if y.corrida_nueva_id is not null and p_corrida <> y.corrida_nueva_id then
    raise exception 'la corrida % no es la corrida nueva (%) de la inyección %',
      p_corrida, y.corrida_nueva_id, p_inyeccion using errcode = '22023';
  end if;

  for r in select distinct x from unnest(coalesce(y.rfcs_afectados, '{}'::text[])) x
            order by 1 loop
    v_existe := null;
    select c.id into v_existe from forense.clusters c
     where c.corrida_id = p_corrida and r = any(coalesce(c.rfcs, '{}'::text[]))
     order by c.creado, c.id limit 1;

    if v_existe is not null then
      cluster_id := v_existe; rfc := r; creado := false;
      return next; continue;
    end if;

    -- Ruta manual de 004. Devuelve null si la corrida no tiene fecha_corte
    -- o si el RFC no está en el padrón de ESA corrida (p. ej. el clon no
    -- terminó): en ese caso no hay cluster y no hay evento.
    v_id := forense.armar_cluster_para(p_corrida, r);
    if v_id is null then
      cluster_id := null; rfc := r; creado := false;
      return next; continue;
    end if;

    v_nuevos := v_nuevos + 1;
    perform forense.log_corrida(p_corrida, 'sistema', 'inyeccion',
      jsonb_build_object('evento_real', 'cluster_garantizado',
                         'inyeccion_id', p_inyeccion, 'cluster_id', v_id,
                         'rfc', r, 'ruta', 'manual',
                         'motivo', 'rfc inyectado sin cluster del selector de dos familias'));
    cluster_id := v_id; rfc := r; creado := true;
    return next;
  end loop;

  if v_nuevos > 0 then
    perform forense.log_corrida(p_corrida, 'sistema', 'inyeccion',
      jsonb_build_object('evento_real', 'clusters_garantizados',
                         'inyeccion_id', p_inyeccion, 'nuevos', v_nuevos));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. clusters_por_prioridad_inyeccion — los garantizados PRIMERO
--
-- Mismas seis columnas que 010 (el nodo hace `SELECT *`; cambiar la forma
-- rompería el workflow). Lo único que cambia:
--   a) antes de ordenar se asegura el cluster de cada RFC inyectado, de
--      modo que el nodo FORENSE_inyectar hereda la garantía sin recablear;
--   b) el orden pone primero los clusters garantizados para esta
--      inyección, después los afectados, después el resto por score.
-- El flag "garantizado" se lee de la BITÁCORA, no de una columna nueva:
-- lo que ordena la cola es auditable con el mismo rastro que lo creó.
-- ---------------------------------------------------------------------

create or replace function forense.clusters_por_prioridad_inyeccion(
  p_corrida uuid, p_inyeccion uuid)
returns table(cluster_id uuid, corrida_id uuid, inyeccion_id uuid,
              investigacion_id uuid, afectado boolean, score numeric)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_inv uuid; v_afect int; v_total int; v_gar int; y record;
begin
  select * into y from forense.inyecciones i where i.id = p_inyeccion;
  if found and p_corrida <> y.corrida_base_id
     and (y.corrida_nueva_id is null or y.corrida_nueva_id = p_corrida) then
    perform 1 from forense.asegurar_clusters_inyectados(p_corrida, p_inyeccion);
  end if;

  select i.id into v_inv from forense.investigaciones i where i.corrida_id = p_corrida
   order by i.creado limit 1;

  create temporary table if not exists tmp_prio_iny2 (
    cluster_id uuid, afectado boolean, garantizado boolean, score numeric) on commit drop;
  delete from tmp_prio_iny2;

  insert into tmp_prio_iny2 (cluster_id, afectado, garantizado, score)
  select c.id,
         exists (select 1 from forense.clusters_afectados(p_inyeccion) a
                  where a.cluster_id = c.id),
         exists (select 1 from forense.bitacora b
                  where b.corrida_id = p_corrida
                    and b.tipo_evento = 'inyeccion'
                    and b.payload->>'evento_real' = 'cluster_garantizado'
                    and b.payload->>'inyeccion_id' = p_inyeccion::text
                    and b.payload->>'cluster_id' = c.id::text),
         c.score
    from forense.clusters c
   where c.corrida_id = p_corrida;

  select count(*) filter (where afectado), count(*) filter (where garantizado), count(*)
    into v_afect, v_gar, v_total from tmp_prio_iny2;

  perform forense.log_corrida(p_corrida, 'sistema', 'inyeccion',
    jsonb_build_object('evento_real', 'clusters_afectados', 'inyeccion_id', p_inyeccion,
                       'afectados', v_afect, 'total', v_total,
                       'garantizados', v_gar));

  return query select t.cluster_id, p_corrida, p_inyeccion, v_inv, t.afectado, t.score
    from tmp_prio_iny2 t
   order by t.garantizado desc, t.afectado desc, t.score desc nulls last, t.cluster_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. estado_corrida — la cola de CLUSTERS también cuenta
--
-- Hallazgo alto: `estado_corrida` sólo miraba `forense.casos`. Un cluster
-- que nunca se despachó (el garantizado de §1 es justo ese caso: nace
-- después de que la corrida empezó a despachar) no tiene caso, así que la
-- corrida se declaraba `completada` con trabajo sin empezar. Ahora:
--   * `cola_restante` = clusters `pendiente` que todavía no tienen caso;
--   * `terminada` exige cola de casos Y cola de clusters en cero.
-- Se cuenta "pendiente sin caso" y no sólo `estado='pendiente'` porque el
-- estado del cluster no pasa a `ronda1` hasta que el caso arranca la ronda
-- 1 (005 §preparar contexto): contar el estado a secas dejaría la cola sin
-- drenar entre el despacho y la primera ronda.
--
-- Añade una columna AL FINAL: `SELECT *` del nodo FORENSE_corrida y el
-- `to_jsonb(t)` de QA siguen funcionando. `create or replace` no puede
-- cambiar el tipo de retorno, por eso el drop explícito (y el grant, que
-- el bloque de 010 ya no vuelve a ejecutar).
-- ---------------------------------------------------------------------

drop function if exists forense.estado_corrida(uuid);

create or replace function forense.estado_corrida(p_corrida uuid)
returns table(corrida_id uuid, terminada boolean, estado_final text,
              completados int, en_cola int, errores int, cola_restante int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare c record; v_comp int; v_cola int; v_err int; v_total int; v_clu int;
begin
  select * into c from forense.corridas k where k.id = p_corrida;
  if not found then
    raise exception 'corrida % no existe', p_corrida using errcode = '22023';
  end if;

  select count(*) filter (where k.estado in ('dictaminado','parcial','cerrado')),
         count(*) filter (where k.estado not in ('dictaminado','parcial','cerrado','error')),
         count(*) filter (where k.estado = 'error'),
         count(*)
    into v_comp, v_cola, v_err, v_total
    from forense.casos k where k.corrida_id = p_corrida;

  select count(*)::int into v_clu
    from forense.clusters cl
   where cl.corrida_id = p_corrida
     and cl.estado = 'pendiente'
     and not exists (select 1 from forense.casos k where k.cluster_id = cl.id);

  return query select p_corrida,
    ((v_total > 0 and v_cola = 0 and v_clu = 0) or c.estado in ('completada','error')),
    case when c.estado in ('completada','error') then c.estado
         when v_total = 0 and v_clu = 0 then 'sin_clusters'
         when v_cola > 0 or v_clu > 0 then 'en_curso'
         when v_err > 0 and v_comp = 0 then 'error'
         else 'completada' end,
    v_comp, v_cola, v_err, v_clu;
end $$;

-- ---------------------------------------------------------------------
-- 4. Permisos. Nada de esto lo llama el LLM ni el frontend anónimo.
-- ---------------------------------------------------------------------

revoke execute on function
  forense.asegurar_clusters_inyectados(uuid, uuid),
  forense.clusters_por_prioridad_inyeccion(uuid, uuid),
  forense.estado_corrida(uuid)
from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.asegurar_clusters_inyectados(uuid, uuid) to service_role';
    execute 'grant execute on function forense.clusters_por_prioridad_inyeccion(uuid, uuid) to service_role';
    execute 'grant execute on function forense.estado_corrida(uuid) to service_role';
  end if;
end $$;

-- Fin 012_inyeccion_clusters.sql
