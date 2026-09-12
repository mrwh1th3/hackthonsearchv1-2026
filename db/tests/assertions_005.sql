-- =====================================================================
-- Aserciones de 005_rpc.sql sobre el fixture.
-- Puerta de verificación de docs/05: "después de 005, una RPC solo lee la
-- corrida del caso y una evidencia refutada permanece excluida".
--
-- Cada envelope devuelto se guarda en pruebas.envelopes; run.sh los valida
-- después contra contracts tools.envelope con ajv.
-- =====================================================================

create table if not exists pruebas.envelopes (tool text, envelope jsonb);
truncate pruebas.envelopes;

create or replace function pruebas.cap(p_tool text, p_env jsonb)
returns jsonb language sql as $$
  with i as (insert into pruebas.envelopes (tool, envelope) values (p_tool, p_env) returning 1)
  select p_env from i
$$;

-- Tareas de prueba: las del fixture están 'completada' y reservar_tool las
-- rechaza (que es lo correcto). version_contexto 9 evita chocar con ellas.
insert into forense.tareas_agente (id, caso_id, corrida_id, cluster_id, agente, ronda, intento,
                                   version_contexto, estado, idempotency_key)
values ('00000000-0000-4000-8000-0000000005a1','00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200',
        'documental', 1, 0, 9, 'pendiente', 'aser-005-doc'),
       ('00000000-0000-4000-8000-0000000005a2','00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200',
        'auditor', 1, 0, 9, 'pendiente', 'aser-005-aud'),
       ('00000000-0000-4000-8000-0000000005a3','00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200',
        'financiero', 1, 0, 9, 'pendiente', 'aser-005-fin'),
       ('00000000-0000-4000-8000-0000000005a4','00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200',
        'temporal', 1, 0, 9, 'pendiente', 'aser-005-sin-cuota')
on conflict (idempotency_key) do nothing;

-- 1. Lecturas del dominio y forma del envelope
do $$
declare
  c uuid := '00000000-0000-4000-8000-000000000100';
  td uuid := '00000000-0000-4000-8000-0000000005a1';
  tf uuid := '00000000-0000-4000-8000-0000000005a3';
  ta uuid := '00000000-0000-4000-8000-0000000005a2';
  e jsonb; v_uuid uuid; v_clabe text;
