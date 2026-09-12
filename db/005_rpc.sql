-- =====================================================================
-- 005_rpc.sql — Las 11 herramientas del agente, las 3 funciones de sistema
-- y las funciones de runtime que invocan los workflows de n8n.
--
-- Fuentes normativas: docs/06 (plantilla, envelope, límites, ACL),
-- docs/17 §4 y §8 (control de runtime y validación de salida),
-- contracts/schemas/tools.schema.json (envelope y argumentos v1),
-- n8n/workflows/MANIFEST.md §2–§7 (nombres y firmas que el runtime llama).
--
-- Reglas duras que este archivo hace cumplir en la base, no en el prompt:
--   * Toda RPC pasa por forense.reservar_tool (002): escribe tool_call,
--     cobra cuota y devuelve el contexto autorizado. El LLM solo decide los
--     argumentos de investigación; caso, corrida, agente, ronda e intento
--     salen de la tarea.
--   * Envelope único {ok,data,referencias,cobertura,truncado,has_more,
--     next_cursor,error}; los errores viajan como dato, nunca como raise.
--   * Texto libre con sufijo _untrusted. Ninguna RPC toca ground_truth.
--   * Límites duros: p_saltos ≤ 4, p_prof ≤ 5, p_limite ≤ 50; si el agente
--     pide más se recorta y se anota en cobertura.datos_ausentes.
--   * p_operacion identifica (tarea, paso, tool_use_id): repetir transporte
--     devuelve el resultado registrado y no vuelve a consumir cuota.
--   * REVOKE por firma exacta (nunca `on all functions in schema public`:
--     eso le quitaría gen_random_uuid() a PUBLIC y rompería los DEFAULT).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Ajustes aditivos de esquema que esta migración necesita
-- ---------------------------------------------------------------------

-- El contrato entities.senal exige tarea_id: sin él la señal no se puede
-- proyectar ni atribuir a la ejecución que la escribió.
alter table forense.senales add column if not exists tarea_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_senales_tarea') then
    alter table forense.senales
      add constraint fk_senales_tarea foreign key (tarea_id)
      references forense.tareas_agente(id) on delete set null;
  end if;
end $$;

-- MANIFEST §3 nodo 6: "Idempotente por idempotency_key".
-- El índice NO es parcial a propósito: Postgres ya admite varios NULL en un
-- índice único, y un índice parcial obligaría a repetir su predicado en cada
-- ON CONFLICT (donde olvidarlo falla en tiempo de ejecución, no al crear).
alter table forense.casos add column if not exists idempotency_key text;
drop index if exists forense.ux_casos_idempotency;
create unique index ux_casos_idempotency on forense.casos (idempotency_key);

-- `v_casos_lista` se define en 002 como `select k.*, ...`: al añadir una
-- columna a `casos` cambia el orden de columnas de la vista y un
-- `create or replace` posterior de 002 fallaría ("cannot change name of view
-- column"). Se recrea aquí con la MISMA definición para que 002 vuelva a ser
-- reaplicable sobre una base ya migrada a 005.
drop view if exists forense.v_casos_lista;
create view forense.v_casos_lista with (security_invoker = true) as
select k.*, c.razon_social, c.giro,
       (select count(*) from forense.evidencia e where e.caso_id = k.id and e.validada) as n_evidencia,
       (select count(*) from forense.defensas d where d.caso_id = k.id and d.resultado <> 'no_refuta') as n_defensas,
       cl.n_rfcs as cluster_tamano
from forense.casos k
left join forense.contribuyentes c on c.rfc = k.rfc_principal and c.corrida_id = k.corrida_id
left join forense.clusters cl on cl.id = k.cluster_id;

do $$
declare rol text;
begin
  foreach rol in array array['service_role','anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = rol) then
      execute format('grant select on forense.v_casos_lista to %I', rol);
    end if;
  end loop;
end $$;

-- Ledger de operaciones de herramienta (docs/06 §Contrato del dispatcher).
create table if not exists forense.tool_operaciones (
  operacion_id uuid primary key,
  caso_id      uuid references forense.casos(id) on delete cascade,
  tarea_id     uuid references forense.tareas_agente(id) on delete cascade,
  herramienta  text not null,
  args_hash    text not null,
  resultado    jsonb not null,
  creado       timestamptz default now()
);
create index if not exists ix_tool_operaciones_tarea on forense.tool_operaciones (tarea_id, creado);

do $$
begin
  execute 'alter table forense.tool_operaciones enable row level security';
  execute 'drop policy if exists lectura on forense.tool_operaciones';
end $$;

-- ---------------------------------------------------------------------
-- 1. Formato del envelope (contracts tools.envelope v1)
-- ---------------------------------------------------------------------

create or replace function forense.fecha_iso(p_ts timestamptz)
returns text language sql immutable set search_path = '' as $$
  select case when p_ts is null then null
              else to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end
$$;

-- Los montos viajan como cadena decimal: el modelo no los recalcula y el
-- transporte JSON no les quita precisión (docs/05 §DTO).
create or replace function forense.importe_txt(p_n numeric)
returns text language sql immutable set search_path = '' as $$
  select case when p_n is null then null
              else to_char(round(p_n, 2), 'FM99999999999990.00') end
$$;

create or replace function forense.refs_json(p_refs text[])
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce((
    select jsonb_agg(r order by r)
      from (select distinct x as r
              from unnest(coalesce(p_refs, '{}'::text[])) x
             where x ~ '^(CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR):[^[:space:]]+$'
               and length(x) <= 512
             limit 100) t
  ), '[]'::jsonb)
$$;

create or replace function forense.cobertura_json(
  p_completa boolean, p_desde timestamptz, p_hasta timestamptz,
  p_familias text[] default '{}', p_ausentes text[] default '{}')
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'completa', coalesce(p_completa, false),
    'periodo', case when p_desde is null or p_hasta is null then null
                    else jsonb_build_object(
                      'desde', forense.fecha_iso(p_desde),
                      'hasta_exclusivo', forense.fecha_iso(p_hasta),
                      'timezone', 'UTC') end,
    'familias_evaluables', coalesce((
      select jsonb_agg(distinct f) from unnest(coalesce(p_familias, '{}'::text[])) f
       where f in ('D','F','R','T','E')), '[]'::jsonb),
    'datos_ausentes', coalesce((
      select jsonb_agg(distinct a) from unnest(coalesce(p_ausentes, '{}'::text[])) a), '[]'::jsonb))
$$;

create or replace function forense.envelope_ok(
  p_data jsonb, p_referencias jsonb default '[]'::jsonb, p_cobertura jsonb default null,
  p_truncado boolean default false, p_has_more boolean default false,
  p_next_cursor text default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'ok', true,
    'data', coalesce(p_data, '{}'::jsonb),
    'referencias', coalesce(p_referencias, '[]'::jsonb),
    'cobertura', coalesce(p_cobertura, forense.cobertura_json(true, null, null)),
    -- has_more ⇒ truncado y cursor; sin has_more el cursor es null (contrato)
    'truncado', coalesce(p_truncado, false) or coalesce(p_has_more, false),
    'has_more', coalesce(p_has_more, false),
    'next_cursor', case when coalesce(p_has_more, false) then p_next_cursor else null end,
    'error', null)
$$;

create or replace function forense.envelope_error(
  p_codigo text, p_mensaje text, p_reintentable boolean default false,
  p_cobertura jsonb default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'ok', false,
    'data', null,
    'referencias', '[]'::jsonb,
    'cobertura', coalesce(p_cobertura, forense.cobertura_json(false, null, null)),
    'truncado', false,
    'has_more', false,
    'next_cursor', null,
    'error', jsonb_build_object(
      'codigo', case when p_codigo in ('presupuesto_agotado','lease_vencido','contexto_invalido',
                                       'argumento_invalido','no_evaluable','fallo_transitorio',
                                       'conflicto_version','salida_invalida','no_autorizado')
                     then p_codigo else 'contexto_invalido' end,
      'mensaje', left(coalesce(p_mensaje, 'error sin mensaje'), 1200),
      'reintentable', coalesce(p_reintentable, false)))
$$;

-- ---------------------------------------------------------------------
-- 2. Identidad y ACL (docs/06 §ACL). Comprobadas en DB, no en el prompt.
-- ---------------------------------------------------------------------

create or replace function forense.familia_de_agente(p_agente text)
returns text language sql immutable set search_path = '' as $$
  select case p_agente
           when 'documental' then 'D'
           when 'financiero' then 'F'
           when 'relacional' then 'R'
           when 'temporal'   then 'T'
           when 'externo'    then 'E'
           else null end
$$;

create or replace function forense.rol_de_familia(p_familia text)
returns text language sql immutable set search_path = '' as $$
  select case p_familia
           when 'D' then 'documental'
           when 'F' then 'financiero'
           when 'R' then 'relacional'
           when 'T' then 'temporal'
           when 'E' then 'externo'
           else null end
$$;

-- Un especialista de ronda 1 investiga su cluster y su familia; no lee el
-- pizarrón. Auditor y Defensor leen todas las familias del MISMO caso aunque
-- su tarea traiga ronda=1.
create or replace function forense.acl_permite(p_ctx jsonb, p_tool text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_tool = 'leer_senal' then
      (p_ctx->>'agente') in ('auditor','defensor','replica','redactor')
      or coalesce((p_ctx->>'ronda')::int, 1) >= 2
      or coalesce((p_ctx->>'intento')::int, 0) >= 1
    else true
  end
$$;

-- El universo de RFC autorizado es el cluster más su frontera declarada.
create or replace function forense.rfc_en_contexto(p_ctx jsonb, p_rfc text)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from forense.clusters cl
     where cl.id = (p_ctx->>'cluster_id')::uuid
       and (p_rfc = any(coalesce(cl.rfcs, '{}'::text[]))
            or p_rfc = any(coalesce(cl.rfcs_frontera, '{}'::text[])))
  ) or exists (
    select 1 from forense.casos k
     where k.id = (p_ctx->>'caso_id')::uuid
       and (k.rfc_principal = p_rfc or p_rfc = any(coalesce(k.rfcs_satelite, '{}'::text[])))
  )
$$;

-- ---------------------------------------------------------------------
-- 3. Apertura y cierre de una llamada de herramienta.
--    abrir_tool: idempotencia por operación → reserva de cuota → contexto.
--    cerrar_tool: tool_result en bitácora + registro de la operación.
-- ---------------------------------------------------------------------

create or replace function forense.abrir_tool(
  p_caso uuid, p_tarea uuid, p_tool text, p_args jsonb default '{}'::jsonb,
  p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ctx jsonb; op record; v_err text;
begin
  if p_operacion is not null then
    select * into op from forense.tool_operaciones where operacion_id = p_operacion;
    if found then
      -- Reentrega del mismo tool_use_id: resultado registrado, sin cuota nueva.
      return jsonb_build_object('ok', true, 'duplicado', true, 'resultado', op.resultado);
    end if;
  end if;

  ctx := forense.reservar_tool(p_caso, p_tarea, p_tool, coalesce(p_args, '{}'::jsonb));
  if coalesce((ctx->>'ok')::boolean, false) then
    return ctx || jsonb_build_object('duplicado', false);
  end if;

  v_err := ctx->>'error';
  return jsonb_build_object(
    'ok', false, 'duplicado', false,
    'envelope', forense.envelope_error(
      case
        when v_err = 'presupuesto agotado' then 'presupuesto_agotado'
        when v_err in ('lease_vencido','contexto_invalido') then v_err
        else 'contexto_invalido'
      end,
      coalesce(ctx->>'detalle', v_err) || coalesce(' (' || (ctx->>'alcance') || ')', ''),
      false));
end $$;

create or replace function forense.cerrar_tool(
  p_ctx jsonb, p_tool text, p_operacion uuid, p_envelope jsonb,
  p_t0 timestamptz, p_cache_hit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform forense.log(
    (p_ctx->>'caso_id')::uuid, p_ctx->>'agente', 'tool_result',
    jsonb_build_object('tool', p_tool, 'ok', p_envelope->'ok',
                       'cache', coalesce(p_cache_hit, false),
                       'operacion', p_operacion,
                       'error', p_envelope->'error',
                       'result', p_envelope),
    (extract(epoch from clock_timestamp() - p_t0) * 1000)::int,
    null, null, null, (p_ctx->>'ronda')::int, (p_ctx->>'cluster_id')::uuid,
    (p_ctx->>'tarea_id')::uuid);

  if p_operacion is not null then
    insert into forense.tool_operaciones (operacion_id, caso_id, tarea_id, herramienta, args_hash, resultado)
    values (p_operacion, (p_ctx->>'caso_id')::uuid, (p_ctx->>'tarea_id')::uuid,
            p_tool, coalesce(p_ctx->>'args_hash', ''), p_envelope)
    on conflict (operacion_id) do nothing;
  end if;
  return p_envelope;
end $$;

-- Cursor keyset (fecha, uuid) ligado a corrida y filtros: opaco para el
-- modelo, validado por backend. Jamás SQL enviado por el modelo.
create or replace function forense.cursor_codificar(p_fecha timestamptz, p_uuid uuid, p_sig text)
returns text language sql immutable set search_path = '' as $$
  select encode(convert_to(jsonb_build_object(
    'f', forense.fecha_iso(p_fecha), 'u', p_uuid::text, 's', p_sig)::text, 'utf8'), 'base64')
$$;

create or replace function forense.cursor_decodificar(p_cursor text, p_sig text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare j jsonb;
begin
  if p_cursor is null or p_cursor = '' then return null; end if;
  begin
    j := convert_from(decode(p_cursor, 'base64'), 'utf8')::jsonb;
  exception when others then
    return jsonb_build_object('error', 'cursor ilegible');
  end;
  if (j->>'s') is distinct from p_sig then
    return jsonb_build_object('error', 'cursor de otra consulta');
  end if;
  return j;
end $$;

-- =====================================================================
-- 4. Las 11 herramientas del agente (public.forense_*)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4.1 forense_perfil
-- ---------------------------------------------------------------------
create or replace function public.forense_perfil(
  p_caso uuid, p_agente text, p_rfc text, p_tarea uuid,
  p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; r jsonb; h text; cache_hit boolean := false; env jsonb;
  v_corrida uuid; v_cluster uuid; v_corte timestamptz; v_version int;
  v_fam text[]; v_familia text; v_refs text[] := '{}'; v_ausentes text[] := '{}';
  v_existe boolean;
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'perfil', jsonb_build_object('rfc', p_rfc), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  v_cluster := (ctx->>'cluster_id')::uuid;
  v_corte   := (ctx->>'fecha_corte')::timestamptz;
  v_version := (ctx->>'version_contexto')::int;
  v_familia := forense.familia_de_agente(ctx->>'agente');
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  if not forense.rfc_en_contexto(ctx, p_rfc) then
    return forense.cerrar_tool(ctx, 'perfil', p_operacion,
      forense.envelope_error('no_autorizado',
        'el RFC no pertenece al cluster autorizado ni a su frontera', false), t0);
  end if;

  h := md5(jsonb_build_object('rfc', p_rfc, 'corte', v_corte)::text);
  r := forense.cache_get(v_corrida, v_cluster, v_version, 'perfil', h);
  cache_hit := r is not null;

  if r is null then
    with fv as (
      select * from forense.cfdi
       where corrida_id = v_corrida
         and fecha > v_corte - interval '12 months' and fecha <= v_corte
    )
    select jsonb_build_object(
      'rfc', c.rfc, 'giro', c.giro, 'tipo_persona', c.tipo_persona,
      'fecha_alta', c.fecha_alta::text,
      'empleados_declarados', c.empleados_declarados,
      'razon_social_untrusted', c.razon_social,
      'facturado_12m', forense.importe_txt((select coalesce(sum(total),0) from fv
                          where emisor_rfc = c.rfc and tipo = 'I' and not cancelado)),
      'recibido_12m', forense.importe_txt((select coalesce(sum(total),0) from fv
                          where receptor_rfc = c.rfc and tipo = 'I' and not cancelado)),
      'nomina_12m', forense.importe_txt((select coalesce(sum(total),0) from fv
                          where emisor_rfc = c.rfc and tipo = 'N' and not cancelado)),
      'n_clientes', (select count(distinct receptor_rfc) from fv
                      where emisor_rfc = c.rfc and tipo = 'I' and not cancelado),
      'n_proveedores', (select count(distinct emisor_rfc) from fv
                      where receptor_rfc = c.rfc and tipo = 'I' and not cancelado),
      'tasa_cancelacion', (select round(avg(cancelado::int), 3) from fv
                      where emisor_rfc = c.rfc and tipo = 'I'),
      'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
                            'clabe', cu.clabe, 'banco', cu.banco, 'tipo', cu.tipo, 'moneda', cu.moneda)
                            order by cu.clabe)
                           from forense.cuentas cu
                          where cu.corrida_id = v_corrida and cu.rfc_titular = c.rfc), '[]'::jsonb),
      'listas_sat', coalesce((select jsonb_agg(jsonb_build_object(
                            'lista', l.lista, 'estatus', l.estatus,
                            'fecha_publicacion', l.fecha_publicacion::text) order by l.fecha_publicacion)
                           from forense.listas_sat l
                          where l.corrida_id = v_corrida and l.rfc = c.rfc
                            and l.fecha_publicacion <= v_corte::date), '[]'::jsonb))
      into r
      from forense.contribuyentes c
     where c.corrida_id = v_corrida and c.rfc = p_rfc;

    if r is null then
      -- Contraparte sin fila en el padrón: entidad técnica incompleta, no un
      -- error de argumento (docs/19 §Identidad).
      r := jsonb_build_object('rfc', p_rfc, 'entidad_tecnica_incompleta', true,
                              'giro', null, 'razon_social_untrusted', null);
    end if;
    perform forense.cache_put(v_corrida, v_cluster, v_version, 'perfil', h, r);
  end if;

  v_existe := not coalesce((r->>'entidad_tecnica_incompleta')::boolean, false);
  if not v_existe then v_ausentes := v_ausentes || array['padron']; end if;
  if coalesce(jsonb_array_length(r->'cuentas'), 0) = 0 then v_ausentes := v_ausentes || array['cuentas']; end if;

  -- Pistas del RFC. En ronda 1 un especialista solo ve las de SU familia.
  r := r || jsonb_build_object('pistas', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id::text, 'codigo', p.codigo, 'familia', p.familia,
             'score', p.score,
             'estado', coalesce(k.evaluacion_pistas->(p.id::text)->>'estado', p.estado),
             'resumen', p.detalle->>'resumen',
             'referencias', coalesce(p.detalle->'referencias', '[]'::jsonb)) order by p.codigo, p.id)
      from forense.pistas p
      join forense.casos k on k.id = (ctx->>'caso_id')::uuid
     where p.corrida_id = v_corrida and p.rfc = p_rfc
       and (v_familia is null
            or coalesce((ctx->>'ronda')::int, 1) >= 2
            or coalesce((ctx->>'intento')::int, 0) >= 1
            or p.familia = v_familia)
  ), '[]'::jsonb));

  if v_familia is not null and coalesce((ctx->>'ronda')::int, 1) = 1
     and coalesce((ctx->>'intento')::int, 0) = 0 then
    v_ausentes := v_ausentes || array['pistas_de_otras_familias'];
  end if;

  select coalesce(array_agg('LISTA:' || p_rfc || ':' || (e->>'estatus') || ':' || (e->>'fecha_publicacion')), '{}')
    into v_refs from jsonb_array_elements(r->'listas_sat') e;

  env := forense.envelope_ok(
    r, forense.refs_json(v_refs),
    forense.cobertura_json(v_existe, v_corte - interval '12 months', v_corte, v_fam, v_ausentes));
  return forense.cerrar_tool(ctx, 'perfil', p_operacion, env, t0, cache_hit);
