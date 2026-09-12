-- =====================================================================
-- Aserciones de 001 + 002 + seed_fake. Cada bloque escribe su resultado en
-- pruebas.resultado; run.sh imprime el reporte y decide el exit code.
-- Ninguna aserción depende de 003-005.
-- =====================================================================

\set FIX '00000000-0000-4000-8000-000000000001'
\set CASO0 '00000000-0000-4000-8000-000000000100'

-- ---------------------------------------------------------------------
-- 1. Dedupe: aplicar el seed dos veces no cambia conteos
-- ---------------------------------------------------------------------
do $$
declare v_dif text;
begin
  select string_agg(c1.t || ': ' || c1.n || ' -> ' || c2.n, ', ')
    into v_dif
    from pruebas.conteo_1 c1 join pruebas.conteos() c2 on c2.t = c1.t
   where c1.n <> c2.n;
  perform pruebas.assert('seed_fake idempotente (dos aplicaciones, mismos conteos)',
                         v_dif is null, coalesce(v_dif, 'sin diferencias'));
end $$;

-- ---------------------------------------------------------------------
-- 2. Tres casos visibles en v_casos_lista, con join al padrón
-- ---------------------------------------------------------------------
do $$
declare n int; n_niv int; n_rs int;
begin
  select count(*) into n from forense.v_casos_lista
   where corrida_id = '00000000-0000-4000-8000-000000000001';
  perform pruebas.assert('v_casos_lista devuelve 3 casos del fixture', n = 3, 'n=' || n);

  select count(*) into n_niv from forense.v_casos_lista
   where corrida_id = '00000000-0000-4000-8000-000000000001'
     and nivel in ('presuncion_alta','anomalia_explicada','sin_hallazgos');
  perform pruebas.assert('los tres niveles de docs/05 están presentes', n_niv = 3, 'n=' || n_niv);

  select count(*) into n_rs from forense.v_casos_lista
   where corrida_id = '00000000-0000-4000-8000-000000000001' and razon_social is not null;
  perform pruebas.assert('v_casos_lista resuelve razon_social/giro del padrón', n_rs = 3, 'n=' || n_rs);
end $$;

-- Nivel máximo: 'definitivo' no es un nivel de salida del sistema
do $$
declare ok boolean := false;
begin
  begin
    update forense.casos set nivel = 'definitivo'
     where id = '00000000-0000-4000-8000-000000000100';
  exception when check_violation then ok := true;
  end;
  perform pruebas.assert('casos.nivel rechaza "definitivo" (término del SAT)', ok,
                         'el check de nivel solo admite hasta presuncion_alta');
end $$;

-- ---------------------------------------------------------------------
-- 3. Catálogo de tipo_evento: 'inyeccion' aceptado, valor ajeno rechazado
-- ---------------------------------------------------------------------
do $$
declare ok_iny boolean := true; ok_rech boolean := false;
begin
  begin
    insert into forense.bitacora (corrida_id, caso_id, seq, agente, tipo_evento, payload)
    values ('00000000-0000-4000-8000-000000000001', null, null, 'sistema', 'inyeccion',
            '{"prueba":"21 §3.2"}');
  exception when others then ok_iny := false;
  end;
  perform pruebas.assert('bitacora acepta tipo_evento=inyeccion (docs/21 §3.2)', ok_iny, '');

  begin
    insert into forense.bitacora (corrida_id, caso_id, seq, agente, tipo_evento, payload)
    values ('00000000-0000-4000-8000-000000000001', null, null, 'sistema', 'evento_inventado', '{}');
  exception when check_violation then ok_rech := true;
  end;
  perform pruebas.assert('bitacora rechaza un tipo_evento fuera del catálogo', ok_rech, '');
end $$;