begin
  select uuid into v_uuid from forense.cfdi
   where corrida_id = '00000000-0000-4000-8000-000000000001'
     and emisor_rfc = 'DEMO:ENTIDAD-0' order by fecha limit 1;
  select clabe into v_clabe from forense.cuentas
   where corrida_id = '00000000-0000-4000-8000-000000000001' and rfc_titular = 'DEMO:ENTIDAD-0' limit 1;

  e := pruebas.cap('perfil', public.forense_perfil(c, 'ignorado', 'DEMO:ENTIDAD-0', td));
  perform pruebas.assert('forense_perfil devuelve el perfil agregado del RFC',
    (e->>'ok')::boolean and (e->'data'->>'rfc') = 'DEMO:ENTIDAD-0', e::text);
  perform pruebas.assert('los importes viajan como cadena decimal, no como número',
    jsonb_typeof(e->'data'->'facturado_12m') = 'string'
    and (e->'data'->>'facturado_12m') ~ '^-?(0|[1-9][0-9]{0,11})\.[0-9]{2}$',
    (e->'data'->>'facturado_12m'));
  perform pruebas.assert('perfil marca el texto libre como _untrusted',
    (e->'data') ? 'razon_social_untrusted' and not ((e->'data') ? 'razon_social'), '');

  -- ACL R1: el especialista documental solo ve pistas de su familia
  perform pruebas.assert('en ronda 1 el especialista solo recibe pistas de SU familia',
    not exists (select 1 from jsonb_array_elements(e->'data'->'pistas') p
                 where p->>'familia' <> 'D'),
    (e->'data'->'pistas')::text);
  perform pruebas.assert('el filtro de familia se declara en cobertura, no se esconde',
    (e->'cobertura'->'datos_ausentes') @> '["pistas_de_otras_familias"]'::jsonb,
    (e->'cobertura')::text);

  e := pruebas.cap('facturas', public.forense_facturas(c, 'ignorado', 'DEMO:ENTIDAD-0', 'emisor',
        '2025-01-01T00:00:00Z'::timestamptz, '2026-02-01T00:00:00Z'::timestamptz, 1, td));
  perform pruebas.assert('forense_facturas pagina con cursor keyset',
    (e->>'ok')::boolean and (e->>'has_more')::boolean and (e->>'next_cursor') is not null,
    e::text);
  perform pruebas.assert('has_more implica truncado (contrato del envelope)',
    (e->>'truncado')::boolean, e::text);

  declare e2 jsonb; primera text;
  begin
    primera := (e->'data'->'filas'->0->>'uuid');
    e2 := pruebas.cap('facturas_pag2', public.forense_facturas(c, 'ignorado', 'DEMO:ENTIDAD-0', 'emisor',
           '2025-01-01T00:00:00Z'::timestamptz, '2026-02-01T00:00:00Z'::timestamptz, 1, td,
           e->>'next_cursor'));
    perform pruebas.assert('la segunda página continúa donde terminó la primera',
      (e2->>'ok')::boolean and (e2->'data'->'filas'->0->>'uuid') is distinct from primera,
      e2::text);
    perform pruebas.assert('un cursor de otra consulta se rechaza como argumento inválido',
      ((pruebas.cap('facturas_cursor_ajeno', public.forense_facturas(c, 'ignorado', 'DEMO:ENTIDAD-3',
         'emisor', '2025-01-01T00:00:00Z'::timestamptz, '2026-02-01T00:00:00Z'::timestamptz, 5, td,
         e->>'next_cursor')))->'error'->>'codigo') = 'argumento_invalido', '');
  end;

  e := pruebas.cap('facturas_limite', public.forense_facturas(c, 'ignorado', 'DEMO:ENTIDAD-0', 'emisor',
        '2025-01-01T00:00:00Z'::timestamptz, '2026-02-01T00:00:00Z'::timestamptz, 500, td));
  perform pruebas.assert('p_limite > 50 se recorta en silencio y se anota',
    (e->>'ok')::boolean and (e->'cobertura'->'datos_ausentes') @> '["limite_recortado_a_50"]'::jsonb,
    (e->'cobertura')::text);

  e := pruebas.cap('conciliar', public.forense_conciliar(c, 'ignorado', v_uuid, tf));
  perform pruebas.assert('forense_conciliar clasifica el estado de pago',
    (e->>'ok')::boolean and (e->'data'->>'estado') in
      ('pagado_directo','pagado_tercero','sin_pago','ppd_sin_complemento'), e::text);

  e := pruebas.cap('seguir_dinero', public.forense_seguir_dinero(c, 'ignorado', v_clabe,
        '2025-01-01T00:00:00Z'::timestamptz, 9, 0::numeric, tf));
  perform pruebas.assert('p_saltos > 4 se recorta a 4 y se declara',
    (e->>'ok')::boolean and (e->'data'->>'saltos') = '4'
    and (e->'cobertura'->'datos_ausentes') @> '["saltos_recortados_a_4"]'::jsonb, e::text);
  perform pruebas.assert('seguir_dinero devuelve el tipo de destino de cada salto',
    exists (select 1 from jsonb_array_elements(e->'data'->'ramas') x
             where x->>'tipo_destino' in ('fisica','moral','efectivo')), '');

  e := pruebas.cap('relacionados', public.forense_relacionados(c, 'ignorado', 'DEMO:ENTIDAD-0', tf));
  perform pruebas.assert('forense_relacionados calcula si se facturan entre sí',
    (e->>'ok')::boolean and jsonb_typeof(e->'data'->'relacionados') = 'array', e::text);
  perform pruebas.assert('relacionados no devuelve el valor crudo del atributo, solo su huella',
    not exists (select 1 from jsonb_array_elements(e->'data'->'relacionados') x,
                     jsonb_array_elements(x->'atributos_compartidos') a
                 where a ? 'valor'), '');

  e := pruebas.cap('ciclos', public.forense_ciclos(c, 'ignorado', 'DEMO:ENTIDAD-0', 9, tf));
  perform pruebas.assert('p_prof > 5 se recorta a 5',
    (e->>'ok')::boolean and (e->'data'->>'profundidad') = '5', e::text);

  e := pruebas.cap('pares', public.forense_pares(c, 'ignorado', 'DEMO:ENTIDAD-0', td));
  perform pruebas.assert('forense_pares compara contra percentiles del giro',
    (e->>'ok')::boolean and (e->'data') ? 'percentiles_del_giro', e::text);

  e := pruebas.cap('listas', public.forense_listas(c, 'ignorado', 'DEMO:ENTIDAD-0', 9, tf));
  perform pruebas.assert('p_saltos de listas se recorta a 2',
    (e->>'ok')::boolean and (e->'data'->>'saltos') = '2', e::text);
