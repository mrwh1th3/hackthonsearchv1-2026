-- =====================================================================
-- db/010_runtime_funciones.sql — Las funciones que los workflows de n8n
-- llaman y que 001–009 no exponían (17 §4, 07 nodo por nodo).
--
-- ADITIVA. 001–009 ya están aplicadas al proyecto remoto: aquí no se
-- edita ninguna de ellas. Solo `create or replace function`, sobrecargas
-- nuevas y `alter table ... add column if not exists`. Reaplicable.
--
-- Contrato: cada nodo Postgres hace `SELECT * FROM forense.f(...)`, así
-- que TODAS devuelven `returns table(...)` con los nombres EXACTOS que
-- declara `CONTRATOS_NODOS` en n8n/runtime/generar-workflows.mjs. Una
-- función que devolviera jsonb daría UNA columna y rompería el nodo.
--
-- Invariantes que se respetan en todas (CLAUDE.md):
--   2. Lo que muta deja evento en forense.bitacora (o actividad_producto
--      para lo que es de producto y no tiene corrida).
--   4. El LLM no calcula ni decide el nivel: el dictamen es determinista.
--   7. `presuncion_alta` es el nivel máximo; «final» nunca es un nivel.
--   10. Todo se filtra por corrida_id; ninguna lee forense.ground_truth.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Columnas aditivas que el runtime necesita
--    `corridas.idempotency_key`: FORENSE_corrida reusa la corrida `lista`
--    con la misma clave en vez de crear otra (regla 10: corridas aisladas
--    pero una reentrega del webhook no duplica el snapshot).
-- ---------------------------------------------------------------------

alter table forense.corridas add column if not exists idempotency_key text;
create unique index if not exists ux_corridas_idempotency
  on forense.corridas (idempotency_key);

-- Rastro de corrida sin caso: `forense.log` exige corrida_id (NOT NULL en
-- bitacora) y acepta caso nulo. Este helper centraliza el patrón y evita
-- repetir doce argumentos posicionales.
create or replace function forense.log_corrida(
  p_corrida uuid, p_agente text, p_tipo text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_corrida is null then return; end if;
  perform forense.log(null, p_agente, p_tipo, p_payload,
                      null, null, null, null, null, null, null, p_corrida);
end $$;

-- =====================================================================
-- 1. FORENSE_corrida
-- =====================================================================

-- 'Validar e idempotencia'. `dataset` es un ORIGEN AUTORIZADO (un nombre
-- de catálogo), nunca una URL: se valida contra un patrón cerrado y
-- contra los datasets que ya existen en la base. Reutiliza la corrida con
-- la misma idempotency_key en vez de clonar dos veces el snapshot.
create or replace function forense.abrir_corrida(
  p_dataset text, p_idempotency text, p_corrida_origen uuid default null)
returns table(corrida_id uuid, estado text, idempotency_key text,
              corrida_origen_id uuid, investigacion_id uuid, dataset text,
              reutilizada boolean)
language plpgsql security definer set search_path = '' as $$
declare v record; v_id uuid; v_inv uuid; v_origen record; v_nombre text;
begin
  if p_idempotency is null or length(p_idempotency) = 0 then
    raise exception 'abrir_corrida exige idempotency_key' using errcode = '22023';
  end if;

  select * into v from forense.corridas c where c.idempotency_key = p_idempotency;
  if found then
    select i.id into v_inv from forense.investigaciones i
     where i.corrida_id = v.id order by i.creado limit 1;
    return query select v.id, v.estado, v.idempotency_key, v.corrida_origen_id,
                        v_inv, v.dataset, true;
    return;
  end if;

  -- Origen autorizado: nombre de catálogo, jamás una URL ni una ruta.
  if p_corrida_origen is null
     and (p_dataset is null or p_dataset !~ '^[a-z0-9][a-z0-9._-]{0,63}$') then
    raise exception 'dataset % no es un origen autorizado', left(coalesce(p_dataset, '(nulo)'), 80)
      using errcode = '22023';
  end if;

  if p_corrida_origen is not null then
    select * into v_origen from forense.corridas c where c.id = p_corrida_origen;
    if not found then
      raise exception 'corrida origen % no existe', p_corrida_origen using errcode = '22023';
    end if;
  end if;

  v_nombre := coalesce(p_dataset, v_origen.dataset, 'corrida') || ':' || left(p_idempotency, 24);

  insert into forense.corridas (
    nombre, dataset, dataset_hash, fecha_corte, corrida_origen_id, estado,
    version_prompts, version_reglas, modo, familias_evaluables,
    idempotency_key, notas)
  values (
    v_nombre,
    coalesce(p_dataset, v_origen.dataset),
    v_origen.dataset_hash, v_origen.fecha_corte, p_corrida_origen, 'preparando',
    coalesce(v_origen.version_prompts, 'prompts-1'),
    coalesce(v_origen.version_reglas, 'pistas-1'),
    coalesce(v_origen.modo, 'completo'),
    coalesce(v_origen.familias_evaluables, '{D,F,R,T,E}'::text[]),
    p_idempotency,
    case when p_corrida_origen is null then 'origen ' || p_dataset
         else 'clon de ' || p_corrida_origen::text end)
  returning id into v_id;

  perform forense.log_corrida(v_id, 'sistema', 'corrida_cargada',
    jsonb_build_object('evento_real', 'corrida_abierta', 'dataset', p_dataset,
                       'corrida_origen_id', p_corrida_origen,
                       'idempotency_key', p_idempotency));

  select i.id into v_inv from forense.investigaciones i
   where i.idempotency_key = p_idempotency limit 1;

  return query select v_id, 'preparando'::text, p_idempotency, p_corrida_origen,
                      v_inv, coalesce(p_dataset, v_origen.dataset), false;
end $$;

-- 'Cargar o clonar snapshot'. Con origen copia el dominio COMPLETO de la
-- corrida origen; sin origen cuenta lo que ya cargó el loader. Nunca
-- mezcla dos corridas (regla 10). ground_truth se copia porque pertenece
-- al snapshot, pero ninguna función de investigación lo lee.
create or replace function forense.cargar_o_clonar_snapshot(
  p_corrida uuid, p_origen uuid default null)
returns table(corrida_id uuid, estado text, filas_por_tabla jsonb,
              corrida_origen_id uuid)
language plpgsql security definer set search_path = '' as $$
declare c record; v_filas jsonb := '{}'::jsonb; n int; v_origen uuid;
begin
  select * into c from forense.corridas k where k.id = p_corrida for update;
  if not found then
    raise exception 'corrida % no existe', p_corrida using errcode = '22023';
  end if;
  v_origen := coalesce(p_origen, c.corrida_origen_id);

  if v_origen is not null
     and not exists (select 1 from forense.cfdi f where f.corrida_id = p_corrida) then
    insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta,
      domicilio, cp, representante, email, telefono, empleados_declarados, corrida_id)
    select rfc, razon_social, giro, tipo_persona, fecha_alta, domicilio, cp,
           representante, email, telefono, empleados_declarados, p_corrida
      from forense.contribuyentes where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('contribuyentes', n);

    insert into forense.cuentas (clabe, rfc_titular, banco, tipo, moneda,
                                 saldo_inicial, fecha_saldo_inicial, corrida_id)
    select clabe, rfc_titular, banco, tipo, moneda, saldo_inicial, fecha_saldo_inicial, p_corrida
      from forense.cuentas where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('cuentas', n);

    insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
      moneda, metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion, cancelado,
      fecha_cancelacion, motivo_cancelacion, uuid_sustituye, corrida_id)
    select uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total, moneda,
           metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion, cancelado,
           fecha_cancelacion, motivo_cancelacion, uuid_sustituye, p_corrida
      from forense.cfdi where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('cfdi', n);

    insert into forense.complementos_pago (uuid_pago, uuid_cfdi, fecha, monto, corrida_id)
    select uuid_pago, uuid_cfdi, fecha, monto, p_corrida
      from forense.complementos_pago where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('complementos_pago', n);

    insert into forense.movimientos (id, cuenta_origen, cuenta_destino, fecha, monto,
                                     moneda, tipo, referencia, corrida_id)
    select id, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, referencia, p_corrida
      from forense.movimientos where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('movimientos', n);

    insert into forense.atributos_entidad (rfc, atributo, valor, fuente, corrida_id)
    select rfc, atributo, valor, fuente, p_corrida
      from forense.atributos_entidad where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('atributos_entidad', n);

    insert into forense.listas_sat (rfc, lista, estatus, fecha_publicacion, oficio,
                                    razon_social, corrida_id)
    select rfc, lista, estatus, fecha_publicacion, oficio, razon_social, p_corrida
      from forense.listas_sat where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('listas_sat', n);

    insert into forense.ground_truth (rfc, corrida_id, es_fraude, tipologia,
                                      es_trampa_legitima, nota)
    select rfc, p_corrida, es_fraude, tipologia, es_trampa_legitima, nota
      from forense.ground_truth where corrida_id = v_origen;
    get diagnostics n = row_count; v_filas := v_filas || jsonb_build_object('ground_truth', n);

    update forense.corridas
       set dataset_hash = coalesce(dataset_hash, (select dataset_hash from forense.corridas
                                                   where id = v_origen)),
           fecha_corte = coalesce(fecha_corte, (select fecha_corte from forense.corridas
                                                  where id = v_origen)),
           corrida_origen_id = v_origen
     where id = p_corrida;
  else
    -- Snapshot ya cargado por el loader: se cuenta, no se duplica.
    v_filas := (
      select jsonb_object_agg(t.tabla, t.n) from (
        select 'contribuyentes' tabla, count(*) n from forense.contribuyentes where corrida_id = p_corrida
        union all select 'cuentas', count(*) from forense.cuentas where corrida_id = p_corrida
        union all select 'cfdi', count(*) from forense.cfdi where corrida_id = p_corrida
        union all select 'complementos_pago', count(*) from forense.complementos_pago where corrida_id = p_corrida
        union all select 'movimientos', count(*) from forense.movimientos where corrida_id = p_corrida
        union all select 'atributos_entidad', count(*) from forense.atributos_entidad where corrida_id = p_corrida
        union all select 'listas_sat', count(*) from forense.listas_sat where corrida_id = p_corrida
      ) t);
  end if;

  perform forense.log_corrida(p_corrida, 'sistema', 'corrida_cargada',
    jsonb_build_object('evento_real', 'snapshot_cargado', 'origen', v_origen,
                       'filas_por_tabla', v_filas));

  return query select p_corrida, c.estado, coalesce(v_filas, '{}'::jsonb), v_origen;