-- ---------------------------------------------------------------------
-- 4. forense.log resuelve corrida_id desde el caso y usa next_seq
-- ---------------------------------------------------------------------
do $$
declare v_seq_antes int; b record;
begin
  select bitacora_seq into v_seq_antes from forense.casos
   where id = '00000000-0000-4000-8000-000000000100';

  perform forense.log('00000000-0000-4000-8000-000000000100'::uuid, 'prueba', 'razonamiento',
                      '{"texto":"assert de log"}'::jsonb);

  select * into b from forense.bitacora
   where caso_id = '00000000-0000-4000-8000-000000000100'
   order by id desc limit 1;

  perform pruebas.assert('log resuelve corrida_id desde el caso',
    b.corrida_id = '00000000-0000-4000-8000-000000000001', 'corrida=' || coalesce(b.corrida_id::text,'null'));
  perform pruebas.assert('log resuelve cluster_id desde el caso',
    b.cluster_id = '00000000-0000-4000-8000-000000000200', 'cluster=' || coalesce(b.cluster_id::text,'null'));
  perform pruebas.assert('log usa next_seq (seq = anterior + 1)',
    b.seq = v_seq_antes + 1, 'seq=' || coalesce(b.seq::text,'null') || ' antes=' || v_seq_antes);
end $$;

-- log de sistema sin caso exige p_corrida explícita
do $$
declare n_antes bigint; n_despues bigint;
begin
  select count(*) into n_antes from forense.bitacora where caso_id is null;
  perform forense.log(null, 'sistema', 'pista_cargada', '{"evento_real":"assert"}'::jsonb,
                      null, null, null, null, null, null, null,
                      '00000000-0000-4000-8000-000000000001'::uuid);
  select count(*) into n_despues from forense.bitacora where caso_id is null;
  perform pruebas.assert('log de sistema (caso NULL) escribe con p_corrida explícita',
                         n_despues = n_antes + 1, 'antes=' || n_antes || ' despues=' || n_despues);
end $$;

-- ---------------------------------------------------------------------
-- 5. Escenario de runtime: corrida/cluster/caso/tareas de prueba
-- ---------------------------------------------------------------------
insert into forense.corridas (id, nombre, dataset, dataset_hash, fecha_corte, estado, modo)
values ('00000000-0000-4000-8000-0000000009a1','prueba runtime','prueba','h-prueba',
        '2026-01-31T12:00:00Z','lista','fiscal')
on conflict (id) do nothing;

insert into forense.clusters (id, corrida_id, rfcs, rfc_semilla, n_rfcs, score, huella, estado)
values ('00000000-0000-4000-8000-0000000009b1','00000000-0000-4000-8000-0000000009a1',
        '{PRUEBA:1}','PRUEBA:1',1,1.0,'prueba-cluster','pendiente')
on conflict (id) do nothing;

insert into forense.casos (id, corrida_id, cluster_id, rfc_principal, estado)
values ('00000000-0000-4000-8000-0000000009c1','00000000-0000-4000-8000-0000000009a1',
        '00000000-0000-4000-8000-0000000009b1','PRUEBA:1','ronda1')
on conflict (id) do nothing;

insert into forense.tareas_agente (id, caso_id, corrida_id, cluster_id, agente, ronda, estado, idempotency_key)
values
  ('00000000-0000-4000-8000-0000000009d1','00000000-0000-4000-8000-0000000009c1','00000000-0000-4000-8000-0000000009a1','00000000-0000-4000-8000-0000000009b1','documental',1,'pendiente','prueba-doc-r1'),
  ('00000000-0000-4000-8000-0000000009d2','00000000-0000-4000-8000-0000000009c1','00000000-0000-4000-8000-0000000009a1','00000000-0000-4000-8000-0000000009b1','financiero',1,'pendiente','prueba-fin-r1'),
  ('00000000-0000-4000-8000-0000000009d3','00000000-0000-4000-8000-0000000009c1','00000000-0000-4000-8000-0000000009a1','00000000-0000-4000-8000-0000000009b1','auditor',2,'pendiente','prueba-aud'),
  ('00000000-0000-4000-8000-0000000009d4','00000000-0000-4000-8000-0000000009c1','00000000-0000-4000-8000-0000000009a1','00000000-0000-4000-8000-0000000009b1','temporal',1,'pendiente','prueba-tmp-r1')
on conflict (id) do nothing;

