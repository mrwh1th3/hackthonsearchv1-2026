-- =====================================================================
-- Aserciones de 008_ingesta.sql sobre el clon del fixture.
-- Comprueban la validación determinista (rechazos con motivo) y que una
-- inyección NUNCA muta el snapshot base: crea una corrida nueva clonada.
-- El ensayo con los paquetes reales de eval/inyecciones/ sobre gen-v1 vive
-- en assertions_gen.sql.
-- =====================================================================

-- 1. Validación: cada rechazo trae tabla, fila, código y mensaje
do $$
declare
  v_base uuid; r jsonb; v_ing uuid; v_uuid_base uuid; v_rfc_base text; v_clabe_base text;
  n int;
begin
  select id into v_base from forense.corridas where nombre = 'pistas: clon del fixture';
  select uuid into v_uuid_base from forense.cfdi where corrida_id = v_base order by uuid limit 1;
  select rfc into v_rfc_base from forense.contribuyentes where corrida_id = v_base order by rfc limit 1;
  select clabe into v_clabe_base from forense.cuentas where corrida_id = v_base order by clabe limit 1;

  r := forense.registrar_inyeccion(v_base, jsonb_build_object(
    'corrida_base_id', v_base, 'origen', 'ensayo',
    'idempotency_key', '00000000-0000-4000-8000-0000000008e1',
    'tablas', jsonb_build_object(
      'contribuyentes', jsonb_build_array(
        jsonb_build_object('rfc', 'INY:NUEVO-1', 'giro', 'comercializadora',
                           'tipo_persona', 'moral', 'fecha_alta', '2025-09-01'),
        -- duplicado contra la base
        jsonb_build_object('rfc', v_rfc_base, 'giro', 'comercializadora'),
        -- etiqueta de evaluación: prohibida (19 §Gates)
        jsonb_build_object('rfc', 'INY:ETIQUETADO', 'es_fraude', true)),
      'cfdi', jsonb_build_array(
        -- UUID que ya existe en la base: rechazo con motivo (21 §3.1)
        jsonb_build_object('uuid', v_uuid_base::text, 'emisor_rfc', 'INY:NUEVO-1',
                           'receptor_rfc', v_rfc_base, 'fecha', '2025-12-01T10:00:00-06:00',
                           'total', '1000.00'),
        -- sin fecha
        jsonb_build_object('uuid', '0f0f0001-0000-4000-8000-000000000001',
                           'emisor_rfc', 'INY:NUEVO-1', 'receptor_rfc', v_rfc_base,
                           'total', '1000.00')),
      'movimientos', jsonb_build_array(
        -- cuenta_destino que no existe ni en la base ni en la inyección
        jsonb_build_object('id', 990001, 'cuenta_origen', v_clabe_base,
                           'cuenta_destino', '999999999999999999',
                           'fecha', '2025-12-02T10:00:00-06:00', 'monto', '500.00')))),
    'ensayo', '00000000-0000-4000-8000-0000000008e1'::uuid);

  perform pruebas.assert('registrar_inyeccion acepta el paquete y lo deja en staging',
    (r->>'ok')::boolean and (r->>'creada')::boolean, r::text);
  v_ing := (r->>'ingesta_id')::uuid;

  perform pruebas.assert('registrar_inyeccion deja evento inyeccion en bitácora',
    exists (select 1 from forense.bitacora
             where tipo_evento = 'inyeccion' and payload->>'ingesta_id' = v_ing::text), '');

  r := forense.validar_inyeccion(v_ing);
  perform pruebas.assert('una inyección con filas inválidas queda rechazada',
    (r->>'ok')::boolean = false and (r->>'estado') = 'rechazada', r::text);

  select count(*) into n from forense.errores_ingesta where ingesta_id = v_ing;
  perform pruebas.assert('cada fila rechazada deja tabla, fila, código y mensaje',
    n = 5, 'errores=' || n);

  perform pruebas.assert('un UUID duplicado contra la base se rechaza con motivo',
    exists (select 1 from forense.errores_ingesta
             where ingesta_id = v_ing and tabla = 'cfdi' and codigo = 'duplicado'), '');
  perform pruebas.assert('un RFC duplicado contra la base se rechaza con motivo',
    exists (select 1 from forense.errores_ingesta
             where ingesta_id = v_ing and tabla = 'contribuyentes' and codigo = 'duplicado'), '');
  perform pruebas.assert('una fila con etiqueta de evaluación se rechaza',
    exists (select 1 from forense.errores_ingesta
             where ingesta_id = v_ing and codigo = 'etiqueta_prohibida'), '');
  perform pruebas.assert('una FK rota contra base + filas nuevas se rechaza',
    exists (select 1 from forense.errores_ingesta
             where ingesta_id = v_ing and tabla = 'movimientos' and codigo = 'fk_rota'), '');
  perform pruebas.assert('un CFDI sin fecha se rechaza',
    exists (select 1 from forense.errores_ingesta
             where ingesta_id = v_ing and codigo = 'fecha_faltante'), '');

  -- Una inyección rechazada NO puede clonar
  begin
    perform forense.clonar_corrida_con_inyeccion(v_base, v_ing);
    perform pruebas.assert('una inyección rechazada no puede crear corrida', false,
      'clonar_corrida_con_inyeccion no falló');
  exception when others then
    perform pruebas.assert('una inyección rechazada no puede crear corrida', true, sqlerrm);
  end;