end $$;

-- 'Verificar integridad'. Una corrida vacía NO se investiga: pasa a
-- `error` con causa. Calcula dataset_hash y fecha_corte deterministas y
-- degrada familias_evaluables a lo que el dataset soporta (una familia
-- sin datos es `no_evaluable`, nunca «sin hallazgos»).
create or replace function forense.verificar_integridad_corrida(p_corrida uuid)
returns table(corrida_id uuid, estado text, dataset_hash text,
              fecha_corte timestamptz, familias_evaluables text[], causa text)
language plpgsql security definer set search_path = '' as $$
declare
  c record; n_cfdi bigint; n_mov bigint; n_contrib bigint; n_cuentas bigint;
  n_listas bigint; n_atr bigint; n_cat bigint; n_hora bigint;
  v_hash text; v_corte timestamptz; v_fam text[] := '{}'; v_causa text; v_estado text;
begin
  select * into c from forense.corridas k where k.id = p_corrida for update;
  if not found then
    raise exception 'corrida % no existe', p_corrida using errcode = '22023';
  end if;

  select count(*) into n_cfdi from forense.cfdi where corrida_id = p_corrida;
  select count(*) into n_mov from forense.movimientos where corrida_id = p_corrida;
  select count(*) into n_contrib from forense.contribuyentes where corrida_id = p_corrida;
  select count(*) into n_cuentas from forense.cuentas where corrida_id = p_corrida;
  select count(*) into n_listas from forense.listas_sat where corrida_id = p_corrida;
  select count(*) into n_atr from forense.atributos_entidad where corrida_id = p_corrida;
  select count(*) into n_cat from forense.catalogo_giro_claves
   where version_reglas = c.version_reglas;
  select count(*) into n_hora from forense.cfdi
   where corrida_id = p_corrida and extract(hour from fecha) <> 0;

  -- Familias evaluables por datos presentes (02 §familias, 003 §no_evaluable).
  if n_cfdi > 0 and n_contrib > 0 and n_cat > 0 then v_fam := v_fam || 'D'; end if;
  if n_mov > 0 and n_cuentas > 0 then v_fam := v_fam || 'F'; end if;
  if n_cfdi > 0 and n_contrib > 0 then v_fam := v_fam || 'R'; end if;
  if n_cfdi > 0 and n_hora > 0 then v_fam := v_fam || 'T'; end if;
  if n_listas > 0 or n_atr > 0 then v_fam := v_fam || 'E'; end if;

  select max(f.fecha) into v_corte from (
    select fecha from forense.cfdi where corrida_id = p_corrida
    union all select fecha from forense.movimientos where corrida_id = p_corrida) f;

  v_hash := encode(sha256(convert_to(
    coalesce(c.dataset, '') || '|' || n_contrib || '|' || n_cuentas || '|' || n_cfdi || '|' ||
    n_mov || '|' || n_listas || '|' || n_atr || '|' || coalesce(v_corte::text, ''), 'utf8')), 'hex');

  if n_cfdi = 0 and n_mov = 0 then
    v_causa := 'la corrida no tiene CFDI ni movimientos: no hay nada que investigar';
  elsif n_contrib = 0 then
    v_causa := 'la corrida no tiene padrón de contribuyentes';
  elsif cardinality(v_fam) < 2 then
    v_causa := 'menos de dos familias evaluables: el selector de dos familias no puede aplicarse';
  end if;
  v_estado := case when v_causa is null then 'lista' else 'error' end;

  update forense.corridas
     set estado = v_estado, dataset_hash = v_hash, fecha_corte = v_corte,
         familias_evaluables = v_fam,
         inicio = coalesce(inicio, now()),
         notas = case when v_causa is null then notas else v_causa end
   where id = p_corrida;

  perform forense.log_corrida(p_corrida, 'sistema', 'corrida_cargada',
    jsonb_build_object('evento_real', 'integridad_verificada', 'estado', v_estado,
                       'dataset_hash', v_hash, 'fecha_corte', v_corte,
                       'familias_evaluables', to_jsonb(v_fam), 'causa', v_causa,
                       'conteos', jsonb_build_object('cfdi', n_cfdi, 'movimientos', n_mov,
                         'contribuyentes', n_contrib, 'cuentas', n_cuentas,
                         'listas_sat', n_listas, 'atributos', n_atr)));

  return query select p_corrida, v_estado, v_hash, v_corte, v_fam, v_causa;
end $$;

-- 'Esperar y reconciliar'. Terminar de despachar NO cierra la corrida:
-- espera SOLO los clusters admitidos y cuenta los errores. Lectura pura.
create or replace function forense.estado_corrida(p_corrida uuid)
returns table(corrida_id uuid, terminada boolean, estado_final text,
              completados int, en_cola int, errores int)
language plpgsql stable security definer set search_path = '' as $$
declare c record; v_comp int; v_cola int; v_err int; v_total int;
begin
  select * into c from forense.corridas k where k.id = p_corrida;
  if not found then
    raise exception 'corrida % no existe', p_corrida using errcode = '22023';
  end if;

  select count(*) filter (where k.estado in ('dictaminado','cerrado','parcial')),
         count(*) filter (where k.estado not in ('dictaminado','cerrado','parcial','error')),
         count(*) filter (where k.estado = 'error'),
         count(*)
    into v_comp, v_cola, v_err, v_total
    from forense.casos k where k.corrida_id = p_corrida;

  return query select p_corrida,
    (v_total > 0 and v_cola = 0) or c.estado in ('completada','error'),
    case when c.estado in ('completada','error') then c.estado
         when v_total = 0 then 'sin_clusters'
         when v_cola > 0 then 'en_curso'
         when v_err > 0 and v_comp = 0 then 'error'
         else 'completada' end,
    v_comp, v_cola, v_err;
end $$;

-- =====================================================================
-- 2. FORENSE_investigar_cluster
-- =====================================================================

-- 'Ronda fin R1'. Escribe ronda_fin y devuelve los insumos DETERMINISTAS
-- de la frontera. Cero señales también exige resultado explícito (07
-- §2.5): senales = [] y familias_evaluables intactas, nunca «sin
-- hallazgos» implícito.
create or replace function forense.cerrar_ronda(
  p_caso uuid, p_ronda int, p_datos jsonb default '{}'::jsonb)
returns table(caso_id uuid, cluster_id uuid, corrida_id uuid, investigacion_id uuid,
              senales jsonb, familias_evaluables text[], version_contexto int,
              roles_por_expansion jsonb, rfcs_frontera text[], ruta_material jsonb,
              expansiones_usadas int, tipo_evento text, registrado boolean)