end $$;

-- ---------------------------------------------------------------------
-- 4.2 forense_facturas — cursor keyset estable (fecha, uuid). p_hasta exclusivo.
-- ---------------------------------------------------------------------
create or replace function public.forense_facturas(
  p_caso uuid, p_agente text, p_rfc text, p_rol text,
  p_desde timestamptz, p_hasta timestamptz, p_limite int, p_tarea uuid,
  p_cursor text default null, p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; v_corrida uuid; v_corte timestamptz; v_fam text[];
  v_limite int; v_ausentes text[] := '{}'; v_sig text; v_cur jsonb;
  v_cf timestamptz := null; v_cu uuid := null;
  filas jsonb := '[]'::jsonb; v_refs text[] := '{}';
  v_has_more boolean := false; v_next text := null; v_truncado boolean := false;
  v_desde timestamptz; v_hasta timestamptz; fila record; n int := 0;
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'facturas',
           jsonb_build_object('rfc', p_rfc, 'rol', p_rol, 'desde', p_desde,
                              'hasta', p_hasta, 'limite', p_limite, 'cursor', p_cursor),
           p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  v_corte   := (ctx->>'fecha_corte')::timestamptz;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  if p_rol not in ('emisor','receptor') then
    return forense.cerrar_tool(ctx, 'facturas', p_operacion,
      forense.envelope_error('argumento_invalido', 'p_rol debe ser emisor o receptor', false), t0);
  end if;
  if not forense.rfc_en_contexto(ctx, p_rfc) then
    return forense.cerrar_tool(ctx, 'facturas', p_operacion,
      forense.envelope_error('no_autorizado', 'RFC fuera del cluster autorizado', false), t0);
  end if;

  -- Límite duro: se recorta en silencio y se anota (docs/06 regla 1).
  v_limite := least(greatest(coalesce(p_limite, 50), 1), 50);
  if coalesce(p_limite, 50) > 50 then v_ausentes := v_ausentes || array['limite_recortado_a_50']; end if;

  v_desde := coalesce(p_desde, v_corte - interval '12 months');
  v_hasta := least(coalesce(p_hasta, v_corte + interval '1 second'), v_corte + interval '1 second');
  if coalesce(p_hasta, v_corte) > v_corte then v_ausentes := v_ausentes || array['ventana_recortada_a_fecha_corte']; end if;

  v_sig := md5(v_corrida::text || '|' || p_rfc || '|' || p_rol || '|' ||
               forense.fecha_iso(v_desde) || '|' || forense.fecha_iso(v_hasta));
  if p_cursor is not null then
    v_cur := forense.cursor_decodificar(p_cursor, v_sig);
    if v_cur is null or (v_cur ? 'error') then
      return forense.cerrar_tool(ctx, 'facturas', p_operacion,
        forense.envelope_error('argumento_invalido',
          coalesce(v_cur->>'error', 'cursor invalido'), false), t0);
    end if;
    v_cf := (v_cur->>'f')::timestamptz;
    v_cu := (v_cur->>'u')::uuid;
  end if;

  for fila in
    select f.uuid, f.fecha, f.total, f.metodo_pago, f.forma_pago, f.clave_prod_serv,
           f.cancelado, f.tipo, f.descripcion,
           case when p_rol = 'emisor' then f.receptor_rfc else f.emisor_rfc end as contraparte
      from forense.cfdi f
     where f.corrida_id = v_corrida
       and ((p_rol = 'emisor' and f.emisor_rfc = p_rfc) or (p_rol = 'receptor' and f.receptor_rfc = p_rfc))
       and f.fecha >= v_desde and f.fecha < v_hasta
       and (v_cf is null or (f.fecha, f.uuid) > (v_cf, v_cu))
     order by f.fecha, f.uuid
     limit v_limite + 1
  loop
    n := n + 1;
    if n > v_limite then
      v_has_more := true;
      exit;
    end if;
    filas := filas || jsonb_build_array(jsonb_build_object(
      'uuid', fila.uuid::text,
      'tipo', fila.tipo,
      'contraparte', fila.contraparte,
      'fecha', forense.fecha_iso(fila.fecha),
      'total', forense.importe_txt(fila.total),
      'metodo_pago', fila.metodo_pago,
      'forma_pago', fila.forma_pago,
      'clave_prod_serv', fila.clave_prod_serv,
      'cancelado', fila.cancelado,
      'descripcion_untrusted', fila.descripcion));
    v_refs := v_refs || ('CFDI:' || fila.uuid::text);
    v_cf := fila.fecha; v_cu := fila.uuid;
  end loop;

  -- Tope de 4,000 caracteres por página: se recortan FILAS completas, nunca
  -- se corta una cita a la mitad (docs/06 regla 4).
  while length(filas::text) > 4000 and jsonb_array_length(filas) > 1 loop
    filas := filas - (jsonb_array_length(filas) - 1);
    v_refs := v_refs[1:array_length(v_refs, 1) - 1];
    v_truncado := true;
    v_has_more := true;
    v_cf := ((filas->(jsonb_array_length(filas) - 1))->>'fecha')::timestamptz;
    v_cu := ((filas->(jsonb_array_length(filas) - 1))->>'uuid')::uuid;
  end loop;

  if v_has_more then
    v_next := forense.cursor_codificar(v_cf, v_cu, v_sig);
  end if;

  env := forense.envelope_ok(
    jsonb_build_object('rfc', p_rfc, 'rol', p_rol, 'n', jsonb_array_length(filas),
                       'desde', forense.fecha_iso(v_desde),
                       'hasta_exclusivo', forense.fecha_iso(v_hasta),
                       'filas', filas),
    forense.refs_json(v_refs),
    forense.cobertura_json(not v_has_more, v_desde, v_hasta, v_fam, v_ausentes),
    v_truncado, v_has_more, v_next);
  return forense.cerrar_tool(ctx, 'facturas', p_operacion, env, t0);
end $$;

-- ---------------------------------------------------------------------
-- 4.3 forense_conciliar
-- ---------------------------------------------------------------------
create or replace function public.forense_conciliar(
  p_caso uuid, p_agente text, p_uuid uuid, p_tarea uuid,
  p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; v_corrida uuid; v_cluster uuid; v_corte timestamptz; v_version int;
  v_fam text[]; f record; v_movs jsonb; v_comp jsonb; v_estado text;
  v_refs text[] := '{}'; h text; r jsonb; cache_hit boolean := false;
  v_ausentes text[] := '{}';
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'conciliar', jsonb_build_object('uuid', p_uuid), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  v_cluster := (ctx->>'cluster_id')::uuid;
  v_corte   := (ctx->>'fecha_corte')::timestamptz;
  v_version := (ctx->>'version_contexto')::int;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  select * into f from forense.cfdi where corrida_id = v_corrida and uuid = p_uuid;
  if not found then
    return forense.cerrar_tool(ctx, 'conciliar', p_operacion,
      forense.envelope_error('argumento_invalido', 'CFDI inexistente en esta corrida', false), t0);
  end if;
  if not (forense.rfc_en_contexto(ctx, f.emisor_rfc) or forense.rfc_en_contexto(ctx, f.receptor_rfc)) then
    return forense.cerrar_tool(ctx, 'conciliar', p_operacion,
      forense.envelope_error('no_autorizado', 'el CFDI no toca al cluster autorizado', false), t0);
  end if;

  h := md5(jsonb_build_object('uuid', p_uuid, 'corte', v_corte)::text);
  r := forense.cache_get(v_corrida, v_cluster, v_version, 'conciliar', h);
  cache_hit := r is not null;

  if r is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', m.id::text, 'fecha', forense.fecha_iso(m.fecha),
             'monto', forense.importe_txt(m.monto), 'moneda', m.moneda, 'tipo', m.tipo,
             'cuenta_origen', m.cuenta_origen, 'cuenta_destino', m.cuenta_destino,
             'titular_origen', co.rfc_titular, 'titular_destino', cd.rfc_titular,
             'del_receptor', (co.rfc_titular is not distinct from f.receptor_rfc),
             'dias', round(extract(epoch from m.fecha - f.fecha) / 86400.0, 2),
             'desvio_pct', round(abs(m.monto - f.total) / nullif(f.total, 0), 4),
             'referencia_untrusted', m.referencia) order by m.fecha, m.id), '[]'::jsonb)
      into v_movs
      from forense.movimientos m
      left join forense.cuentas co on co.corrida_id = v_corrida and co.clabe = m.cuenta_origen
      left join forense.cuentas cd on cd.corrida_id = v_corrida and cd.clabe = m.cuenta_destino
     where m.corrida_id = v_corrida
       and cd.rfc_titular is not distinct from f.emisor_rfc
       and m.fecha between f.fecha - interval '7 days' and f.fecha + interval '7 days'
       and abs(m.monto - f.total) <= f.total * 0.02;

    select coalesce(jsonb_agg(jsonb_build_object(
             'uuid_pago', cp.uuid_pago::text, 'fecha', forense.fecha_iso(cp.fecha),
             'monto', forense.importe_txt(cp.monto)) order by cp.fecha), '[]'::jsonb)
      into v_comp
      from forense.complementos_pago cp
     where cp.corrida_id = v_corrida and cp.uuid_cfdi = p_uuid;

    v_estado := case
      when f.metodo_pago = 'PPD' and jsonb_array_length(v_comp) = 0 then 'ppd_sin_complemento'
      when jsonb_array_length(v_movs) = 0 then 'sin_pago'
      when exists (select 1 from jsonb_array_elements(v_movs) x
                    where coalesce((x->>'del_receptor')::boolean, false)) then 'pagado_directo'
      else 'pagado_tercero' end;

    r := jsonb_build_object(
      'cfdi', jsonb_build_object(
        'uuid', f.uuid::text, 'tipo', f.tipo, 'emisor_rfc', f.emisor_rfc,
        'receptor_rfc', f.receptor_rfc, 'fecha', forense.fecha_iso(f.fecha),
        'total', forense.importe_txt(f.total), 'moneda', f.moneda,
        'metodo_pago', f.metodo_pago, 'forma_pago', f.forma_pago,
        'cancelado', f.cancelado, 'descripcion_untrusted', f.descripcion),
      'movimientos_candidatos', v_movs,
      'complementos', v_comp,
      'estado', v_estado,
      'criterio', jsonb_build_object('ventana_dias', 7, 'tolerancia_monto_pct', 0.02));
    perform forense.cache_put(v_corrida, v_cluster, v_version, 'conciliar', h, r);
  end if;

  v_refs := array['CFDI:' || p_uuid::text];
  select v_refs || coalesce(array_agg('MOV:' || (x->>'id')), '{}')
    into v_refs from jsonb_array_elements(r->'movimientos_candidatos') x;

  if not exists (select 1 from forense.cuentas cu
                  where cu.corrida_id = v_corrida and cu.rfc_titular = (r->'cfdi'->>'receptor_rfc')) then
    v_ausentes := v_ausentes || array['cuentas_del_receptor'];
  end if;

  env := forense.envelope_ok(r, forense.refs_json(v_refs),
    forense.cobertura_json(array_length(v_ausentes, 1) is null,
      (r->'cfdi'->>'fecha')::timestamptz - interval '7 days',
      (r->'cfdi'->>'fecha')::timestamptz + interval '7 days', v_fam, v_ausentes));
  return forense.cerrar_tool(ctx, 'conciliar', p_operacion, env, t0, cache_hit);