end $$;

-- 2. ACL: el especialista de ronda 1 no lee el pizarrón; el auditor sí
-- Las tareas de prueba comparten contador de cuota; se reinicia entre bloques
-- porque cada bloque prueba OTRA cosa (la cuota tiene su propio bloque, el 4).
update forense.tareas_agente set tool_calls = 0
 where idempotency_key like 'aser-005-%';

do $$
declare
  c uuid := '00000000-0000-4000-8000-000000000100';
  td uuid := '00000000-0000-4000-8000-0000000005a1';
  ta uuid := '00000000-0000-4000-8000-0000000005a2';
  s bigint; s_ajena bigint; e jsonb;
begin
  select id into s from forense.senales
   where cluster_id = '00000000-0000-4000-8000-000000000200' order by id limit 1;
  select id into s_ajena from forense.senales
   where cluster_id = '00000000-0000-4000-8000-000000000201' order by id limit 1;

  e := pruebas.cap('leer_senal_r1', public.forense_leer_senal(c, 'ignorado', s, td));
  perform pruebas.assert('ACL R1: leer_senal denegado al especialista de ronda 1',
    (e->>'ok')::boolean = false and (e->'error'->>'codigo') = 'no_autorizado', e::text);

  e := pruebas.cap('leer_senal_auditor', public.forense_leer_senal(c, 'ignorado', s, ta));
  perform pruebas.assert('el Auditor lee el pizarrón aunque su tarea traiga ronda=1',
    (e->>'ok')::boolean and (e->'data'->>'id') = s::text, e::text);
  perform pruebas.assert('leer_senal deja evento senal_leida en bitácora',
    exists (select 1 from forense.bitacora b
             where b.caso_id = c and b.tipo_evento = 'senal_leida'
               and (b.payload->>'senal_id')::bigint = s), '');

  if s_ajena is not null then
    e := pruebas.cap('leer_senal_ajena', public.forense_leer_senal(c, 'ignorado', s_ajena, ta));
    perform pruebas.assert('una señal de otro caso se rechaza aunque el ID exista',
      (e->>'ok')::boolean = false and (e->'error'->>'codigo') = 'no_autorizado', e::text);
  end if;
end $$;

-- 3. Aislamiento por corrida y por cluster
-- Las tareas de prueba comparten contador de cuota; se reinicia entre bloques
-- porque cada bloque prueba OTRA cosa (la cuota tiene su propio bloque, el 4).
update forense.tareas_agente set tool_calls = 0
 where idempotency_key like 'aser-005-%';

do $$
declare
  c uuid := '00000000-0000-4000-8000-000000000100';
  td uuid := '00000000-0000-4000-8000-0000000005a1';
  e jsonb; v_ajeno text; v_uuid_ajeno uuid;
begin
  -- Un RFC que existe en la corrida pero NO en el cluster del caso, y que
  -- además existe en otra corrida (el clon de 003): el ID existe, el acceso no.
  select c2.rfc into v_ajeno
    from forense.contribuyentes c2
    join forense.clusters cl on cl.id = '00000000-0000-4000-8000-000000000200'
   where c2.corrida_id = '00000000-0000-4000-8000-000000000001'
     and not (c2.rfc = any(coalesce(cl.rfcs, '{}'::text[])))
     and not (c2.rfc = any(coalesce(cl.rfcs_frontera, '{}'::text[])))
     and c2.rfc <> (select rfc_principal from forense.casos where id = c)
   order by c2.rfc limit 1;
  if v_ajeno is null then
    perform pruebas.assert('hay un RFC fuera del cluster para probar el aislamiento',
      false, 'el fixture no tiene RFC fuera del cluster');
    return;
  end if;

  e := pruebas.cap('perfil_rfc_ajeno', public.forense_perfil(c, 'ignorado', v_ajeno, td));
  perform pruebas.assert('una RPC solo lee RFC del cluster del caso, no de otra corrida',
    (e->>'ok')::boolean = false and (e->'error'->>'codigo') = 'no_autorizado', e::text);

  -- Un CFDI que existe SOLO en otra corrida: el UUID es real, pero no en la
  -- corrida del caso. La RPC debe rechazarlo, no resolverlo por ID global.
  v_uuid_ajeno := '00000000-0000-4000-9000-0000000000aa'::uuid;
  insert into forense.cfdi (corrida_id, uuid, tipo, emisor_rfc, receptor_rfc, fecha,
                            subtotal, iva, total, moneda, metodo_pago, cancelado)
  select v2.id, v_uuid_ajeno, 'I', 'DEMO:ENTIDAD-0', 'DEMO:ENTIDAD-3',
         v2.fecha_corte - interval '30 days', 100, 16, 116, 'MXN', 'PUE', false
    from forense.corridas v2
   where v2.nombre = 'pistas: clon del fixture'
  on conflict do nothing;

  if exists (select 1 from forense.cfdi where uuid = v_uuid_ajeno) then
    e := pruebas.cap('conciliar_ajeno', public.forense_conciliar(c, 'ignorado', v_uuid_ajeno, td));
    perform pruebas.assert('un UUID de otra corrida no se concilia aunque exista',
      (e->>'ok')::boolean = false and (e->'error'->>'codigo') in ('argumento_invalido','no_autorizado'),
      e::text);
  end if;

  perform pruebas.assert('ninguna función pública de 005 menciona ground_truth',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'forense\_%'
         and pg_get_functiondef(p.oid) ilike '%ground_truth%'), '');