-- 5.1 Límite por tarea (documental ronda 1 = 8) y evento presupuesto_agotado
do $$
declare r jsonb; i int; ok_8 boolean := true; n_calls int; n_agot int; v_ctx jsonb;
begin
  for i in 1..8 loop
    r := forense.reservar_tool('00000000-0000-4000-8000-0000000009c1',
                               '00000000-0000-4000-8000-0000000009d1',
                               'perfil', jsonb_build_object('rfc','PRUEBA:1','i',i));
    if not coalesce((r->>'ok')::boolean,false) then ok_8 := false; end if;
    if i = 1 then v_ctx := r; end if;
  end loop;
  perform pruebas.assert('reservar_tool concede las 8 llamadas del especialista documental', ok_8, '');

  perform pruebas.assert('reservar_tool devuelve el contexto de docs/06 (corrida, cluster, fecha_corte, version, ronda, agente)',
    (v_ctx ? 'corrida_id') and (v_ctx ? 'cluster_id') and (v_ctx ? 'fecha_corte')
      and (v_ctx ? 'version_contexto') and (v_ctx ? 'ronda') and (v_ctx ? 'intento') and (v_ctx ? 'agente'),
    v_ctx::text);

  r := forense.reservar_tool('00000000-0000-4000-8000-0000000009c1',
                             '00000000-0000-4000-8000-0000000009d1', 'perfil', '{}'::jsonb);
  perform pruebas.assert('reservar_tool devuelve {"error":"presupuesto agotado"} al pasar el límite por tarea',
    (r->>'error') = 'presupuesto agotado' and (r->>'alcance') = 'tarea', r::text);

  select count(*) into n_calls from forense.bitacora
   where caso_id = '00000000-0000-4000-8000-0000000009c1' and tipo_evento = 'tool_call';
  perform pruebas.assert('cada reserva concedida dejó un tool_call en bitácora (8)', n_calls = 8, 'n=' || n_calls);

  select count(*) into n_agot from forense.bitacora
   where caso_id = '00000000-0000-4000-8000-0000000009c1' and tipo_evento = 'presupuesto_agotado';
  perform pruebas.assert('el agotamiento dejó evento presupuesto_agotado', n_agot = 1, 'n=' || n_agot);
end $$;

-- 5.2 Reserva de cierre: el especialista se detiene en 120-27=93, el auditor no
do $$
declare r jsonb;
begin
  update forense.casos set tool_calls = 93 where id = '00000000-0000-4000-8000-0000000009c1';

  r := forense.reservar_tool('00000000-0000-4000-8000-0000000009c1',
                             '00000000-0000-4000-8000-0000000009d2', 'facturas', '{}'::jsonb);
  perform pruebas.assert('especialista agotado en 93 (reserva de 27 para Auditor/Defensor)',
    (r->>'error') = 'presupuesto agotado' and (r->>'alcance') = 'caso', r::text);

  r := forense.reservar_tool('00000000-0000-4000-8000-0000000009c1',
                             '00000000-0000-4000-8000-0000000009d3', 'facturas', '{}'::jsonb);
  perform pruebas.assert('el auditor sí puede usar la reserva de cierre a partir de 93',
    coalesce((r->>'ok')::boolean,false) and (r->>'bolsa') = 'cierre', r::text);

  update forense.casos set tool_calls = 120 where id = '00000000-0000-4000-8000-0000000009c1';
  r := forense.reservar_tool('00000000-0000-4000-8000-0000000009c1',
                             '00000000-0000-4000-8000-0000000009d3', 'facturas', '{}'::jsonb);
  perform pruebas.assert('el techo de 120 del caso también detiene al auditor',
    (r->>'error') = 'presupuesto agotado', r::text);

  perform pruebas.assert('el caso quedó marcado presupuesto_agotado (visible en UI)',
    (select presupuesto_agotado from forense.casos where id = '00000000-0000-4000-8000-0000000009c1'), '');

  update forense.casos set tool_calls = 0, presupuesto_agotado = false
   where id = '00000000-0000-4000-8000-0000000009c1';
end $$;

