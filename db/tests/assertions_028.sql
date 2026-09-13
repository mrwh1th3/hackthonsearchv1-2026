-- =====================================================================
-- Aserciones de db/028_ia_complemento.sql. Base local desechable; usa la
-- corrida fixture de seed_fake y un run_log sintético del auditor.
-- Cubre: checkpoint nunca array, tope duro de 5 agentes idempotente, orden
-- auditor→IA, regla 5 (paquete no crece), presupuestos en reserve_request,
-- contrato agents.especialista, telemetría/pizarrón, cierre determinista,
-- reconciliador acotado y disparo automático.
-- =====================================================================

set search_path = '';

create or replace function pruebas.c028_run(p_n int) returns jsonb language sql as $$
  select jsonb_build_object(
    'company_rfc', 'AAA010101AAA',
    'findings', (select jsonb_agg(jsonb_build_object(
        'scheme_type', 'phantom_vendor', 'confidence', 'proven',
        'entities', jsonb_build_array('RFC:BBB010101BB' || (g % 10)::text, 'RFC:CCC010101CC1', 'EMP:9', 'EMP:10', 'EMP:11'),
        'peso_amount', 1000 + g, 'rule_broken', repeat('regla larga ', 30),
        'exhibits', (select jsonb_agg(jsonb_build_object('source_table', 'contracts', 'record_id', 'K' || h))
                       from generate_series(1, 9) h)))
      from generate_series(1, p_n) g),
    'leads', (select jsonb_agg(jsonb_build_object('entity', 'RFC:DDD010101DD' || (g % 10)::text,
        'investigated_as', 'kickback', 'closed_by', 'challenger', 'reason', repeat('motivo ', 40)))
      from generate_series(1, p_n) g))
$$;

do $$
declare
  v_corr uuid := '00000000-0000-4000-8000-000000000001';
  v_inv uuid := '00000000-0000-4000-8000-000000028001';
  v_inv2 uuid := '00000000-0000-4000-8000-000000028002';
  r jsonb; r2 jsonb; v_caso uuid; v_n int; v_b1 int; v_b2 int; v_e uuid; v_claim jsonb;
  v_ok boolean; v_i int; v_t uuid; v_cp jsonb; v_auditor_antes text;