end $$;

-- 4. Presupuesto agotado: error como dato, no excepción
do $$
declare
  c uuid := '00000000-0000-4000-8000-000000000100';
  tsin uuid := '00000000-0000-4000-8000-0000000005a4';
  e jsonb; n_antes int;
begin
  -- temporal ronda 1 tiene límite 6 en forense.limites_agente
  update forense.tareas_agente set tool_calls = 6 where id = tsin;
  e := pruebas.cap('presupuesto_tarea', public.forense_perfil(c, 'ignorado', 'DEMO:ENTIDAD-0', tsin));
  perform pruebas.assert('el presupuesto agotado por tarea devuelve error como dato',
    (e->>'ok')::boolean = false and (e->'error'->>'codigo') = 'presupuesto_agotado', e::text);
  perform pruebas.assert('el envelope de error no trae data',
    jsonb_typeof(e->'data') = 'null', e::text);
  perform pruebas.assert('el presupuesto agotado deja evento en bitácora',
    exists (select 1 from forense.bitacora b
             where b.caso_id = c and b.tipo_evento = 'presupuesto_agotado'), '');
  update forense.tareas_agente set tool_calls = 0 where id = tsin;

  -- Techo del caso: la exploración se detiene antes de tocar la reserva de cierre
  select tool_calls into n_antes from forense.casos where id = c;
  update forense.casos set tool_calls = 120 where id = c;
  e := pruebas.cap('presupuesto_caso', public.forense_perfil(c, 'ignorado', 'DEMO:ENTIDAD-0', tsin));
  perform pruebas.assert('el techo del caso también devuelve presupuesto_agotado',
    (e->>'ok')::boolean = false and (e->'error'->>'codigo') = 'presupuesto_agotado', e::text);
  update forense.casos set tool_calls = n_antes, presupuesto_agotado = false where id = c;
end $$;

-- 5. Idempotencia por operación: reentrega no consume cuota ni duplica señal
-- Las tareas de prueba comparten contador de cuota; se reinicia entre bloques
-- porque cada bloque prueba OTRA cosa (la cuota tiene su propio bloque, el 4).
update forense.tareas_agente set tool_calls = 0
 where idempotency_key like 'aser-005-%';

do $$
declare
  c uuid := '00000000-0000-4000-8000-000000000100';
  td uuid := '00000000-0000-4000-8000-0000000005a1';
  op uuid := '00000000-0000-4000-8000-0000000005b1';
  e1 jsonb; e2 jsonb; n1 int; n2 int; s1 int; s2 int; v_uuid uuid;