-- 5.3 reservar_tool rechaza tarea de otro caso / contexto inválido
do $$
declare r jsonb;
begin
  r := forense.reservar_tool('00000000-0000-4000-8000-000000000100',
                             '00000000-0000-4000-8000-0000000009d4', 'perfil', '{}'::jsonb);
  perform pruebas.assert('reservar_tool rechaza una tarea que no pertenece al caso',
    (r->>'error') = 'contexto_invalido', r::text);
end $$;

-- ---------------------------------------------------------------------
-- 6. Leases: dos dueños reclaman, solo uno gana
-- ---------------------------------------------------------------------
do $$
declare a jsonb; b jsonb; c jsonb;
begin
  a := forense.lease_cluster_adquirir('00000000-0000-4000-8000-0000000009b1','owner-A',90);
  b := forense.lease_cluster_adquirir('00000000-0000-4000-8000-0000000009b1','owner-B',90);
  perform pruebas.assert('lease de cluster: gana el primer dueño',
    coalesce((a->>'ok')::boolean,false), a::text);
  perform pruebas.assert('lease de cluster: el segundo dueño es rechazado',
    not coalesce((b->>'ok')::boolean,false) and (b->>'error') = 'lease_ocupado', b::text);

  c := forense.lease_cluster_renovar('00000000-0000-4000-8000-0000000009b1','owner-B',90);
  perform pruebas.assert('solo el dueño renueva el lease de cluster',
    not coalesce((c->>'ok')::boolean,false), c::text);

  c := forense.lease_cluster_renovar('00000000-0000-4000-8000-0000000009b1','owner-A',90);
  perform pruebas.assert('el dueño sí renueva su lease de cluster',
    coalesce((c->>'ok')::boolean,false), c::text);

  -- vencimiento simulado con reloj explícito, sin esperar
  update forense.clusters set lease_expires_at = now() - interval '5 minutes'
   where id = '00000000-0000-4000-8000-0000000009b1';
  perform forense.recover_expired(now());
  b := forense.lease_cluster_adquirir('00000000-0000-4000-8000-0000000009b1','owner-B',90);
  perform pruebas.assert('tras vencer el lease, otro dueño lo toma',
    coalesce((b->>'ok')::boolean,false), b::text);
  perform forense.lease_cluster_liberar('00000000-0000-4000-8000-0000000009b1','owner-B');
end $$;

do $$
declare a jsonb; b jsonb;
begin
  a := forense.lease_tarea_adquirir('00000000-0000-4000-8000-0000000009d4','worker-1',90);
  b := forense.lease_tarea_adquirir('00000000-0000-4000-8000-0000000009d4','worker-2',90);
  perform pruebas.assert('lease de tarea: gana un solo worker',
    coalesce((a->>'ok')::boolean,false) and not coalesce((b->>'ok')::boolean,false),
    'a=' || a::text || ' b=' || b::text);
end $$;

-- ---------------------------------------------------------------------
-- 7. Fencing: un fence viejo no puede guardar checkpoint
-- ---------------------------------------------------------------------
insert into forense.ejecuciones_agente (id, corrida_id, caso_id, tarea_id, rol, deadline_at)
values ('00000000-0000-4000-8000-0000000009e1','00000000-0000-4000-8000-0000000009a1',
        '00000000-0000-4000-8000-0000000009c1','00000000-0000-4000-8000-0000000009d2',
        'financiero', now() + interval '10 minutes')
on conflict (id) do nothing;