language plpgsql security definer set search_path = '' as $$
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

  return query select p_caso, k.cluster_id, k.corrida_id, v_inv, v_sen,
                      coalesce(v_fam, '{}'::text[]), coalesce(cl.version_contexto, 1),
                      v_roles, coalesce(v_frontera, '{}'::text[]), v_ruta, v_exp,
                      'ronda_fin'::text, true;
end $$;

-- 'Aplicar resolución'. Transacción: aplica la réplica del investigador a
-- las defensas y SOLO a las evidencias objetivo del caso. NUNCA cambia
-- forense.pistas.estado global (07 §15): la trampa vale para este caso.
create or replace function forense.aplicar_resolucion_replica(
  p_caso uuid, p_tarea_replica uuid)
returns table(caso_id uuid, cluster_id uuid, corrida_id uuid,
              investigacion_id uuid, resoluciones jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  k record; t record; v_inv uuid; r jsonb; v_out jsonb := '[]'::jsonb;
  d record; v_eval jsonb; v_acepta boolean; v_ids bigint[];
begin
  select * into k from forense.casos c where c.id = p_caso for update;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  select * into t from forense.tareas_agente a
   where a.id = p_tarea_replica and a.caso_id = p_caso;
  select i.id into v_inv from forense.investigaciones i where i.caso_id = p_caso
   order by i.creado limit 1;

  v_eval := coalesce(k.evaluacion_pistas, '{}'::jsonb);

  for r in select value from jsonb_array_elements(
             coalesce(t.resultado->'resoluciones', '[]'::jsonb))
  loop
    select * into d from forense.defensas x
     where x.id = (r->>'defensa_id')::bigint and x.caso_id = p_caso;
    continue when not found;

    v_acepta := coalesce((r->>'aceptado')::boolean, d.resultado = 'refuta');
    update forense.defensas
       set aceptado = v_acepta,
           respuesta_investigador = left(coalesce(r->>'respuesta', ''), 4000)
     where id = d.id;

    v_ids := coalesce(d.evidencia_objetivo_ids, '{}'::bigint[]);
    if v_acepta and cardinality(v_ids) > 0 then
      update forense.evidencia e
         set refutada = true, validada = false,
             motivo_descartada = coalesce(e.motivo_descartada,
               'defensa aceptada: ' || coalesce(d.trampa_codigo, 'trampa legítima'))
       where e.caso_id = p_caso and e.id = any(v_ids);

      perform forense.log(p_caso, 'investigador', 'evidencia_descartada',
        jsonb_build_object('defensa_id', d.id, 'trampa_codigo', d.trampa_codigo,
                           'evidencia_ids', to_jsonb(v_ids),
                           'pista_objetivo', d.pista_objetivo),
        null, null, null, null, null, k.cluster_id, p_tarea_replica, k.corrida_id);
    end if;

    -- Evaluación POR CASO, nunca el estado global de la pista.
    if d.pista_objetivo is not null then
      v_eval := v_eval || jsonb_build_object(d.pista_objetivo,
        jsonb_build_object('resultado', case when v_acepta then 'descartada' else 'sostenida' end,
                           'defensa_id', d.id, 'trampa_codigo', d.trampa_codigo));
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'defensa_id', d.id, 'aceptado', v_acepta, 'pista_objetivo', d.pista_objetivo,
      'trampa_codigo', d.trampa_codigo, 'evidencia_ids', to_jsonb(v_ids)));
  end loop;

  update forense.casos set evaluacion_pistas = v_eval where id = p_caso;

  perform forense.log(p_caso, 'investigador', 'replica',
    jsonb_build_object('tarea_replica_id', p_tarea_replica,
                       'n_resoluciones', jsonb_array_length(v_out),
                       'resoluciones', v_out),
    null, null, null, null, null, k.cluster_id, p_tarea_replica, k.corrida_id);

  return query select p_caso, k.cluster_id, k.corrida_id, v_inv, v_out;
end $$;

-- 'Paquete auditor final'. Entrada preparada por BACKEND: el auditor no
-- recibe JSON de otro agente sin validar (07 §Code node). Cada evidencia
-- lleva `monto_centavos` entero: el dictaminador determinista suma
-- centavos, no pesos con decimales flotantes. Lectura pura.
create or replace function forense.paquete_auditor_final(p_caso uuid)
returns table(caso_id uuid, cluster_id uuid, corrida_id uuid, investigacion_id uuid,
              caso jsonb, pistas jsonb, evidencia jsonb, pendientes jsonb,
              cobertura_completa boolean, presupuesto jsonb)
language plpgsql stable security definer set search_path = '' as $$
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
    coalesce(k.cobertura_completa, false),
    v_pres;
end $$;

-- 'Guardar dictamen'. El nivel llega YA CALCULADO por el dictaminador
-- determinista del runtime (regla 4): aquí solo se persiste, se acota al
-- catálogo y se rechaza cualquier nivel fuera de él. `presuncion_alta` es
-- el máximo (regla 7). No hereda el nivel del principal a los satélites:
-- cada RFC lleva el suyo en resultado_por_rfc.
create or replace function forense.guardar_dictamen(p_caso uuid, p_dictamen jsonb)
returns table(caso_id uuid, cluster_id uuid, corrida_id uuid,
              investigacion_id uuid, nivel text, version int)
language plpgsql security definer set search_path = '' as $$
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
         cobertura_completa = coalesce((p_dictamen->>'cobertura_completa')::boolean,
                                       cobertura_completa),
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

-- 'Validar citas'. Cada cita del expediente resuelve a un ID validado de
-- ESTA corrida; una cita que no resuelve invalida el expediente y el caso
-- queda `parcial`, nunca con un nivel más alto.
create or replace function forense.validar_expediente(p_caso uuid, p_version int)
returns table(caso_id uuid, cluster_id uuid, corrida_id uuid, investigacion_id uuid,
              version int, ok boolean, estado_final text)