begin
  select tool_calls into n1 from forense.tareas_agente where id = td;
  e1 := pruebas.cap('perfil_op', public.forense_perfil(c, 'ignorado', 'DEMO:ENTIDAD-0', td, 1, op));
  select tool_calls into n2 from forense.tareas_agente where id = td;
  perform pruebas.assert('una llamada nueva con operación consume cuota',
    n2 = n1 + 1, 'antes=' || n1 || ' despues=' || n2);

  e2 := public.forense_perfil(c, 'ignorado', 'DEMO:ENTIDAD-0', td, 1, op);
  select tool_calls into n1 from forense.tareas_agente where id = td;
  perform pruebas.assert('reentregar la misma operación NO consume cuota otra vez',
    n1 = n2, 'despues de reentrega=' || n1);
  perform pruebas.assert('la reentrega devuelve exactamente el resultado registrado',
    e2 = e1, '');

  -- escribir_senal: el retry HTTP no inserta un hallazgo nuevo
  select uuid into v_uuid from forense.cfdi
   where corrida_id = '00000000-0000-4000-8000-000000000001'
     and emisor_rfc = 'DEMO:ENTIDAD-0' order by fecha limit 1;
  select count(*)::int into s1 from forense.senales where tarea_id = td;
  e1 := pruebas.cap('escribir_senal', public.forense_escribir_senal(c, 'ignorado', 'D',
    'capacidad operativa sin nómina', '{"pista_id":"1","descripcion":"prueba de contrato"}'::jsonb,
    array['DEMO:ENTIDAD-0'], array['CFDI:' || v_uuid::text], array[]::text[], 'media', false, td));
  perform pruebas.assert('forense_escribir_senal devuelve el id de la señal',
    (e1->>'ok')::boolean and (e1->'data'->>'senal_id') is not null, e1::text);
  e2 := public.forense_escribir_senal(c, 'ignorado', 'D',
    'capacidad operativa sin nómina', '{"pista_id":"1","descripcion":"prueba de contrato"}'::jsonb,
    array['DEMO:ENTIDAD-0'], array['CFDI:' || v_uuid::text], array[]::text[], 'media', false, td);
  select count(*)::int into s2 from forense.senales where tarea_id = td;
  perform pruebas.assert('dos escrituras idénticas de la misma tarea no duplican la señal',
    s2 = s1 + 1, 'antes=' || s1 || ' despues=' || s2);
  perform pruebas.assert('escribir_senal deja evento senal_escrita',
    exists (select 1 from forense.bitacora b
             where b.caso_id = c and b.tipo_evento = 'senal_escrita'), '');

  -- Un especialista no escribe en familia ajena ni cita RFC de fuera
  e1 := pruebas.cap('escribir_senal_familia_ajena', public.forense_escribir_senal(c, 'ignorado', 'F',
    'familia que no le toca', '{"pista_id":"1","descripcion":"x"}'::jsonb,
    array['DEMO:ENTIDAD-0'], array['CFDI:' || v_uuid::text], array[]::text[], 'alta', false, td));
  perform pruebas.assert('un especialista no escribe señales de otra familia',
    (e1->>'ok')::boolean = false and (e1->'error'->>'codigo') = 'no_autorizado', e1::text);

  e1 := pruebas.cap('escribir_senal_rfc_ajeno', public.forense_escribir_senal(c, 'ignorado', 'D',
    'rfc de fuera', '{"pista_id":"1","descripcion":"x"}'::jsonb,
    array['RFC:NO:AUTORIZADO'], array['CFDI:' || v_uuid::text], array[]::text[], 'alta', false, td));
  perform pruebas.assert('una señal no puede citar RFC fuera del cluster autorizado',
    (e1->>'ok')::boolean = false and (e1->'error'->>'codigo') = 'no_autorizado', e1::text);
end $$;

-- 6. Evidencia: registro, validación y permanencia de la refutación
-- Las tareas de prueba comparten contador de cuota; se reinicia entre bloques
-- porque cada bloque prueba OTRA cosa (la cuota tiene su propio bloque, el 4).
update forense.tareas_agente set tool_calls = 0
 where idempotency_key like 'aser-005-%';

do $$
declare
  c uuid := '00000000-0000-4000-8000-000000000100';
  ta uuid := '00000000-0000-4000-8000-0000000005a2';
  e jsonb; v_uuid uuid; v_id bigint; v_val boolean; v_ref boolean;