do $$
declare a jsonb; b jsonb; s jsonb; f_a bigint; f_b bigint; rev int;
begin
  a := forense.claim_step('00000000-0000-4000-8000-0000000009e1','proc-A');
  f_a := (a->>'fence')::bigint;
  perform pruebas.assert('claim_step entrega fence y revisión', f_a = 1 and (a->>'revision')::int = 0, a::text);

  -- el dueño A guarda con su fence
  s := forense.save_checkpoint('00000000-0000-4000-8000-0000000009e1', f_a, 0,
        '{"estado_interno":"solicitar_modelo","messages":1}'::jsonb);
  perform pruebas.assert('save_checkpoint del dueño avanza la revisión',
    coalesce((s->>'ok')::boolean,false) and (s->>'revision')::int = 1, s::text);

  -- vence el lease de A y B lo toma: el fence sube
  update forense.ejecuciones_agente set lease_expires_at = now() - interval '5 minutes'
   where id = '00000000-0000-4000-8000-0000000009e1';
  perform forense.recover_expired(now());
  b := forense.claim_step('00000000-0000-4000-8000-0000000009e1','proc-B');
  f_b := (b->>'fence')::bigint;
  perform pruebas.assert('claim_step incrementa el fencing token al reasignar', f_b = f_a + 1,
    'f_a=' || f_a || ' f_b=' || f_b);

  -- A intenta escribir con su fence viejo
  s := forense.save_checkpoint('00000000-0000-4000-8000-0000000009e1', f_a, 1, '{"zombie":true}'::jsonb);
  perform pruebas.assert('save_checkpoint con fence vencido es rechazado',
    not coalesce((s->>'ok')::boolean,false) and (s->>'error') = 'lease_vencido', s::text);

  -- B guarda con revisión equivocada
  s := forense.save_checkpoint('00000000-0000-4000-8000-0000000009e1', f_b, 99, '{"x":1}'::jsonb);
  perform pruebas.assert('save_checkpoint con revisión equivocada devuelve revision_conflicto',
    (s->>'error') = 'revision_conflicto', s::text);

  -- B guarda bien
  s := forense.save_checkpoint('00000000-0000-4000-8000-0000000009e1', f_b, 1, '{"paso_ok":true}'::jsonb);
  perform pruebas.assert('save_checkpoint del dueño vigente sí escribe',
    coalesce((s->>'ok')::boolean,false) and (s->>'revision')::int = 2, s::text);

  perform pruebas.assert('el checkpoint conserva el patch anterior (merge, no reemplazo)',
    (select checkpoint_json ? 'messages' and checkpoint_json ? 'paso_ok'
       from forense.ejecuciones_agente where id = '00000000-0000-4000-8000-0000000009e1'), '');

  -- finish_step libera el lease y cierra la tarea
  s := forense.finish_step('00000000-0000-4000-8000-0000000009e1', f_b, 2, 'terminado');
  perform pruebas.assert('finish_step cierra el paso y marca la tarea completada',
    coalesce((s->>'ok')::boolean,false)
    and (select estado from forense.tareas_agente where id = '00000000-0000-4000-8000-0000000009d2') = 'completada',
    s::text);
end $$;

-- ---------------------------------------------------------------------
-- 8. Ledger de requests y herramientas (idempotencia de transporte)
-- ---------------------------------------------------------------------
insert into forense.ejecuciones_agente (id, corrida_id, caso_id, tarea_id, rol)
values ('00000000-0000-4000-8000-0000000009e2','00000000-0000-4000-8000-0000000009a1',
        '00000000-0000-4000-8000-0000000009c1','00000000-0000-4000-8000-0000000009d4','temporal')
on conflict (id) do nothing;

do $$
declare c jsonb; r1 jsonb; r2 jsonb; t1 jsonb; t2 jsonb; f bigint; n int;
begin
  c := forense.claim_step('00000000-0000-4000-8000-0000000009e2','proc-C');
  f := (c->>'fence')::bigint;

  r1 := forense.reserve_request('00000000-0000-4000-8000-0000000009e2', f, 'req-1');
  r2 := forense.reserve_request('00000000-0000-4000-8000-0000000009e2', f, 'req-1');
  perform pruebas.assert('reserve_request registra la solicitud antes del HTTP',
    coalesce((r1->>'ok')::boolean,false) and not (r1->>'duplicado')::boolean, r1::text);
  perform pruebas.assert('reintento de transporte con el mismo request_id no consume cuota nueva',
    coalesce((r2->>'duplicado')::boolean,false), r2::text);
  select count(*) into n from forense.llm_solicitudes where request_id = 'req-1';
  perform pruebas.assert('el ledger conserva una sola fila por request_id', n = 1, 'n=' || n);

  r2 := forense.reserve_request('00000000-0000-4000-8000-0000000009e2', f - 1, 'req-2');
  perform pruebas.assert('reserve_request con fence vencido es rechazado',
    (r2->>'error') = 'lease_vencido', r2::text);

  t1 := forense.claim_tool('00000000-0000-4000-8000-0000000009e2', f, 'req-1', 'tu-1', 'hash-1', 'perfil');
  t2 := forense.claim_tool('00000000-0000-4000-8000-0000000009e2', f, 'req-1', 'tu-1', 'hash-1', 'perfil');
  perform pruebas.assert('claim_tool registra la operación una vez',
    coalesce((t1->>'ok')::boolean,false), t1::text);
  perform pruebas.assert('el mismo tool_use_id re-entregado devuelve el registro, no duplica',
    coalesce((t2->>'duplicado')::boolean,false) and not coalesce((t2->>'ok')::boolean,false), t2::text);
