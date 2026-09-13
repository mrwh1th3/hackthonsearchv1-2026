-- 028_ia_complemento.sql — tope de 5 subagentes IA por investigación, presupuesto
-- acotado, telemetría en vivo y pizarrón. Corrige el bucle de coste observado en la
-- corrida 2b446f04-645a-5a9d-8b46-bb18a5b3190f (seed 5005, 2026-09-12).
--
-- Causa raíz (diagnóstico completo en el reporte de forense-runtime):
--   1. `validar_salida_rol` (005/023) exigía a los especialistas {titular, confianza,
--      ids, familia} — la forma de `forense_escribir_senal` — mientras el contrato
--      `agents.especialista` (contracts v1) y el Code node exigen {senal_ids, resumen,
--      limitaciones} sin claves extra. Ninguna salida podía pasar ambos.
--   2. El grafo real nunca persistía `reparaciones_json`: cada salida inválida pedía
--      otra reparación, sin tope, hasta el deadline. `reserve_request` devolvía
--      ok=false al agotar cuota pero el worker llamaba al modelo igual.
--   3. `checkpoint_json || 'null'::jsonb` convierte el objeto en ARRAY (Postgres
--      concatena como arrays). Un parámetro jsonb que n8n renderizaba como el texto
--      'null' dejaba el checkpoint como [ {...}, null, null, ... ] y el estado se
--      perdía: el paso volvía a `preparar_contexto` y pagaba otro turno.
--   4. El reconciliador redespachaba cada 10 s cualquier ejecución sin lease, con el
--      mismo owner 'reconciliador' para todas (dos cadenas paralelas pasaban el
--      claim como «renovación»), sin tope de recuperaciones.
--   5. Fan-out: loaders/auditoria_en_vivo.py --agentes n8n despacha un
--      FORENSE_investigar_cluster por hallazgo (5 especialistas + 4 roles de cierre
--      por hallazgo). Esa ruta queda sin coste LLM con `ia_solo_complemento=1`.
--
-- Qué añade:
--   §1 checkpoint robusto (save_checkpoint / finish_step nunca producen arrays).
--   §2 columnas de telemetría en ejecuciones_agente + precios + config IA.
--   §3 tope duro: índice único (investigacion_id, familia) y abrir_ia_complemento.
--   §4 presupuesto por ejecución y por investigación en reserve_request.
--   §5 validar_salida_rol alineado con agents.especialista.
--   §6 registrar_turno_ia / registrar_fin_agente (telemetría y pizarrón).
--   §7 cerrar_ia_complemento (nivel por código determinista).
--   §8 recuperar_pasos (reconciliador acotado) e ia_complementos_pendientes.
--   §9 bitácora (tipos nuevos), permisos y realtime.
--
-- Idempotente y portátil (Postgres local sin roles de Supabase). No se aplica en
-- remoto desde este worktree: la aplica el integrador designado.

-- ---------------------------------------------------------------------
-- §1 Checkpoint: un patch que no es objeto se ignora; un checkpoint ya
--    corrompido (array) se repara tomando su último objeto.
-- ---------------------------------------------------------------------

create or replace function forense.checkpoint_objeto(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when p is null then '{}'::jsonb
    when jsonb_typeof(p) = 'object' then p
    when jsonb_typeof(p) = 'array' then coalesce(
      (select x.v from jsonb_array_elements(p) with ordinality x(v, n)
        where jsonb_typeof(x.v) = 'object' order by x.n desc limit 1), '{}'::jsonb)
    else '{}'::jsonb
  end
$$;

create or replace function forense.save_checkpoint(
  p_execution_id uuid, p_fence bigint, p_revision_expected int, p_patch jsonb,
  p_lease_segundos int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; v_patch jsonb;
begin
  select * into e from forense.ejecuciones_agente where id = p_execution_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  if p_fence is distinct from e.fence_token then
    return jsonb_build_object('ok', false, 'error', 'lease_vencido',
                              'fence_actual', e.fence_token, 'fence_recibido', p_fence);
  end if;
  if p_revision_expected is distinct from e.revision then
    return jsonb_build_object('ok', false, 'error', 'revision_conflicto',
                              'revision_actual', e.revision);
  end if;
  if p_patch is not null and jsonb_typeof(p_patch) <> 'object' then
    -- Un patch que no es objeto NO se concatena: `obj || null` es un array.
    return jsonb_build_object('ok', false, 'error', 'patch_invalido',
                              'tipo', jsonb_typeof(p_patch), 'revision_actual', e.revision);
  end if;
  v_patch := coalesce(p_patch, '{}'::jsonb);

  update forense.ejecuciones_agente
     set checkpoint_json = forense.checkpoint_objeto(checkpoint_json) || v_patch,
         revision = revision + 1,
         estado_interno = coalesce(v_patch->>'estado_interno', estado_interno),
         paso = coalesce((v_patch->>'paso')::int, paso),
         paso_actual = coalesce(v_patch->>'estado_interno', paso_actual),
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_segundos, 1)),
         actualizado = now()
   where id = p_execution_id;

  return jsonb_build_object('ok', true, 'revision', e.revision + 1);
end $$;