begin
  select uuid into v_uuid from forense.cfdi
   where corrida_id = '00000000-0000-4000-8000-000000000001'
     and emisor_rfc = 'DEMO:ENTIDAD-0' order by fecha limit 1;

  e := pruebas.cap('registrar_evidencia', public.forense_registrar_evidencia(c, 'ignorado',
    jsonb_build_array(
      jsonb_build_object(
        'pista_id','1','pista_codigo','D2','familia','D','tipo','cfdi',
        'ref_id','CFDI:' || v_uuid::text,
        'referencias', jsonb_build_array('CFDI:' || v_uuid::text),
        'comprobacion', jsonb_build_object('codigo','D2','referencias', jsonb_build_array('PAR:consultoria')),
        'rfcs_afectados', jsonb_build_array('DEMO:ENTIDAD-0'),
        'descripcion','CFDI emitido sin capacidad operativa comprobable'),
      -- familia y código incompatibles: se rechaza el item, no la llamada
      jsonb_build_object(
        'pista_id','2','pista_codigo','F1','familia','D','tipo','cfdi',
        'ref_id','CFDI:' || v_uuid::text,
        'referencias', jsonb_build_array('CFDI:' || v_uuid::text),
        'comprobacion', jsonb_build_object('codigo','F1','referencias', jsonb_build_array('CFDI:' || v_uuid::text)),
        'rfcs_afectados', jsonb_build_array('DEMO:ENTIDAD-0'),
        'descripcion','item incompatible')),
    ta));
  perform pruebas.assert('forense_registrar_evidencia inserta el item válido',
    (e->>'ok')::boolean and (e->'data'->>'insertadas')::int = 1, e::text);
  perform pruebas.assert('un item con familia y código incompatibles se rechaza con motivo',
    jsonb_array_length(e->'data'->'rechazadas') = 1, (e->'data'->'rechazadas')::text);

  select (e->'data'->'ids'->>0)::bigint into v_id;

  e := pruebas.cap('validar_evidencia', public.forense_validar_evidencia(c));
  perform pruebas.assert('forense_validar_evidencia valida el CFDI citado',
    (e->>'ok')::boolean and (e->'data'->>'validadas')::int >= 1, e::text);
  select validada into v_val from forense.evidencia where id = v_id;
  perform pruebas.assert('la evidencia con ID resoluble queda validada', v_val, '');

  -- La Réplica refuta: la validación posterior NO revierte la refutación
  update forense.evidencia set refutada = true where id = v_id;
  e := pruebas.cap('validar_evidencia_tras_refutar', public.forense_validar_evidencia(c));
  select validada, refutada into v_val, v_ref from forense.evidencia where id = v_id;
  perform pruebas.assert('una evidencia refutada permanece excluida tras revalidar',
    v_ref and not v_val, 'refutada=' || v_ref::text || ' validada=' || coalesce(v_val::text, 'null'));
  perform pruebas.assert('el descarte queda en bitácora con su motivo',
    exists (select 1 from forense.bitacora b
             where b.caso_id = c and b.tipo_evento = 'evidencia_descartada'), '');

  -- Una evidencia que cita un ID inexistente no se valida por ser plausible
  insert into forense.evidencia (caso_id, idempotency_key, tipo, ref_id, pista_codigo, familia,
                                 rfcs_afectados, descripcion, agente, ronda, intento, refutada)
  values (c, 'aser-005-fantasma', 'cfdi', 'CFDI:00000000-0000-4000-9000-0000000000ff',
          'D2', 'D', array['DEMO:ENTIDAD-0'], 'cita inventada', 'auditor', 1, 0, false)
  on conflict (idempotency_key) do nothing;
  perform public.forense_validar_evidencia(c);
  perform pruebas.assert('una cita a un ID inexistente no se valida por ser plausible',
    (select not coalesce(validada, false) and motivo_descartada is not null
       from forense.evidencia where idempotency_key = 'aser-005-fantasma'), '');
end $$;

-- 7. Frontera y despertar
do $$
declare e jsonb; cl uuid := '00000000-0000-4000-8000-000000000200';
begin
  e := pruebas.cap('evaluar_frontera', public.forense_evaluar_frontera(cl));
  perform pruebas.assert('forense_evaluar_frontera responde con decisión y motivo',
    (e->>'ok')::boolean and (e->'data') ? 'expandir' and (e->'data') ? 'motivo', e::text);
  perform pruebas.assert('la evaluación de frontera deja evento frontera_detectada',
    exists (select 1 from forense.bitacora b
             where b.cluster_id = cl and b.tipo_evento = 'frontera_detectada'), '');

  e := pruebas.cap('despertar', public.forense_despertar(cl));
  perform pruebas.assert('forense_despertar aplica la tabla de disparo de 03',
    (e->>'ok')::boolean and jsonb_typeof(e->'data'->'despertados') = 'array', e::text);
  perform pruebas.assert('R en ronda 1 despierta a documental y financiero',
    not exists (select 1 from forense.senales where cluster_id = cl and ronda = 1 and familia = 'R')
    or ((e->'data'->'despertados') @> '["documental"]'::jsonb
        and (e->'data'->'despertados') @> '["financiero"]'::jsonb),
    (e->'data'->'despertados')::text);
  perform pruebas.assert('el despertar deja su evento en bitácora',
    exists (select 1 from forense.bitacora b
             where b.cluster_id = cl and b.tipo_evento = 'despertar'), '');