end $$;

-- ---------------------------------------------------------------------
-- 4.4 forense_seguir_dinero — árbol de salidas, p_saltos ≤ 4
-- ---------------------------------------------------------------------
create or replace function public.forense_seguir_dinero(
  p_caso uuid, p_agente text, p_cuenta text, p_desde timestamptz,
  p_saltos int, p_monto_min numeric, p_tarea uuid,
  p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; v_corrida uuid; v_corte timestamptz; v_fam text[];
  v_saltos int; v_ausentes text[] := '{}'; v_refs text[] := '{}';
  v_ramas jsonb; v_titular text; v_desde timestamptz; v_podadas int := 0;
  v_monto_min numeric;
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'seguir_dinero',
           jsonb_build_object('cuenta', p_cuenta, 'desde', p_desde,
                              'saltos', p_saltos, 'monto_min', p_monto_min), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  v_corte   := (ctx->>'fecha_corte')::timestamptz;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  select rfc_titular into v_titular from forense.cuentas
   where corrida_id = v_corrida and clabe = p_cuenta;
  if v_titular is null and not exists (select 1 from forense.cuentas
                                        where corrida_id = v_corrida and clabe = p_cuenta) then
    return forense.cerrar_tool(ctx, 'seguir_dinero', p_operacion,
      forense.envelope_error('argumento_invalido', 'cuenta inexistente en esta corrida', false), t0);
  end if;
  if v_titular is not null and not forense.rfc_en_contexto(ctx, v_titular) then
    return forense.cerrar_tool(ctx, 'seguir_dinero', p_operacion,
      forense.envelope_error('no_autorizado', 'la cuenta no pertenece al cluster autorizado', false), t0);
  end if;

  v_saltos := least(greatest(coalesce(p_saltos, 2), 1), 4);
  if coalesce(p_saltos, 2) > 4 then v_ausentes := v_ausentes || array['saltos_recortados_a_4']; end if;
  v_desde := coalesce(p_desde, v_corte - interval '12 months');
  v_monto_min := greatest(coalesce(p_monto_min, 0), 0);

  with recursive arbol as (
    select m.id, m.cuenta_origen, m.cuenta_destino, m.fecha, m.monto, m.tipo,
           1 as salto, m.monto as monto_raiz,
           array[m.id] as ruta
      from forense.movimientos m
     where m.corrida_id = v_corrida and m.cuenta_origen = p_cuenta
       and m.fecha >= v_desde and m.fecha <= v_corte
       and m.monto >= v_monto_min
    union all
    select m.id, m.cuenta_origen, m.cuenta_destino, m.fecha, m.monto, m.tipo,
           a.salto + 1, a.monto_raiz, a.ruta || m.id
      from arbol a
      join forense.movimientos m
        on m.corrida_id = v_corrida and m.cuenta_origen = a.cuenta_destino
       and m.fecha >= a.fecha and m.fecha <= v_corte
       and m.monto >= v_monto_min
       and m.monto <= a.monto * 1.05
     where a.salto < v_saltos
       and not (m.id = any(a.ruta))
  ),
  acotado as (
    select * , row_number() over (order by salto, monto desc, id) as rn
      from arbol
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id::text, 'salto', a.salto,
           'cuenta_origen', a.cuenta_origen, 'cuenta_destino', a.cuenta_destino,
           'fecha', forense.fecha_iso(a.fecha), 'monto', forense.importe_txt(a.monto),
           'tipo_movimiento', a.tipo,
           'titular_destino', cd.rfc_titular,
           'tipo_destino', coalesce(cd.tipo, case when a.tipo = 'efectivo' then 'efectivo' else 'desconocido' end),
           'conservado_del_origen', round(a.monto / nullif(a.monto_raiz, 0), 4)
         ) order by a.salto, a.id), '[]'::jsonb)
    into v_ramas
    from acotado a
    left join forense.cuentas cd on cd.corrida_id = v_corrida and cd.clabe = a.cuenta_destino
   where a.rn <= 60;

  select count(*)::int into v_podadas from (
    select 1 from forense.movimientos m
     where m.corrida_id = v_corrida and m.cuenta_origen = p_cuenta
       and m.fecha >= v_desde and m.fecha <= v_corte and m.monto < v_monto_min) x;
  if v_podadas > 0 then v_ausentes := v_ausentes || array['ramas_bajo_monto_min']; end if;
  if jsonb_array_length(v_ramas) >= 60 then v_ausentes := v_ausentes || array['ramas_truncadas_en_60']; end if;

  select coalesce(array_agg('MOV:' || (x->>'id')), '{}') into v_refs
    from jsonb_array_elements(v_ramas) x;

  env := forense.envelope_ok(
    jsonb_build_object('cuenta', p_cuenta, 'titular', v_titular,
                       'saltos', v_saltos, 'monto_min', forense.importe_txt(v_monto_min),
                       'n_ramas', jsonb_array_length(v_ramas), 'ramas', v_ramas),
    forense.refs_json(v_refs),
    forense.cobertura_json(array_length(v_ausentes, 1) is null, v_desde, v_corte, v_fam, v_ausentes),
    jsonb_array_length(v_ramas) >= 60, false, null);
  return forense.cerrar_tool(ctx, 'seguir_dinero', p_operacion, env, t0);
end $$;