create or replace function forense.finish_step(
  p_execution_id uuid, p_fence bigint, p_revision_expected int, p_estado_interno text,
  p_patch jsonb default '{}'::jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; v_estado_tarea text;
begin
  select * into e from forense.ejecuciones_agente where id = p_execution_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  if p_fence is distinct from e.fence_token then
    return jsonb_build_object('ok', false, 'error', 'lease_vencido', 'fence_actual', e.fence_token);
  end if;
  if p_revision_expected is distinct from e.revision then
    return jsonb_build_object('ok', false, 'error', 'revision_conflicto', 'revision_actual', e.revision);
  end if;

  update forense.ejecuciones_agente
     set checkpoint_json = forense.checkpoint_objeto(checkpoint_json)
                           || case when jsonb_typeof(p_patch) = 'object' then p_patch else '{}'::jsonb end,
         revision = revision + 1,
         paso = paso + 1,
         estado_interno = p_estado_interno,
         paso_actual = p_estado_interno,
         tool_en_curso = null,
         lease_owner = null,
         lease_expires_at = null,
         actualizado = now()
   where id = p_execution_id;

  if p_estado_interno in ('terminado','error','timeout') and e.tarea_id is not null then
    v_estado_tarea := case p_estado_interno
                        when 'terminado' then 'completada'
                        when 'timeout'   then 'timeout'
                        else 'error' end;
    update forense.tareas_agente
       set estado = v_estado_tarea, terminado = now(), error = p_error,
           lease_owner = null, lease_expires_at = null
     where id = e.tarea_id;
  end if;

  return jsonb_build_object('ok', true, 'revision', e.revision + 1,
                            'estado_interno', p_estado_interno, 'tarea_id', e.tarea_id,
                            'caso_id', e.caso_id);
end $$;

-- ---------------------------------------------------------------------
-- §2 Telemetría, precios y configuración IA
-- ---------------------------------------------------------------------

alter table forense.ejecuciones_agente add column if not exists investigacion_id uuid
  references forense.investigaciones(id) on delete set null;
alter table forense.ejecuciones_agente add column if not exists familia text
  check (familia is null or familia in ('D','F','R','T','E'));
alter table forense.ejecuciones_agente add column if not exists tokens_in int not null default 0;
alter table forense.ejecuciones_agente add column if not exists tokens_out int not null default 0;
alter table forense.ejecuciones_agente add column if not exists tokens_cache_lectura int not null default 0;
alter table forense.ejecuciones_agente add column if not exists tokens_cache_escritura int not null default 0;
alter table forense.ejecuciones_agente add column if not exists costo_usd numeric(12,6) not null default 0;
alter table forense.ejecuciones_agente add column if not exists n_requests int not null default 0;
alter table forense.ejecuciones_agente add column if not exists n_tools int not null default 0;
alter table forense.ejecuciones_agente add column if not exists paso_actual text;
alter table forense.ejecuciones_agente add column if not exists tool_en_curso text;
alter table forense.ejecuciones_agente add column if not exists iniciado_at timestamptz;
alter table forense.ejecuciones_agente add column if not exists terminado_at timestamptz;
alter table forense.ejecuciones_agente add column if not exists duracion_ms int;
alter table forense.ejecuciones_agente add column if not exists recuperaciones int not null default 0;

-- Reparación de checkpoints ya corrompidos por el bug de §1.
update forense.ejecuciones_agente
   set checkpoint_json = forense.checkpoint_objeto(checkpoint_json)
 where jsonb_typeof(checkpoint_json) <> 'object';

-- TOPE DURO: una ejecución por (investigación, familia) → como máximo 5.
create unique index if not exists ux_ejecuciones_ia_familia
  on forense.ejecuciones_agente (investigacion_id, familia)
  where investigacion_id is not null;
create index if not exists ix_ejecuciones_investigacion
  on forense.ejecuciones_agente (investigacion_id) where investigacion_id is not null;

-- Precios por millón de tokens. SUPUESTO sin verificar (verificado=false): el
-- coordinador debe confirmarlos contra la tarifa vigente de la cuenta. El coste es
-- una estimación para el tope, no una factura.
create table if not exists forense.precios_modelo (
  model_id               text primary key,
  usd_mtok_in            numeric(10,4) not null,
  usd_mtok_out           numeric(10,4) not null,
  usd_mtok_cache_lectura numeric(10,4) not null,
  usd_mtok_cache_escritura numeric(10,4) not null,
  verificado             boolean not null default false,
  fuente                 text
);
insert into forense.precios_modelo values
  ('claude-opus-5',   5.00, 25.00, 0.50, 6.25, false, 'supuesto 028: confirmar tarifa'),
  ('claude-sonnet-5', 3.00, 15.00, 0.30, 3.75, false, 'supuesto 028: confirmar tarifa'),
  ('claude-haiku-4-5-20251001', 1.00, 5.00, 0.10, 1.25, false, 'supuesto 028: confirmar tarifa; sin smoke')
on conflict (model_id) do nothing;

create table if not exists forense.config_ia (
  clave text primary key,
  valor text not null,
  nota  text
);
insert into forense.config_ia (clave, valor, nota) values
  ('modelo_workers', 'claude-sonnet-5',
   'Modelo de los 5 especialistas del complemento IA. sonnet verificado por smoke (config.mjs); haiku es el respaldo barato SIN smoke.')
on conflict (clave) do nothing;

insert into forense.config_presupuesto (clave, valor, nota) values
  ('ia_solo_complemento',             1, '028: 1 = solo los 5 especialistas del complemento IA (y el editor) pueden llamar al modelo'),
  ('ia_complemento_auto',             1, '028: el reconciliador lanza el complemento tras el auditor determinista'),
  ('ia_complemento_ventana_min',     30, '028: solo investigaciones completadas en los últimos N minutos'),
  ('ia_requests_por_ejecucion',       8, '028: turnos de modelo por especialista (incluye reparación)'),
  ('ia_tokens_por_ejecucion',    120000, '028: tokens in+out (sin caché) por especialista'),
  ('ia_tokens_por_investigacion',500000, '028: tokens in+out de los 5 especialistas juntos'),
  ('ia_costo_milusd_por_ejecucion', 1500, '028: milésimas de USD por especialista (1.50 USD)'),
  ('ia_costo_milusd_por_investigacion', 5000, '028: milésimas de USD por investigación (5.00 USD)'),
  ('ia_deadline_segundos',          900, '028: deadline de cada especialista'),
  ('max_recuperaciones_paso',         2, '028: redespachos del reconciliador antes de cerrar en error')
on conflict (clave) do nothing;

create or replace function forense.config_ia_texto(p_clave text, p_default text)
returns text language sql stable set search_path = '' as $$
  select coalesce((select c.valor from forense.config_ia c where c.clave = p_clave), p_default)
$$;

create or replace function forense.costo_usd(p_modelo text, p_usage jsonb)
returns numeric language sql stable set search_path = '' as $$
  select round((
      coalesce((p_usage->>'input_tokens')::numeric, 0) * p.usd_mtok_in
    + coalesce((p_usage->>'output_tokens')::numeric, 0) * p.usd_mtok_out
    + coalesce((p_usage->>'cache_read_input_tokens')::numeric, 0) * p.usd_mtok_cache_lectura
    + coalesce((p_usage->>'cache_creation_input_tokens')::numeric, 0) * p.usd_mtok_cache_escritura
    ) / 1000000.0, 6)
    from forense.precios_modelo p
   where p.model_id = coalesce(p_modelo, '')
  union all select 0 where not exists (select 1 from forense.precios_modelo p where p.model_id = coalesce(p_modelo, ''))
  limit 1
$$;

-- Pizarrón por agente: lo que cada especialista razonó, consultó y entregó.
-- El texto viene del modelo (puede reproducir datos _untrusted): privado, lo sirve
-- el BFF. Ningún veredicto depende de él.
create table if not exists forense.anotaciones_agente (
  id               bigserial primary key,
  corrida_id       uuid not null references forense.corridas(id) on delete cascade,
  investigacion_id uuid references forense.investigaciones(id) on delete cascade,
  caso_id          uuid references forense.casos(id) on delete cascade,
  ejecucion_id     uuid not null references forense.ejecuciones_agente(id) on delete cascade,
  rol              text not null,
  familia          text,
  turno            int not null,
  tipo             text not null check (tipo in ('razonamiento','consulta','salida','error')),
  texto            text,
  herramientas     text[] not null default '{}',
  senal_ids        bigint[] not null default '{}',
  tokens_in        int,
  tokens_out       int,
  costo_usd        numeric(12,6),
  creado           timestamptz not null default now()
);
create index if not exists ix_anotaciones_investigacion on forense.anotaciones_agente (investigacion_id, id);
create index if not exists ix_anotaciones_ejecucion on forense.anotaciones_agente (ejecucion_id, id);

-- ---------------------------------------------------------------------
-- §3 Complemento IA: contexto compacto y apertura idempotente de 5 agentes
-- ---------------------------------------------------------------------

create unique index if not exists ux_casos_ia_complemento
  on forense.casos (origen_valor) where origen = 'ia_complemento';

-- Referencia canónica de un registro del estate (mismo mapeo que
-- loaders/auditoria_en_vivo.py::referencias_canonicas).
create or replace function forense.referencia_estate(p_corrida uuid, p_tabla text, p_registro text)
returns text language sql stable set search_path = '' as $$
  select case p_tabla
    when 'invoices' then coalesce(
      (select 'CFDI:' || f.uuid::text from forense.cfdi f
        where f.corrida_id = p_corrida and f.id_origen = p_registro limit 1),
      'ATR:invoices:' || p_registro)
    when 'bank_txns' then coalesce(
      (select 'MOV:' || m.id::text from forense.movimientos m
        where m.corrida_id = p_corrida and m.id_origen = p_registro limit 1),
      'ATR:bank_txns:' || p_registro)
    else 'ATR:' || coalesce(p_tabla, 'desconocida') || ':' || p_registro
  end
$$;

create or replace function forense.rfc_de_entidad(p text)
returns text language sql immutable set search_path = '' as $$
  select case when p like 'RFC:%' then substr(p, 5)
              when p ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$' then p
              else null end
$$;

-- Paquete del complemento. Regla 5: topes fijos (6 hallazgos, 10 leads, 3
-- entidades y 3 registros por hallazgo, 40 RFC, textos recortados). Con el doble
-- de hallazgos el paquete pesa lo mismo; el detalle vive en las herramientas.
create or replace function forense.preparar_contexto_ia(p_caso uuid, p_run jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare k record; c record; v_out jsonb;
begin
  select * into k from forense.casos where id = p_caso;
  select * into c from forense.corridas where id = k.corrida_id;
  select jsonb_build_object(
    'modo', 'complemento_ia',
    'caso_id', k.id, 'cluster_id', k.cluster_id, 'corrida_id', k.corrida_id,
    'investigacion_id', k.origen_valor,
    'ronda', 1, 'intento', 0, 'version_contexto', 1,
    'fecha_corte', forense.fecha_iso(c.fecha_corte),
    'dataset_hash', c.dataset_hash,
    'familias_evaluables', to_jsonb(c.familias_evaluables),
    'rfc_principal', k.rfc_principal,
    'rfcs_autorizados', (select coalesce(to_jsonb(cl.rfcs[1:40]), '[]'::jsonb)
                           from forense.clusters cl where cl.id = k.cluster_id),
    'mision', 'El auditor determinista ya cerró esta auditoría. Busca lo que NO encontró: '
              || 'relaciones, periodos o contrapartes fuera de sus hallazgos, y leads que cerró '
              || 'con un motivo que tus herramientas contradigan. No repitas sus hallazgos. '
              || 'No fijas niveles ni montos: los calcula código determinista.',
    'determinista', jsonb_build_object(
      'n_hallazgos', coalesce(jsonb_array_length(p_run->'findings'), 0),
      'n_leads_cerrados', coalesce(jsonb_array_length(p_run->'leads'), 0),
      'hallazgos', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'esquema', f.v->>'scheme_type',
                 'entidades', (select coalesce(jsonb_agg(e.x), '[]'::jsonb)
                                 from (select t0.x from jsonb_array_elements(f.v->'entities') t0(x) limit 3) e),
                 'confianza', f.v->>'confidence',
                 'monto', (f.v->>'peso_amount'),
                 'regla', left(f.v->>'rule_broken', 100),
                 'registros', (select coalesce(jsonb_agg(forense.referencia_estate(k.corrida_id,
                                          ex.x->>'source_table', ex.x->>'record_id')), '[]'::jsonb)
                                 from (select t1.x from jsonb_array_elements(f.v->'exhibits') t1(x) limit 3) ex))
                 order by (f.v->>'peso_amount')::numeric desc nulls last, f.n)
          from (select v, n from jsonb_array_elements(coalesce(p_run->'findings', '[]'::jsonb))
                  with ordinality t(v, n)
                 order by (v->>'peso_amount')::numeric desc nulls last, n limit 6) f), '[]'::jsonb),
      'leads_cerrados', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'entidad', l.v->>'entity', 'como', l.v->>'investigated_as',
                 'cerrado_por', l.v->>'closed_by', 'motivo', left(l.v->>'reason', 90))
                 order by l.n)
          from (select v, n from jsonb_array_elements(coalesce(p_run->'leads', '[]'::jsonb))
                  with ordinality t(v, n) order by n limit 10) l), '[]'::jsonb)),
    'limites', jsonb_build_object(
      'requests_restantes', forense.config_int('ia_requests_por_ejecucion', 8),
      'input_tokens_max', forense.config_int('ia_tokens_por_ejecucion', 120000)),
    'cobertura', jsonb_build_object('completa', false,
      'datos_ausentes', jsonb_build_array('solo resumen del determinista; detalle vía herramientas'))
  ) into v_out;
  return v_out;