end $$;

-- 8. Funciones de runtime (MANIFEST §2.1)
do $$
declare
  v_corrida uuid; cl uuid; r jsonb; v_caso uuid; v_tareas jsonb; v_ejec uuid; b jsonb;
begin
  select id into v_corrida from forense.corridas where nombre = 'pistas: clon del fixture';
  select id into cl from forense.clusters where corrida_id = v_corrida
   order by score desc nulls last, id limit 1;

  r := forense.crear_caso(v_corrida, cl, 'pipeline', null, 'aser-005-caso', 'exec-1');
  perform pruebas.assert('crear_caso crea el caso y deja caso_creado en bitácora',
    (r->>'ok')::boolean and (r->>'creado')::boolean, r::text);
  v_caso := (r->>'caso_id')::uuid;
  perform pruebas.assert('crear_caso escribe caso_creado, cluster_armado y pista_cargada',
    (select count(distinct tipo_evento) from forense.bitacora
      where caso_id = v_caso and tipo_evento in ('caso_creado','cluster_armado','pista_cargada')) = 3, '');

  r := forense.crear_caso(v_corrida, cl, 'pipeline', null, 'aser-005-caso', 'exec-2');
  perform pruebas.assert('crear_caso es idempotente por idempotency_key',
    (r->>'ok')::boolean and (r->>'creado')::boolean = false
    and (r->>'caso_id')::uuid = v_caso, r::text);

  r := forense.preparar_contexto_ronda1(v_caso);
  perform pruebas.assert('preparar_contexto_ronda1 persiste el artefacto y su hash',
    (r->>'ok')::boolean and length(r->>'context_hash') = 64
    and exists (select 1 from forense.artefactos_contexto where caso_id = v_caso), r::text);
  perform pruebas.assert('el contexto agrupa las pistas por familia y acota a 40 entidades',
    jsonb_array_length(r->'contenido'->'entidades') <= 40
    and jsonb_typeof(r->'contenido'->'pistas_por_familia') = 'object', '');
  perform pruebas.assert('el contexto de ronda 1 no incluye señales ni dictamen de otros roles',
    not (r->'contenido' ? 'senales') and not (r->'contenido' ? 'dictamen'), '');

  v_tareas := forense.crear_tareas_ronda(v_caso, 1, array['documental','financiero','relacional']);
  perform pruebas.assert('crear_tareas_ronda devuelve el conjunto exacto de tarea_id',
    (v_tareas->>'ok')::boolean and jsonb_array_length(v_tareas->'tareas') = 3, v_tareas::text);
  perform pruebas.assert('cada tarea recibe su ejecución de runtime',
    (select count(*) from forense.ejecuciones_agente where caso_id = v_caso) = 3, '');

  b := forense.estado_barrera(v_caso, 'ronda1');
  perform pruebas.assert('la barrera arranca incompleta con las tres tareas esperadas',
    (b->>'existe')::boolean and (b->>'esperadas')::int = 3
    and (b->>'completa')::boolean = false, b::text);

  r := forense.advance_case_if_ready(v_caso, 'ronda1');
  perform pruebas.assert('advance_case_if_ready no avanza con tareas pendientes',
    (r->>'ok')::boolean and (r->>'avanzo')::boolean = false, r::text);

  update forense.tareas_agente set estado = 'completada'
   where caso_id = v_caso and ronda = 1;
  b := forense.estado_barrera(v_caso, 'ronda1');
  perform pruebas.assert('la barrera se declara completa cuando el conjunto exacto termina',
    (b->>'completa')::boolean, b::text);

  r := forense.advance_case_if_ready(v_caso, 'ronda1');
  perform pruebas.assert('advance_case_if_ready cierra el paso nombrado y deja ronda_fin',
    (r->>'ok')::boolean and (r->>'avanzo')::boolean and (r->>'paso') = 'ronda1', r::text);
  r := forense.advance_case_if_ready(v_caso, 'ronda1');
  perform pruebas.assert('un segundo callback no vuelve a cerrar el mismo paso',
    (r->>'ok')::boolean and (r->>'avanzo')::boolean = false, r::text);

  perform pruebas.assert('solo existe la firma de tres argumentos de advance_case_if_ready',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'forense' and p.proname = 'advance_case_if_ready') = 1, '');

  r := forense.abrir_tarea_cierre(v_caso, 'auditor');
  perform pruebas.assert('abrir_tarea_cierre crea la tarea del Auditor y su paso',
    (r->>'ok')::boolean and (r->>'tarea_id') is not null, r::text);
  perform pruebas.assert('la apertura de auditoría deja su evento',
    exists (select 1 from forense.bitacora where caso_id = v_caso and tipo_evento = 'auditoria'), '');

  select id into v_ejec from forense.ejecuciones_agente where caso_id = v_caso limit 1;
  r := forense.registrar_evento(v_ejec, 'paso_en_cola', '{"motivo":"slot ocupado"}'::jsonb);
  perform pruebas.assert('registrar_evento persiste incluso un tipo fuera del catálogo',
    (r->>'ok')::boolean and (r->'data'->>'catalogado')::boolean = false, r::text);
  perform pruebas.assert('el tipo real queda declarado en el payload',
    exists (select 1 from forense.bitacora where caso_id = v_caso
             and payload->>'evento_real' = 'paso_en_cola'), '');