-- ---------------------------------------------------------------------
-- 4.5 forense_relacionados
-- ---------------------------------------------------------------------
create or replace function public.forense_relacionados(
  p_caso uuid, p_agente text, p_rfc text, p_tarea uuid,
  p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; v_corrida uuid; v_cluster uuid; v_corte timestamptz; v_version int;
  v_fam text[]; h text; r jsonb; cache_hit boolean := false; v_refs text[] := '{}';
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'relacionados', jsonb_build_object('rfc', p_rfc), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  v_cluster := (ctx->>'cluster_id')::uuid;
  v_corte   := (ctx->>'fecha_corte')::timestamptz;
  v_version := (ctx->>'version_contexto')::int;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  if not forense.rfc_en_contexto(ctx, p_rfc) then
    return forense.cerrar_tool(ctx, 'relacionados', p_operacion,
      forense.envelope_error('no_autorizado', 'RFC fuera del cluster autorizado', false), t0);
  end if;

  h := md5(jsonb_build_object('rfc', p_rfc, 'corte', v_corte)::text);
  r := forense.cache_get(v_corrida, v_cluster, v_version, 'relacionados', h);
  cache_hit := r is not null;

  if r is null then
    with mios as (
      select a.atributo, a.valor from forense.atributos_entidad a
       where a.corrida_id = v_corrida and a.rfc = p_rfc
         and a.atributo in ('domicilio','representante','email','telefono','clabe','grupo','contrato_factoraje')
    ),
    pares as (
      select a.rfc, a.atributo, a.valor
        from forense.atributos_entidad a
        join mios m on m.atributo = a.atributo and m.valor = a.valor
       where a.corrida_id = v_corrida and a.rfc <> p_rfc
    ),
    agg as (
      select p.rfc,
             jsonb_agg(distinct jsonb_build_object('atributo', p.atributo,
                                                   'valor_hash', md5(p.valor))) as atributos,
             (select count(*) from forense.cfdi f
               where f.corrida_id = v_corrida and f.tipo = 'I' and not f.cancelado
                 and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
                 and ((f.emisor_rfc = p_rfc and f.receptor_rfc = p.rfc)
                      or (f.emisor_rfc = p.rfc and f.receptor_rfc = p_rfc))) as n_cfdi_entre,
             (select count(*) from forense.movimientos m2
                join forense.cuentas co on co.corrida_id = v_corrida and co.clabe = m2.cuenta_origen
                join forense.cuentas cd on cd.corrida_id = v_corrida and cd.clabe = m2.cuenta_destino
               where m2.corrida_id = v_corrida and m2.fecha <= v_corte
                 and ((co.rfc_titular = p_rfc and cd.rfc_titular = p.rfc)
                      or (co.rfc_titular = p.rfc and cd.rfc_titular = p_rfc))) as n_mov_entre
        from pares p group by p.rfc
    )
    select jsonb_build_object(
      'rfc', p_rfc,
      'n_relacionados', (select count(*) from agg),
      'relacionados', coalesce((select jsonb_agg(jsonb_build_object(
          'rfc', a.rfc,
          'atributos_compartidos', a.atributos,
          'se_facturan_entre_si', (a.n_cfdi_entre > 0),
          'n_cfdi_entre', a.n_cfdi_entre,
          'hay_flujo_de_dinero', (a.n_mov_entre > 0),
          'n_movimientos_entre', a.n_mov_entre,
          'en_69b', exists (select 1 from forense.listas_sat l
                             where l.corrida_id = v_corrida and l.rfc = a.rfc
                               and l.lista like '69B%' and l.fecha_publicacion <= v_corte::date
                               and l.estatus not in ('desvirtuado','sentencia_favorable')))
          order by a.rfc) from agg a), '[]'::jsonb))
      into r;
    perform forense.cache_put(v_corrida, v_cluster, v_version, 'relacionados', h, r);
  end if;

  select coalesce(array_agg('ATR:' || (at->>'atributo') || ':' || (at->>'valor_hash')), '{}')
    into v_refs
    from jsonb_array_elements(r->'relacionados') x,
         jsonb_array_elements(x->'atributos_compartidos') at;

  env := forense.envelope_ok(r, forense.refs_json(v_refs),
    forense.cobertura_json(true, v_corte - interval '12 months', v_corte, v_fam, '{}'));
  return forense.cerrar_tool(ctx, 'relacionados', p_operacion, env, t0, cache_hit);
end $$;

-- ---------------------------------------------------------------------
-- 4.6 forense_ciclos — p_prof ≤ 5, rotación canónica, hubs excluidos
-- ---------------------------------------------------------------------
create or replace function public.forense_ciclos(
  p_caso uuid, p_agente text, p_rfc text, p_prof int, p_tarea uuid,
  p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; v_corrida uuid; v_cluster uuid; v_corte timestamptz; v_version int;
  v_fam text[]; v_prof int; v_ausentes text[] := '{}'; v_refs text[] := '{}';
  h text; r jsonb; cache_hit boolean := false; v_hubs int;
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'ciclos',
           jsonb_build_object('rfc', p_rfc, 'prof', p_prof), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  v_cluster := (ctx->>'cluster_id')::uuid;
  v_corte   := (ctx->>'fecha_corte')::timestamptz;
  v_version := (ctx->>'version_contexto')::int;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  if not forense.rfc_en_contexto(ctx, p_rfc) then
    return forense.cerrar_tool(ctx, 'ciclos', p_operacion,
      forense.envelope_error('no_autorizado', 'RFC fuera del cluster autorizado', false), t0);
  end if;

  v_prof := least(greatest(coalesce(p_prof, 5), 1), 5);
  if coalesce(p_prof, 5) > 5 then v_ausentes := v_ausentes || array['profundidad_recortada_a_5']; end if;

  h := md5(jsonb_build_object('rfc', p_rfc, 'prof', v_prof, 'corte', v_corte)::text);
  r := forense.cache_get(v_corrida, v_cluster, v_version, 'ciclos', h);
  cache_hit := r is not null;

  if r is null then
    with recursive hubs as (
      select emisor_rfc as rfc from forense.cfdi
       where corrida_id = v_corrida and tipo = 'I' and not cancelado
         and fecha <= v_corte and fecha > v_corte - interval '12 months'
       group by emisor_rfc having count(distinct receptor_rfc) > 40
    ),
    f as (
      select emisor_rfc, receptor_rfc, uuid, total, fecha
        from forense.cfdi
       where corrida_id = v_corrida and tipo = 'I' and not cancelado
         and fecha <= v_corte and fecha > v_corte - interval '12 months'
         and emisor_rfc is not null and receptor_rfc is not null
         and emisor_rfc <> receptor_rfc
         and emisor_rfc not in (select rfc from hubs)
         and receptor_rfc not in (select rfc from hubs)
    ),
    camino as (
      select emisor_rfc as origen, receptor_rfc as actual,
             array[emisor_rfc, receptor_rfc] as ruta, array[uuid] as uuids,
             total as monto_ini, total as monto_act,
             fecha as f_ini, fecha as f_act, 1 as saltos, true as dec_ok
        from f where emisor_rfc = p_rfc
      union all
      select c.origen, f.receptor_rfc, c.ruta || f.receptor_rfc, c.uuids || f.uuid,
             c.monto_ini, f.total, c.f_ini, f.fecha, c.saltos + 1,
             c.dec_ok and f.total between c.monto_act * 0.90 and c.monto_act * 0.97
        from camino c join f on f.emisor_rfc = c.actual
       where c.saltos < v_prof and c.actual <> c.origen
         and not (f.receptor_rfc = any(c.ruta[2:]))
         and f.fecha >= c.f_act and f.fecha <= c.f_ini + interval '30 days'
         and abs(f.total - c.monto_act) / nullif(c.monto_act, 0) <= 0.15
    ),
    hallazgos as (
      select case when actual = origen then 'ciclo' else 'cadena' end as tipo,
             case when actual = origen then forense.ciclo_canonico(ruta) else ruta end as ruta_canonica,
             uuids, monto_ini, monto_act, f_ini, f_act, saltos, dec_ok
        from camino
       where (actual = origen and saltos >= 3) or (saltos >= 4 and dec_ok)
    ),
    dedup as (
      select distinct on (tipo, md5(array_to_string(ruta_canonica, '>')))
             h2.*, md5(array_to_string(h2.ruta_canonica, '>')) as clave
        from hallazgos h2
       order by tipo, md5(array_to_string(ruta_canonica, '>')), saltos, f_ini
    )
    select jsonb_build_object(
      'rfc', p_rfc, 'profundidad', v_prof,
      'n_hallazgos', (select count(*) from dedup),
      'hallazgos', coalesce((select jsonb_agg(jsonb_build_object(
          'tipo', d.tipo, 'clave', d.clave, 'saltos', d.saltos,
          'ruta', to_jsonb(d.ruta_canonica), 'uuids', to_jsonb(
            (select array_agg(u::text) from unnest(d.uuids) u)),
          'monto_ini', forense.importe_txt(d.monto_ini),
          'monto_fin', forense.importe_txt(d.monto_act),
          'conservado', round(d.monto_act / nullif(d.monto_ini, 0), 4),
          'dias', extract(day from d.f_act - d.f_ini),
          'decremento_por_salto_3_10', d.dec_ok)
          order by d.tipo, d.clave) from dedup d), '[]'::jsonb))
      into r;
    perform forense.cache_put(v_corrida, v_cluster, v_version, 'ciclos', h, r);
  end if;

  select count(*)::int into v_hubs from (
    select emisor_rfc from forense.cfdi
     where corrida_id = v_corrida and tipo = 'I' and not cancelado
       and fecha <= v_corte and fecha > v_corte - interval '12 months'
     group by emisor_rfc having count(distinct receptor_rfc) > 40) hh;
  if v_hubs > 0 then v_ausentes := v_ausentes || array['hubs_excluidos_del_recorrido']; end if;

  select coalesce(array_agg(ref), '{}') into v_refs from (
    select 'CFDI:' || u as ref
      from jsonb_array_elements(r->'hallazgos') x, jsonb_array_elements_text(x->'uuids') u
    union all
    select case when (x->>'tipo') = 'ciclo' then 'CICLO:' else 'CADENA:' end || (x->>'clave')
      from jsonb_array_elements(r->'hallazgos') x) t;

  env := forense.envelope_ok(r, forense.refs_json(v_refs),
    forense.cobertura_json(v_hubs = 0, v_corte - interval '12 months', v_corte, v_fam, v_ausentes));
  return forense.cerrar_tool(ctx, 'ciclos', p_operacion, env, t0, cache_hit);
end $$;

-- ---------------------------------------------------------------------
-- 4.7 forense_pares
-- ---------------------------------------------------------------------
create or replace function public.forense_pares(
  p_caso uuid, p_agente text, p_rfc text, p_tarea uuid,
  p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; v_corrida uuid; v_cluster uuid; v_corte timestamptz; v_version int;
  v_fam text[]; h text; r jsonb; cache_hit boolean := false; v_ausentes text[] := '{}';
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'pares', jsonb_build_object('rfc', p_rfc), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  v_cluster := (ctx->>'cluster_id')::uuid;
  v_corte   := (ctx->>'fecha_corte')::timestamptz;
  v_version := (ctx->>'version_contexto')::int;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  if not forense.rfc_en_contexto(ctx, p_rfc) then
    return forense.cerrar_tool(ctx, 'pares', p_operacion,
      forense.envelope_error('no_autorizado', 'RFC fuera del cluster autorizado', false), t0);
  end if;

  h := md5(jsonb_build_object('rfc', p_rfc, 'corte', v_corte)::text);
  r := forense.cache_get(v_corrida, v_cluster, v_version, 'pares', h);
  cache_hit := r is not null;

  if r is null then
    select jsonb_build_object(
      'rfc', a.rfc, 'giro', a.giro,
      'n_pares', g.n_pares,
      'muestra_pequena', (g.n_pares < 3),
      'facturacion_12m', forense.importe_txt(a.facturacion_12m),
      'compras_12m', forense.importe_txt(a.compras_12m),
      'nomina_12m', forense.importe_txt(a.nomina_12m),
      'ratio_nomina', a.ratio_nomina,
      'tasa_cancelacion', a.tasa_cancelacion,
      'n_clientes', a.n_clientes, 'n_proveedores', a.n_proveedores,
      'percentiles_del_giro', jsonb_build_object(
        'fact_p10', forense.importe_txt(g.fact_p10::numeric), 'fact_p50', forense.importe_txt(g.fact_p50::numeric),
        'fact_p90', forense.importe_txt(g.fact_p90::numeric),
        'compras_p10', forense.importe_txt(g.compras_p10::numeric),
        'nomina_p10', g.nomina_p10, 'nomina_p50', g.nomina_p50,
        'cancel_p90', g.cancel_p90, 'clientes_p50', g.clientes_p50),
      'posicion', jsonb_build_object(
        'facturacion_sobre_p50', (a.facturacion_12m > g.fact_p50),
        'compras_bajo_p10', (a.compras_12m < g.compras_p10),
        'nomina_bajo_p10', (a.ratio_nomina is not null and g.nomina_p10 is not null
                            and a.ratio_nomina < g.nomina_p10)))
      into r
      from forense.v_agregado_rfc a
      left join forense.v_pares_giro g on g.corrida_id = a.corrida_id and g.giro = a.giro
     where a.corrida_id = v_corrida and a.rfc = p_rfc;

    if r is null then
      r := jsonb_build_object('rfc', p_rfc, 'entidad_tecnica_incompleta', true);
    end if;
    perform forense.cache_put(v_corrida, v_cluster, v_version, 'pares', h, r);
  end if;

  if coalesce((r->>'entidad_tecnica_incompleta')::boolean, false) then
    v_ausentes := v_ausentes || array['padron'];
  elsif coalesce((r->>'n_pares')::int, 0) < 3 then
    v_ausentes := v_ausentes || array['muestra_de_pares_insuficiente'];
  end if;

  env := forense.envelope_ok(r,
    forense.refs_json(array['PAR:' || regexp_replace(coalesce(r->>'giro', 'sin_giro'), '\s+', '_', 'g')]),
    forense.cobertura_json(array_length(v_ausentes, 1) is null,
      v_corte - interval '12 months', v_corte, v_fam, v_ausentes));
  return forense.cerrar_tool(ctx, 'pares', p_operacion, env, t0, cache_hit);
end $$;

-- ---------------------------------------------------------------------
-- 4.8 forense_listas — p_saltos ≤ 2, solo publicaciones ≤ fecha_corte
-- ---------------------------------------------------------------------
create or replace function public.forense_listas(
  p_caso uuid, p_agente text, p_rfc text, p_saltos int, p_tarea uuid,
  p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; v_corrida uuid; v_cluster uuid; v_corte timestamptz; v_version int;
  v_fam text[]; v_saltos int; h text; r jsonb; cache_hit boolean := false;
  v_refs text[] := '{}'; v_ausentes text[] := '{}';
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'listas',
           jsonb_build_object('rfc', p_rfc, 'saltos', p_saltos), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  v_cluster := (ctx->>'cluster_id')::uuid;
  v_corte   := (ctx->>'fecha_corte')::timestamptz;
  v_version := (ctx->>'version_contexto')::int;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  if not forense.rfc_en_contexto(ctx, p_rfc) then
    return forense.cerrar_tool(ctx, 'listas', p_operacion,
      forense.envelope_error('no_autorizado', 'RFC fuera del cluster autorizado', false), t0);
  end if;

  v_saltos := least(greatest(coalesce(p_saltos, 2), 0), 2);
  if coalesce(p_saltos, 2) > 2 then v_ausentes := v_ausentes || array['saltos_recortados_a_2']; end if;

  h := md5(jsonb_build_object('rfc', p_rfc, 'saltos', v_saltos, 'corte', v_corte)::text);
  r := forense.cache_get(v_corrida, v_cluster, v_version, 'listas', h);
  cache_hit := r is not null;

  if r is null then
    with recursive vigentes as (
      select distinct on (l.rfc) l.rfc, l.lista, l.estatus, l.fecha_publicacion, l.oficio
        from forense.listas_sat l
       where l.corrida_id = v_corrida and l.fecha_publicacion <= v_corte::date and l.lista like '69%'
       order by l.rfc, l.fecha_publicacion desc
    ),
    aristas as (
      select distinct emisor_rfc as a, receptor_rfc as b
        from forense.cfdi
       where corrida_id = v_corrida and tipo = 'I' and not cancelado
         and fecha <= v_corte and fecha > v_corte - interval '12 months'
         and emisor_rfc is not null and receptor_rfc is not null
    ),
    alcance as (
      select p_rfc as rfc, 0 as salto
      union
      select case when ar.a = al.rfc then ar.b else ar.a end, al.salto + 1
        from alcance al join aristas ar on ar.a = al.rfc or ar.b = al.rfc
       where al.salto < v_saltos
    ),
    nodos as (select rfc, min(salto) as salto from alcance group by rfc)
    select jsonb_build_object(
      'rfc', p_rfc, 'saltos', v_saltos,
      'propio', coalesce((select jsonb_build_object(
                   'lista', v.lista, 'estatus', v.estatus,
                   'fecha_publicacion', v.fecha_publicacion::text, 'oficio', v.oficio,
                   'operaciones_posteriores', (select count(*) from forense.cfdi f
                      where f.corrida_id = v_corrida and not f.cancelado
                        and f.fecha > v.fecha_publicacion::timestamptz and f.fecha <= v_corte
                        and (f.emisor_rfc = p_rfc or f.receptor_rfc = p_rfc)))
                 from vigentes v where v.rfc = p_rfc), 'null'::jsonb),
      'cercanos', coalesce((select jsonb_agg(jsonb_build_object(
                   'rfc', n.rfc, 'saltos', n.salto, 'lista', v.lista, 'estatus', v.estatus,
                   'fecha_publicacion', v.fecha_publicacion::text,
                   'operaciones_posteriores_con_el_rfc', (select count(*) from forense.cfdi f
                      where f.corrida_id = v_corrida and not f.cancelado
                        and f.fecha > v.fecha_publicacion::timestamptz and f.fecha <= v_corte
                        and ((f.emisor_rfc = p_rfc and f.receptor_rfc = n.rfc)
                             or (f.emisor_rfc = n.rfc and f.receptor_rfc = p_rfc))))
                   order by n.salto, n.rfc)
                 from nodos n join vigentes v on v.rfc = n.rfc
                where n.rfc <> p_rfc), '[]'::jsonb))
      into r;
    perform forense.cache_put(v_corrida, v_cluster, v_version, 'listas', h, r);
  end if;

  select coalesce(array_agg(ref), '{}') into v_refs from (
    select 'LISTA:' || p_rfc || ':' || (r->'propio'->>'estatus') || ':' || (r->'propio'->>'fecha_publicacion') as ref
     where jsonb_typeof(r->'propio') = 'object'
    union all
    select 'LISTA:' || (x->>'rfc') || ':' || (x->>'estatus') || ':' || (x->>'fecha_publicacion')
      from jsonb_array_elements(r->'cercanos') x) t;

  env := forense.envelope_ok(r, forense.refs_json(v_refs),
    forense.cobertura_json(array_length(v_ausentes, 1) is null, null, v_corte, v_fam, v_ausentes));
  return forense.cerrar_tool(ctx, 'listas', p_operacion, env, t0, cache_hit);
end $$;

-- ---------------------------------------------------------------------
-- 4.9 forense_leer_senal — denegada al especialista de ronda 1 (ACL R1)
-- ---------------------------------------------------------------------
create or replace function public.forense_leer_senal(
  p_caso uuid, p_agente text, p_senal_id bigint, p_tarea uuid,
  p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; s record; v_corrida uuid; v_fam text[];
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'leer_senal',
           jsonb_build_object('senal_id', p_senal_id), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  if not forense.acl_permite(ctx, 'leer_senal') then
    return forense.cerrar_tool(ctx, 'leer_senal', p_operacion,
      forense.envelope_error('no_autorizado',
        'un especialista de ronda 1 no lee el pizarrón', false), t0);
  end if;

  select sn.*, cl.corrida_id as cl_corrida into s
    from forense.senales sn
    join forense.clusters cl on cl.id = sn.cluster_id
   where sn.id = p_senal_id;

  if not found or s.cl_corrida is distinct from v_corrida
     or s.cluster_id is distinct from (ctx->>'cluster_id')::uuid then
    -- Un ID de otra corrida se rechaza aunque exista (docs/06).
    return forense.cerrar_tool(ctx, 'leer_senal', p_operacion,
      forense.envelope_error('no_autorizado', 'señal fuera del caso autorizado', false), t0);
  end if;

  perform forense.log((ctx->>'caso_id')::uuid, ctx->>'agente', 'senal_leida',
    jsonb_build_object('senal_id', p_senal_id, 'familia', s.familia),
    null, null, null, null, (ctx->>'ronda')::int, (ctx->>'cluster_id')::uuid,
    (ctx->>'tarea_id')::uuid);

  env := forense.envelope_ok(
    jsonb_build_object(
      'id', s.id::text, 'caso_id', s.caso_id, 'cluster_id', s.cluster_id,
      'tarea_id', s.tarea_id, 'ronda', s.ronda, 'intento', s.intento,
      'version_contexto', s.version_contexto, 'familia', s.familia, 'agente', s.agente,
      'titular', s.titular, 'detalle', s.detalle,
      'rfcs', coalesce(to_jsonb(s.rfcs), '[]'::jsonb),
      'ids', coalesce(to_jsonb(s.ids), '[]'::jsonb),
      'frontera', coalesce(to_jsonb(s.frontera), '[]'::jsonb),
      'confianza', s.confianza, 'refuta', s.refuta),
    forense.refs_json(s.ids),
    forense.cobertura_json(true, null, null, v_fam, '{}'));
  return forense.cerrar_tool(ctx, 'leer_senal', p_operacion, env, t0);
end $$;

-- ---------------------------------------------------------------------
-- 4.10 forense_escribir_senal — mutación idempotente por tarea + argumentos
-- ---------------------------------------------------------------------
create or replace function public.forense_escribir_senal(
  p_caso uuid, p_agente text, p_familia text, p_titular text, p_detalle jsonb,
  p_rfcs text[], p_ids text[], p_frontera text[], p_confianza text, p_refuta boolean,
  p_tarea uuid, p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; v_corrida uuid; v_fam text[]; v_id bigint; v_key text;
  v_familia_agente text; v_ids text[]; v_rfcs text[]; v_ajenos text[];
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'escribir_senal',
           jsonb_build_object('familia', p_familia, 'titular', p_titular,
                              'detalle', p_detalle, 'rfcs', to_jsonb(p_rfcs),
                              'ids', to_jsonb(p_ids), 'frontera', to_jsonb(p_frontera),
                              'confianza', p_confianza, 'refuta', p_refuta), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;
  v_familia_agente := forense.familia_de_agente(ctx->>'agente');

  if p_familia is null or p_familia not in ('D','F','R','T','E') then
    return forense.cerrar_tool(ctx, 'escribir_senal', p_operacion,
      forense.envelope_error('argumento_invalido', 'familia fuera del catálogo', false), t0);
  end if;
  if v_familia_agente is not null and p_familia <> v_familia_agente then
    return forense.cerrar_tool(ctx, 'escribir_senal', p_operacion,
      forense.envelope_error('no_autorizado',
        'un especialista escribe solo en su familia', false), t0);
  end if;
  if p_confianza is null or p_confianza not in ('alta','media','baja') then
    return forense.cerrar_tool(ctx, 'escribir_senal', p_operacion,
      forense.envelope_error('argumento_invalido', 'confianza fuera del catálogo', false), t0);
  end if;
  if coalesce(array_length(p_rfcs, 1), 0) = 0 or coalesce(array_length(p_ids, 1), 0) = 0 then
    return forense.cerrar_tool(ctx, 'escribir_senal', p_operacion,
      forense.envelope_error('argumento_invalido',
        'una señal sin RFC o sin IDs no es citable', false), t0);
  end if;
  if p_detalle is null or not (p_detalle ? 'pista_id') or not (p_detalle ? 'descripcion') then
    return forense.cerrar_tool(ctx, 'escribir_senal', p_operacion,
      forense.envelope_error('argumento_invalido',
        'detalle requiere pista_id y descripcion', false), t0);
  end if;

  select coalesce(array_agg(x order by x), '{}') into v_ajenos
    from unnest(p_rfcs) x where not forense.rfc_en_contexto(ctx, x);
  if coalesce(array_length(v_ajenos, 1), 0) > 0 then
    return forense.cerrar_tool(ctx, 'escribir_senal', p_operacion,
      forense.envelope_error('no_autorizado',
        'la señal cita RFC fuera del cluster autorizado: ' || array_to_string(v_ajenos, ','), false), t0);
  end if;

  select coalesce(array_agg(distinct x order by x), '{}') into v_ids
    from unnest(p_ids) x
   where x ~ '^(CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR):[^[:space:]]+$';
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return forense.cerrar_tool(ctx, 'escribir_senal', p_operacion,
      forense.envelope_error('argumento_invalido',
        'ningún ID usa el espacio de nombres del contrato', false), t0);
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_rfcs from unnest(p_rfcs) x;

  -- Idempotencia de mutación: un retry HTTP no inserta un hallazgo nuevo.
  v_key := md5((ctx->>'tarea_id') || '|' || coalesce(p_operacion::text, '') || '|escribir_senal|' ||
                forense.args_hash(jsonb_build_object('familia', p_familia, 'titular', p_titular,
                  'detalle', p_detalle, 'rfcs', to_jsonb(v_rfcs), 'ids', to_jsonb(v_ids))));

  insert into forense.senales (cluster_id, caso_id, tarea_id, ronda, intento, version_contexto,
                               idempotency_key, familia, agente, titular, detalle,
                               rfcs, ids, frontera, confianza, refuta)
  values ((ctx->>'cluster_id')::uuid, (ctx->>'caso_id')::uuid, (ctx->>'tarea_id')::uuid,
          (ctx->>'ronda')::int, (ctx->>'intento')::int, (ctx->>'version_contexto')::int,
          v_key, p_familia, ctx->>'agente', left(p_titular, 240),
          jsonb_build_object('pista_id', p_detalle->>'pista_id',
                             'descripcion', left(p_detalle->>'descripcion', 2000)),
          v_rfcs, v_ids, coalesce(p_frontera, '{}'::text[]), p_confianza, coalesce(p_refuta, false))
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from forense.senales where idempotency_key = v_key;
  else
    perform forense.log((ctx->>'caso_id')::uuid, ctx->>'agente', 'senal_escrita',
      jsonb_build_object('senal_id', v_id, 'familia', p_familia, 'titular', left(p_titular, 240),
                         'confianza', p_confianza, 'refuta', coalesce(p_refuta, false),
                         'n_ids', coalesce(array_length(v_ids, 1), 0)),
      null, null, null, null, (ctx->>'ronda')::int, (ctx->>'cluster_id')::uuid,
      (ctx->>'tarea_id')::uuid);
  end if;

  env := forense.envelope_ok(
    jsonb_build_object('senal_id', v_id::text, 'familia', p_familia,
                       'ronda', (ctx->>'ronda')::int),
    forense.refs_json(v_ids),
    forense.cobertura_json(true, null, null, v_fam, '{}'));
  return forense.cerrar_tool(ctx, 'escribir_senal', p_operacion, env, t0);
end $$;

-- ---------------------------------------------------------------------
-- 4.11 forense_registrar_evidencia — auditor Y especialistas (DECISIONES H3)
-- ---------------------------------------------------------------------
create or replace function public.forense_registrar_evidencia(
  p_caso uuid, p_agente text, p_items jsonb, p_tarea uuid,
  p_ronda int default 1, p_operacion uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp();
  ctx jsonb; env jsonb; v_corrida uuid; v_fam text[]; it jsonb; i int := 0;
  v_ids bigint[] := '{}'; v_refs text[] := '{}'; v_id bigint; v_key text;
  v_rechazos jsonb := '[]'::jsonb;
begin
  ctx := forense.abrir_tool(p_caso, p_tarea, 'registrar_evidencia',
           jsonb_build_object('n_items', coalesce(jsonb_array_length(p_items), 0)), p_operacion);
  if coalesce((ctx->>'duplicado')::boolean, false) then return ctx->'resultado'; end if;
  if not coalesce((ctx->>'ok')::boolean, false) then return ctx->'envelope'; end if;

  v_corrida := (ctx->>'corrida_id')::uuid;
  select familias_evaluables into v_fam from forense.corridas where id = v_corrida;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return forense.cerrar_tool(ctx, 'registrar_evidencia', p_operacion,
      forense.envelope_error('argumento_invalido', 'p_items debe ser un arreglo no vacío', false), t0);
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    if i > 40 then exit; end if;

    if not (it ? 'pista_id' and it ? 'pista_codigo' and it ? 'familia' and it ? 'tipo'
            and it ? 'ref_id' and it ? 'referencias' and it ? 'comprobacion'
            and it ? 'rfcs_afectados' and it ? 'descripcion') then
      v_rechazos := v_rechazos || jsonb_build_array(jsonb_build_object(
        'i', i, 'motivo', 'faltan campos del contrato evidencia_propuesta'));
      continue;
    end if;
    if left(it->>'pista_codigo', 1) is distinct from (it->>'familia') then
      v_rechazos := v_rechazos || jsonb_build_array(jsonb_build_object(
        'i', i, 'motivo', 'familia y pista_codigo incompatibles'));
      continue;
    end if;
    if exists (select 1 from jsonb_array_elements_text(it->'rfcs_afectados') x
                where not forense.rfc_en_contexto(ctx, x.value)) then
      v_rechazos := v_rechazos || jsonb_build_array(jsonb_build_object(
        'i', i, 'motivo', 'rfcs_afectados fuera del cluster autorizado'));
      continue;
    end if;

    v_key := md5((ctx->>'tarea_id') || '|' || coalesce(p_operacion::text, '') ||
                 '|evidencia|' || forense.args_hash(it));

    insert into forense.evidencia (
      caso_id, idempotency_key, tipo, ref_id, pista_id, pista_codigo, familia,
      rfcs_afectados, descripcion, agente, ronda, intento, refutada, validada, hecho_validado)
    values (
      (ctx->>'caso_id')::uuid, v_key, it->>'tipo', it->>'ref_id',
      nullif(it->>'pista_id', '')::bigint, it->>'pista_codigo', it->>'familia',
      (select coalesce(array_agg(x.value), '{}') from jsonb_array_elements_text(it->'rfcs_afectados') x),
      left(it->>'descripcion', 2000), ctx->>'agente',
      (ctx->>'ronda')::int, (ctx->>'intento')::int, false, null,
      jsonb_build_object('propuesta', jsonb_build_object(
        'referencias', it->'referencias', 'comprobacion', it->'comprobacion')))
    on conflict (idempotency_key) do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id from forense.evidencia where idempotency_key = v_key;
    end if;
    v_ids := v_ids || v_id;
    select v_refs || coalesce(array_agg(x.value), '{}') into v_refs
      from jsonb_array_elements_text(it->'referencias') x;
  end loop;

  perform forense.log((ctx->>'caso_id')::uuid, ctx->>'agente', 'razonamiento',
    jsonb_build_object('evento_real', 'registrar_evidencia',
                       'insertadas', coalesce(array_length(v_ids, 1), 0),
                       'rechazadas', jsonb_array_length(v_rechazos),
                       'rechazos', v_rechazos),
    null, null, null, null, (ctx->>'ronda')::int, (ctx->>'cluster_id')::uuid,
    (ctx->>'tarea_id')::uuid);

  env := forense.envelope_ok(
    jsonb_build_object(
      'ids', coalesce((select jsonb_agg(x::text) from unnest(v_ids) x), '[]'::jsonb),
      'insertadas', coalesce(array_length(v_ids, 1), 0),
      'rechazadas', v_rechazos),
    forense.refs_json(v_refs),
    forense.cobertura_json(jsonb_array_length(v_rechazos) = 0, null, null, v_fam,
      case when jsonb_array_length(v_rechazos) > 0 then array['items_rechazados'] else '{}'::text[] end));
  return forense.cerrar_tool(ctx, 'registrar_evidencia', p_operacion, env, t0);
end $$;

-- =====================================================================
-- 5. Herramientas de sistema (no las llama el LLM)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 5.1 forense_validar_evidencia — existencia, pertenencia, ventana y
--     concordancia. `validada = valida_tecnica AND NOT refutada`: una nueva
--     validación NUNCA revierte una refutación de la Réplica.
-- ---------------------------------------------------------------------
create or replace function public.forense_validar_evidencia(p_caso uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k record; e record; v_corte timestamptz; v_ok boolean; v_motivo text;
  v_hecho jsonb; n_val int := 0; n_desc int := 0; v_monto numeric;
begin
  select * into k from forense.casos where id = p_caso;
  if not found then
    return forense.envelope_error('contexto_invalido', 'caso inexistente', false);
  end if;
  select fecha_corte into v_corte from forense.corridas where id = k.corrida_id;

  for e in select * from forense.evidencia where caso_id = p_caso order by id loop
    v_ok := false; v_motivo := null; v_hecho := '{}'::jsonb; v_monto := null;

    if e.tipo = 'cfdi' then
      select jsonb_build_object(
               'uuid', f.uuid::text, 'emisor_rfc', f.emisor_rfc, 'receptor_rfc', f.receptor_rfc,
               'fecha', forense.fecha_iso(f.fecha), 'total', forense.importe_txt(f.total),
               'cancelado', f.cancelado, 'fuente', 'forense.cfdi'), f.total
        into v_hecho, v_monto
        from forense.cfdi f
       where f.corrida_id = k.corrida_id
         and f.uuid = (regexp_replace(e.ref_id, '^CFDI:', ''))::uuid;
      if v_hecho is null then
        v_motivo := 'el CFDI citado no existe en la corrida del caso';
      elsif (v_hecho->>'fecha')::timestamptz > v_corte then
        v_motivo := 'el CFDI es posterior a la fecha de corte';
      elsif not (e.rfcs_afectados && array[(v_hecho->>'emisor_rfc'), (v_hecho->>'receptor_rfc')]) then
        v_motivo := 'rfcs_afectados no concuerda con emisor/receptor del CFDI';
      else
        v_ok := true;
      end if;

    elsif e.tipo = 'movimiento' then
      select jsonb_build_object(
               'id', m.id::text, 'fecha', forense.fecha_iso(m.fecha),
               'monto', forense.importe_txt(m.monto), 'moneda', m.moneda,
               'cuenta_origen', m.cuenta_origen, 'cuenta_destino', m.cuenta_destino,
               'titular_origen', co.rfc_titular, 'titular_destino', cd.rfc_titular,
               'fuente', 'forense.movimientos'), m.monto
        into v_hecho, v_monto
        from forense.movimientos m
        left join forense.cuentas co on co.corrida_id = k.corrida_id and co.clabe = m.cuenta_origen
        left join forense.cuentas cd on cd.corrida_id = k.corrida_id and cd.clabe = m.cuenta_destino
       where m.corrida_id = k.corrida_id
         and m.id = (regexp_replace(e.ref_id, '^MOV:', ''))::bigint;
      if v_hecho is null then
        v_motivo := 'el movimiento citado no existe en la corrida del caso';
      elsif (v_hecho->>'fecha')::timestamptz > v_corte then
        v_motivo := 'el movimiento es posterior a la fecha de corte';
      elsif not (e.rfcs_afectados && array[(v_hecho->>'titular_origen'), (v_hecho->>'titular_destino')])
        then v_motivo := 'rfcs_afectados no concuerda con la titularidad de las cuentas';
      else
        v_ok := true;
      end if;

    elsif e.tipo = 'lista' then
      select jsonb_build_object('rfc', l.rfc, 'lista', l.lista, 'estatus', l.estatus,
                                'fecha_publicacion', l.fecha_publicacion::text,
                                'fuente', 'forense.listas_sat')
        into v_hecho
        from forense.listas_sat l
       where l.corrida_id = k.corrida_id
         and l.rfc = split_part(e.ref_id, ':', 2)
         and l.estatus = split_part(e.ref_id, ':', 3)
         and l.fecha_publicacion = nullif(split_part(e.ref_id, ':', 4), '')::date;
      if v_hecho is null then
        v_motivo := 'la publicación citada no existe con esa clave completa';
      elsif (v_hecho->>'estatus') in ('desvirtuado','sentencia_favorable') then
        v_motivo := 'el estatus citado desvirtúa en lugar de sostener';
      else
        v_ok := true;
      end if;

    elsif e.tipo = 'atributo' then
      select jsonb_build_object('rfc', a.rfc, 'atributo', a.atributo,
                                'valor_hash', md5(a.valor), 'fuente', 'forense.atributos_entidad')
        into v_hecho
        from forense.atributos_entidad a
       where a.corrida_id = k.corrida_id
         and a.atributo = split_part(e.ref_id, ':', 2)
         and md5(a.valor) = split_part(e.ref_id, ':', 3)
         and a.rfc = any(e.rfcs_afectados)
       limit 1;
      if v_hecho is null then
        v_motivo := 'el atributo citado no existe para los RFC afectados';
      else
        v_ok := true;
      end if;

    elsif e.tipo in ('ciclo','par','nomina') then
      -- Estos se reconstruyen desde IDs base: se exige que la propuesta traiga
      -- referencias resolubles, no una descripción plausible (docs/06).
      if exists (select 1 from jsonb_array_elements_text(
                   coalesce(e.hecho_validado->'propuesta'->'referencias', '[]'::jsonb)) x
                  where x.value like 'CFDI:%'
                    and exists (select 1 from forense.cfdi f
                                 where f.corrida_id = k.corrida_id
                                   and f.uuid::text = replace(x.value, 'CFDI:', ''))) then
        v_hecho := jsonb_build_object('tipo', e.tipo, 'reconstruido_desde', 'CFDI base',
                                      'fuente', 'forense.cfdi');
        v_ok := true;
      else
        v_motivo := 'el hallazgo no se reconstruye desde IDs base de esta corrida';
      end if;

    else
      v_motivo := 'tipo de evidencia no verificable por una comprobación implementada';
    end if;

    update forense.evidencia
       set valida_tecnica = v_ok,
           hecho_validado = coalesce(hecho_validado, '{}'::jsonb) ||
                            jsonb_build_object('verificado', coalesce(v_hecho, '{}'::jsonb)),
           monto = coalesce(v_monto, monto),
           validada = (v_ok and not refutada),
           motivo_descartada = case when v_ok and not refutada then null
                                    when refutada then coalesce(motivo_descartada, 'refutada por la defensa')
                                    else v_motivo end
     where id = e.id;

    if v_ok and not e.refutada then n_val := n_val + 1; else n_desc := n_desc + 1; end if;

    if not (v_ok and not e.refutada) then
      perform forense.log(p_caso, 'validador', 'evidencia_descartada',
        jsonb_build_object('evidencia_id', e.id, 'ref_id', e.ref_id, 'tipo', e.tipo,
                           'motivo', coalesce(v_motivo, 'refutada por la defensa')),
        null, null, null, null, e.ronda, k.cluster_id, null, k.corrida_id);
    end if;
  end loop;

  perform forense.log(p_caso, 'validador', 'validacion',
    jsonb_build_object('validadas', n_val, 'descartadas', n_desc),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  return forense.envelope_ok(
    jsonb_build_object('caso_id', p_caso, 'validadas', n_val, 'descartadas', n_desc),
    '[]'::jsonb, forense.cobertura_json(true, null, null, '{}', '{}'));
end $$;

-- ---------------------------------------------------------------------
-- 5.2 forense_evaluar_frontera — misma regla que n8n/runtime/despertar.mjs:
--     ≥2 RFC nuevos con facturación relevante, o 1 que corta una ruta
--     material, y UNA sola expansión por cluster.
-- ---------------------------------------------------------------------
create or replace function public.forense_evaluar_frontera(p_cluster uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cl record; v_corte timestamptz; v_cands text[]; v_relev text[]; v_ruta text[];
  v_expandir boolean; v_motivo text; v_expansiones int;
begin
  select * into cl from forense.clusters where id = p_cluster;
  if not found then
    return forense.envelope_error('contexto_invalido', 'cluster inexistente', false);
  end if;
  select fecha_corte into v_corte from forense.corridas where id = cl.corrida_id;
  v_expansiones := case when cl.expandido then 1 else 0 end;

  select coalesce(array_agg(distinct x order by x), '{}') into v_cands
    from forense.senales s, unnest(coalesce(s.frontera, '{}'::text[])) x
   where s.cluster_id = p_cluster and not (x = any(coalesce(cl.rfcs, '{}'::text[])));

  -- Relevante = factura algo dentro de la ventana. Sin actividad no aporta.
  select coalesce(array_agg(distinct x order by x), '{}') into v_relev
    from unnest(v_cands) x
   where exists (select 1 from forense.cfdi f
                  where f.corrida_id = cl.corrida_id and f.tipo = 'I' and not f.cancelado
                    and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
                    and (f.emisor_rfc = x or f.receptor_rfc = x));

  -- Ruta material cortada: el RFC frontera factura CON un miembro del cluster.
  select coalesce(array_agg(distinct x order by x), '{}') into v_ruta
    from unnest(v_relev) x
   where exists (select 1 from forense.cfdi f
                  where f.corrida_id = cl.corrida_id and f.tipo = 'I' and not f.cancelado
                    and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
                    and ((f.emisor_rfc = x and f.receptor_rfc = any(cl.rfcs))
                         or (f.receptor_rfc = x and f.emisor_rfc = any(cl.rfcs))));

  if coalesce(array_length(v_relev, 1), 0) >= 2 or coalesce(array_length(v_ruta, 1), 0) >= 1 then
    if v_expansiones >= 1 then
      v_expandir := false; v_motivo := 'cuota_expansion_agotada';
    else
      v_expandir := true; v_motivo := 'frontera_material';
    end if;
  else
    v_expandir := false; v_motivo := 'frontera_no_significativa';
  end if;

  perform forense.log(null, 'sistema', 'frontera_detectada',
    jsonb_build_object('cluster_id', p_cluster, 'candidatos', to_jsonb(v_cands),
                       'relevantes', to_jsonb(v_relev), 'ruta_material', to_jsonb(v_ruta),
                       'expandir', v_expandir, 'motivo', v_motivo),
    null, null, null, null, null, p_cluster, null, cl.corrida_id);

  return forense.envelope_ok(
    jsonb_build_object(
      'cluster_id', p_cluster, 'expandir', v_expandir, 'motivo', v_motivo,
      'rfcs_nuevos', case when v_expandir then to_jsonb(v_relev) else '[]'::jsonb end,
      'pendientes', to_jsonb(v_cands),
      'version_contexto', cl.version_contexto,
      'version_contexto_nueva', cl.version_contexto + case when v_expandir then 1 else 0 end,
      'limitaciones', case when not v_expandir and coalesce(array_length(v_cands, 1), 0) > 0
        then jsonb_build_array(jsonb_build_object(
          'codigo', 'cobertura_incompleta',
          'descripcion', 'La cadena continúa hacia ' || array_length(v_cands, 1) ||
                         ' RFC no investigados.',
          'referencias', '[]'::jsonb))
        else '[]'::jsonb end),
    '[]'::jsonb, forense.cobertura_json(v_motivo <> 'cobertura_incompleta', null, null, '{}', '{}'));
end $$;

-- ---------------------------------------------------------------------
-- 5.3 forense_despertar — tabla de disparo de 03, idéntica a despertar.mjs
-- ---------------------------------------------------------------------
create or replace function public.forense_despertar(p_cluster uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cl record; v_fam text[]; s record; v_motivos jsonb := '{}'::jsonb;
  v_rol text; v_objetivo text; v_afectadas text[]; f text;
  v_despertados text[];
begin
  select * into cl from forense.clusters where id = p_cluster;
  if not found then
    return forense.envelope_error('contexto_invalido', 'cluster inexistente', false);
  end if;
  select familias_evaluables into v_fam from forense.corridas where id = cl.corrida_id;

  for s in select * from forense.senales where cluster_id = p_cluster and ronda = 1 order by id loop
    if coalesce(s.refuta, false) then
      -- Despierta al emisor de la señal refutada, no a la tabla general.
      select familia into v_objetivo from forense.senales
       where id = nullif(s.detalle->>'refuta_senal_id', '')::bigint;
      v_objetivo := coalesce(v_objetivo, s.detalle->>'familia_refutada');
      v_rol := forense.rol_de_familia(v_objetivo);
      if v_rol is not null and v_objetivo = any(v_fam) then
        v_motivos := jsonb_set(v_motivos, array[v_rol],
          coalesce(v_motivos->v_rol, '[]'::jsonb) || jsonb_build_array('refuta:' || s.id));
      end if;
      continue;
    end if;

    if s.familia = 'E' then
      select coalesce(array_agg(x), '{}') into v_afectadas
        from unnest(v_fam) x where x <> 'E';
      foreach f in array v_afectadas loop
        v_rol := forense.rol_de_familia(f);
        v_motivos := jsonb_set(v_motivos, array[v_rol],
          coalesce(v_motivos->v_rol, '[]'::jsonb) || jsonb_build_array('E:' || s.id));
      end loop;
      continue;
    end if;

    -- R → D,F ; F → D,T ; D → F ; T → R
    for v_rol in
      select r from unnest(
        case s.familia
          when 'R' then array['documental','financiero']
          when 'F' then array['documental','temporal']
          when 'D' then array['financiero']
          when 'T' then array['relacional']
          else '{}'::text[] end) r
    loop
      if forense.familia_de_agente(v_rol) = any(v_fam) then
        v_motivos := jsonb_set(v_motivos, array[v_rol],
          coalesce(v_motivos->v_rol, '[]'::jsonb) || jsonb_build_array(s.familia || ':' || s.id));
      end if;
    end loop;
  end loop;

  select coalesce(array_agg(kk order by kk), '{}') into v_despertados
    from jsonb_object_keys(v_motivos) kk;

  perform forense.log(null, 'sistema', 'despertar',
    jsonb_build_object('cluster_id', p_cluster, 'despertados', to_jsonb(v_despertados),
                       'motivos', v_motivos,
                       'saltar_ronda2', coalesce(array_length(v_despertados, 1), 0) = 0),
    null, null, null, null, null, p_cluster, null, cl.corrida_id);

  return forense.envelope_ok(
    jsonb_build_object('cluster_id', p_cluster,
                       'despertados', to_jsonb(v_despertados),
                       'motivos', v_motivos,
                       'saltar_ronda2', coalesce(array_length(v_despertados, 1), 0) = 0),
    '[]'::jsonb, forense.cobertura_json(true, null, null, v_fam, '{}'));
end $$;

-- =====================================================================
-- 6. Funciones de runtime que invocan los workflows (MANIFEST §2.1)
-- =====================================================================

-- 6.1 registrar_evento: la rama `en_cola` del worker también deja rastro.
--     Los tipos fuera del enum de 05 se persisten como 'razonamiento' con
--     payload.evento_real, igual que hace clonar_corrida en 002.
create or replace function forense.registrar_evento(
  p_execution_id uuid, p_tipo text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e record; v_tipo text; v_catalogado boolean;
begin
  select * into e from forense.ejecuciones_agente where id = p_execution_id;
  if not found then
    return forense.envelope_error('contexto_invalido', 'ejecución inexistente', false);
  end if;

  v_catalogado := p_tipo in (
    'caso_creado','cluster_armado','pista_cargada','ronda_inicio','ronda_fin',
    'razonamiento','tool_call','tool_result','senal_escrita','senal_leida',
    'despertar','frontera_detectada','cluster_expandido','auditoria','defensa_inicio',
    'defensa_argumento','replica','validacion','evidencia_descartada','dictamen',
    'rechazo_auditor_final','reintento_inicio','redaccion_inicio','redaccion_fin',
    'edicion','error','presupuesto_agotado','inyeccion','corrida_cargada');
  v_tipo := case when v_catalogado then p_tipo else 'razonamiento' end;

  perform forense.log(e.caso_id, e.rol, v_tipo,
    coalesce(p_payload, '{}'::jsonb) ||
    jsonb_build_object('execution_id', p_execution_id, 'paso', e.paso,
                       'estado_interno', e.estado_interno) ||
    case when v_catalogado then '{}'::jsonb
         else jsonb_build_object('evento_real', p_tipo, 'evento_no_catalogado', true) end,
    null, null, null, null, null,
    (select cluster_id from forense.casos where id = e.caso_id),
    e.tarea_id, e.corrida_id);

  return forense.envelope_ok(
    jsonb_build_object('registrado', true, 'tipo', v_tipo, 'catalogado', v_catalogado),
    '[]'::jsonb, forense.cobertura_json(true, null, null, '{}', '{}'));
end $$;

-- 6.2 estado_barrera: poll acotado, conexión corta. La barrera es el conjunto
--     guardado en pasos_pipeline.tareas_esperadas, no un conteo de filas.
create or replace function forense.estado_barrera(p_caso uuid, p_paso text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p record; v_falt uuid[]; v_total int;
begin
  select * into p from forense.pasos_pipeline
   where caso_id = p_caso and paso = p_paso
   order by intento desc, version_contexto desc, id desc limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'completa', false, 'existe', false,
                              'faltantes', '[]'::jsonb, 'vencida', false,
                              'paso', p_paso, 'esperadas', 0);
  end if;

  v_total := coalesce(array_length(p.tareas_esperadas, 1), 0);
  select coalesce(array_agg(t.id order by t.id), '{}') into v_falt
    from forense.tareas_agente t
   where t.id = any(p.tareas_esperadas)
     and t.estado not in ('completada','error','timeout','omitida');

  return jsonb_build_object(
    'ok', true, 'existe', true, 'paso', p.paso, 'estado', p.estado,
    'revision', p.revision, 'intento', p.intento,
    'version_contexto', p.version_contexto,
    'esperadas', v_total,
    'faltantes', to_jsonb(v_falt),
    'completa', (coalesce(array_length(v_falt, 1), 0) = 0 and p.estado in ('abierto','cerrado')),
    'vencida', (p.deadline is not null and p.deadline < now() and p.estado = 'abierto'));
end $$;

-- 6.3 advance_case_if_ready con el paso explícito (DECISIONES H3 01:35).
--     La versión de dos argumentos de 002 se elimina: dejarla crearía una
--     sobrecarga que cierra "el último paso abierto" en vez del nombrado.
drop function if exists forense.advance_case_if_ready(uuid, int);

create or replace function forense.advance_case_if_ready(
  p_caso_id uuid, p_paso text, p_revision_expected int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k record; p record; v_pend uuid[]; v_total int;
begin
  select * into k from forense.casos where id = p_caso_id for update;     -- lock 1: caso
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;

  select * into p from forense.pasos_pipeline
   where caso_id = p_caso_id and paso = p_paso and estado = 'abierto'
   order by intento desc, version_contexto desc, id desc limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', true, 'avanzo', false, 'paso', p_paso,
                              'motivo', 'sin_paso_abierto');
  end if;
  if p_revision_expected is not null and p_revision_expected is distinct from p.revision then
    return jsonb_build_object('ok', false, 'error', 'revision_conflicto',
                              'revision_actual', p.revision, 'paso', p.paso);
  end if;

  v_total := coalesce(array_length(p.tareas_esperadas, 1), 0);
  select coalesce(array_agg(t.id order by t.id), '{}') into v_pend
    from forense.tareas_agente t
   where t.id = any(p.tareas_esperadas)
     and t.estado not in ('completada','error','timeout','omitida');

  if coalesce(array_length(v_pend, 1), 0) > 0 then
    return jsonb_build_object('ok', true, 'avanzo', false, 'paso', p.paso,
                              'revision', p.revision, 'esperadas', v_total,
                              'pendientes', to_jsonb(v_pend));
  end if;

  update forense.pasos_pipeline
     set estado = 'cerrado', cerrado = now(), revision = revision + 1
   where id = p.id;

  perform forense.log(p_caso_id, 'sistema', 'ronda_fin',
    jsonb_build_object('paso', p.paso, 'revision', p.revision + 1, 'tareas', v_total),
    null, null, null, null, null, k.cluster_id, null, k.corrida_id);

  return jsonb_build_object('ok', true, 'avanzo', true, 'paso', p.paso,
                            'revision', p.revision + 1, 'esperadas', v_total);
end $$;

-- 6.4 crear_caso — idempotente por idempotency_key (MANIFEST §3 nodo 6)
create or replace function forense.crear_caso(
  p_corrida uuid, p_cluster uuid, p_origen text default 'pipeline',
  p_origen_valor text default null, p_idempotency_key text default null,
  p_n8n_execution_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cl record; v_id uuid; v_key text; n_pistas int;
begin
  select * into cl from forense.clusters where id = p_cluster;
  if not found or cl.corrida_id <> p_corrida then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido',
                              'detalle', 'cluster inexistente o de otra corrida');
  end if;

  v_key := coalesce(p_idempotency_key, 'caso|' || p_cluster::text);

  select id into v_id from forense.casos where idempotency_key = v_key;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'creado', false, 'caso_id', v_id,
                              'cluster_id', p_cluster, 'corrida_id', p_corrida);
  end if;

  insert into forense.casos (corrida_id, cluster_id, rfc_principal, rfcs_satelite,
                             origen, origen_valor, estado, idempotency_key, n8n_execution_id)
  values (p_corrida, p_cluster, cl.rfc_semilla,
          (select coalesce(array_agg(x order by x), '{}') from unnest(cl.rfcs) x
            where x is distinct from cl.rfc_semilla),
          p_origen, p_origen_valor, 'en_cola', v_key, p_n8n_execution_id)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from forense.casos where idempotency_key = v_key;
    return jsonb_build_object('ok', true, 'creado', false, 'caso_id', v_id,
                              'cluster_id', p_cluster, 'corrida_id', p_corrida);
  end if;

  perform forense.log(v_id, 'sistema', 'caso_creado',
    jsonb_build_object('cluster_id', p_cluster, 'rfc_principal', cl.rfc_semilla,
                       'n_rfcs', cl.n_rfcs, 'origen', p_origen),
    null, null, null, null, null, p_cluster, null, p_corrida);
  perform forense.log(v_id, 'sistema', 'cluster_armado',
    jsonb_build_object('cluster_id', p_cluster, 'huella', cl.huella,
                       'rfcs', to_jsonb(cl.rfcs), 'score', cl.score),
    null, null, null, null, null, p_cluster, null, p_corrida);

  select count(*)::int into n_pistas from forense.pistas p
   where p.corrida_id = p_corrida and p.rfc = any(cl.rfcs) and p.estado = 'disparada';
  perform forense.log(v_id, 'sistema', 'pista_cargada',
    jsonb_build_object('cluster_id', p_cluster, 'n_pistas', n_pistas),
    null, null, null, null, null, p_cluster, null, p_corrida);

  return jsonb_build_object('ok', true, 'creado', true, 'caso_id', v_id,
                            'cluster_id', p_cluster, 'corrida_id', p_corrida,
                            'rfc_principal', cl.rfc_semilla, 'n_pistas', n_pistas);
end $$;

-- 6.5 preparar_contexto_ronda1 — resumen ≤40 RFC y pistas POR FAMILIA.
--     El contexto de un agente no crece con el dataset (regla 5).
create or replace function forense.preparar_contexto_ronda1(p_caso uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k record; cl record; v_corte timestamptz; v_fam text[]; v_contenido jsonb; v_hash text;
begin
  select * into k from forense.casos where id = p_caso;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  select * into cl from forense.clusters where id = k.cluster_id;
  select fecha_corte, familias_evaluables into v_corte, v_fam
    from forense.corridas where id = k.corrida_id;

  select jsonb_build_object(
    'caso_id', p_caso, 'cluster_id', k.cluster_id, 'corrida_id', k.corrida_id,
    'fecha_corte', forense.fecha_iso(v_corte),
    'familias_evaluables', to_jsonb(v_fam),
    'rfc_principal', k.rfc_principal,
    'version_contexto', cl.version_contexto,
    'entidades', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rfc', x.rfc, 'giro', c.giro, 'tipo_persona', c.tipo_persona,
               'fecha_alta', c.fecha_alta::text,
               'razon_social_untrusted', c.razon_social,
               'en_padron', (c.rfc is not null)) order by x.rfc)
        from unnest(cl.rfcs[1:40]) x(rfc)
        left join forense.contribuyentes c
          on c.corrida_id = k.corrida_id and c.rfc = x.rfc), '[]'::jsonb),
    'pistas_por_familia', coalesce((
      select jsonb_object_agg(t.familia, t.j)
        from (select p.familia,
                     jsonb_agg(jsonb_build_object(
                       'id', p.id::text, 'codigo', p.codigo, 'rfc', p.rfc,
                       'score', p.score, 'resumen', p.detalle->>'resumen',
                       'referencias', coalesce(p.detalle->'referencias', '[]'::jsonb))
                       order by p.score desc, p.id) as j
                from forense.pistas p
               where p.corrida_id = k.corrida_id and p.rfc = any(cl.rfcs)
                 and p.estado = 'disparada'
               group by p.familia) t), '{}'::jsonb),
    'frontera', coalesce(to_jsonb(cl.rfcs_frontera), '[]'::jsonb))
    into v_contenido;

  v_hash := encode(sha256(convert_to(v_contenido::text, 'utf8')), 'hex');

  insert into forense.artefactos_contexto (hash, corrida_id, caso_id, contenido, bytes)
  values (v_hash, k.corrida_id, p_caso, v_contenido, length(v_contenido::text));

  update forense.casos set estado = 'ronda1' where id = p_caso and estado = 'en_cola';
  update forense.clusters set estado = 'ronda1' where id = k.cluster_id and estado = 'pendiente';

  perform forense.log(p_caso, 'sistema', 'ronda_inicio',
    jsonb_build_object('ronda', 1, 'context_hash', v_hash,
                       'n_entidades', jsonb_array_length(v_contenido->'entidades'),
                       'bytes', length(v_contenido::text)),
    null, null, null, null, 1, k.cluster_id, null, k.corrida_id);

  return jsonb_build_object('ok', true, 'caso_id', p_caso, 'context_hash', v_hash,
                            'bytes', length(v_contenido::text),
                            'familias_evaluables', to_jsonb(v_fam),
                            'contenido', v_contenido);
end $$;

-- 6.6 crear_tareas_ronda — devuelve el conjunto EXACTO de tarea_id y deja la
--     barrera registrada. También crea la ejecución por tarea (17 §4).
create or replace function forense.crear_tareas_ronda(
  p_caso uuid, p_ronda int, p_agentes text[], p_intento int default 0,
  p_deadline_segundos int default 900)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k record; cl record; a text; v_tarea uuid; v_ids uuid[] := '{}'; v_key text;
  v_paso text; v_fam text[]; v_omitidos text[] := '{}'; v_ctx text;
begin
  select * into k from forense.casos where id = p_caso;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  select * into cl from forense.clusters where id = k.cluster_id;
  select familias_evaluables into v_fam from forense.corridas where id = k.corrida_id;

  v_paso := case when p_intento > 0 then 'reintento' else 'ronda' || p_ronda::text end;

  foreach a in array coalesce(p_agentes, '{}'::text[]) loop
    if forense.familia_de_agente(a) is not null and not (forense.familia_de_agente(a) = any(v_fam)) then
      -- Familia no evaluable en este dataset: se omite con motivo, no se finge.
      v_omitidos := v_omitidos || a;
      continue;
    end if;
    v_key := md5(p_caso::text || '|' || p_ronda || '|' || p_intento || '|' || a || '|' ||
                 cl.version_contexto::text);
    insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda, intento,
                                       version_contexto, estado, idempotency_key)
    values (p_caso, k.corrida_id, k.cluster_id, a, p_ronda, p_intento,
            cl.version_contexto, 'pendiente', v_key)
    on conflict (idempotency_key) do nothing
    returning id into v_tarea;
    if v_tarea is null then
      select id into v_tarea from forense.tareas_agente where idempotency_key = v_key;
    end if;
    v_ids := v_ids || v_tarea;

    select hash into v_ctx from forense.artefactos_contexto
     where caso_id = p_caso order by creado desc limit 1;

    insert into forense.ejecuciones_agente (corrida_id, caso_id, tarea_id, rol, context_hash,
                                            deadline_at)
    values (k.corrida_id, p_caso, v_tarea, a, v_ctx,
            now() + make_interval(secs => greatest(coalesce(p_deadline_segundos, 900), 30)))
    on conflict (tarea_id) where tarea_id is not null do nothing;
  end loop;

  insert into forense.pasos_pipeline (caso_id, paso, intento, version_contexto,
                                      tareas_esperadas, snapshot_senales, estado, deadline)
  values (p_caso, v_paso, p_intento, cl.version_contexto, v_ids,
          coalesce((select array_agg(s.id) from forense.senales s where s.cluster_id = k.cluster_id), '{}'),
          'abierto', now() + make_interval(secs => greatest(coalesce(p_deadline_segundos, 900), 30)))
  on conflict (caso_id, paso, intento, version_contexto) do update
    set tareas_esperadas = excluded.tareas_esperadas, estado = 'abierto',
        deadline = excluded.deadline;

  update forense.casos
     set estado = case when p_ronda = 2 then 'ronda2' when p_intento > 0 then 'reintento'
                       else 'ronda1' end
   where id = p_caso;

  perform forense.log(p_caso, 'sistema', 'ronda_inicio',
    jsonb_build_object('ronda', p_ronda, 'intento', p_intento, 'paso', v_paso,
                       'agentes', to_jsonb(p_agentes),
                       'omitidos_no_evaluables', to_jsonb(v_omitidos),
                       'tareas', to_jsonb(v_ids)),
    null, null, null, null, p_ronda, k.cluster_id, null, k.corrida_id);

  return jsonb_build_object('ok', true, 'caso_id', p_caso, 'paso', v_paso,
                            'ronda', p_ronda, 'intento', p_intento,
                            'tareas', to_jsonb(v_ids),
                            'omitidos_no_evaluables', to_jsonb(v_omitidos),
                            'version_contexto', cl.version_contexto);
end $$;

-- 6.7 expandir_y_crear_tareas_r2 — la expansión produce una versión nueva
--     explícita antes de crear las tareas de la ronda informada.
create or replace function forense.expandir_y_crear_tareas_r2(
  p_caso uuid, p_rfcs text[] default '{}', p_agentes text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k record; n int := 0; v_tareas jsonb;
begin
  select * into k from forense.casos where id = p_caso;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;

  if coalesce(array_length(p_rfcs, 1), 0) > 0 then
    n := forense.expandir_cluster(k.cluster_id, p_rfcs);
  end if;

  if coalesce(array_length(p_agentes, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'expandidos', n, 'tareas', '[]'::jsonb,
                              'motivo', 'sin especialistas despertados');
  end if;

  v_tareas := forense.crear_tareas_ronda(p_caso, 2, p_agentes, 0);
  return jsonb_build_object('ok', true, 'expandidos', n, 'ronda2', v_tareas);
end $$;

-- 6.8 abrir_tarea_cierre — Auditor, Defensor, Réplica, Redactor. Consumen
--     cuota global como cualquier tarea (docs/03).
create or replace function forense.abrir_tarea_cierre(
  p_caso uuid, p_rol text, p_deadline_segundos int default 900)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k record; cl record; v_key text; v_tarea uuid; v_ejec uuid; v_ctx text; v_estado text;
begin
  if p_rol not in ('auditor','defensor','replica','redactor') then
    return jsonb_build_object('ok', false, 'error', 'argumento_invalido',
                              'detalle', 'rol de cierre no reconocido');
  end if;
  select * into k from forense.casos where id = p_caso;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contexto_invalido');
  end if;
  select * into cl from forense.clusters where id = k.cluster_id;

  v_key := md5(p_caso::text || '|cierre|' || p_rol || '|' || cl.version_contexto::text ||
               '|' || k.n_reintentos::text);
  insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda, intento,
                                     version_contexto, estado, idempotency_key)
  values (p_caso, k.corrida_id, k.cluster_id, p_rol, greatest(coalesce(k.n_reintentos, 0), 1),
          coalesce(k.n_reintentos, 0), cl.version_contexto, 'pendiente', v_key)
  on conflict (idempotency_key) do nothing
  returning id into v_tarea;
  if v_tarea is null then
    select id into v_tarea from forense.tareas_agente where idempotency_key = v_key;
  end if;

  select hash into v_ctx from forense.artefactos_contexto
   where caso_id = p_caso order by creado desc limit 1;

  insert into forense.ejecuciones_agente (corrida_id, caso_id, tarea_id, rol, context_hash, deadline_at)
  values (k.corrida_id, p_caso, v_tarea, p_rol, v_ctx,
          now() + make_interval(secs => greatest(coalesce(p_deadline_segundos, 900), 30)))
  on conflict (tarea_id) where tarea_id is not null do nothing;
  select id into v_ejec from forense.ejecuciones_agente where tarea_id = v_tarea;

  v_estado := case p_rol when 'auditor' then 'auditando' when 'defensor' then 'defendiendo'
                         when 'replica' then 'replicando' else 'redactando' end;
  update forense.casos set estado = v_estado where id = p_caso;

  insert into forense.pasos_pipeline (caso_id, paso, intento, version_contexto,
                                      tareas_esperadas, estado, deadline)
  values (p_caso, p_rol, coalesce(k.n_reintentos, 0), cl.version_contexto,
          array[v_tarea], 'abierto',
          now() + make_interval(secs => greatest(coalesce(p_deadline_segundos, 900), 30)))
  on conflict (caso_id, paso, intento, version_contexto) do update
    set tareas_esperadas = excluded.tareas_esperadas, estado = 'abierto',
        deadline = excluded.deadline;

  perform forense.log(p_caso, p_rol,
    case p_rol when 'auditor' then 'auditoria' when 'defensor' then 'defensa_inicio'
               when 'replica' then 'replica' else 'redaccion_inicio' end,
    jsonb_build_object('tarea_id', v_tarea, 'ejecucion_id', v_ejec, 'rol', p_rol),
    null, null, null, null, null, k.cluster_id, v_tarea, k.corrida_id);

  return jsonb_build_object('ok', true, 'caso_id', p_caso, 'rol', p_rol,
                            'tarea_id', v_tarea, 'ejecucion_id', v_ejec,
                            'paso', p_rol, 'estado_caso', v_estado);
end $$;

-- 6.9 validar_salida_rol — segundo nivel de 17 §8: schema del rol, IDs de la
--     corrida, unidades y sustento, resueltos en backend. Un Code node no
--     puede cargar contracts/; esta función sí puede comprobar los hechos.
create or replace function forense.validar_salida_rol(
  p_ejecucion uuid, p_rol text, p_salida jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e record; k record; v_err text[] := '{}'; v_ids text[]; x text;
  v_corrida uuid; v_rol text;
begin
  select * into e from forense.ejecuciones_agente where id = p_ejecucion;
  if not found then
    return jsonb_build_object('ok', false, 'errores', to_jsonb(array['ejecucion inexistente']));
  end if;
  v_corrida := e.corrida_id;
  -- El rol vive en la ejecución: un rol enviado por el runner no lo cambia.
  v_rol := e.rol;
  if p_rol is not null and p_rol <> v_rol then
    v_err := v_err || ('rol declarado (' || p_rol || ') distinto del de la ejecución (' || v_rol || ')');
  end if;

  if p_salida is null or jsonb_typeof(p_salida) <> 'object' then
    return jsonb_build_object('ok', false, 'rol', v_rol,
                              'errores', to_jsonb(v_err || 'salida no es un objeto JSON'));
  end if;

  if v_rol in ('documental','financiero','relacional','temporal','externo') then
    if not (p_salida ? 'titular') or length(coalesce(p_salida->>'titular', '')) = 0 then
      v_err := v_err || array['falta titular'];
    end if;
    if coalesce(p_salida->>'titular', '') ~ '[\r\n]' then
      v_err := v_err || array['el titular debe ser UNA línea'];
    end if;
    if not (p_salida ? 'confianza') or (p_salida->>'confianza') not in ('alta','media','baja') then
      v_err := v_err || array['confianza fuera del catálogo'];
    end if;
    if jsonb_typeof(p_salida->'ids') is distinct from 'array'
       or coalesce(jsonb_array_length(p_salida->'ids'), 0) = 0 then
      v_err := v_err || array['una señal sin IDs no es citable'];
    end if;
    if forense.familia_de_agente(v_rol) is distinct from (p_salida->>'familia') then
      v_err := v_err || array['la familia no corresponde al rol de la ejecución'];
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

  -- Nivel: nunca 'definitivo' (regla 7 de CLAUDE.md).
  if p_salida::text ~* '"definitivo"' and v_rol <> 'externo' then
    v_err := v_err || array['la palabra definitivo no es un nivel de salida del sistema'];
  end if;

  -- IDs citados: espacio de nombres del contrato y existencia en ESTA corrida.
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
                      where f.corrida_id = v_corrida
                        and f.uuid::text = replace(x, 'CFDI:', '')) then
        v_err := v_err || ('CFDI citado que no existe en la corrida: ' || left(x, 80));
      end if;
    elsif x like 'MOV:%' then
      if not exists (select 1 from forense.movimientos m
                      where m.corrida_id = v_corrida
                        and m.id::text = replace(x, 'MOV:', '')) then
        v_err := v_err || ('movimiento citado que no existe en la corrida: ' || left(x, 80));
      end if;
    end if;
  end loop;

  -- Unidades: los importes viajan como cadena decimal, no como float.
  if jsonb_typeof(p_salida->'monto_en_riesgo') = 'number'
     or jsonb_typeof(p_salida->'monto') = 'number' then
    v_err := v_err || array['los importes viajan como cadena decimal, no como número'];
  end if;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_err, 1), 0) = 0,
    'rol', v_rol, 'ejecucion_id', p_ejecucion,
    'errores', coalesce(to_jsonb(v_err), '[]'::jsonb),
    'ids_verificados', coalesce(array_length(v_ids, 1), 0));
end $$;

-- =====================================================================
-- 7. Permisos. REVOKE por firma exacta; nunca sobre todo el schema public.
-- =====================================================================

do $$
declare
  f text;
  firmas text[] := array[
    'public.forense_perfil(uuid,text,text,uuid,int,uuid)',
    'public.forense_facturas(uuid,text,text,text,timestamptz,timestamptz,int,uuid,text,int,uuid)',
    'public.forense_conciliar(uuid,text,uuid,uuid,int,uuid)',
    'public.forense_seguir_dinero(uuid,text,text,timestamptz,int,numeric,uuid,int,uuid)',
    'public.forense_relacionados(uuid,text,text,uuid,int,uuid)',
    'public.forense_ciclos(uuid,text,text,int,uuid,int,uuid)',
    'public.forense_pares(uuid,text,text,uuid,int,uuid)',
    'public.forense_listas(uuid,text,text,int,uuid,int,uuid)',
    'public.forense_leer_senal(uuid,text,bigint,uuid,int,uuid)',
    'public.forense_escribir_senal(uuid,text,text,text,jsonb,text[],text[],text[],text,boolean,uuid,int,uuid)',
    'public.forense_registrar_evidencia(uuid,text,jsonb,uuid,int,uuid)',
    'public.forense_validar_evidencia(uuid)',
    'public.forense_evaluar_frontera(uuid)',
    'public.forense_despertar(uuid)'
  ];
  rol text;
begin
  foreach f in array firmas loop
    execute format('revoke execute on function %s from public', f);
    foreach rol in array array['anon','authenticated'] loop
      if exists (select 1 from pg_roles where rolname = rol) then
        execute format('revoke execute on function %s from %I', f, rol);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

revoke execute on all functions in schema forense from public;

do $$
declare rol text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema forense to service_role';
  end if;
  -- Las tres funciones de lectura para UI se reconceden expresamente
  -- (revoke ... on all functions también las alcanzó).
  foreach rol in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = rol) then
      execute format('grant execute on function forense.v_grafo(uuid,text,integer) to %I', rol);
      execute format('grant execute on function forense.v_trayectoria_rfc(uuid,text) to %I', rol);
      execute format('grant execute on function forense.v_metricas_corrida(uuid) to %I', rol);
    end if;
  end loop;
end $$;

-- Fin 005_rpc.sql