end $$;

create or replace function forense.abrir_ia_complemento(p_investigacion uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  i record; r record; v_corrida uuid; v_caso uuid; v_cluster uuid; v_rfcs text[];
  v_ctx jsonb; v_hash text; v_rol text; v_tarea uuid; v_tareas uuid[] := '{}';
  v_modelo text; v_deadline int; v_empresa text;
begin
  select * into i from forense.investigaciones where id = p_investigacion;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'investigacion_inexistente');
  end if;
  v_corrida := i.corrida_id;
  select * into r from forense.auditor_resultados where corrida_id = v_corrida;
  if not found then
    -- Los 5 corren SIEMPRE después del determinista, nunca antes.
    return jsonb_build_object('ok', false, 'motivo', 'auditor_determinista_pendiente',
                              'investigacion_id', p_investigacion, 'corrida_id', v_corrida);
  end if;

  perform pg_advisory_xact_lock(hashtext('ia_complemento:' || p_investigacion::text));

  select id, cluster_id into v_caso, v_cluster from forense.casos
   where origen = 'ia_complemento' and origen_valor = p_investigacion::text;
  if found then
    select coalesce(array_agg(t.id order by t.agente), '{}') into v_tareas
      from forense.tareas_agente t where t.caso_id = v_caso;
    return jsonb_build_object('ok', true, 'creado', false, 'motivo', 'ya_abierto',
      'caso_id', v_caso, 'cluster_id', v_cluster, 'corrida_id', v_corrida,
      'investigacion_id', p_investigacion, 'tarea_ids', to_jsonb(v_tareas));
  end if;

  v_empresa := coalesce(r.run_log->>'company_rfc', '');
  -- RFC autorizados (≤40): entidades del determinista primero, luego los RFC con más
  -- CFDI de la corrida. Tope fijo: el contexto no crece con el dataset.
  select coalesce(array_agg(x.rfc order by x.prio, x.orden, x.rfc), '{}') into v_rfcs
    from (select rfc, min(prio) prio, min(orden) orden from (
            select v_empresa rfc, 0 prio, 0::bigint orden where v_empresa <> ''
            union all
            select forense.rfc_de_entidad(e.v #>> '{}'), 1, e.n
              from jsonb_array_elements(coalesce(r.run_log->'findings', '[]'::jsonb)) f(v),
                   jsonb_array_elements(coalesce(f.v->'entities', '[]'::jsonb)) with ordinality e(v, n)
            union all
            select forense.rfc_de_entidad(l.v->>'entity'), 2, l.n
              from jsonb_array_elements(coalesce(r.run_log->'leads', '[]'::jsonb)) with ordinality l(v, n)
            union all
            select q.rfc, 3, q.rk from (
              select f.emisor_rfc rfc, row_number() over (order by count(*) desc, f.emisor_rfc) rk
                from forense.cfdi f where f.corrida_id = v_corrida and f.emisor_rfc is not null
               group by f.emisor_rfc) q where q.rk <= 40
          ) s where rfc is not null and rfc <> '' group by rfc
          order by min(prio), min(orden), rfc limit 40) x;

  insert into forense.clusters (corrida_id, rfcs, rfc_semilla, n_rfcs, score, huella, estado)
  values (v_corrida, v_rfcs, coalesce(v_rfcs[1], v_empresa), cardinality(v_rfcs), 0,
          'ia:' || p_investigacion::text, 'ronda1')
  on conflict (corrida_id, huella) do update set estado = 'ronda1'
  returning id into v_cluster;

  insert into forense.casos (corrida_id, cluster_id, rfc_principal, rfcs_satelite, origen, origen_valor,
                             estado, hipotesis, idempotency_key, cobertura_completa)
  values (v_corrida, v_cluster, coalesce(v_rfcs[1], v_empresa), coalesce(v_rfcs[2:40], '{}'),
          'ia_complemento', p_investigacion::text, 'ronda1',
          'Complemento IA: buscar lo que el auditor determinista no encontró',
          'ia:' || p_investigacion::text, false)
  returning id into v_caso;

  v_ctx := forense.preparar_contexto_ia(v_caso, r.run_log);
  v_hash := encode(sha256(convert_to(v_ctx::text, 'utf8')), 'hex');
  insert into forense.artefactos_contexto (hash, corrida_id, caso_id, contenido, bytes)
  values (v_hash, v_corrida, v_caso, v_ctx, length(v_ctx::text));

  v_modelo := forense.config_ia_texto('modelo_workers', 'claude-sonnet-5');
  v_deadline := greatest(forense.config_int('ia_deadline_segundos', 900), 60);

  foreach v_rol in array array['documental','financiero','relacional','temporal','externo'] loop
    insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda, intento,
                                       version_contexto, estado, idempotency_key)
    values (v_caso, v_corrida, v_cluster, v_rol, 1, 0, 1, 'pendiente',
            'ia:' || p_investigacion::text || ':' || v_rol)
    on conflict (idempotency_key) do nothing
    returning id into v_tarea;
    if v_tarea is null then
      select id into v_tarea from forense.tareas_agente
       where idempotency_key = 'ia:' || p_investigacion::text || ':' || v_rol;
    end if;
    v_tareas := v_tareas || v_tarea;
    insert into forense.ejecuciones_agente (corrida_id, caso_id, tarea_id, rol, context_hash, model_id,
                                            deadline_at, investigacion_id, familia, paso_actual)
    values (v_corrida, v_caso, v_tarea, v_rol, v_hash, v_modelo,
            now() + make_interval(secs => v_deadline), p_investigacion,
            forense.familia_de_agente(v_rol), 'preparar_contexto')
    on conflict do nothing;
  end loop;

  insert into forense.pasos_pipeline (caso_id, paso, intento, version_contexto, tareas_esperadas, estado, deadline)
  values (v_caso, 'ia', 0, 1, v_tareas, 'abierto', now() + make_interval(secs => v_deadline + 300))
  on conflict (caso_id, paso, intento, version_contexto) do nothing;

  perform forense.log(v_caso, 'sistema', 'ia_complemento_inicio',
    jsonb_build_object('investigacion_id', p_investigacion, 'agentes', 5,
                       'roles', jsonb_build_array('documental','financiero','relacional','temporal','externo'),
                       'modelo', v_modelo, 'context_hash', v_hash, 'bytes', length(v_ctx::text),
                       'n_rfcs_autorizados', cardinality(v_rfcs),
                       'presupuesto', jsonb_build_object(
                         'requests_por_agente', forense.config_int('ia_requests_por_ejecucion', 8),
                         'tokens_por_agente', forense.config_int('ia_tokens_por_ejecucion', 120000),
                         'tokens_total', forense.config_int('ia_tokens_por_investigacion', 500000),
                         'usd_por_agente', forense.config_int('ia_costo_milusd_por_ejecucion', 1500) / 1000.0,
                         'usd_total', forense.config_int('ia_costo_milusd_por_investigacion', 5000) / 1000.0),
                       'tareas', to_jsonb(v_tareas)),
    null, null, null, null, 1, v_cluster, null, v_corrida);

  return jsonb_build_object('ok', true, 'creado', true, 'motivo', null,
    'caso_id', v_caso, 'cluster_id', v_cluster, 'corrida_id', v_corrida,
    'investigacion_id', p_investigacion, 'tarea_ids', to_jsonb(v_tareas),
    'context_hash', v_hash);