begin
  select string_agg(id::text || nivel, ',' order by id) into v_auditor_antes from forense.casos;

  insert into forense.investigaciones (id, perfil_id, modo, corrida_id, estado, idempotency_key, completada_at)
  values (v_inv, (select id from forense.perfiles limit 1), 'corrida', v_corr, 'investigacion_completa',
          'auditor:t028', now());

  -- Orden: sin auditor determinista no se abre nada.
  r := forense.abrir_ia_complemento(v_inv);
  perform pruebas.assert('028 sin auditor_resultados no abre agentes',
    (r->>'ok')::boolean = false and r->>'motivo' = 'auditor_determinista_pendiente', r::text);
  perform pruebas.assert('028 pendientes no lista la investigación sin auditor',
    not exists (select 1 from forense.ia_complementos_pendientes(5) p where p.investigacion_id = v_inv), '');

  insert into forense.auditor_resultados (corrida_id, seed, fingerprint, estate_sha256, submission, run_log, case_file_html)
  values (v_corr, 5005, 'f', 's', '{}', pruebas.c028_run(20), '<html/>');

  perform pruebas.assert('028 pendientes lista la investigación tras el auditor',
    exists (select 1 from forense.ia_complementos_pendientes(5) p where p.investigacion_id = v_inv), '');

  r := forense.abrir_ia_complemento(v_inv);
  v_caso := (r->>'caso_id')::uuid;
  perform pruebas.assert('028 abre el complemento', (r->>'ok')::boolean and (r->>'creado')::boolean, r::text);
  select count(*) into v_n from forense.ejecuciones_agente where investigacion_id = v_inv;
  perform pruebas.assert('028 exactamente 5 ejecuciones IA', v_n = 5, v_n::text);
  perform pruebas.assert('028 familias D,F,R,T,E',
    (select array_agg(familia order by familia) from forense.ejecuciones_agente where investigacion_id = v_inv)
      = array['D','E','F','R','T'], '');
  perform pruebas.assert('028 modelo de workers desde config (sonnet)',
    (select bool_and(model_id = 'claude-sonnet-5') from forense.ejecuciones_agente where investigacion_id = v_inv), '');

  r2 := forense.abrir_ia_complemento(v_inv);
  select count(*) into v_n from forense.ejecuciones_agente where investigacion_id = v_inv;
  perform pruebas.assert('028 idempotente: segunda apertura no crea agentes',
    (r2->>'creado')::boolean = false and v_n = 5 and r2->>'caso_id' = v_caso::text
    and jsonb_array_length(r2->'tarea_ids') = 5, r2::text);
  perform pruebas.assert('028 pendientes ya no la lista',
    not exists (select 1 from forense.ia_complementos_pendientes(5) p where p.investigacion_id = v_inv), '');

  v_ok := false;
  begin
    insert into forense.tareas_agente (id, caso_id, corrida_id, cluster_id, agente, ronda, estado, idempotency_key)
    select gen_random_uuid(), v_caso, v_corr, cluster_id, 'documental', 2, 'pendiente', 'sexto' from forense.casos where id = v_caso
    returning id into v_t;
    insert into forense.ejecuciones_agente (corrida_id, caso_id, tarea_id, rol, investigacion_id, familia)
    values (v_corr, v_caso, v_t, 'documental', v_inv, 'D');
  exception when unique_violation then v_ok := true;
  end;
  perform pruebas.assert('028 un sexto agente por familia viola el índice único', v_ok, '');
  delete from forense.tareas_agente where idempotency_key = 'sexto';

  -- Regla 5: con el doble de hallazgos el paquete pesa lo mismo.
  v_b1 := length(forense.preparar_contexto_ia(v_caso, pruebas.c028_run(20))::text);
  v_b2 := length(forense.preparar_contexto_ia(v_caso, pruebas.c028_run(40))::text);
  perform pruebas.assert('028 regla 5: paquete idéntico con el doble de hallazgos', v_b1 = v_b2,
    v_b1::text || ' vs ' || v_b2::text);
  perform pruebas.assert('028 paquete bajo el techo de 12000 caracteres', v_b1 < 12000, v_b1::text);
  perform pruebas.assert('028 artefacto de contexto enlazado a las 5 ejecuciones',
    (select count(*) from forense.ejecuciones_agente e join forense.artefactos_contexto a
        on a.caso_id = e.caso_id and a.hash = e.context_hash where e.investigacion_id = v_inv) = 5, '');

  -- Checkpoint: nunca array.
  perform pruebas.assert('028 checkpoint_objeto repara arrays',
    forense.checkpoint_objeto('[{"a":1},null,{"b":2},null]'::jsonb) = '{"b":2}'::jsonb, '');
  select id into v_e from forense.ejecuciones_agente where investigacion_id = v_inv and familia = 'D';
  v_claim := forense.claim_step(v_e, 'test:1');
  r := forense.save_checkpoint(v_e, (v_claim->>'fence')::bigint, (v_claim->>'revision')::int, 'null'::jsonb);
  select checkpoint_json into v_cp from forense.ejecuciones_agente where id = v_e;
  perform pruebas.assert('028 save_checkpoint rechaza patch no objeto',
    (r->>'ok')::boolean = false and r->>'error' = 'patch_invalido' and jsonb_typeof(v_cp) = 'object', r::text);
  update forense.ejecuciones_agente set checkpoint_json = '[{"estado_interno":"validar_salida"},null]' where id = v_e;
  r := forense.save_checkpoint(v_e, (v_claim->>'fence')::bigint, (v_claim->>'revision')::int,
                               '{"estado_interno":"solicitar_modelo","reparaciones_json":1}'::jsonb);
  select checkpoint_json into v_cp from forense.ejecuciones_agente where id = v_e;
  perform pruebas.assert('028 save_checkpoint cura un checkpoint array',
    (r->>'ok')::boolean and jsonb_typeof(v_cp) = 'object' and v_cp->>'reparaciones_json' = '1', v_cp::text);

  -- Presupuesto por ejecución: 8 requests y la novena se niega.
  v_claim := forense.claim_step(v_e, 'test:1');
  for v_i in 1..8 loop
    r := forense.reserve_request(v_e, (v_claim->>'fence')::bigint, 'req:' || v_i, null, 'claude-sonnet-5');
    exit when not (r->>'ok')::boolean;
  end loop;
  perform pruebas.assert('028 ocho requests concedidas', (r->>'ok')::boolean, r::text);
  r := forense.reserve_request(v_e, (v_claim->>'fence')::bigint, 'req:9', null, 'claude-sonnet-5');
  perform pruebas.assert('028 la novena request se niega', (r->>'ok')::boolean = false
    and r->>'alcance' = 'requests_ejecucion', r::text);
  perform pruebas.assert('028 la negativa deja rastro presupuesto_agotado',
    exists (select 1 from forense.bitacora where caso_id = v_caso and tipo_evento = 'presupuesto_agotado'
              and payload->>'alcance' = 'requests_ejecucion'), '');

  -- Presupuesto de coste por investigación.
  select id into v_e from forense.ejecuciones_agente where investigacion_id = v_inv and familia = 'F';
  update forense.ejecuciones_agente set costo_usd = 1.3 where investigacion_id = v_inv and familia in ('D','R','T','E');
  v_claim := forense.claim_step(v_e, 'test:2');
  r := forense.reserve_request(v_e, (v_claim->>'fence')::bigint, 'reqF:1', null, 'claude-sonnet-5');
  perform pruebas.assert('028 tope de coste por investigación', (r->>'ok')::boolean = false
    and r->>'alcance' = 'costo_investigacion', r::text);
  update forense.ejecuciones_agente set costo_usd = 0 where investigacion_id = v_inv;

  -- Fuera del complemento no hay coste LLM.
  select e.id into v_e from forense.ejecuciones_agente e where e.investigacion_id is null and e.tarea_id is not null limit 1;
  if v_e is null then
    insert into forense.ejecuciones_agente (corrida_id, caso_id, tarea_id, rol)
    select v_corr, t.caso_id, t.id, t.agente from forense.tareas_agente t
     where not exists (select 1 from forense.ejecuciones_agente x where x.tarea_id = t.id) limit 1
    returning id into v_e;
  end if;
  v_claim := forense.claim_step(v_e, 'test:3');
  r := forense.reserve_request(v_e, (v_claim->>'fence')::bigint, 'fuera:1', null, 'claude-opus-5');
  perform pruebas.assert('028 ia_solo_complemento niega requests fuera del complemento',
    (r->>'ok')::boolean = false and r->>'alcance' = 'fuera_de_complemento_ia', coalesce(r::text, 'sin ejecucion'));

  -- Contrato agents.especialista.
  select id into v_e from forense.ejecuciones_agente where investigacion_id = v_inv and familia = 'R';
  r := forense.validar_salida_rol(v_e, 'relacional', '{"senal_ids":[],"resumen":"sin novedades","limitaciones":[]}');
  perform pruebas.assert('028 salida agents.especialista válida', (r->>'ok')::boolean, r::text);
  r := forense.validar_salida_rol(v_e, 'relacional', '{"titular":"x","familia":"R","confianza":"alta","ids":["CFDI:x"]}');
  perform pruebas.assert('028 la forma de escribir_senal ya no es salida válida', (r->>'ok')::boolean = false, r::text);
  r := forense.validar_salida_rol(v_e, 'relacional', '{"senal_ids":["999999"],"resumen":"x","limitaciones":[]}');
  perform pruebas.assert('028 senal_id ajeno se rechaza', (r->>'ok')::boolean = false, r::text);
  r := forense.validar_salida_rol(v_e, 'relacional', 'null'::jsonb);
  perform pruebas.assert('028 salida no objeto devuelve ok=false sin excepción', (r->>'ok')::boolean = false, r::text);

  -- Telemetría y pizarrón.
  r := forense.registrar_turno_ia(v_e, 'reqR:1',
    '{"input_tokens":1000,"output_tokens":200,"cache_read_input_tokens":5000}'::jsonb, 'claude-sonnet-5',
    'tool_use', array['forense_relacionados'], 'Reviso relaciones fuera de los hallazgos', 'ejecutar_herramienta');
  perform pruebas.assert('028 registrar_turno_ia acumula tokens y coste',
    (select tokens_in = 1000 and tokens_out = 200 and costo_usd = 0.0075 and n_requests = 1
            and tool_en_curso = 'forense_relacionados' and paso_actual = 'ejecutar_herramienta'
       from forense.ejecuciones_agente where id = v_e), r::text);
  perform pruebas.assert('028 turno deja evento agente_turno en bitácora',
    exists (select 1 from forense.bitacora where caso_id = v_caso and tipo_evento = 'agente_turno'
              and (payload->>'tokens_in')::int = 1000 and tokens_in = 1000), '');
  perform pruebas.assert('028 turno deja anotación consulta en el pizarrón',
    exists (select 1 from forense.anotaciones_agente where ejecucion_id = v_e and tipo = 'consulta'
              and herramientas = array['forense_relacionados']), '');
  r := forense.registrar_fin_agente(v_e);
  perform pruebas.assert('028 registrar_fin_agente emite agente_fin con duración',
    exists (select 1 from forense.bitacora where caso_id = v_caso and tipo_evento = 'agente_fin')
    and (select terminado_at is not null and duracion_ms is not null from forense.ejecuciones_agente where id = v_e), r::text);

  -- Reconciliador acotado con owner único.
  update forense.ejecuciones_agente set lease_owner = null, lease_expires_at = null,
         actualizado = now() - interval '5 minutes', recuperaciones = 0
   where investigacion_id = v_inv and familia = 'T';
  perform pruebas.assert('028 recuperar_pasos devuelve owner único',
    exists (select 1 from forense.recuperar_pasos('reconciliador:77', 8) p
             where p.rol = 'temporal' and p.owner like 'reconciliador:77:%:1'), '');
  update forense.ejecuciones_agente set actualizado = now() - interval '5 minutes', recuperaciones = 2
   where investigacion_id = v_inv and familia = 'T';
  perform count(*) from forense.recuperar_pasos('reconciliador:78', 8);
  perform pruebas.assert('028 recuperaciones agotadas cierran en error',
    (select estado_interno = 'error' from forense.ejecuciones_agente where investigacion_id = v_inv and familia = 'T'), '');

  -- Forma del paquete (no solo su tamaño).
  perform pruebas.assert('028 paquete: entidades son strings y registros son referencias canónicas',
    (select jsonb_typeof(a.contenido#>'{determinista,hallazgos,0,entidades,0}') = 'string'
        and jsonb_array_length(a.contenido#>'{determinista,hallazgos,0,entidades}') = 3
        and a.contenido#>>'{determinista,hallazgos,0,registros,0}' like 'ATR:contracts:%'
        and a.contenido#>>'{determinista,leads_cerrados,0,cerrado_por}' = 'challenger'
       from forense.artefactos_contexto a where a.caso_id = v_caso), '');

  -- Red de seguridad: workflow muerto → el reconciliador encuentra el caso por cerrar.
  -- Un agente (E) sigue vivo pero la barrera venció: también se cierra y se corta.
  update forense.ejecuciones_agente set estado_interno = 'terminado'
   where investigacion_id = v_inv and familia <> 'E' and estado_interno not in ('error','timeout');
  update forense.ejecuciones_agente set estado_interno = 'solicitar_modelo' where investigacion_id = v_inv and familia = 'E';
  update forense.pasos_pipeline set deadline = now() - interval '1 minute' where caso_id = v_caso and paso = 'ia';
  update forense.casos set creado = now() - interval '10 minutes' where id = v_caso;
  perform pruebas.assert('028 ia_complementos_por_cerrar encuentra el complemento huérfano',
    exists (select 1 from forense.ia_complementos_por_cerrar(4) p where p.caso_id = v_caso), '');

  -- Cierre determinista.
  r := forense.cerrar_ia_complemento(v_caso);
  perform pruebas.assert('028 cerrado ya no aparece por cerrar',
    not exists (select 1 from forense.ia_complementos_por_cerrar(4) p where p.caso_id = v_caso), '');
  perform pruebas.assert('028 cierre sin señales = sin_hallazgos',
    r->>'nivel' = 'sin_hallazgos' and (select estado = 'dictaminado' from forense.casos where id = v_caso), r::text);
  perform pruebas.assert('028 cierre corta agentes vivos',
    not exists (select 1 from forense.ejecuciones_agente where investigacion_id = v_inv
                  and estado_interno not in ('terminado','error','timeout')), '');
  perform pruebas.assert('028 cierre emite ia_complemento_fin y dictamen',
    (select count(*) from forense.bitacora where caso_id = v_caso and tipo_evento in ('ia_complemento_fin','dictamen')) = 2, '');
  perform pruebas.assert('028 no modifica casos previos',
    (select string_agg(id::text || nivel, ',' order by id) from forense.casos where id <> v_caso
       and not (origen = 'ia_complemento')) is not distinct from v_auditor_antes, '');
  r := forense.cerrar_ia_complemento(v_caso);
  perform pruebas.assert('028 cierre idempotente', (r->>'ya_cerrado')::boolean, r::text);
end $$;

select case when ok then 'PASA ' else 'FALLA' end || ' ' || nombre || case when ok then '' else ' :: ' || detalle end
  from pruebas.resultado where nombre like '028 %' order by nombre;