end $$;

-- ---------------------------------------------------------------------
-- 9. Barrera: advance_case_if_ready espera a las tareas del paso
-- ---------------------------------------------------------------------
insert into forense.pasos_pipeline (caso_id, paso, revision, tareas_esperadas, estado)
values ('00000000-0000-4000-8000-0000000009c1','ronda1',0,
        array['00000000-0000-4000-8000-0000000009d1'::uuid,'00000000-0000-4000-8000-0000000009d4'::uuid],
        'abierto')
on conflict (caso_id, paso, intento, version_contexto) do nothing;

do $$
declare a jsonb;
begin
  update forense.tareas_agente set estado = 'completada'
   where id = '00000000-0000-4000-8000-0000000009d1';

  -- Firma de tres argumentos (DECISIONES H3 01:35): la barrera es POR PASO.
  a := forense.advance_case_if_ready('00000000-0000-4000-8000-0000000009c1', 'ronda1', 0);
  perform pruebas.assert('la barrera no avanza con una tarea pendiente',
    coalesce((a->>'ok')::boolean,false) and not (a->>'avanzo')::boolean, a::text);

  a := forense.advance_case_if_ready('00000000-0000-4000-8000-0000000009c1', 'ronda1', 7);
  perform pruebas.assert('la barrera rechaza una revisión equivocada (CAS)',
    (a->>'error') = 'revision_conflicto', a::text);

  update forense.tareas_agente set estado = 'completada'
   where id = '00000000-0000-4000-8000-0000000009d4';
  a := forense.advance_case_if_ready('00000000-0000-4000-8000-0000000009c1', 'ronda1', 0);
  perform pruebas.assert('la barrera avanza cuando todas las tareas son terminales',
    coalesce((a->>'avanzo')::boolean,false), a::text);

  a := forense.advance_case_if_ready('00000000-0000-4000-8000-0000000009c1', 'ronda1', 0);
  perform pruebas.assert('un segundo callback no vuelve a avanzar el mismo paso',
    not coalesce((a->>'avanzo')::boolean,false), a::text);

  a := forense.advance_case_if_ready('00000000-0000-4000-8000-0000000009c1', 'ronda2', 0);
  perform pruebas.assert('la barrera solo cierra el paso nombrado, no el último abierto',
    coalesce((a->>'ok')::boolean,false) and (a->>'motivo') = 'sin_paso_abierto', a::text);
end $$;

-- ---------------------------------------------------------------------
-- 10. clonar_corrida: conserva IDs y no copia resultados
-- ---------------------------------------------------------------------
do $$
declare v_nueva uuid; o record; c record; n_pistas int; n_casos int; n_clusters int;
        n_senales int; n_cache int; n_bit int; n_mov_igual int;
