-- =====================================================================
-- assertions_019.sql — la pierna (a) de T2 recalibrada (db/019).
--
-- Se prueba con FIXTURE PROPIO, no con gen-v1: `cargar_gen.sh` copia el
-- snapshot `gen-v1`, cuyos CFDI comparten una sola hora del día, así que
-- allí la pierna (a) está no_evaluable por construcción y no puede
-- ejercitar nada. El fixture crea sus corridas, mide y las borra al final
-- (cascada), de modo que estas aserciones valen igual con GEN=0 y GEN=1.
--
-- Lo que se comprueba:
--   1. sin resolución intradía la pierna (a) sigue no_evaluable con motivo
--      en bitácora (regla 2) y la pierna (b) sigue viva;
--   2. una ráfaga de 4 facturas encadenadas en 6 minutos dispara;
--   3. la misma cadena estirada a 45 minutos NO dispara (ventana de 15);
--   4. no se marca a quien no está en el padrón;
--   5. la guarda relativa al giro suprime la ráfaga cuando es la norma del
--      sector, y lo deja en bitácora;
--   6. el detalle publica la comparación con los pares del giro y los
--      discriminadores de la trampa (nómina/compras);
--   7. la pierna (b) (pico de diciembre sin histórico) sigue disparando.
-- =====================================================================

set search_path = '';

do $$
declare
  v_plana uuid; v_intra uuid; n int; v_rfc text; v_det jsonb;
  sufijo text := substr(md5(random()::text), 1, 8);
  corte timestamptz := '2026-01-31 23:59:59-06';