language plpgsql security definer set search_path = '' as $$
declare
  k record; v_inv uuid; x record; v_txt text; v_malas text[] := '{}';
  v_ok boolean; v_final text; v_cita text;
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  select i.id into v_inv from forense.investigaciones i where i.caso_id = p_caso
   order by i.creado limit 1;
  select * into x from forense.expedientes e
   where e.caso_id = p_caso and e.version = p_version;
  if not found then
    return query select p_caso, k.cluster_id, k.corrida_id, v_inv, p_version,
                        false, 'parcial'::text;
    return;
  end if;

  v_txt := coalesce(x.markdown, '') || ' ' || coalesce(x.contenido_json::text, '');

  for v_cita in
    select distinct m[1] from regexp_matches(v_txt,
      '((?:CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR):[A-Za-z0-9._:-]+)', 'g') m
  loop
    if v_cita like 'CFDI:%' then
      if not exists (select 1 from forense.cfdi f
                      where f.corrida_id = k.corrida_id
                        and f.uuid = substring(v_cita from 6)) then
        v_malas := v_malas || v_cita;
      end if;
    elsif v_cita like 'MOV:%' then
      if not exists (select 1 from forense.movimientos mv
                      where mv.corrida_id = k.corrida_id
                        and mv.id = substring(v_cita from 5)) then
        v_malas := v_malas || v_cita;
      end if;
    end if;
  end loop;

  -- Un expediente sin una sola cita no es citable: tampoco pasa.
  v_ok := cardinality(v_malas) = 0 and v_txt ~ '(CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR):';
  v_final := case when v_ok then 'dictaminado' else 'parcial' end;

  update forense.expedientes
     set estado_revision = case when v_ok then 'validado' else 'rechazado' end,
         actualizado = now()
   where caso_id = p_caso and version = p_version;

  perform forense.log(p_caso, 'sistema', 'validacion',
    jsonb_build_object('evento_real', 'validacion_citas', 'version', p_version,
                       'ok', v_ok, 'citas_invalidas', to_jsonb(v_malas)),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  return query select p_caso, k.cluster_id, k.corrida_id, v_inv, p_version, v_ok, v_final;
end $$;

-- 'Cerrar caso'. dictaminado | parcial | error; libera el lease del
-- cluster. Presupuesto agotado ⇒ `parcial` con nivel no_concluyente:
-- agotar reintentos NUNCA sube el nivel (regla 10).
create or replace function forense.cerrar_caso(p_caso uuid, p_estado_final text)
returns table(caso_id uuid, cluster_id uuid, corrida_id uuid,
              investigacion_id uuid, estado_final text, duracion_ms int)
language plpgsql security definer set search_path = '' as $$
declare k record; v_inv uuid; v_final text; v_dur int;
begin
  select * into k from forense.casos c where c.id = p_caso for update;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  select i.id into v_inv from forense.investigaciones i where i.caso_id = p_caso
   order by i.creado limit 1;

  v_final := coalesce(p_estado_final, 'parcial');
  if v_final not in ('dictaminado','parcial','error') then v_final := 'parcial'; end if;
  if coalesce(k.presupuesto_agotado, false) and v_final = 'dictaminado' then
    v_final := 'parcial';
  end if;

  v_dur := greatest(0, (extract(epoch from (now() - coalesce(k.creado, now()))) * 1000)::int);

  update forense.casos
     set estado = v_final,
         nivel = case when v_final = 'parcial' and nivel is null then 'no_concluyente'
                      when v_final = 'error' then coalesce(nivel, 'no_concluyente')
                      else nivel end,
         terminado = now(), duracion_ms = v_dur
   where id = p_caso;

  if k.cluster_id is not null then
    update forense.clusters
       set estado = case when v_final = 'error' then 'error' else 'investigado' end,
           lease_owner = null, lease_expires_at = null
     where id = k.cluster_id;
  end if;

  perform forense.log(p_caso, 'sistema', 'redaccion_fin',
    jsonb_build_object('evento_real', 'caso_cerrado', 'estado_final', v_final,
                       'duracion_ms', v_dur,
                       'presupuesto_agotado', coalesce(k.presupuesto_agotado, false)),
    v_dur, null, null, null, null, k.cluster_id, null, k.corrida_id);

  return query select p_caso, k.cluster_id, k.corrida_id, v_inv, v_final, v_dur;
end $$;

-- =====================================================================
-- 3. FORENSE_reintento
-- =====================================================================

-- 'Seleccionar autores'. Por MOTIVO (07 §3), nunca «todos los faltantes
-- por defecto»: comprobación pendiente en familia evaluable, ruta
-- concreta, trampa con evidencias objetivo, autor de la evidencia
-- inválida, o los autores en contradicción.
create or replace function forense.autores_reintento(
  p_caso uuid, p_motivo text, p_objetivo jsonb default '{}'::jsonb)
returns table(caso_id uuid, autores text[], puede_expandir boolean,
              motivo text, objetivo jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  k record; v_aut text[] := '{}'; v_fam text[]; v_max int; v_exp boolean;
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  select familias_evaluables into v_fam from forense.corridas where id = k.corrida_id;

  if p_motivo = 'cadena_incompleta' then
    -- Solo los roles de las familias EVALUABLES que aún no dejaron señal.
    select coalesce(array_agg(distinct forense.rol_de_familia(f)), '{}') into v_aut
      from unnest(coalesce(v_fam, '{}'::text[])) f
     where not exists (select 1 from forense.senales s
                        where s.caso_id = p_caso and s.familia = f);
  elsif p_motivo = 'trampa_no_descartada' then
    select coalesce(array_agg(distinct e.agente), '{}') into v_aut
      from forense.evidencia e
     where e.caso_id = p_caso and coalesce(e.refutada, false) = false
       and e.agente is not null
       and (jsonb_typeof(p_objetivo->'evidencia_ids') <> 'array'
            or e.id in (select (x)::bigint from jsonb_array_elements_text(
                                 p_objetivo->'evidencia_ids') x));
  elsif p_motivo = 'evidencia_invalida' then
    select coalesce(array_agg(distinct e.agente), '{}') into v_aut
      from forense.evidencia e
     where e.caso_id = p_caso and e.agente is not null
       and (coalesce(e.valida_tecnica, true) = false or coalesce(e.validada, false) = false);
  elsif p_motivo = 'contradiccion' then
    select coalesce(array_agg(distinct s.agente), '{}') into v_aut
      from forense.senales s
     where s.caso_id = p_caso and s.agente is not null
       and exists (select 1 from forense.senales t
                    where t.caso_id = p_caso and t.familia = s.familia
                      and coalesce(t.refuta, false) <> coalesce(s.refuta, false));
  else
    -- Motivo con objetivo explícito: solo los autores que nombra.
    select coalesce(array_agg(distinct x), '{}') into v_aut
      from jsonb_array_elements_text(
             case when jsonb_typeof(p_objetivo->'autores') = 'array'
                  then p_objetivo->'autores' else '[]'::jsonb end) x;
  end if;

  v_max := forense.config_int('max_expansiones_caso', 2);
  v_exp := p_motivo = 'cadena_incompleta'
           and (select count(*) from forense.bitacora b
                 where b.caso_id = p_caso and b.tipo_evento = 'cluster_expandido') < v_max;

  perform forense.log(p_caso, 'sistema', 'reintento_inicio',
    jsonb_build_object('evento_real', 'autores_seleccionados', 'motivo', p_motivo,
                       'autores', to_jsonb(v_aut), 'puede_expandir', v_exp,
                       'objetivo', coalesce(p_objetivo, '{}'::jsonb)),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  return query select p_caso, v_aut, v_exp, p_motivo, coalesce(p_objetivo, '{}'::jsonb);
end $$;

-- 'Expandir para reintento'. Solo si queda cuota. Reusa
-- forense.expandir_cluster (004), que ya versiona el contexto e invalida
-- la caché del cluster.
create or replace function forense.expandir_cluster_reintento(
  p_caso uuid, p_objetivo jsonb default '{}'::jsonb)
returns table(caso_id uuid, autores text[], expandido boolean,
              version_contexto int, rfcs_nuevos text[])
language plpgsql security definer set search_path = '' as $$
declare
  k record; cl record; v_rfcs text[]; v_nuevos text[]; v_n int := 0;
  v_max int; v_usadas int; v_aut text[];
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  select * into cl from forense.clusters c where c.id = k.cluster_id for update;

  select coalesce(array_agg(distinct x), '{}') into v_aut
    from jsonb_array_elements_text(
           case when jsonb_typeof(p_objetivo->'autores') = 'array'
                then p_objetivo->'autores' else '[]'::jsonb end) x;

  select coalesce(array_agg(distinct x), '{}') into v_rfcs
    from jsonb_array_elements_text(
           case when jsonb_typeof(p_objetivo->'rfcs') = 'array'
                then p_objetivo->'rfcs' else '[]'::jsonb end) x;
  if cardinality(v_rfcs) = 0 then
    v_rfcs := coalesce(cl.rfcs_frontera, '{}'::text[]);
  end if;

  select coalesce(array_agg(r), '{}') into v_nuevos
    from unnest(v_rfcs) r where not (r = any(coalesce(cl.rfcs, '{}'::text[])));

  v_max := forense.config_int('max_expansiones_caso', 2);
  select count(*)::int into v_usadas from forense.bitacora b
   where b.caso_id = p_caso and b.tipo_evento = 'cluster_expandido';

  if cardinality(v_nuevos) > 0 and v_usadas < v_max then
    v_n := forense.expandir_cluster(k.cluster_id, v_nuevos);
    select * into cl from forense.clusters c where c.id = k.cluster_id;
    perform forense.log(p_caso, 'sistema', 'cluster_expandido',
      jsonb_build_object('evento_real', 'expansion_reintento',
                         'rfcs_nuevos', to_jsonb(v_nuevos), 'agregados', v_n,
                         'version_contexto', cl.version_contexto),
      null, null, null, null, null, k.cluster_id, null, k.corrida_id);
  else
    v_nuevos := '{}';
  end if;

  return query select p_caso, v_aut, (v_n > 0), coalesce(cl.version_contexto, 1), v_nuevos;
end $$;

-- 'Crear tareas de revisión'. Ronda 2 con intento ≥ 1 y la
-- version_contexto vigente; las señales previas NO se borran, la historia
-- se conserva. Devuelve una fila POR TAREA (el nodo las despacha en
-- abanico) y `tarea_ids` completo en cada una.
create or replace function forense.crear_tareas_revision(
  p_caso uuid, p_intento int, p_autores text[], p_objetivo jsonb default '{}'::jsonb)
returns table(caso_id uuid, tarea_id uuid, tarea_ids uuid[],
              version_contexto int, deadline timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  k record; cl record; v_res jsonb; v_ids uuid[]; v_dead timestamptz; v_seg int;
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  if p_autores is null or cardinality(p_autores) = 0 then
    raise exception 'un reintento sin autores no es un reintento' using errcode = '22023';
  end if;
  if coalesce(p_intento, 0) < 1 then
    raise exception 'las tareas de revisión exigen intento >= 1' using errcode = '22023';
  end if;
  select * into cl from forense.clusters c where c.id = k.cluster_id;

  v_seg := forense.config_int('deadline_revision_segundos', 900);
  v_res := forense.crear_tareas_ronda(p_caso, 2, p_autores, p_intento, v_seg);

  select coalesce(array_agg((x)::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(v_res->'tarea_ids', '[]'::jsonb)) x;

  select max(t.lease_expires_at) into v_dead from forense.tareas_agente t
   where t.id = any(v_ids);
  v_dead := coalesce(v_dead, now() + make_interval(secs => v_seg));

  perform forense.log(p_caso, 'sistema', 'reintento_inicio',
    jsonb_build_object('evento_real', 'tareas_revision_creadas', 'intento', p_intento,
                       'autores', to_jsonb(p_autores), 'tarea_ids', to_jsonb(v_ids),
                       'version_contexto', cl.version_contexto,
                       'objetivo', coalesce(p_objetivo, '{}'::jsonb)),
    null, null, null, null, 2, k.cluster_id, null, k.corrida_id);

  return query select p_caso, t.id, v_ids, coalesce(cl.version_contexto, 1), v_dead
    from unnest(v_ids) as t(id);
end $$;

-- 'Revalidar si cambió evidencia'. Repite la validación ANTES del
-- dictamen: evidencia nueva no entra sin validar.
create or replace function forense.revalidar_caso(p_caso uuid)
returns table(caso_id uuid, limitaciones jsonb, evidencia_revalidada int)
language plpgsql security definer set search_path = '' as $$
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

  return query select p_caso, v_lim, v_n;
end $$;

-- =====================================================================
-- 4. FORENSE_editar_expediente
-- =====================================================================

-- 'Cargar versión base'. Versión vigente, dictamen y las citas
-- PERMITIDAS (las que ya están validadas): el editor no puede inventar
-- una cita nueva. Lectura pura.
create or replace function forense.cargar_version_expediente(
  p_caso uuid, p_version int default null)
returns table(caso_id uuid, version_actual int, nivel text, citas_permitidas jsonb,
              context_hash text, prompt_hash text, modelo text, documento jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare k record; x record; v_ver int; v_citas jsonb; e record;
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;

  select coalesce(max(version), 0) into v_ver from forense.expedientes where caso_id = p_caso;
  select * into x from forense.expedientes d
   where d.caso_id = p_caso and d.version = coalesce(p_version, v_ver);

  select coalesce(jsonb_agg(distinct c.cita), '[]'::jsonb) into v_citas from (
    select ('CFDI:' || e2.ref_id) as cita from forense.evidencia e2
     where e2.caso_id = p_caso and e2.tipo = 'cfdi'
       and coalesce(e2.validada, false) and not coalesce(e2.refutada, false)
    union all
    select ('MOV:' || e2.ref_id) from forense.evidencia e2
     where e2.caso_id = p_caso and e2.tipo = 'movimiento'
       and coalesce(e2.validada, false) and not coalesce(e2.refutada, false)
    union all
    select e2.ref_id from forense.evidencia e2
     where e2.caso_id = p_caso and e2.tipo not in ('cfdi','movimiento')
       and coalesce(e2.validada, false) and not coalesce(e2.refutada, false)
       and e2.ref_id ~ '^(ATR|LISTA|CICLO|CADENA|PAR):'
  ) c;

  select * into e from forense.ejecuciones_agente a
   where a.caso_id = p_caso and a.rol = 'redactor'
   order by a.creado desc limit 1;

  return query select p_caso, v_ver, k.nivel, v_citas,
                      e.context_hash, e.prompt_hash, e.model_id,
                      jsonb_build_object(
                        'version', x.version,
                        'markdown', x.markdown,
                        'contenido_json', x.contenido_json,
                        'estado_revision', x.estado_revision,
                        'autor', x.autor);
end $$;

-- 'Guardar propuesta'. NO cambia el expediente: «Aplicar» es una
-- operación determinista del BFF que versiona (regla 11). Las columnas
-- son las que lee web/lib/document/repositorio.ts.
create or replace function forense.guardar_propuesta_edicion(
  p_caso uuid, p_version_base int, p_patch jsonb, p_diff jsonb,
  p_citas text[] default '{}', p_modo text default 'propuesta',
  p_perfil uuid default null, p_mensaje text default null,
  p_seleccion text default null, p_request text default null,
  p_directriz uuid default null)
returns table(propuesta_id uuid, caso_id uuid, version_base int, creado timestamptz)
language plpgsql security definer set search_path = '' as $$
declare k record; v_id uuid; v_creado timestamptz; v_modo text; v_existente record;
begin
  select * into k from forense.casos c where c.id = p_caso;
  if not found then
    raise exception 'caso % no existe', p_caso using errcode = '22023';
  end if;
  v_modo := case when p_modo in ('pregunta','propuesta') then p_modo else 'propuesta' end;

  if p_request is not null then
    select * into v_existente from forense.propuestas_edicion p where p.request_id = p_request;
    if found then
      return query select v_existente.id, v_existente.caso_id,
                          v_existente.version_base, v_existente.creado;
      return;
    end if;
  end if;

  insert into forense.propuestas_edicion (
    caso_id, perfil_id, version_base, seleccion, seleccion_hash, mensaje,
    directriz_id, modo, patch, diff, citas, estado, request_id)
  values (p_caso, p_perfil, p_version_base, p_seleccion,
          case when p_seleccion is null then null
               else encode(sha256(convert_to(p_seleccion, 'utf8')), 'hex') end,
          p_mensaje, p_directriz, v_modo, p_patch, p_diff,
          to_jsonb(coalesce(p_citas, '{}'::text[])), 'propuesta', p_request)
  returning id, creado into v_id, v_creado;

  perform forense.log(p_caso, 'editor', 'edicion',
    jsonb_build_object('evento_real', 'propuesta_guardada', 'propuesta_id', v_id,
                       'version_base', p_version_base, 'modo', v_modo,
                       'n_citas', cardinality(coalesce(p_citas, '{}'::text[]))),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  return query select v_id, p_caso, p_version_base, v_creado;
end $$;

-- Revertir a una versión anterior (petición del editor). ATÓMICA: crea
-- una versión NUEVA con el contenido de la objetivo — no borra historia —
-- y falla entera si la versión base ya no es la vigente. Deja evento
-- `edicion` en forense.bitacora vía forense.log.
create or replace function forense.revertir_expediente(
  p_caso uuid, p_version_objetivo int, p_version_base int,
  p_idempotency text, p_perfil uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k record; obj record; v_max int; v_nueva int; v_id bigint; v_ya record;
begin
  select * into k from forense.casos c where c.id = p_caso for update;
  if not found then
    return jsonb_build_object('ok', false,
             'error', jsonb_build_object('codigo', 'contexto_invalido',
                                         'mensaje', 'el caso no existe'));
  end if;
  if p_idempotency is null or length(p_idempotency) = 0 then
    return jsonb_build_object('ok', false,
             'error', jsonb_build_object('codigo', 'argumento_invalido',
                                         'mensaje', 'revertir exige idempotency'));
  end if;

  select * into v_ya from forense.expedientes e
   where e.idempotency_key = 'revertir:' || p_idempotency;
  if found then
    return jsonb_build_object('ok', true, 'revertida', false, 'motivo', 'ya_aplicada',
                              'caso_id', p_caso, 'version', v_ya.version);
  end if;

  select coalesce(max(version), 0) into v_max from forense.expedientes where caso_id = p_caso;
  if p_version_base is distinct from v_max then
    return jsonb_build_object('ok', false,
             'error', jsonb_build_object('codigo', 'conflicto_version',
                                         'mensaje', 'la versión base ya no es la vigente'),
             'version_base', p_version_base, 'version_actual', v_max);
  end if;

  select * into obj from forense.expedientes e
   where e.caso_id = p_caso and e.version = p_version_objetivo;
  if not found then
    return jsonb_build_object('ok', false,
             'error', jsonb_build_object('codigo', 'argumento_invalido',
                                         'mensaje', 'la versión objetivo no existe'));
  end if;

  v_nueva := v_max + 1;
  insert into forense.expedientes (caso_id, idempotency_key, version, markdown,
                                   contenido_json, autor, estado_revision, version_base)
  values (p_caso, 'revertir:' || p_idempotency, v_nueva, obj.markdown, obj.contenido_json,
          'humano', 'borrador', v_max);

  perform forense.log(p_caso, 'editor', 'edicion',
    jsonb_build_object('evento_real', 'expediente_revertido',
                       'version_objetivo', p_version_objetivo,
                       'version_base', v_max, 'version_resultante', v_nueva),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);
  v_id := forense.registrar_actividad('propuesta_aplicada', p_perfil, null, p_caso,
            p_idempotency, jsonb_build_object('accion', 'revertir',
              'version_objetivo', p_version_objetivo, 'version', v_nueva));

  return jsonb_build_object('ok', true, 'revertida', true, 'caso_id', p_caso,
                            'version', v_nueva, 'version_base', v_max,
                            'version_objetivo', p_version_objetivo);
end $$;

-- =====================================================================
-- 5. FORENSE_inyectar
-- =====================================================================

-- 'Registrar inyección'. SOBRECARGA del nodo: la ingesta ya existe (la
-- creó el mapper de 19), aquí solo se registra la inyección contra la
-- corrida base. La de 008 (uuid, jsonb, …) sigue siendo la del BFF y no
-- se toca.
create or replace function forense.registrar_inyeccion(
  p_corrida_base uuid, p_ingesta uuid, p_idempotency text,
  p_prioridad text default 'inyectados')
returns table(inyeccion_id uuid, estado text, corrida_base_id uuid, ingesta_id uuid,
              idempotency_key text, prioridad text)
language plpgsql security definer set search_path = '' as $$
declare g record; v_id uuid; v_prio text; v_key uuid; v_ya record;
begin
  select * into g from forense.ingestas i where i.id = p_ingesta;
  if not found then
    raise exception 'ingesta % no existe', p_ingesta using errcode = '22023';
  end if;
  if not exists (select 1 from forense.corridas c where c.id = p_corrida_base) then
    raise exception 'corrida base % no existe', p_corrida_base using errcode = '22023';
  end if;
  v_prio := case when p_prioridad in ('inyectados','todos') then p_prioridad
                 else 'inyectados' end;
  begin
    v_key := p_idempotency::uuid;
  exception when others then
    v_key := null;
  end;

  if v_key is not null then
    select * into v_ya from forense.inyecciones y where y.idempotency_key = v_key;
    if found then
      return query select v_ya.id, v_ya.estado, v_ya.corrida_base_id, v_ya.ingesta_id,
                          v_ya.idempotency_key::text, v_prio;
      return;
    end if;
  end if;

  insert into forense.inyecciones (ingesta_id, corrida_base_id, perfil_id, origen,
                                   hash_payload, filas_por_tabla, estado, idempotency_key)
  values (p_ingesta, p_corrida_base, g.perfil_id,
          case when g.origen in ('ui','api','ensayo') then g.origen else 'api' end,
          coalesce(g.hash_payload, encode(sha256(convert_to(p_ingesta::text, 'utf8')), 'hex')),
          coalesce(g.filas_por_tabla, '{}'::jsonb), 'recibida', v_key)
  returning id into v_id;

  perform forense.log_corrida(p_corrida_base, 'sistema', 'inyeccion',
    jsonb_build_object('evento_real', 'inyeccion_recibida', 'inyeccion_id', v_id,
                       'ingesta_id', p_ingesta, 'idempotency_key', p_idempotency,
                       'prioridad', v_prio));

  return query select v_id, 'recibida'::text, p_corrida_base, p_ingesta,
                      p_idempotency, v_prio;
end $$;

-- 'Clusters afectados primero'. Ordena primero los clusters que contienen
-- rfcs_afectados; el resto queda `en_cola`. Reusa forense.clusters_afectados
-- (008) para la prioridad y deja evento `inyeccion` con
-- payload.evento_real='clusters_afectados' (petición de webapp).
create or replace function forense.clusters_por_prioridad_inyeccion(
  p_corrida uuid, p_inyeccion uuid)
returns table(cluster_id uuid, corrida_id uuid, inyeccion_id uuid,
              investigacion_id uuid, afectado boolean, score numeric)
language plpgsql security definer set search_path = '' as $$
declare v_inv uuid; v_afect int; v_total int;
begin
  select i.id into v_inv from forense.investigaciones i where i.corrida_id = p_corrida
   order by i.creado limit 1;

  create temporary table if not exists tmp_prio_iny (
    cluster_id uuid, afectado boolean, score numeric) on commit drop;
  delete from tmp_prio_iny;

  insert into tmp_prio_iny (cluster_id, afectado, score)
  select c.id,
         exists (select 1 from forense.clusters_afectados(p_inyeccion) a
                  where a.cluster_id = c.id),
         c.score
    from forense.clusters c
   where c.corrida_id = p_corrida;

  select count(*) filter (where afectado), count(*) into v_afect, v_total from tmp_prio_iny;

  perform forense.log_corrida(p_corrida, 'sistema', 'inyeccion',
    jsonb_build_object('evento_real', 'clusters_afectados', 'inyeccion_id', p_inyeccion,
                       'afectados', v_afect, 'total', v_total));

  return query select t.cluster_id, p_corrida, p_inyeccion, v_inv, t.afectado, t.score
    from tmp_prio_iny t
   order by t.afectado desc, t.score desc nulls last, t.cluster_id;
end $$;

-- =====================================================================
-- 6. FORENSE_notificar_completada / FORENSE_resultado_llamada
-- =====================================================================

-- 'Releer evento desde DB'. NO confía en el payload del webhook: relee
-- evento y estado. Un teléfono en el payload se IGNORA (16 §2).
create or replace function forense.leer_evento_salida(p_evento uuid)
returns table(evento_id uuid, investigacion_id uuid, tipo_evento text, estado text,
              completada_at timestamptz, reporte_hash text)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
    select e.id, e.investigacion_id, e.tipo, e.estado, i.completada_at,
           encode(sha256(convert_to(coalesce(i.reporte_manifest, '[]'::jsonb)::text, 'utf8')), 'hex')
      from forense.eventos_salida e
      left join forense.investigaciones i on i.id = e.investigacion_id
     where e.id = p_evento;
end $$;

-- 'Reclamar evento'. SOBRECARGA por evento concreto: claim atómico con
-- lease. Cinco entregas del webhook NO generan cinco llamadas (16 §2).
-- La de 007 (owner, segundos) toma el siguiente pendiente y no se toca.
create or replace function forense.reclamar_evento_salida(p_evento uuid, p_owner text)
returns table(evento_id uuid, reclamado boolean, lease_owner text, motivo text)
language plpgsql security definer set search_path = '' as $$
declare e record; v_seg int;
begin
  v_seg := forense.config_int('lease_evento_salida_segundos', 120);
  select * into e from forense.eventos_salida x where x.id = p_evento for update;
  if not found then
    return query select p_evento, false, null::text, 'evento inexistente'::text;
    return;
  end if;
  if e.estado in ('entregado','descartado') then
    return query select p_evento, false, e.lease_owner, ('evento ya ' || e.estado)::text;
    return;
  end if;
  if e.lease_owner is not null and e.lease_owner <> p_owner
     and e.lease_expires_at is not null and e.lease_expires_at > now() then
    return query select p_evento, false, e.lease_owner, 'lease vigente de otro owner'::text;
    return;
  end if;

  update forense.eventos_salida
     set estado = 'reclamado', lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => greatest(v_seg, 10)),
         intentos = intentos + 1, actualizado = now()
   where id = p_evento;

  perform forense.registrar_actividad('investigacion_completa', null, e.investigacion_id,
    null, p_owner, jsonb_build_object('evento_real', 'evento_reclamado',
                                      'event_id', p_evento, 'intentos', e.intentos + 1));

  return query select p_evento, true, p_owner, null::text;
end $$;

-- 'Resolver destinatario'. El teléfono sale del PERFIL, jamás del prompt
-- ni del payload (16 §3), y no se devuelve: solo si se PUEDE llamar.
create or replace function forense.destinatario_aviso(p_investigacion uuid)
returns table(investigacion_id uuid, puede_llamar boolean, motivo_omision text,
              perfil_id uuid, referencia_corta text)
language plpgsql stable security definer set search_path = '' as $$
declare inv record; p record; v_motivo text;
begin
  select * into inv from forense.investigaciones i where i.id = p_investigacion;
  if not found then
    return query select p_investigacion, false, 'la investigación no existe'::text,
                        null::uuid, null::text;
    return;
  end if;
  select * into p from forense.perfiles f where f.id = inv.perfil_id;

  v_motivo := case
    when p.id is null then 'la investigación no tiene perfil propietario'
    when p.telefono_e164 is null then 'el perfil no tiene teléfono configurado'
    when not coalesce(p.llamadas_activadas, false) then 'el perfil tiene las llamadas desactivadas'
    when not coalesce(p.permiso_aviso, false) then 'no hay permiso de aviso registrado'
    else null end;

  return query select p_investigacion, (v_motivo is null), v_motivo, p.id,
                      ('INV-' || upper(left(replace(p_investigacion::text, '-', ''), 6)))::text;
end $$;

-- 'Omitir con motivo'. El aviso DENTRO de la app se mantiene: la voz es
-- un extra, no el canal (16 §2).
create or replace function forense.omitir_llamada(p_investigacion uuid, p_motivo text)
returns table(investigacion_id uuid, estado text, motivo_omision text)
language plpgsql security definer set search_path = '' as $$
declare e record; v_id uuid; v_intento int;
begin
  select * into e from forense.eventos_salida x
   where x.investigacion_id = p_investigacion and x.tipo = 'investigacion.completa'
   for update;

  if found then
    select coalesce(max(intento), 0) + 1 into v_intento
      from forense.llamadas_notificacion l where l.event_id = e.id;
    insert into forense.llamadas_notificacion (event_id, intento, estado, motivo, perfil_id)
    select e.id, v_intento, 'omitida', left(coalesce(p_motivo, 'sin motivo'), 500), i.perfil_id
      from forense.investigaciones i where i.id = p_investigacion
    returning id into v_id;

    update forense.eventos_salida
       set estado = 'entregado', lease_owner = null, lease_expires_at = null,
           actualizado = now()
     where id = e.id;
  end if;

  perform forense.registrar_actividad('llamada_solicitada', null, p_investigacion, null, null,
    jsonb_build_object('evento_real', 'llamada_omitida', 'llamada_id', v_id,
                       'motivo', p_motivo));

  return query select p_investigacion, 'omitida'::text, p_motivo;
end $$;

-- 'Crear intento de llamada'. Congela destinatario y configuración y
-- reclama `solicitando` ANTES del POST (16 §2.5). `cuerpo_elevenlabs`
-- lleva dynamic_variables YA NORMALIZADAS: sin RFC, sin montos y sin la
-- palabra sospecha — el aviso dice que el reporte está listo, nada más.
create or replace function forense.crear_intento_llamada(
  p_investigacion uuid, p_evento uuid)
returns table(llamada_id uuid, investigacion_id uuid, estado text, cuerpo_elevenlabs jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_id uuid; l record; p record; inv record; v_ref text;
begin
  v_res := forense.solicitar_llamada(p_evento, 'n8n', null);
  if coalesce(v_res->>'ok', 'false') <> 'true' then
    raise exception 'no se pudo crear el intento de llamada: %', coalesce(v_res->>'error', '?')
      using errcode = '22023';
  end if;
  v_id := (v_res->>'llamada_id')::uuid;

  select * into l from forense.llamadas_notificacion x where x.id = v_id;
  select * into inv from forense.investigaciones i where i.id = p_investigacion;
  select * into p from forense.perfiles f where f.id = l.perfil_id;
  v_ref := 'INV-' || upper(left(replace(p_investigacion::text, '-', ''), 6));

  return query select v_id, p_investigacion, l.estado,
    case when l.estado <> 'solicitando' then '{}'::jsonb
    else jsonb_build_object(
      'agent_id', l.agent_id,
      'to_number', l.destino,
      'conversation_initiation_client_data', jsonb_build_object(
        'dynamic_variables', jsonb_build_object(
          -- Normalizado: ni RFC, ni montos, ni nivel. Solo que ya está.
          'nombre', coalesce(p.nombre, 'hola'),
          'referencia_corta', v_ref,
          'n_reportes', jsonb_array_length(coalesce(inv.reporte_manifest, '[]'::jsonb)),
          'zona_horaria', coalesce(p.timezone, 'America/Mexico_City'))))
    end;
end $$;

-- 'Guardar aceptación'. HTTP 200 = solicitud ACEPTADA, no que alguien
-- contestó. Sin 2xx el intento queda `fallida`; un timeout tras enviar
-- es `resultado_desconocido`, nunca un redial ciego (16 §2.7).
create or replace function forense.guardar_aceptacion_llamada(
  p_llamada uuid, p_status int, p_body jsonb default '{}'::jsonb)
returns table(llamada_id uuid, estado text, conversation_id text, call_sid text)
language plpgsql security definer set search_path = '' as $$
declare v_estado text; v_conv text; v_sid text; v_res jsonb;
begin
  v_conv := nullif(p_body->>'conversation_id', '');
  v_sid := coalesce(nullif(p_body->>'call_sid', ''), nullif(p_body->>'callSid', ''));
  v_estado := case
    when p_status is null then 'resultado_desconocido'
    when p_status between 200 and 299 then 'aceptada'
    else 'fallida' end;

  v_res := forense.resultado_llamada(p_llamada, v_estado, coalesce(p_body, '{}'::jsonb),
                                     v_conv, v_sid, null,
                                     case when v_estado = 'fallida'
                                          then 'HTTP ' || coalesce(p_status::text, '?')
                                          else null end);
  if coalesce(v_res->>'ok', 'false') <> 'true' then
    raise exception 'llamada % no existe', p_llamada using errcode = '22023';
  end if;

  return query select p_llamada, v_estado, v_conv, v_sid;
end $$;

-- 'Deduplicar callback'. Correlaciona por conversation_id / call_sid. Un
-- callback que llega ANTES de guardar el POST se conserva para la
-- conciliación posterior (16 §2.7) en provider_payload.
create or replace function forense.registrar_callback_llamada(
  p_conversation text, p_call_sid text, p_evento jsonb default '{}'::jsonb)
returns table(llamada_id uuid, duplicado boolean, estado_llamada text,
              aviso_entregado boolean)
language plpgsql security definer set search_path = '' as $$
declare l record; v_huella text; v_dup boolean := false;
begin
  v_huella := encode(sha256(convert_to(
    coalesce(p_conversation, '') || '|' || coalesce(p_call_sid, '') || '|' ||
    coalesce(p_evento->>'type', p_evento->>'event', 'callback') || '|' ||
    coalesce(p_evento->>'status', ''), 'utf8')), 'hex');

  select * into l from forense.llamadas_notificacion x
   where (p_conversation is not null and x.conversation_id = p_conversation)
      or (p_call_sid is not null and x.call_sid = p_call_sid)
   order by x.creado desc limit 1;

  if not found then
    -- Callback huérfano: se guarda para conciliar, no se inventa la llamada.
    perform forense.registrar_actividad('llamada_resultado', null, null, null, null,
      jsonb_build_object('evento_real', 'callback_huerfano', 'huella', v_huella,
                         'conversation_id', p_conversation, 'call_sid', p_call_sid));
    return query select null::uuid, false, null::text, null::boolean;
    return;
  end if;

  v_dup := coalesce(l.provider_payload->'callbacks_vistos', '[]'::jsonb) ? v_huella;

  update forense.llamadas_notificacion
     set provider_payload = coalesce(provider_payload, '{}'::jsonb)
           || jsonb_build_object('callbacks_vistos',
                coalesce(provider_payload->'callbacks_vistos', '[]'::jsonb)
                || case when v_dup then '[]'::jsonb else jsonb_build_array(v_huella) end)
           || jsonb_build_object('ultimo_callback', coalesce(p_evento, '{}'::jsonb)),
         conversation_id = coalesce(conversation_id, p_conversation),
         call_sid = coalesce(call_sid, p_call_sid),
         actualizado = now()
   where id = l.id;

  return query select l.id, v_dup, l.estado, l.aviso_entregado;
end $$;

-- 'Actualizar llamada'. Mapea SOLO hechos recibidos: `aviso_entregado`
-- null se conserva como DESCONOCIDO. El fallo de voz no revierte la
-- investigación ni borra el reporte (16 §2.7, regla 11).
create or replace function forense.actualizar_llamada(
  p_llamada uuid, p_estado text, p_aviso boolean default null)
returns table(llamada_id uuid, estado text, aviso_entregado boolean)
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_estado text;
begin
  v_estado := case when p_estado in ('aceptada','en_curso','finalizada','fallida',
                                     'sin_respuesta','omitida','resultado_desconocido')
                   then p_estado else 'resultado_desconocido' end;
  v_res := forense.resultado_llamada(p_llamada, v_estado, '{}'::jsonb, null, null, p_aviso, null);
  if coalesce(v_res->>'ok', 'false') <> 'true' then
    raise exception 'llamada % no existe', p_llamada using errcode = '22023';
  end if;
  return query select p_llamada, v_estado, (v_res->>'aviso_entregado')::boolean;
end $$;

-- =====================================================================
-- 7. FORENSE_reconciliador
-- =====================================================================

-- 'Barreras vencidas'. Cierra las barreras con deadline vencido marcando
-- limitaciones y llama a advance_case_if_ready. Error o timeout NO es
-- ausencia de fraude (07): la limitación viaja al dictamen.
create or replace function forense.cerrar_barreras_vencidas(p_now timestamptz default now())
returns table(caso_id uuid, paso text, cerradas int, limitaciones jsonb)
language plpgsql security definer set search_path = '' as $$
declare b record; v_falt uuid[]; v_lim jsonb; v_n int := 0;
begin
  create temporary table if not exists tmp_barreras_vencidas (
    caso_id uuid, paso text, cerradas int, limitaciones jsonb) on commit drop;
  delete from tmp_barreras_vencidas;

  for b in
    select * from forense.pasos_pipeline p
     where p.estado = 'abierto' and p.deadline is not null and p.deadline < p_now
     order by p.caso_id, p.id
     for update skip locked
  loop
    select coalesce(array_agg(t), '{}') into v_falt
      from unnest(coalesce(b.tareas_esperadas, '{}'::uuid[])) t
     where not exists (select 1 from forense.tareas_agente a
                        where a.id = t and a.estado in ('completada','error','descartada'));

    v_lim := jsonb_build_object(
      'codigo', 'barrera_vencida', 'paso', b.paso,
      'deadline', b.deadline, 'tareas_faltantes', to_jsonb(v_falt),
      'nota', 'timeout de barrera: ausencia de señal, no ausencia de fraude');

    update forense.pasos_pipeline
       set estado = 'cerrado', cerrado = now()
     where id = b.id;
    v_n := v_n + 1;

    update forense.casos
       set pendientes = coalesce(pendientes, '[]'::jsonb) || jsonb_build_array(v_lim),
           cobertura_completa = false
     where id = b.caso_id;

    perform forense.log(b.caso_id, 'sistema', 'ronda_fin',
      jsonb_build_object('evento_real', 'barrera_vencida', 'paso', b.paso,
                         'revision', b.revision, 'limitaciones', v_lim),
      null, null, null, null, null, null, null, null);

    perform forense.advance_case_if_ready(b.caso_id, b.paso, b.revision);

    insert into tmp_barreras_vencidas values (b.caso_id, b.paso, 1, v_lim);
  end loop;

  return query select t.caso_id, t.paso, t.cerradas, t.limitaciones
    from tmp_barreras_vencidas t;
end $$;

-- 'Outbox pendiente'. Reenvía eventos no entregados (16 §2). El backoff
-- de outbox NO equivale a repetir una llamada ya aceptada. Lectura pura:
-- el claim lo hace reclamar_evento_salida.
create or replace function forense.eventos_salida_pendientes(p_limite int default 20)
returns table(evento_id uuid, investigacion_id uuid, intentos int)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
    select e.id, e.investigacion_id, e.intentos
      from forense.eventos_salida e
     where e.estado in ('pendiente','error','reclamado')
       and coalesce(e.proximo_intento, e.creado) <= now()
       and (e.lease_owner is null or e.lease_expires_at is null
            or e.lease_expires_at < now())
     order by e.creado
     limit greatest(coalesce(p_limite, 20), 1);
end $$;

-- =====================================================================
-- 8. QA-002 / QA-003
-- =====================================================================

-- QA-003. `registrar_inyeccion` (la de 008, la del BFF) propagaba
-- unique_violation cuando dos solicitudes con la MISMA idempotency_key
-- corrían a la vez: la comprobación previa no protege de la carrera, solo
-- el índice único lo hace. Ahora devuelve el error tipado del contrato.
-- Solo se envuelve el cuerpo: la lógica de 008 no cambia.
create or replace function forense.registrar_inyeccion(
  p_base uuid, p_payload jsonb, p_origen text default 'ui',
  p_idempotency uuid default null, p_perfil uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ingesta uuid; v_iny uuid; v_hash text; v_tabla text; v_fila jsonb; i int;
  v_filas jsonb := '{}'::jsonb; v_n int; v_existente record;
begin
  if not exists (select 1 from forense.corridas where id = p_base) then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'corrida base inexistente');
  end if;
  if p_payload is null or jsonb_typeof(p_payload->'tablas') <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'argumento_invalido',
                              'detalle', 'el paquete debe traer un objeto tablas');
  end if;

  if p_idempotency is not null then
    select * into v_existente from forense.inyecciones where idempotency_key = p_idempotency;
    if found then
      return jsonb_build_object('ok', true, 'creada', false, 'inyeccion_id', v_existente.id,
                                'ingesta_id', v_existente.ingesta_id,
                                'estado', v_existente.estado);
    end if;
  end if;

  v_hash := encode(sha256(convert_to(p_payload::text, 'utf8')), 'hex');

  insert into forense.ingestas (nombre, origen, estado, corrida_base_id, perfil_id,
                                hash_payload, idempotency_key)
  values (coalesce(p_payload->>'nota', 'inyección en vivo'),
          case when p_origen in ('ui','api','ensayo') then p_origen else 'api' end,
          'validando', p_base, p_perfil, v_hash,
          coalesce(p_idempotency::text, v_hash))
  returning id into v_ingesta;

  for v_tabla in
    select k from jsonb_object_keys(p_payload->'tablas') k
     where k in ('contribuyentes','cuentas','cfdi','complementos_pago',
                 'movimientos','atributos_entidad','listas_sat')
     order by k
  loop
    i := 0;
    for v_fila in select value from jsonb_array_elements(p_payload->'tablas'->v_tabla) loop
      i := i + 1;
      insert into forense.staging_filas (ingesta_id, tabla, fila, datos)
      values (v_ingesta, v_tabla, i, v_fila)
      on conflict (ingesta_id, tabla, fila) do nothing;
    end loop;
    v_filas := v_filas || jsonb_build_object(v_tabla, i);
  end loop;

  update forense.ingestas set filas_por_tabla = v_filas, actualizado = now()
   where id = v_ingesta;

  insert into forense.inyecciones (ingesta_id, corrida_base_id, perfil_id, origen,
                                   hash_payload, filas_por_tabla, estado, idempotency_key)
  values (v_ingesta, p_base, p_perfil,
          case when p_origen in ('ui','api','ensayo') then p_origen else 'api' end,
          v_hash, v_filas, 'recibida', p_idempotency)
  returning id into v_iny;

  select coalesce(sum((value)::int), 0) into v_n from jsonb_each_text(v_filas);

  perform forense.log(null, 'sistema', 'inyeccion',
    jsonb_build_object('evento_real', 'inyeccion_recibida', 'inyeccion_id', v_iny,
                       'ingesta_id', v_ingesta, 'corrida_base_id', p_base,
                       'hash_payload', v_hash, 'filas_por_tabla', v_filas, 'filas', v_n),
    null, null, null, null, null, null, null, p_base);

  return jsonb_build_object('ok', true, 'creada', true, 'inyeccion_id', v_iny,
                            'ingesta_id', v_ingesta, 'estado', 'recibida',
                            'hash_payload', v_hash, 'filas_por_tabla', v_filas);
exception
  -- QA-003: la clave repetida es un resultado del contrato, no un 500.
  when unique_violation then
    select * into v_existente from forense.inyecciones
     where idempotency_key = p_idempotency;
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'codigo', 'duplicado',
        'mensaje', 'ya existe una inyección con esa idempotency_key',
        'reintentable', false),
      'inyeccion_id', v_existente.id,
      'ingesta_id', v_existente.ingesta_id,
      'estado', v_existente.estado,
      'idempotency_key', p_idempotency);
end $$;

-- QA-002. `trg_investigacion_completa` se creó en 007 DESPUÉS del
-- `revoke ... from public` de 002, así que quedó ejecutable por public
-- siendo security definer. Una función de trigger no se llama a mano.
revoke execute on function forense.trg_investigacion_completa() from public;

-- ---------------------------------------------------------------------
-- 9. Permisos de lo nuevo. Nada de 010 es ejecutable por anon: todas
--    mutan o leen datos privados; el runtime entra con service_role.
-- ---------------------------------------------------------------------

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'forense'
       and p.proname in (
         'log_corrida','abrir_corrida','cargar_o_clonar_snapshot',
         'verificar_integridad_corrida','estado_corrida','cerrar_ronda',
         'aplicar_resolucion_replica','paquete_auditor_final','guardar_dictamen',
         'validar_expediente','cerrar_caso','autores_reintento',
         'expandir_cluster_reintento','crear_tareas_revision','revalidar_caso',
         'cargar_version_expediente','guardar_propuesta_edicion','revertir_expediente',
         'registrar_inyeccion','clusters_por_prioridad_inyeccion','leer_evento_salida',
         'reclamar_evento_salida','destinatario_aviso','omitir_llamada',
         'crear_intento_llamada','guardar_aceptacion_llamada','registrar_callback_llamada',
         'actualizar_llamada','cerrar_barreras_vencidas','eventos_salida_pendientes')
  loop
    execute format('revoke execute on function %s from public', f.sig);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema forense to service_role';
  end if;
end $$;

-- Fin 010_runtime_funciones.sql