end $$;

-- ---------------------------------------------------------------------
-- §4 reserve_request con presupuesto IA
-- ---------------------------------------------------------------------

create or replace function forense.reserve_request(
  p_execution_id uuid, p_fence bigint, p_request_id text,
  p_paso int default null, p_modelo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e record; s record; v_usadas int; v_total int; v_reserva int; v_techo int; v_bolsa text;
  v_motivo text; v_det jsonb;
  v_tok_inv bigint; v_costo_inv numeric;
begin
  select * into e from forense.ejecuciones_agente where id = p_execution_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  if p_fence is distinct from e.fence_token then
    return jsonb_build_object('ok', false, 'error', 'lease_vencido', 'fence_actual', e.fence_token);
  end if;

  select * into s from forense.llm_solicitudes where request_id = p_request_id;
  if found then
    update forense.llm_solicitudes
       set intento_transporte = intento_transporte + 1, actualizado = now()
     where request_id = p_request_id;
    return jsonb_build_object('ok', true, 'duplicado', true, 'request_id', p_request_id,
                              'estado', s.estado, 'intento_transporte', s.intento_transporte + 1);
  end if;

  v_bolsa := forense.bolsa_agente(e.rol);
  if e.editor_operacion_id is not null then
    v_bolsa := 'editor';
    v_techo := 3;
    select count(*) into v_usadas from forense.llm_solicitudes where ejecucion_id = p_execution_id;
    if v_usadas >= v_techo then
      v_motivo := 'requests'; v_det := jsonb_build_object('techo', v_techo, 'usadas', v_usadas);
    end if;
  elsif e.investigacion_id is null and forense.config_int('ia_solo_complemento', 1) = 1 then
    -- Tope duro de la investigación: fuera del complemento IA no hay coste LLM.
    v_motivo := 'fuera_de_complemento_ia';
    v_det := jsonb_build_object('regla', 'ia_solo_complemento=1');
  elsif e.investigacion_id is not null then
    select count(*) into v_usadas from forense.llm_solicitudes where ejecucion_id = p_execution_id;
    select coalesce(sum(x.tokens_in + x.tokens_out), 0), coalesce(sum(x.costo_usd), 0)
      into v_tok_inv, v_costo_inv
      from forense.ejecuciones_agente x where x.investigacion_id = e.investigacion_id;
    if v_usadas >= forense.config_int('ia_requests_por_ejecucion', 8) then
      v_motivo := 'requests_ejecucion';
    elsif e.tokens_in + e.tokens_out >= forense.config_int('ia_tokens_por_ejecucion', 120000) then
      v_motivo := 'tokens_ejecucion';
    elsif e.costo_usd * 1000 >= forense.config_int('ia_costo_milusd_por_ejecucion', 1500) then
      v_motivo := 'costo_ejecucion';
    elsif v_tok_inv >= forense.config_int('ia_tokens_por_investigacion', 500000) then
      v_motivo := 'tokens_investigacion';
    elsif v_costo_inv * 1000 >= forense.config_int('ia_costo_milusd_por_investigacion', 5000) then
      v_motivo := 'costo_investigacion';
    end if;
    v_det := jsonb_build_object('requests', v_usadas, 'tokens_ejecucion', e.tokens_in + e.tokens_out,
                                'costo_ejecucion_usd', e.costo_usd, 'tokens_investigacion', v_tok_inv,
                                'costo_investigacion_usd', v_costo_inv);
    v_techo := forense.config_int('ia_requests_por_ejecucion', 8);
  else
    v_total   := forense.config_int('requests_por_caso', 100);
    v_reserva := forense.config_int('reserva_cierre_requests', 34);
    v_techo   := case when v_bolsa = 'cierre' then v_total else v_total - v_reserva end;
    select count(*) into v_usadas
      from forense.llm_solicitudes l
      join forense.ejecuciones_agente x on x.id = l.ejecucion_id
     where x.caso_id = e.caso_id;
    if v_usadas >= v_techo then
      v_motivo := 'requests'; v_det := jsonb_build_object('techo', v_techo, 'usadas', v_usadas);
    end if;
  end if;

  if v_motivo is not null then
    if e.caso_id is not null then
      update forense.casos set presupuesto_agotado = true where id = e.caso_id;
      perform forense.log(e.caso_id, e.rol, 'presupuesto_agotado',
        jsonb_build_object('alcance', v_motivo, 'bolsa', v_bolsa, 'ejecucion_id', e.id) || coalesce(v_det, '{}'::jsonb),
        null, null, null, null, null, null, e.tarea_id, e.corrida_id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'presupuesto agotado', 'alcance', v_motivo,
                              'detalle', v_det);
  end if;

  insert into forense.llm_solicitudes (request_id, ejecucion_id, paso, estado, bolsa, modelo)
  values (p_request_id, p_execution_id, coalesce(p_paso, e.paso), 'reservado', v_bolsa, p_modelo);

  update forense.ejecuciones_agente
     set paso_actual = 'solicitar_modelo', iniciado_at = coalesce(iniciado_at, now())
   where id = p_execution_id;

  return jsonb_build_object('ok', true, 'duplicado', false, 'request_id', p_request_id,
                            'bolsa', v_bolsa, 'restante', greatest(coalesce(v_techo, 0) - (coalesce(v_usadas, 0) + 1), 0));
end $$;

-- ---------------------------------------------------------------------
-- §5 validar_salida_rol: especialistas contra agents.especialista
--    {senal_ids: string bigint[] ≤16, resumen 1..1200, limitaciones[] ≤40},
--    additionalProperties=false. Las señales citadas deben ser de ESTA tarea.
--    El resto de roles conserva la lógica de 023.
-- ---------------------------------------------------------------------

create or replace function forense.validar_salida_rol(
  p_ejecucion uuid, p_rol text, p_salida jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e record; v_err text[] := '{}'; v_ids text[]; x text; k text;
  v_corrida uuid; v_rol text;
begin
  select * into e from forense.ejecuciones_agente where id = p_ejecucion;
  if not found then
    return jsonb_build_object('ok', false, 'errores', to_jsonb(array['ejecucion inexistente']));
  end if;
  v_corrida := e.corrida_id;
  v_rol := e.rol;
  if p_rol is not null and p_rol <> v_rol then
    v_err := v_err || ('rol declarado (' || p_rol || ') distinto del de la ejecución (' || v_rol || ')');
  end if;

  if p_salida is null or jsonb_typeof(p_salida) <> 'object' then
    return jsonb_build_object('ok', false, 'rol', v_rol,
                              'errores', to_jsonb(v_err || array['salida no es un objeto JSON']));
  end if;

  if v_rol in ('documental','financiero','relacional','temporal','externo') then
    for k in select jsonb_object_keys(p_salida) loop
      if k not in ('senal_ids','resumen','limitaciones') then
        v_err := v_err || ('campo no permitido por agents.especialista: ' || left(k, 40));
      end if;
    end loop;
    if jsonb_typeof(p_salida->'resumen') is distinct from 'string'
       or length(p_salida->>'resumen') = 0 or length(p_salida->>'resumen') > 1200 then
      v_err := v_err || array['resumen requerido (1..1200 caracteres)'];
    end if;
    if jsonb_typeof(p_salida->'limitaciones') is distinct from 'array' then
      v_err := v_err || array['limitaciones requerido (array, puede ir vacío)'];
    elsif jsonb_array_length(p_salida->'limitaciones') > 40 then
      v_err := v_err || array['limitaciones: máximo 40'];
    end if;
    if jsonb_typeof(p_salida->'senal_ids') is distinct from 'array' then
      v_err := v_err || array['senal_ids requerido (array de IDs devueltos por forense_escribir_senal, puede ir vacío)'];
    elsif jsonb_array_length(p_salida->'senal_ids') > 16 then
      v_err := v_err || array['senal_ids: máximo 16'];
    else
      for x in select jsonb_array_elements_text(p_salida->'senal_ids') loop
        if x !~ '^[1-9][0-9]{0,18}$' then
          v_err := v_err || ('senal_id no es un entero positivo: ' || left(x, 40));
        elsif not exists (select 1 from forense.senales s
                           where s.id = x::bigint and s.tarea_id = e.tarea_id) then
          v_err := v_err || ('senal_id que esta tarea no escribió: ' || x);
        end if;
      end loop;
    end if;
  elsif v_rol = 'auditor' then
    if not (p_salida ? 'hipotesis') then v_err := v_err || array['falta hipotesis']; end if;
    if (p_salida ? 'nivel') then
      v_err := v_err || array['el auditor no fija el nivel: lo calcula el dictaminador determinista'];
    end if;
  elsif v_rol = 'defensor' then
    if not (p_salida ? 'resultado')
       or (p_salida->>'resultado') not in ('refuta','parcial','no_refuta') then
      v_err := v_err || array['resultado de defensa fuera del catálogo'];
    end if;
  elsif v_rol = 'redactor' then
    if not (p_salida ? 'markdown') and not (p_salida ? 'contenido_json') then
      v_err := v_err || array['el expediente necesita markdown o contenido_json'];
    end if;
    if position('Trayectoria' in coalesce(p_salida->>'markdown', '')) = 0
       and jsonb_typeof(p_salida->'secciones') is distinct from 'array' then
      v_err := v_err || array['falta la sección obligatoria Trayectoria (21 §2)'];
    end if;
    if position('Cadena de explicación' in coalesce(p_salida->>'markdown', '')) = 0
       and jsonb_typeof(p_salida->'secciones') is distinct from 'array' then
      v_err := v_err || array['falta la sección obligatoria Cadena de explicación (21 §4)'];
    end if;
  end if;

  if p_salida::text ~* '"definitivo"' and v_rol <> 'externo' then
    v_err := v_err || array['la palabra definitivo no es un nivel de salida del sistema'];
  end if;

  select coalesce(array_agg(distinct t.v), '{}') into v_ids from (
    select jsonb_array_elements_text(p_salida->'ids') as v
     where jsonb_typeof(p_salida->'ids') = 'array'
    union all
    select jsonb_array_elements_text(p_salida->'referencias') as v
     where jsonb_typeof(p_salida->'referencias') = 'array') t;

  foreach x in array v_ids loop
    if x !~ '^(CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR):[^[:space:]]+$' then
      v_err := v_err || ('referencia fuera del espacio de nombres: ' || left(x, 80));
    elsif x like 'CFDI:%' then
      if not exists (select 1 from forense.cfdi f
                      where f.corrida_id = v_corrida and f.uuid::text = replace(x, 'CFDI:', '')) then
        v_err := v_err || ('CFDI citado que no existe en la corrida: ' || left(x, 80));
      end if;
    elsif x like 'MOV:%' then
      if not exists (select 1 from forense.movimientos m
                      where m.corrida_id = v_corrida and m.id::text = replace(x, 'MOV:', '')) then
        v_err := v_err || ('movimiento citado que no existe en la corrida: ' || left(x, 80));
      end if;
    end if;
  end loop;

  if jsonb_typeof(p_salida->'monto_en_riesgo') = 'number' or jsonb_typeof(p_salida->'monto') = 'number' then
    v_err := v_err || array['los importes viajan como cadena decimal, no como número'];
  end if;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_err, 1), 0) = 0,
    'rol', v_rol, 'ejecucion_id', p_ejecucion,
    'errores', coalesce(to_jsonb(v_err), '[]'::jsonb),
    'ids_verificados', coalesce(array_length(v_ids, 1), 0));