begin
  -- ---------------------------------------------------------------
  -- Corrida A: una sola hora del día (como gen-v1).
  -- ---------------------------------------------------------------
  insert into forense.corridas (nombre, dataset, dataset_hash, fecha_corte, estado, modo)
  values ('fixture-019-plana-' || sufijo, 'fixture-019', 'h019plana' || sufijo, corte,
          'lista', 'fixture')
  returning id into v_plana;

  insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta, corrida_id)
  select 'T19P' || lpad(i::text, 6, '0') || 'AA1', 'Fixture Plana ' || i,
         'gtest_plano', 'moral', '2019-01-01'::date, v_plana
    from generate_series(1, 4) i;

  -- Cadena A→B→C→D, tres facturas, TODAS a las 10:30 (sin intradía).
  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
                            moneda, metodo_pago, clave_prod_serv, descripcion, cancelado, corrida_id)
  select gen_random_uuid(), 'I',
         'T19P' || lpad(i::text, 6, '0') || 'AA1',
         'T19P' || lpad((i + 1)::text, 6, '0') || 'AA1',
         '2025-06-10 10:30:00-06'::timestamptz,
         100000, 16000, 116000, 'MXN', 'PUE', '84111506', 'Fixture', false, v_plana
    from generate_series(1, 3) i;

  n := forense.pista_t2(v_plana);
  perform pruebas.assert('019: sin resolución intradía la pierna (a) no emite pista',
    not exists (select 1 from forense.pistas p
                 where p.corrida_id = v_plana and p.codigo = 'T2'
                   and p.detalle->>'motivo' = 'sincronia'),
    'pista_t2 devolvió ' || n || ' filas');
  perform pruebas.assert('019: el motivo del no_evaluable queda en bitácora (regla 2)',
    exists (select 1 from forense.bitacora b
             where b.corrida_id = v_plana
               and b.payload->>'evento_real' = 'T2_sincronia_no_evaluable'),
    'evento T2_sincronia_no_evaluable');

  -- ---------------------------------------------------------------
  -- Corrida B: con resolución intradía.
  --   giro gtest_rafaga (10 RFC): 4 en ráfaga de 6 min  → prevalencia 0.4
  --   giro gtest_lento  (10 RFC): 4 en cadena de 45 min → fuera de ventana
  --   giro gtest_norma  ( 4 RFC): los 4 en ráfaga       → prevalencia 1.0
  --   giro gtest_dic    ( 1 RFC): pico de diciembre     → pierna (b)
  -- ---------------------------------------------------------------
  insert into forense.corridas (nombre, dataset, dataset_hash, fecha_corte, estado, modo)
  values ('fixture-019-intra-' || sufijo, 'fixture-019', 'h019intra' || sufijo, corte,
          'lista', 'fixture')
  returning id into v_intra;

  insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta, corrida_id)
  select 'T19R' || lpad(i::text, 6, '0') || 'AA1', 'Fixture Rafaga ' || i,
         'gtest_rafaga', 'moral', '2019-01-01'::date, v_intra
    from generate_series(1, 10) i;
  insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta, corrida_id)
  select 'T19L' || lpad(i::text, 6, '0') || 'AA1', 'Fixture Lento ' || i,
         'gtest_lento', 'moral', '2019-01-01'::date, v_intra
    from generate_series(1, 10) i;
  insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta, corrida_id)
  select 'T19N' || lpad(i::text, 6, '0') || 'AA1', 'Fixture Norma ' || i,
         'gtest_norma', 'moral', '2019-01-01'::date, v_intra
    from generate_series(1, 4) i;
  insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona, fecha_alta, corrida_id)
  values ('T19D000001AA1', 'Fixture Diciembre', 'gtest_dic', 'moral', '2019-01-01', v_intra);

  -- Ráfaga: 3 facturas encadenadas (4 RFC) en 6 minutos.
  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
                            moneda, metodo_pago, clave_prod_serv, descripcion, cancelado, corrida_id)
  select gen_random_uuid(), 'I',
         'T19R' || lpad(i::text, 6, '0') || 'AA1',
         'T19R' || lpad((i + 1)::text, 6, '0') || 'AA1',
         '2025-06-10 09:05:00-06'::timestamptz + ((i - 1) * interval '2 minutes'),
         100000, 16000, 116000, 'MXN', 'PUE', '84111506', 'Fixture', false, v_intra
    from generate_series(1, 3) i;
  -- Cuarto salto hacia un receptor que NO está en el padrón.
  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
                            moneda, metodo_pago, clave_prod_serv, descripcion, cancelado, corrida_id)
  values (gen_random_uuid(), 'I', 'T19R000004AA1', 'NOMT19R000004', '2025-06-10 09:11:00-06',
          100000, 16000, 116000, 'MXN', 'PUE', '84111506', 'Fixture', false, v_intra);
  -- Nómina y compras del primero: discriminadores de la trampa.
  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
                            moneda, metodo_pago, clave_prod_serv, descripcion, cancelado, corrida_id)
  values (gen_random_uuid(), 'N', 'T19R000001AA1', 'NOMT19R000001', '2025-06-25 12:00:00-06',
          50000, 0, 50000, 'MXN', 'PUE', '84111505', 'Nomina', false, v_intra),
         (gen_random_uuid(), 'I', 'T19L000009AA1', 'T19R000001AA1', '2025-06-04 11:00:00-06',
          20000, 3200, 23200, 'MXN', 'PUE', '84111506', 'Compra', false, v_intra);

  -- Cadena lenta: 3 facturas encadenadas en 45 minutos (fuera de ventana).
  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
                            moneda, metodo_pago, clave_prod_serv, descripcion, cancelado, corrida_id)
  select gen_random_uuid(), 'I',
         'T19L' || lpad(i::text, 6, '0') || 'AA1',
         'T19L' || lpad((i + 1)::text, 6, '0') || 'AA1',
         '2025-07-10 14:00:00-06'::timestamptz + ((i - 1) * interval '22 minutes'),
         100000, 16000, 116000, 'MXN', 'PUE', '84111506', 'Fixture', false, v_intra
    from generate_series(1, 3) i;

  -- Giro donde la ráfaga es la NORMA: los 4 del giro en la misma cadena.
  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
                            moneda, metodo_pago, clave_prod_serv, descripcion, cancelado, corrida_id)
  select gen_random_uuid(), 'I',
         'T19N' || lpad(i::text, 6, '0') || 'AA1',
         'T19N' || lpad((i + 1)::text, 6, '0') || 'AA1',
         '2025-08-12 20:15:00-06'::timestamptz + ((i - 1) * interval '2 minutes'),
         100000, 16000, 116000, 'MXN', 'PUE', '84111506', 'Fixture', false, v_intra
    from generate_series(1, 3) i;

  -- Pierna (b): 10 meses de 1,000 y diciembre de 40,000, sin diciembre previo.
  insert into forense.cfdi (uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
                            moneda, metodo_pago, clave_prod_serv, descripcion, cancelado, corrida_id)
  select gen_random_uuid(), 'I', 'T19D000001AA1', 'T19R000010AA1',
         make_timestamptz(2025, mes, 15, 13, 0, 0, '-06'),
         case when mes = 12 then 40000 else 1000 end,
         0, case when mes = 12 then 40000 else 1000 end,
         'MXN', 'PUE', '84111506', 'Fixture', false, v_intra
    from generate_series(2, 12) mes;

  n := forense.pista_t2(v_intra);

  perform pruebas.assert('019: la ráfaga de 6 minutos dispara T2(a) sobre los 4 RFC de la cadena',
    (select count(*) from forense.pistas p
      where p.corrida_id = v_intra and p.codigo = 'T2'
        and p.detalle->>'motivo' = 'sincronia' and p.rfc like 'T19R%') = 4,
    'marcados: ' || (select count(*) from forense.pistas p
                      where p.corrida_id = v_intra and p.codigo = 'T2'
                        and p.detalle->>'motivo' = 'sincronia' and p.rfc like 'T19R%'));

  perform pruebas.assert('019: una cadena de 45 minutos queda FUERA de la ventana de 15',
    not exists (select 1 from forense.pistas p
                 where p.corrida_id = v_intra and p.codigo = 'T2'
                   and p.detalle->>'motivo' = 'sincronia' and p.rfc like 'T19L%'),
    'ventana de ráfaga = 15 min');

  perform pruebas.assert('019: no se marca a un receptor que no está en el padrón',
    not exists (select 1 from forense.pistas p
                 where p.corrida_id = v_intra and p.codigo = 'T2' and p.rfc like 'NOM%'),
    'el 4.º salto va a NOMT19R000004, que no es contribuyente');

  perform pruebas.assert('019: la guarda de giro suprime la ráfaga cuando es la norma del sector',
    not exists (select 1 from forense.pistas p
                 where p.corrida_id = v_intra and p.codigo = 'T2'
                   and p.detalle->>'motivo' = 'sincronia' and p.rfc like 'T19N%'),
    'prevalencia del giro gtest_norma = 4/4 >= 0.5');

  select p.detalle into v_det from forense.pistas p
   where p.corrida_id = v_intra and p.codigo = 'T2'
     and p.detalle->>'motivo' = 'sincronia' and p.rfc = 'T19R000001AA1';

  perform pruebas.assert('019: el detalle publica la comparación con los pares del giro',
    v_det ? 'pares_giro' and v_det ? 'pares_con_rafaga' and v_det ? 'prevalencia_giro'
      and (v_det->>'pares_giro')::int = 10 and (v_det->>'pares_con_rafaga')::int = 4,
    coalesce(v_det->>'prevalencia_giro', '(sin detalle)'));

  perform pruebas.assert('019: el detalle publica los discriminadores de la trampa',
    (v_det->>'tiene_nomina')::boolean and (v_det->>'tiene_compras')::boolean,
    'nomina=' || coalesce(v_det->>'tiene_nomina', '?')
      || ' compras=' || coalesce(v_det->>'tiene_compras', '?'));

  perform pruebas.assert('019: la ventana declarada en cobertura son minutos, no horas',
    (v_det->'cobertura'->>'ventana_minutos')::numeric = 15
      and (v_det->'cobertura'->>'solo_padron')::boolean,
    'cobertura=' || coalesce((v_det->'cobertura')::text, '(vacío)'));

  perform pruebas.assert('019: el score de la ráfaga cae en [0,1] y el resumen no va vacío',
    not exists (select 1 from forense.pistas p
                 where p.corrida_id = v_intra and p.codigo = 'T2'
                   and (p.score < 0 or p.score > 1
                        or coalesce(p.detalle->>'resumen', '') = ''
                        or jsonb_typeof(p.detalle->'referencias') <> 'array')),
    'contrato entities.pista');

  perform pruebas.assert('019: la calibración deja su propio evento en bitácora (regla 2)',
    exists (select 1 from forense.bitacora b
             where b.corrida_id = v_intra
               and b.payload->>'evento_real' = 'T2_sincronia_calibrada'
               and (b.payload->>'ventana_minutos')::numeric = 15),
    'evento T2_sincronia_calibrada');

  perform pruebas.assert('019: la pierna (b) de 003 sigue disparando (pico de diciembre)',
    exists (select 1 from forense.pistas p
             where p.corrida_id = v_intra and p.codigo = 'T2'
               and p.detalle->>'motivo' = 'estacionalidad'
               and p.rfc = 'T19D000001AA1'),
    'estacionalidad sin diciembre previo');

  -- El fixture no participa en métricas: se borra con su cascada.
  delete from forense.corridas where id in (v_plana, v_intra);

  perform pruebas.assert('019: el fixture no deja corridas ni pistas detrás',
    not exists (select 1 from forense.pistas p where p.corrida_id in (v_plana, v_intra))
      and not exists (select 1 from forense.corridas k where k.id in (v_plana, v_intra)),
    'limpieza por cascada');
end $$;