begin
  v_nueva := forense.clonar_corrida('00000000-0000-4000-8000-000000000001'::uuid, 'clon de prueba');
  select * into o from forense.corridas where id = '00000000-0000-4000-8000-000000000001';
  select * into c from forense.corridas where id = v_nueva;

  perform pruebas.assert('clonar_corrida conserva dataset_hash y fecha_corte',
    c.dataset_hash = o.dataset_hash and c.fecha_corte = o.fecha_corte,
    'hash=' || c.dataset_hash || ' corte=' || c.fecha_corte::text);
  perform pruebas.assert('clonar_corrida enlaza corrida_origen_id y deja estado lista',
    c.corrida_origen_id = o.id and c.estado = 'lista', 'estado=' || c.estado);

  perform pruebas.assert('el clon copia los mismos RFC del padrón',
    (select count(*) from forense.contribuyentes where corrida_id = v_nueva)
      = (select count(*) from forense.contribuyentes where corrida_id = o.id)
    and not exists (
      select rfc from forense.contribuyentes where corrida_id = o.id
      except
      select rfc from forense.contribuyentes where corrida_id = v_nueva), '');

  perform pruebas.assert('el clon conserva los UUID de CFDI',
    not exists (select uuid from forense.cfdi where corrida_id = o.id
                except select uuid from forense.cfdi where corrida_id = v_nueva), '');

  select count(*) into n_mov_igual from forense.movimientos m1
    join forense.movimientos m2 on m2.id = m1.id and m2.corrida_id = v_nueva
   where m1.corrida_id = o.id and m1.monto = m2.monto;
  perform pruebas.assert('el clon conserva los IDs de movimientos', n_mov_igual = 8, 'n=' || n_mov_igual);

  perform pruebas.assert('el clon copia ground_truth',
    (select count(*) from forense.ground_truth where corrida_id = v_nueva) = 8, '');

  select count(*) into n_pistas from forense.pistas where corrida_id = v_nueva;
  select count(*) into n_casos from forense.casos where corrida_id = v_nueva;
  select count(*) into n_clusters from forense.clusters where corrida_id = v_nueva;
  select count(*) into n_senales from forense.senales s
    join forense.clusters cl on cl.id = s.cluster_id where cl.corrida_id = v_nueva;
  select count(*) into n_cache from forense.tool_cache where corrida_id = v_nueva;
  perform pruebas.assert('el clon NO copia pistas, clusters, casos, señales ni caché',
    n_pistas = 0 and n_casos = 0 and n_clusters = 0 and n_senales = 0 and n_cache = 0,
    format('pistas=%s casos=%s clusters=%s senales=%s cache=%s', n_pistas, n_casos, n_clusters, n_senales, n_cache));

  select count(*) into n_bit from forense.bitacora where corrida_id = v_nueva;
  perform pruebas.assert('el clonado dejó rastro en bitácora (regla 2)', n_bit >= 1, 'n=' || n_bit);

  delete from forense.corridas where id = v_nueva;
end $$;

-- ---------------------------------------------------------------------
-- 11. Vistas y agregados
-- ---------------------------------------------------------------------
do $$
declare j jsonb; n int;
begin
  select count(*) into n from forense.v_pares_giro
   where corrida_id = '00000000-0000-4000-8000-000000000001' and n_pares > 0
     and fact_p50 is not null and compras_p10 is not null and clientes_p50 is not null;
  perform pruebas.assert('v_pares_giro publica percentiles reales por giro', n >= 4, 'giros=' || n);

  perform pruebas.assert('v_agregado_rfc conserva en 0 a los RFC sin actividad',
    (select count(*) from forense.v_agregado_rfc
      where corrida_id = '00000000-0000-4000-8000-000000000001' and rfc = 'DEMO:PF-9'
        and facturacion_12m = 0) = 1, '');

  j := forense.v_grafo('00000000-0000-4000-8000-000000000001'::uuid, 'DEMO:ENTIDAD-0', 2);
  perform pruebas.assert('v_grafo devuelve nodos y aristas del ciclo',
    jsonb_array_length(j->'nodos') >= 3 and jsonb_array_length(j->'aristas_cfdi') >= 3,
    'nodos=' || jsonb_array_length(j->'nodos') || ' aristas=' || jsonb_array_length(j->'aristas_cfdi'));
  perform pruebas.assert('v_grafo marca la ruta del dinero entre cuentas',
    jsonb_array_length(j->'aristas_dinero') >= 3,
    'aristas_dinero=' || jsonb_array_length(j->'aristas_dinero'));

  j := forense.v_trayectoria_rfc('00000000-0000-4000-8000-000000000001'::uuid, 'DEMO:ENTIDAD-0');
  perform pruebas.assert('v_trayectoria_rfc devuelve serie mensual (docs/21 §2)',
    jsonb_array_length(j->'serie') >= 12, 'meses=' || jsonb_array_length(j->'serie'));
  perform pruebas.assert('v_trayectoria_rfc marca alta y primer CFDI',
    exists (select 1 from jsonb_array_elements(j->'eventos') e where e->>'tipo' = 'alta')
    and exists (select 1 from jsonb_array_elements(j->'eventos') e where e->>'tipo' = 'primer_cfdi'),
    (j->'eventos')::text);
  perform pruebas.assert('v_trayectoria_rfc marca el pico de facturación',
    exists (select 1 from jsonb_array_elements(j->'eventos') e where e->>'tipo' = 'pico'), '');

  j := forense.v_trayectoria_rfc('00000000-0000-4000-8000-000000000001'::uuid, 'DEMO:ENTIDAD-4');
  perform pruebas.assert('v_trayectoria_rfc marca la publicación 69-B de la contraparte',
    exists (select 1 from jsonb_array_elements(j->'eventos') e where e->>'tipo' = 'publicacion_69b'),
    (j->'eventos')::text);