end $$;

-- 2. Inyección válida: corrida nueva, base intacta, rastro persistido
do $$
declare
  v_base uuid; r jsonb; v_ing uuid; v_iny uuid; v_nueva uuid;
  n_cfdi_base_antes int; n_cfdi_base_despues int; n_mov_base_antes int;
  n_contrib_nueva int; n_cfdi_nueva int; v_rfc_base text; v_clabe_base text;
begin
  select id into v_base from forense.corridas where nombre = 'pistas: clon del fixture';
  select rfc into v_rfc_base from forense.contribuyentes where corrida_id = v_base order by rfc limit 1;
  select clabe into v_clabe_base from forense.cuentas where corrida_id = v_base order by clabe limit 1;
  select count(*) into n_cfdi_base_antes from forense.cfdi where corrida_id = v_base;
  select count(*) into n_mov_base_antes from forense.movimientos where corrida_id = v_base;

  r := forense.registrar_inyeccion(v_base, jsonb_build_object(
    'corrida_base_id', v_base, 'origen', 'ensayo',
    'idempotency_key', '00000000-0000-4000-8000-0000000008e2',
    'tablas', jsonb_build_object(
      'contribuyentes', jsonb_build_array(
        jsonb_build_object('rfc', 'INY:BUENO-1', 'razon_social', 'Inyectada Uno',
                           'giro', 'comercializadora', 'tipo_persona', 'moral',
                           'fecha_alta', '2025-09-01', 'empleados_declarados', 0)),
      'cuentas', jsonb_build_array(
        jsonb_build_object('clabe', '012180000000990001', 'rfc_titular', 'INY:BUENO-1',
                           'banco', '012', 'tipo', 'moral', 'moneda', 'MXN',
                           'saldo_inicial', '1000.00')),
      'cfdi', jsonb_build_array(
        jsonb_build_object('uuid', '0f0f0002-0000-4000-8000-000000000001', 'tipo', 'I',
                           'emisor_rfc', 'INY:BUENO-1', 'receptor_rfc', v_rfc_base,
                           'fecha', '2025-12-01T10:00:00-06:00', 'total', '500000.00',
                           'moneda', 'MXN', 'metodo_pago', 'PUE',
                           'descripcion', 'servicios inyectados')),
      'movimientos', jsonb_build_array(
        jsonb_build_object('id', 990002, 'cuenta_origen', v_clabe_base,
                           'cuenta_destino', '012180000000990001',
                           'fecha', '2025-12-03T10:00:00-06:00', 'monto', '500000.00',
                           'moneda', 'MXN', 'tipo', 'transferencia',
                           'referencia', 'PAGO INYECTADO')))),
    'ensayo', '00000000-0000-4000-8000-0000000008e2'::uuid);
  v_ing := (r->>'ingesta_id')::uuid;
  v_iny := (r->>'inyeccion_id')::uuid;

  r := forense.validar_inyeccion(v_ing);
  perform pruebas.assert('una inyección consistente queda validada',
    (r->>'ok')::boolean and (r->>'estado') = 'validada', r::text);
  perform pruebas.assert('la validación calcula los RFC afectados',
    (r->'rfcs_afectados') @> '["INY:BUENO-1"]'::jsonb, (r->'rfcs_afectados')::text);

  v_nueva := forense.clonar_corrida_con_inyeccion(v_base, v_ing);
  perform pruebas.assert('clonar_corrida_con_inyeccion devuelve la corrida nueva',
    v_nueva is not null and v_nueva <> v_base, coalesce(v_nueva::text, 'null'));

  perform pruebas.assert('la corrida nueva referencia a la base y queda lista',
    (select corrida_origen_id = v_base and estado = 'lista'
       from forense.corridas where id = v_nueva), '');
  perform pruebas.assert('la corrida nueva tiene dataset_hash propio',
    (select c1.dataset_hash <> c2.dataset_hash
       from forense.corridas c1, forense.corridas c2
      where c1.id = v_nueva and c2.id = v_base), '');

  -- El snapshot base no se movió: regla 10
  select count(*) into n_cfdi_base_despues from forense.cfdi where corrida_id = v_base;
  perform pruebas.assert('la inyección no muta el snapshot base (CFDI)',
    n_cfdi_base_despues = n_cfdi_base_antes,
    'antes=' || n_cfdi_base_antes || ' despues=' || n_cfdi_base_despues);
  perform pruebas.assert('la inyección no muta el snapshot base (movimientos)',
    (select count(*) from forense.movimientos where corrida_id = v_base) = n_mov_base_antes, '');
  perform pruebas.assert('el RFC inyectado no aparece en la corrida base',
    not exists (select 1 from forense.contribuyentes
                 where corrida_id = v_base and rfc = 'INY:BUENO-1'), '');

  select count(*) into n_contrib_nueva from forense.contribuyentes where corrida_id = v_nueva;
  select count(*) into n_cfdi_nueva from forense.cfdi where corrida_id = v_nueva;
  perform pruebas.assert('la corrida nueva = base + filas inyectadas',
    n_cfdi_nueva = n_cfdi_base_antes + 1, 'cfdi nueva=' || n_cfdi_nueva);
  perform pruebas.assert('el RFC inyectado sí está en la corrida nueva',
    exists (select 1 from forense.contribuyentes
             where corrida_id = v_nueva and rfc = 'INY:BUENO-1'), '');

  perform pruebas.assert('la corrida nueva no hereda pistas, clusters ni casos de la base',
    not exists (select 1 from forense.pistas where corrida_id = v_nueva)
    and not exists (select 1 from forense.clusters where corrida_id = v_nueva)
    and not exists (select 1 from forense.casos where corrida_id = v_nueva), '');

  perform pruebas.assert('la corrida nueva conserva el ground_truth de la base',
    (select count(*) from forense.ground_truth where corrida_id = v_nueva)
    = (select count(*) from forense.ground_truth where corrida_id = v_base), '');
  perform pruebas.assert('las filas inyectadas NO reciben etiqueta de ground_truth',
    not exists (select 1 from forense.ground_truth
                 where corrida_id = v_nueva and rfc = 'INY:BUENO-1'), '');

  -- Rastro: sin evento persistido no hay animación (21 §3.3)
  perform pruebas.assert('la clonación deja evento inyeccion con la corrida nueva',
    exists (select 1 from forense.bitacora
             where corrida_id = v_nueva and tipo_evento = 'inyeccion'
               and payload->>'evento_real' = 'snapshot_creado'), '');
  perform pruebas.assert('la clonación deja evento corrida_cargada (contracts 1.2.0)',
    exists (select 1 from forense.bitacora
             where corrida_id = v_nueva and tipo_evento = 'corrida_cargada'), '');

  perform pruebas.assert('la inyección queda en snapshot_creado con su corrida nueva',
    (select estado = 'snapshot_creado' and corrida_nueva_id = v_nueva
       from forense.inyecciones where id = v_iny), '');
  perform pruebas.assert('estado_inyeccion publica el timeline persistido',
    jsonb_array_length((forense.estado_inyeccion(v_iny))->'timeline') >= 2,
    (forense.estado_inyeccion(v_iny))::text);

  -- Idempotencia del webhook: la misma clave no crea una segunda inyección
  r := forense.registrar_inyeccion(v_base, jsonb_build_object(
    'corrida_base_id', v_base, 'origen', 'ensayo',
    'idempotency_key', '00000000-0000-4000-8000-0000000008e2',
    'tablas', jsonb_build_object('contribuyentes', jsonb_build_array(
      jsonb_build_object('rfc', 'INY:BUENO-1')))),
    'ensayo', '00000000-0000-4000-8000-0000000008e2'::uuid);
  perform pruebas.assert('reenviar el webhook con la misma clave no duplica la inyección',
    (r->>'ok')::boolean and (r->>'creada')::boolean = false
    and (r->>'inyeccion_id')::uuid = v_iny, r::text);
end $$;

-- 3. El enum de bitácora admite corrida_cargada y sigue admitiendo el resto
do $$
declare n int;
begin
  select count(*) into n from pg_constraint
   where conname = 'ck_bitacora_tipo_evento'
     and pg_get_constraintdef(oid) like '%corrida_cargada%'
     and pg_get_constraintdef(oid) like '%inyeccion%'
     and pg_get_constraintdef(oid) like '%presupuesto_agotado%';
  perform pruebas.assert('el check de tipo_evento es aditivo: conserva el catálogo y añade corrida_cargada',
    n = 1, 'constraints=' || n);

  perform pruebas.assert('staging y errores de ingesta no tienen lectura pública',
    not exists (select 1 from pg_policies
                 where schemaname = 'forense'
                   and tablename in ('staging_filas','errores_ingesta','ingestas',
                                     'inyecciones','mapeos_ingesta','archivos_ingesta')), '');
end $$;