end $$;

-- ---------------------------------------------------------------------
-- §6 Telemetría por turno y fin de agente. Orden de locks: caso (forense.log →
--    next_seq) ANTES que ejecución, igual que 17 §4.
-- ---------------------------------------------------------------------

create or replace function forense.registrar_turno_ia(
  p_ejecucion uuid, p_request_id text, p_usage jsonb, p_modelo text, p_stop_reason text,
  p_herramientas text[], p_texto text, p_estado_interno text,
  p_salida_valida boolean default null, p_salida jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e record; v_tin int; v_tout int; v_cr int; v_cw int; v_costo numeric; v_turno int;
  v_tools text[]; v_senales bigint[];
begin
  select * into e from forense.ejecuciones_agente where id = p_ejecucion;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  v_tin  := coalesce((p_usage->>'input_tokens')::int, 0);
  v_tout := coalesce((p_usage->>'output_tokens')::int, 0);
  v_cr   := coalesce((p_usage->>'cache_read_input_tokens')::int, 0);
  v_cw   := coalesce((p_usage->>'cache_creation_input_tokens')::int, 0);
  v_costo := forense.costo_usd(coalesce(p_modelo, e.model_id), p_usage);
  v_turno := e.n_requests + 1;
  v_tools := coalesce(p_herramientas, '{}');

  if e.caso_id is not null then
    perform forense.log(e.caso_id, e.rol, 'agente_turno',
      jsonb_build_object('ejecucion_id', e.id, 'familia', e.familia, 'turno', v_turno,
        'request_id', p_request_id, 'stop_reason', p_stop_reason, 'herramientas', to_jsonb(v_tools),
        'estado_interno', p_estado_interno, 'salida_valida', p_salida_valida,
        'tokens_in', v_tin, 'tokens_out', v_tout, 'cache_lectura', v_cr, 'cache_escritura', v_cw,
        'costo_usd', v_costo,
        'acumulado', jsonb_build_object('tokens_in', e.tokens_in + v_tin, 'tokens_out', e.tokens_out + v_tout,
                                        'costo_usd', e.costo_usd + v_costo, 'requests', v_turno)),
      null, v_tin, v_tout, coalesce(p_modelo, e.model_id), null, null, e.tarea_id, e.corrida_id);
  end if;

  update forense.ejecuciones_agente
     set tokens_in = tokens_in + v_tin, tokens_out = tokens_out + v_tout,
         tokens_cache_lectura = tokens_cache_lectura + v_cr,
         tokens_cache_escritura = tokens_cache_escritura + v_cw,
         costo_usd = costo_usd + v_costo,
         n_requests = n_requests + 1,
         n_tools = n_tools + cardinality(v_tools),
         paso_actual = coalesce(p_estado_interno, paso_actual),
         tool_en_curso = case when cardinality(v_tools) > 0 then array_to_string(v_tools, ',') else null end,
         iniciado_at = coalesce(iniciado_at, now())
   where id = p_ejecucion;

  if p_salida_valida is true and jsonb_typeof(p_salida->'senal_ids') = 'array' then
    select coalesce(array_agg(x::bigint), '{}') into v_senales
      from jsonb_array_elements_text(p_salida->'senal_ids') x where x ~ '^[1-9][0-9]{0,18}$';
  end if;

  insert into forense.anotaciones_agente (corrida_id, investigacion_id, caso_id, ejecucion_id, rol, familia,
                                          turno, tipo, texto, herramientas, senal_ids, tokens_in, tokens_out, costo_usd)
  select e.corrida_id, e.investigacion_id, e.caso_id, e.id, e.rol, e.familia, v_turno,
         case when p_salida_valida is true then 'salida'
              when p_salida_valida is false then 'error'
              when cardinality(v_tools) > 0 then 'consulta'
              else 'razonamiento' end,
         left(coalesce(case when p_salida_valida is true then p_salida->>'resumen' end, p_texto), 600),
         v_tools, coalesce(v_senales, '{}'), v_tin, v_tout, v_costo
   where e.corrida_id is not null
     and (coalesce(p_texto, '') <> '' or cardinality(v_tools) > 0 or p_salida_valida is not null);

  return jsonb_build_object('ok', true, 'turno', v_turno, 'costo_usd', v_costo,
                            'tokens_in', v_tin, 'tokens_out', v_tout);
end $$;

create or replace function forense.registrar_fin_agente(p_ejecucion uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; v_dur int;
begin
  select * into e from forense.ejecuciones_agente where id = p_ejecucion;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  v_dur := (extract(epoch from (now() - coalesce(e.iniciado_at, e.creado))) * 1000)::int;
  if e.caso_id is not null and e.terminado_at is null then
    perform forense.log(e.caso_id, e.rol, 'agente_fin',
      jsonb_build_object('ejecucion_id', e.id, 'familia', e.familia, 'estado_interno', e.estado_interno,
                         'requests', e.n_requests, 'tools', e.n_tools,
                         'tokens_in', e.tokens_in, 'tokens_out', e.tokens_out,
                         'cache_lectura', e.tokens_cache_lectura, 'costo_usd', e.costo_usd,
                         'duracion_ms', v_dur),
      v_dur, e.tokens_in, e.tokens_out, e.model_id, null, null, e.tarea_id, e.corrida_id);
  end if;
  update forense.ejecuciones_agente
     set terminado_at = coalesce(terminado_at, now()), duracion_ms = coalesce(duracion_ms, v_dur),
         paso_actual = estado_interno, tool_en_curso = null
   where id = p_ejecucion;
  return jsonb_build_object('ok', true, 'caso_id', e.caso_id, 'duracion_ms', v_dur);
end $$;

-- ---------------------------------------------------------------------
-- §7 Cierre determinista del complemento. El LLM no decide el nivel (regla 4):
--    sin señales → sin_hallazgos; con señales → no_concluyente (leads que el
--    determinista debe confirmar). Nunca presuncion/presuncion_alta desde IA.
--    No toca casos del auditor.
-- ---------------------------------------------------------------------

create or replace function forense.cerrar_ia_complemento(p_caso uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k record; r record; v_det text[]; v_n int; v_nov int; v_fam text[]; v_nivel text; v_regla text;
  v_tin bigint; v_tout bigint; v_costo numeric; v_agentes jsonb; v_dur int;
begin
  select * into k from forense.casos where id = p_caso and origen = 'ia_complemento' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_es_complemento_ia');
  end if;
  if k.estado = 'dictaminado' then
    return jsonb_build_object('ok', true, 'caso_id', p_caso, 'nivel', k.nivel, 'ya_cerrado', true);
  end if;

  -- Lo que siga vivo se corta: sin esto un agente tardío seguiría gastando.
  update forense.ejecuciones_agente
     set cancelada = true, estado_interno = 'timeout', paso_actual = 'timeout',
         lease_owner = null, lease_expires_at = null, terminado_at = coalesce(terminado_at, now())
   where caso_id = p_caso and estado_interno not in ('terminado','error','timeout');
  update forense.tareas_agente
     set estado = 'timeout', terminado = now(), lease_owner = null, lease_expires_at = null
   where caso_id = p_caso and estado not in ('completada','error','timeout','omitida');

  select * into r from forense.auditor_resultados where corrida_id = k.corrida_id;
  select coalesce(array_agg(distinct forense.rfc_de_entidad(e.v #>> '{}')), '{}') into v_det
    from jsonb_array_elements(coalesce(r.run_log->'findings', '[]'::jsonb)) f(v),
         jsonb_array_elements(coalesce(f.v->'entities', '[]'::jsonb)) e(v)
   where forense.rfc_de_entidad(e.v #>> '{}') is not null;

  select count(*), count(*) filter (where not (coalesce(s.rfcs, '{}') && v_det)),
         coalesce(array_agg(distinct s.familia) filter (where s.familia is not null), '{}')
    into v_n, v_nov, v_fam
    from forense.senales s where s.caso_id = p_caso;

  if v_n = 0 then
    v_nivel := 'sin_hallazgos';
    v_regla := 'ia.sin_senales';
  else
    v_nivel := 'no_concluyente';
    v_regla := 'ia.senales_requieren_confirmacion_determinista';
  end if;

  select coalesce(sum(tokens_in), 0), coalesce(sum(tokens_out), 0), coalesce(sum(costo_usd), 0),
         coalesce(jsonb_agg(jsonb_build_object('rol', rol, 'familia', familia, 'estado_interno', estado_interno,
                                               'requests', n_requests, 'tokens_in', tokens_in,
                                               'tokens_out', tokens_out, 'costo_usd', costo_usd)
                            order by familia), '[]'::jsonb)
    into v_tin, v_tout, v_costo, v_agentes
    from forense.ejecuciones_agente where caso_id = p_caso;
  v_dur := (extract(epoch from (now() - k.creado)) * 1000)::int;

  perform forense.log(p_caso, 'sistema', 'ia_complemento_fin',
    jsonb_build_object('nivel', v_nivel, 'regla', v_regla, 'n_senales', v_n, 'n_fuera_del_determinista', v_nov,
                       'familias', to_jsonb(v_fam), 'tokens_in', v_tin, 'tokens_out', v_tout,
                       'costo_usd', v_costo, 'agentes', v_agentes, 'investigacion_id', k.origen_valor),
    v_dur, v_tin::int, v_tout::int, null, null, k.cluster_id, null, k.corrida_id);
  perform forense.log(p_caso, 'sistema', 'dictamen',
    jsonb_build_object('nivel', v_nivel, 'regla', v_regla, 'origen', 'ia_complemento',
                       'determinista', true, 'n_senales', v_n),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  update forense.casos
     set estado = 'dictaminado', nivel = v_nivel,
         hipotesis = 'Complemento IA: ' || v_n || ' señal(es), ' || v_nov
                     || ' fuera de los hallazgos deterministas; nivel por regla ' || v_regla,
         tokens_total = (v_tin + v_tout)::int, duracion_ms = v_dur, terminado = now()
   where id = p_caso;
  update forense.clusters set estado = 'cerrado' where id = k.cluster_id;
  update forense.pasos_pipeline set estado = 'cerrado', cerrado = now()
   where caso_id = p_caso and paso = 'ia' and estado = 'abierto';

  return jsonb_build_object('ok', true, 'caso_id', p_caso, 'nivel', v_nivel, 'regla', v_regla,
                            'n_senales', v_n, 'n_fuera_del_determinista', v_nov,
                            'tokens_in', v_tin, 'tokens_out', v_tout, 'costo_usd', v_costo,
                            'investigacion_id', k.origen_valor);
end $$;

-- ---------------------------------------------------------------------
-- §8 Reconciliador acotado y disparo automático del complemento
-- ---------------------------------------------------------------------

create or replace function forense.recuperar_pasos(p_owner_base text, p_limite int default 8)
returns table (execution_id uuid, caso_id uuid, tarea_id uuid, corrida_id uuid, rol text, owner text)
language plpgsql security definer set search_path = '' as $$
declare v_max int := forense.config_int('max_recuperaciones_paso', 2); c record;
begin
  for c in
    select e.id, e.caso_id, e.tarea_id, e.corrida_id, e.rol, e.recuperaciones
      from forense.ejecuciones_agente e
     where e.estado_interno not in ('terminado','error','timeout')
       and not e.cancelada
       and e.lease_owner is null
       and (e.deadline_at is null or e.deadline_at > now())
       -- No compite con el despacho normal: solo lo que lleva 60 s quieto.
       and e.actualizado < now() - interval '60 seconds'
     order by e.actualizado
     limit greatest(coalesce(p_limite, 8), 0)
     for update skip locked
  loop
    if c.recuperaciones >= v_max then
      if c.caso_id is not null then
        perform forense.log(c.caso_id, c.rol, 'error',
          jsonb_build_object('ejecucion_id', c.id, 'motivo', 'recuperaciones_agotadas',
                             'recuperaciones', c.recuperaciones),
          null, null, null, null, null, null, c.tarea_id, c.corrida_id);
      end if;
      update forense.ejecuciones_agente
         set estado_interno = 'error', paso_actual = 'error', terminado_at = coalesce(terminado_at, now()),
             actualizado = now()
       where id = c.id;
      update forense.tareas_agente set estado = 'error', terminado = now(), error = 'recuperaciones_agotadas'
       where id = c.tarea_id and estado not in ('completada','error','timeout','omitida');
    else
      update forense.ejecuciones_agente
         set recuperaciones = recuperaciones + 1, actualizado = now()
       where id = c.id;
      execution_id := c.id; caso_id := c.caso_id; tarea_id := c.tarea_id;
      corrida_id := c.corrida_id; rol := c.rol;
      -- Owner ÚNICO por redespacho: dos cadenas no pueden compartir lease.
      owner := coalesce(p_owner_base, 'reconciliador') || ':' || c.id::text || ':' || (c.recuperaciones + 1)::text;
      return next;
    end if;
  end loop;
end $$;

create or replace function forense.ia_complementos_pendientes(p_limite int default 2)
returns table (investigacion_id uuid, corrida_id uuid)
language sql stable security definer set search_path = '' as $$
  select i.id, i.corrida_id
    from forense.investigaciones i
   where forense.config_int('ia_complemento_auto', 1) = 1
     and i.estado = 'investigacion_completa'
     and i.corrida_id is not null
     and coalesce(i.completada_at, i.actualizado) > now()
         - make_interval(mins => forense.config_int('ia_complemento_ventana_min', 30))
     and exists (select 1 from forense.auditor_resultados a where a.corrida_id = i.corrida_id)
     and not exists (select 1 from forense.casos c
                      where c.origen = 'ia_complemento' and c.origen_valor = i.id::text)
   order by coalesce(i.completada_at, i.actualizado)
   limit greatest(coalesce(p_limite, 2), 0)
$$;

-- Vista para el BFF: telemetría sin checkpoint ni transcript.
create or replace view forense.v_agentes_ia as
  select e.id as ejecucion_id, e.investigacion_id, e.corrida_id, e.caso_id, e.tarea_id, e.rol, e.familia,
         e.model_id, e.estado_interno, e.paso_actual, e.tool_en_curso, e.n_requests, e.n_tools,
         e.tokens_in, e.tokens_out, e.tokens_cache_lectura, e.tokens_cache_escritura, e.costo_usd,
         e.iniciado_at, e.terminado_at, e.duracion_ms, e.recuperaciones, e.deadline_at, e.actualizado,
         t.estado as estado_tarea
    from forense.ejecuciones_agente e
    left join forense.tareas_agente t on t.id = e.tarea_id
   where e.investigacion_id is not null;

-- ---------------------------------------------------------------------
-- §9 Bitácora, permisos, realtime
-- ---------------------------------------------------------------------

alter table forense.bitacora drop constraint if exists ck_bitacora_tipo_evento;
alter table forense.bitacora add constraint ck_bitacora_tipo_evento check (
  tipo_evento is null or tipo_evento in (
    'caso_creado','cluster_armado','pista_cargada','ronda_inicio','ronda_fin',
    'razonamiento','tool_call','tool_result','senal_escrita','senal_leida',
    'despertar','frontera_detectada','cluster_expandido',
    'auditoria','defensa_inicio','defensa_argumento','replica',
    'validacion','evidencia_descartada','dictamen',
    'rechazo_auditor_final','reintento_inicio',
    'redaccion_inicio','redaccion_fin','edicion',
    'error','presupuesto_agotado',
    'inyeccion','corrida_cargada',
    'paso_en_cola','paso_checkpoint',
    'ia_complemento_inicio','ia_complemento_fin','agente_turno','agente_fin'
  )
) not valid;

alter table forense.anotaciones_agente enable row level security;
alter table forense.precios_modelo enable row level security;
alter table forense.config_ia enable row level security;

do $$
declare f text;
begin
  foreach f in array array[
    'forense.checkpoint_objeto(jsonb)', 'forense.config_ia_texto(text,text)',
    'forense.costo_usd(text,jsonb)', 'forense.referencia_estate(uuid,text,text)',
    'forense.rfc_de_entidad(text)', 'forense.preparar_contexto_ia(uuid,jsonb)',
    'forense.abrir_ia_complemento(uuid)',
    'forense.registrar_turno_ia(uuid,text,jsonb,text,text,text[],text,text,boolean,jsonb)',
    'forense.registrar_fin_agente(uuid)', 'forense.cerrar_ia_complemento(uuid)',
    'forense.recuperar_pasos(text,int)', 'forense.ia_complementos_pendientes(int)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on forense.anotaciones_agente, forense.precios_modelo, forense.config_ia to service_role';
    execute 'grant usage, select on sequence forense.anotaciones_agente_id_seq to service_role';
    execute 'grant select on forense.v_agentes_ia to service_role';
  end if;
  -- anon/authenticated: NADA nuevo. La UI lee telemetría por BFF privado; lo
  -- público en vivo son los eventos de bitácora (ya con realtime + SELECT anon).
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on forense.v_agentes_ia from anon';
  end if;
end $$;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['anotaciones_agente'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'forense' and tablename = t) then
        execute format('alter publication supabase_realtime add table forense.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Fin 028_ia_complemento.sql