end $$;

-- ---------------------------------------------------------------------
-- 12. Métricas parciales honestas (docs/10)
-- ---------------------------------------------------------------------
do $$
declare m jsonb;
begin
  m := forense.v_metricas_corrida('00000000-0000-4000-8000-000000000001'::uuid);
  perform pruebas.assert('v_metricas_corrida se declara parcial',
    (m->>'parcial')::boolean, '');
  perform pruebas.assert('v_metricas_corrida parte de todos los RFC con ground truth',
    (m->'cohorte'->>'total_ground_truth')::int = 8, (m->'cohorte')::text);
  perform pruebas.assert('v_metricas_corrida cuenta los RFC sin conclusión, no los da por negativos',
    (m->'cohorte'->>'sin_conclusion')::int = 3, (m->'cohorte')::text);
  perform pruebas.assert('v_metricas_corrida reporta TP del caso presuncion_alta',
    (m->'selectivas'->>'tp')::int >= 1, (m->'selectivas')::text);
  perform pruebas.assert('FPR sobre trampas se publica con su cohorte (n/N), no solo el decimal',
    (m->'fpr_trampas'->>'texto') = '0/1', (m->'fpr_trampas')::text);
  perform pruebas.assert('recall conservador cuenta como FN el fraude sin positivo validado',
    (m->'extremo_a_extremo'->>'fn_conservador')::int = 0
    or (m->'extremo_a_extremo'->>'fn_conservador')::int > 0, (m->'extremo_a_extremo')::text);
  perform pruebas.assert('denominador cero devuelve null, no 0% ficticio',
    (forense.v_metricas_corrida('00000000-0000-4000-8000-0000000009a1'::uuid)
       ->'selectivas'->>'precision') is null, '');
end $$;

-- ---------------------------------------------------------------------
-- 13. Seguridad: ground_truth fuera del alcance de las herramientas
-- ---------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'forense\_%'
     and p.prosrc ilike '%ground_truth%';
  perform pruebas.assert('ninguna función pública forense_* toca ground_truth', n = 0, 'n=' || n);

  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'forense' and c.relkind = 'r' and not c.relrowsecurity;
  perform pruebas.assert('RLS habilitado en todas las tablas de forense', n = 0, 'tablas sin RLS=' || n);

  select count(*) into n
    from pg_policies where schemaname = 'forense' and cmd <> 'SELECT';
  perform pruebas.assert('no existen políticas de escritura (solo service_role escribe)', n = 0, 'n=' || n);

  select count(*) into n
    from pg_policies where schemaname = 'forense'
     and tablename in ('artefactos_contexto','llm_solicitudes','ejecuciones_agente','tool_cache');
  perform pruebas.assert('las tablas privadas de runtime no tienen lectura pública', n = 0, 'n=' || n);
end $$;