end $$;

-- 9. validar_salida_rol (segundo nivel de 17 §8)
do $$
declare
  v_caso uuid; v_ejec uuid; r jsonb; v_uuid uuid; v_corrida uuid;
begin
  select id into v_caso from forense.casos where idempotency_key = 'aser-005-caso';
  select corrida_id into v_corrida from forense.casos where id = v_caso;
  select id into v_ejec from forense.ejecuciones_agente
   where caso_id = v_caso and rol = 'documental' limit 1;
  select uuid into v_uuid from forense.cfdi where corrida_id = v_corrida limit 1;

  r := forense.validar_salida_rol(v_ejec, 'documental', jsonb_build_object(
    'familia','D','titular','una línea','confianza','media',
    'ids', jsonb_build_array('CFDI:' || v_uuid::text)));
  perform pruebas.assert('validar_salida_rol acepta una señal bien formada con IDs reales',
    (r->>'ok')::boolean, r::text);

  r := forense.validar_salida_rol(v_ejec, 'documental', jsonb_build_object(
    'familia','D','titular','una línea','confianza','media',
    'ids', jsonb_build_array('CFDI:00000000-0000-4000-9000-0000000000fe')));
  perform pruebas.assert('validar_salida_rol rechaza un ID que no existe en la corrida',
    (r->>'ok')::boolean = false, r::text);

  r := forense.validar_salida_rol(v_ejec, 'documental', jsonb_build_object(
    'familia','F','titular','otra familia','confianza','media',
    'ids', jsonb_build_array('CFDI:' || v_uuid::text)));
  perform pruebas.assert('validar_salida_rol rechaza una familia que no es la del rol',
    (r->>'ok')::boolean = false, r::text);

  r := forense.validar_salida_rol(v_ejec, 'documental', jsonb_build_object(
    'familia','D','titular','con salto' || chr(10) || 'de línea','confianza','media',
    'ids', jsonb_build_array('CFDI:' || v_uuid::text)));
  perform pruebas.assert('el titular de una señal es UNA línea',
    (r->>'ok')::boolean = false, r::text);

  r := forense.validar_salida_rol(v_ejec, 'documental', jsonb_build_object(
    'familia','D','titular','monto como número','confianza','media',
    'monto', 123.45, 'ids', jsonb_build_array('CFDI:' || v_uuid::text)));
  perform pruebas.assert('validar_salida_rol rechaza importes como número',
    (r->>'ok')::boolean = false, r::text);
end $$;

-- 10. Permisos: las herramientas no son ejecutables por PUBLIC
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'forense\_%'
     and has_function_privilege('public', p.oid, 'execute');
  perform pruebas.assert('ninguna herramienta public.forense_* es ejecutable por PUBLIC',
    n = 0, 'ejecutables por public=' || n);

  perform pruebas.assert('gen_random_uuid sigue siendo ejecutable por PUBLIC',
    has_function_privilege('public', 'public.gen_random_uuid()', 'execute'), '');
end $$;
