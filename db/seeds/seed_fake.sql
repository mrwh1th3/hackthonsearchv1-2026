-- =====================================================================
-- db/seeds/seed_fake.sql — Fixture de UI. Se ejecuta a mano tras 001 + 002.
--
-- NO es evaluación ni ground truth de detección: los resultados están
-- escritos a mano, no salieron de agentes ni de clasificadores. La corrida
-- lleva modo='fixture' y no se mezcla con métricas de corridas reales
-- (docs/05 §orden de migraciones, contracts/README §fixtures).
--
-- IDs alineados con contracts/fixtures/valid/corrida.json y caso-0/1/2.json.
-- Los NIVELES siguen docs/05 (presuncion_alta / anomalia_explicada /
-- sin_hallazgos), que difiere de los fixtures de contrato
-- (presuncion / anomalia_explicada / no_concluyente). Divergencia declarada.
--
-- Idempotente: reejecutarlo no duplica filas ni cambia conteos.
-- Texto libre (razon_social, descripcion, referencia) es UNTRUSTED.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Corrida
-- ---------------------------------------------------------------------
insert into forense.corridas (
  id, nombre, dataset, dataset_hash, fecha_corte, estado, version_prompts,
  version_reglas, modo, familias_evaluables, inicio, fin, notas)
values (
  '00000000-0000-4000-8000-000000000001',
  'Fixture UI — no es evaluación',
  'fixture-contract-v1',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '2026-01-31T12:00:00Z', 'completada',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'fixture', '{D,F,R,T,E}',
  '2026-01-31T12:00:00Z', '2026-01-31T12:00:00Z',
  'Datos sintéticos de fixture para construir la UI sin pipeline. No entra en métricas.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Padrón
-- ---------------------------------------------------------------------
insert into forense.contribuyentes (corrida_id, rfc, razon_social, giro, tipo_persona,
                                    fecha_alta, domicilio, cp, representante, email, telefono,
                                    empleados_declarados)
values
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-0','Comercializadora Demo Cero SA de CV','comercio_mayoreo','moral','2025-02-10','Av. Demo 100, Piso 3','64000','R. Demo Uno','contacto@demo0.example','8110000000',1),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-1','Despacho Contable Demo Uno SC','servicios_contables','moral','2016-05-03','Av. Demo 100, Piso 3','64000','C. Demo Dos','contacto@demo1.example','8110000001',14),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-2','Ferretería Demo Dos SA de CV','ferreteria','moral','2012-09-01','Calle Demo 55','64100','F. Demo Tres','contacto@demo2.example','8110000002',22),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-3','Servicios Integrales Demo Tres SA de CV','servicios_profesionales','moral','2025-03-15','Av. Demo 100, Piso 3','64000','R. Demo Uno','contacto@demo3.example','8110000003',0),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-4','Logística Demo Cuatro SA de CV','comercio_mayoreo','moral','2025-01-20','Av. Demo 100, Piso 3','64000','R. Demo Uno','contacto@demo4.example','8110000004',2),
  ('00000000-0000-4000-8000-000000000001','DEMO:PF-9','Persona Física Demo Nueve',null,'fisica','2019-07-01','Calle Demo 9','64200',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','DEMO:CLIENTE-A','Constructora Demo A SA de CV','construccion','moral','2009-03-11','Blvd. Demo 800','66200','A. Demo','contacto@demoa.example','8110000005',96),
  ('00000000-0000-4000-8000-000000000001','DEMO:CLIENTE-B','Constructora Demo B SA de CV','construccion','moral','2014-11-22','Blvd. Demo 802','66200','B. Demo','contacto@demob.example','8110000006',54)
on conflict (corrida_id, rfc) do nothing;

insert into forense.cuentas (corrida_id, clabe, rfc_titular, banco, tipo, moneda, saldo_inicial, fecha_saldo_inicial)
values
  ('00000000-0000-4000-8000-000000000001','012180000000000010','DEMO:ENTIDAD-0','BANCO DEMO','moral','MXN',5000.00,'2025-02-10T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000001','012180000000000011','DEMO:ENTIDAD-1','BANCO DEMO','moral','MXN',180000.00,'2025-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000001','012180000000000020','DEMO:ENTIDAD-2','BANCO DEMO','moral','MXN',420000.00,'2025-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000001','012180000000000030','DEMO:ENTIDAD-3','BANCO DEMO','moral','MXN',1000.00,'2025-03-15T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000001','012180000000000040','DEMO:ENTIDAD-4','BANCO DEMO','moral','MXN',1500.00,'2025-01-20T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000001','012180000000000090','DEMO:PF-9','BANCO DEMO','fisica','MXN',null,null)
on conflict (corrida_id, clabe) do nothing;

-- ---------------------------------------------------------------------
-- CFDI: ciclo de facturas E0 -> E3 -> E4 -> E0 con decremento por salto,
-- más operaciones ordinarias del despacho y de la ferretería.
-- ---------------------------------------------------------------------
insert into forense.cfdi (corrida_id, uuid, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total,
                          moneda, metodo_pago, forma_pago, uso_cfdi, clave_prod_serv, descripcion, cancelado)
values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000001','I','DEMO:ENTIDAD-0','DEMO:ENTIDAD-3','2025-11-05T10:00:00Z',1034482.76,165517.24,1200000.00,'MXN','PPD','99','G03','80101500','Servicios de consultoria estrategica integral',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000002','I','DEMO:ENTIDAD-3','DEMO:ENTIDAD-4','2025-11-12T10:00:00Z',1003448.28,160551.72,1164000.00,'MXN','PPD','99','G03','80101500','Subcontratacion de consultoria',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000003','I','DEMO:ENTIDAD-4','DEMO:ENTIDAD-0','2025-11-20T10:00:00Z',983379.31,157340.69,1140720.00,'MXN','PPD','99','G03','80101500','Servicios logisticos integrales',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000004','I','DEMO:ENTIDAD-0','DEMO:ENTIDAD-2','2025-09-10T10:00:00Z',73275.86,11724.14,85000.00,'MXN','PUE','03','G03','31162800','Tornilleria surtida',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000005','I','DEMO:ENTIDAD-1','DEMO:ENTIDAD-0','2025-10-01T10:00:00Z',15948.28,2551.72,18500.00,'MXN','PUE','03','G03','84111500','Honorarios contables mensuales',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000006','I','DEMO:ENTIDAD-1','DEMO:ENTIDAD-2','2025-10-01T10:00:00Z',10689.66,1710.34,12400.00,'MXN','PUE','03','G03','84111500','Honorarios contables mensuales',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000007','I','DEMO:ENTIDAD-2','DEMO:ENTIDAD-0','2025-08-15T10:00:00Z',27586.21,4413.79,32000.00,'MXN','PUE','03','G03','31162800','Material de ferreteria',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000008','I','DEMO:ENTIDAD-2','DEMO:ENTIDAD-1','2025-12-05T10:00:00Z',8534.48,1365.52,9900.00,'MXN','PUE','03','G03','31162800','Material de oficina y ferreteria',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-00000000000a','N','DEMO:ENTIDAD-1','DEMO:ENTIDAD-1','2025-10-31T10:00:00Z',85000.00,0.00,85000.00,'MXN','PUE','99','CN01','84111505','Nomina quincenal',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-00000000000b','N','DEMO:ENTIDAD-1','DEMO:ENTIDAD-1','2025-11-30T10:00:00Z',85000.00,0.00,85000.00,'MXN','PUE','99','CN01','84111505','Nomina quincenal',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-00000000000e','I','DEMO:ENTIDAD-1','DEMO:CLIENTE-A','2025-11-15T10:00:00Z',189655.17,30344.83,220000.00,'MXN','PUE','03','G03','84111500','Servicios contables anuales',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-00000000000f','I','DEMO:ENTIDAD-1','DEMO:CLIENTE-B','2025-09-15T10:00:00Z',82758.62,13241.38,96000.00,'MXN','PUE','03','G03','84111500','Servicios contables anuales',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000010','I','DEMO:ENTIDAD-2','DEMO:CLIENTE-A','2025-07-20T10:00:00Z',1594827.59,255172.41,1850000.00,'MXN','PPD','03','G03','31162800','Suministro de material de obra',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000011','I','DEMO:ENTIDAD-2','DEMO:CLIENTE-B','2025-10-12T10:00:00Z',810344.83,129655.17,940000.00,'MXN','PPD','03','G03','31162800','Suministro de material de obra',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-00000000000c','N','DEMO:ENTIDAD-2','DEMO:ENTIDAD-2','2025-11-30T10:00:00Z',380000.00,0.00,380000.00,'MXN','PUE','99','CN01','84111505','Nomina quincenal',false),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-00000000000d','I','DEMO:ENTIDAD-0','DEMO:ENTIDAD-3','2025-12-18T10:00:00Z',258620.69,41379.31,300000.00,'MXN','PPD','99','G03','80101500','Consultoria complementaria',true)
on conflict (corrida_id, uuid) do nothing;

update forense.cfdi
   set fecha_cancelacion = '2025-12-27T10:00:00Z', motivo_cancelacion = '02'
 where corrida_id = '00000000-0000-4000-8000-000000000001'
   and uuid = '00000000-0000-4000-9000-00000000000d';

insert into forense.complementos_pago (corrida_id, uuid_pago, uuid_cfdi, fecha, monto)
values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-9100-000000000001','00000000-0000-4000-9000-000000000001','2025-11-06T10:00:00Z',1200000.00)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Movimientos: el dinero recorre el mismo ciclo en 6 días y se dispersa
-- a una persona física. IDs estables asignados por el loader.
-- ---------------------------------------------------------------------
insert into forense.movimientos (corrida_id, id, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, referencia)
values
  ('00000000-0000-4000-8000-000000000001',1,'012180000000000010','012180000000000030','2025-11-06T09:00:00Z',1200000.00,'MXN','transferencia','PAGO FACTURA A-1001'),
  ('00000000-0000-4000-8000-000000000001',2,'012180000000000030','012180000000000040','2025-11-13T09:00:00Z',1164000.00,'MXN','transferencia','PAGO SUBCONTRATO'),
  ('00000000-0000-4000-8000-000000000001',3,'012180000000000040','012180000000000010','2025-11-21T09:00:00Z',1140720.00,'MXN','transferencia','LIQUIDACION SERVICIOS'),
  ('00000000-0000-4000-8000-000000000001',4,'012180000000000010','012180000000000090','2025-11-24T09:00:00Z',380000.00,'MXN','transferencia','PRESTAMO'),
  ('00000000-0000-4000-8000-000000000001',5,'012180000000000010','012180000000000090','2025-11-25T09:00:00Z',380000.00,'MXN','transferencia','PRESTAMO 2'),
  ('00000000-0000-4000-8000-000000000001',6,'012180000000000010','012180000000000090','2025-11-26T09:00:00Z',360000.00,'MXN','efectivo','RETIRO'),
  ('00000000-0000-4000-8000-000000000001',7,'012180000000000020','012180000000000011','2025-10-03T09:00:00Z',12400.00,'MXN','transferencia','HONORARIOS OCTUBRE'),
  ('00000000-0000-4000-8000-000000000001',8,'012180000000000010','012180000000000011','2025-10-03T09:00:00Z',18500.00,'MXN','transferencia','HONORARIOS OCTUBRE')
on conflict (corrida_id, id) do nothing;

-- ---------------------------------------------------------------------
-- Atributos compartidos y listas SAT
-- ---------------------------------------------------------------------
insert into forense.atributos_entidad (corrida_id, rfc, atributo, valor, fuente)
values
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-0','domicilio','Av. Demo 100, Piso 3','padron'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-1','domicilio','Av. Demo 100, Piso 3','padron'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-3','domicilio','Av. Demo 100, Piso 3','padron'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-4','domicilio','Av. Demo 100, Piso 3','padron'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-0','representante','R. Demo Uno','padron'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-3','representante','R. Demo Uno','padron'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-4','representante','R. Demo Uno','padron')
on conflict (corrida_id, rfc, atributo, valor) do nothing;

insert into forense.listas_sat (corrida_id, rfc, lista, estatus, fecha_publicacion, oficio, razon_social)
values
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-4','69B','presunto','2025-12-15','DEMO-500-00-00-00-2025-0001','Logística Demo Cuatro SA de CV')
on conflict (corrida_id, rfc, lista, estatus, fecha_publicacion) do nothing;

-- ground_truth del fixture: solo para que /estadisticas tenga forma.
-- No participa en las métricas de corridas reales.
insert into forense.ground_truth (corrida_id, rfc, es_fraude, tipologia, es_trampa_legitima, nota)
values
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-0',true,'carrusel',false,'Fixture: emisora del ciclo'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-3',true,'carrusel',false,'Fixture: eslabón intermedio'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-4',true,'carrusel',false,'Fixture: eslabón con 69-B presunto'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-1',false,null,true,'Fixture: despacho contable, domicilio compartido legítimo'),
  ('00000000-0000-4000-8000-000000000001','DEMO:ENTIDAD-2',false,null,false,'Fixture: operación ordinaria'),
  ('00000000-0000-4000-8000-000000000001','DEMO:PF-9',false,null,false,'Fixture: receptor de dispersión, sin atribución propia'),
  ('00000000-0000-4000-8000-000000000001','DEMO:CLIENTE-A',false,null,false,'Fixture: cliente legítimo sin caso (queda sin conclusión)'),
  ('00000000-0000-4000-8000-000000000001','DEMO:CLIENTE-B',false,null,false,'Fixture: cliente legítimo sin caso (queda sin conclusión)')
on conflict (rfc, corrida_id) do nothing;

-- ---------------------------------------------------------------------
-- Pistas del fixture (escritas a mano; 003 las recalcula en corridas reales)
-- ---------------------------------------------------------------------
insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella, estado)
values
  ('00000000-0000-4000-8000-000000000001','D2','D','DEMO:ENTIDAD-0',0.90,
   jsonb_build_object(
     'facturacion_12m','1500000.00','nomina_12m','0.00','empleados_declarados',1,'ratio_nomina',0,
     'resumen','Facturó 1,500,000.00 en los 12 meses al corte con nómina de 0.00 y un empleado declarado, por debajo del p10 de sus pares de comercio_mayoreo.',
     'referencias', jsonb_build_array('PAR:comercio_mayoreo','CFDI:00000000-0000-4000-9000-000000000001')),
   'fixture-d2-entidad0','disparada'),
  ('00000000-0000-4000-8000-000000000001','F1','F','DEMO:ENTIDAD-0',0.85,
   jsonb_build_object(
     'pct_dispersado','0.93','destinos_fisicos',1,'dias',3,
     'movimientos', jsonb_build_array('MOV:4','MOV:5','MOV:6'),
     'resumen','El 93% de lo que entró salió en 3 días hacia una cuenta de persona física.',
     'referencias', jsonb_build_array('MOV:4','MOV:5','MOV:6')),
   'fixture-f1-entidad0','disparada'),
  ('00000000-0000-4000-8000-000000000001','R2','R','DEMO:ENTIDAD-0',0.75,
   jsonb_build_object(
     'tipo','ciclo',
     'ruta', jsonb_build_array('DEMO:ENTIDAD-0','DEMO:ENTIDAD-3','DEMO:ENTIDAD-4','DEMO:ENTIDAD-0'),
     'dias',15,
     'resumen','Ciclo de 3 saltos entre 3 RFC en 15 días: el monto vuelve al emisor original.',
     'referencias', jsonb_build_array('CICLO:ciclo:fixture-r2-entidad0',
                                      'CFDI:00000000-0000-4000-9000-000000000001')),
   'fixture-r2-entidad0','disparada'),
  ('00000000-0000-4000-8000-000000000001','E1','E','DEMO:ENTIDAD-0',0.60,
   jsonb_build_object(
     'contraparte','DEMO:ENTIDAD-4','estatus','presunto','saltos',1,
     'fecha_publicacion','2025-12-15',
     'resumen','Opera a 1 salto de DEMO:ENTIDAD-4, publicado en el listado del SAT con estatus "presunto" el 2025-12-15.',
     'referencias', jsonb_build_array('LISTA:DEMO:ENTIDAD-4:presunto:2025-12-15')),
   'fixture-e1-entidad0','disparada'),
  ('00000000-0000-4000-8000-000000000001','R1','R','DEMO:ENTIDAD-1',0.40,
   jsonb_build_object(
     'atributo','domicilio','valor','Av. Demo 100, Piso 3',
     'rfcs', jsonb_build_array('DEMO:ENTIDAD-0','DEMO:ENTIDAD-3','DEMO:ENTIDAD-4'),
     'se_facturan_entre_si', false, 'pct_monto_interno', 0,
     'resumen','Comparte domicilio con otros 3 RFC, pero no se facturan entre sí: 0% del monto que factura el grupo se queda dentro.',
     'referencias', jsonb_build_array('ATR:domicilio:' || md5('Av. Demo 100, Piso 3'))),
   'fixture-r1-entidad1','disparada'),
  ('00000000-0000-4000-8000-000000000001','T1','T','DEMO:ENTIDAD-2',0.20,
   jsonb_build_object(
     'nota','variacion estacional dentro de rango de su giro',
     'resumen','Variación estacional dentro del rango de su giro: no alcanza el umbral de concentración trimestral.',
     'referencias', jsonb_build_array()),
   'fixture-t1-entidad2','disparada')
on conflict (corrida_id, codigo, rfc, huella) do nothing;

-- ---------------------------------------------------------------------
-- Clusters
-- ---------------------------------------------------------------------
insert into forense.clusters (id, corrida_id, rfcs, rfc_semilla, n_rfcs, n_cfdi, n_movimientos,
                              score, expandido, version_contexto, huella, rfcs_frontera, estado, creado)
values
  ('00000000-0000-4000-8000-000000000200','00000000-0000-4000-8000-000000000001',
   '{DEMO:ENTIDAD-0,DEMO:ENTIDAD-3,DEMO:ENTIDAD-4}','DEMO:ENTIDAD-0',3,5,6,3.10,true,2,
   'fixture-cluster-0','{DEMO:PF-9}','cerrado','2026-01-31T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001',
   '{DEMO:ENTIDAD-1}','DEMO:ENTIDAD-1',1,4,2,0.40,false,1,
   'fixture-cluster-1','{}','cerrado','2026-01-31T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000001',
   '{DEMO:ENTIDAD-2}','DEMO:ENTIDAD-2',1,4,1,0.20,false,1,
   'fixture-cluster-2','{}','cerrado','2026-01-31T12:00:00Z')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Casos. Niveles según docs/05; nunca la palabra 'definitivo'.
-- ---------------------------------------------------------------------
insert into forense.casos (
  id, corrida_id, cluster_id, rfc_principal, rfcs_satelite, origen, origen_valor, estado, nivel,
  tipologia, hipotesis, familias_confirmadas, resultado_por_rfc, monto_en_riesgo, moneda,
  cobertura_completa, pendientes, conflictos, n_reintentos, presupuesto_agotado,
  tool_calls, bitacora_seq, tokens_total, duracion_ms, creado, terminado)
values
  ('00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000200','DEMO:ENTIDAD-0','{DEMO:ENTIDAD-3,DEMO:ENTIDAD-4}',
   'pipeline','cluster fixture 0','dictaminado','presuncion_alta','carrusel',
   'Ciclo de facturación sin materialidad con retorno del dinero al emisor en 15 días.',
   '{D,F,R,E}',
   '[{"rfc":"DEMO:ENTIDAD-0","nivel":"presuncion_alta","tipologia":"carrusel","evidencia_ids":[],"cobertura_completa":true},
     {"rfc":"DEMO:ENTIDAD-3","nivel":"presuncion","tipologia":"carrusel","evidencia_ids":[],"cobertura_completa":true},
     {"rfc":"DEMO:ENTIDAD-4","nivel":"presuncion","tipologia":"carrusel","evidencia_ids":[],"cobertura_completa":false}]'::jsonb,
   3504720.00,'MXN',true,'[]'::jsonb,'[]'::jsonb,0,false,18,20,41200,182000,
   '2026-01-31T12:00:00Z','2026-01-31T12:03:02Z'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000201','DEMO:ENTIDAD-1','{}',
   'pipeline','cluster fixture 1','dictaminado','anomalia_explicada',null,
   'Domicilio compartido con varios contribuyentes explicado por la actividad del despacho contable.',
   '{}',
   '[{"rfc":"DEMO:ENTIDAD-1","nivel":"anomalia_explicada","tipologia":null,"evidencia_ids":[],"cobertura_completa":true}]'::jsonb,
   0.00,'MXN',true,'[]'::jsonb,'[]'::jsonb,0,false,7,6,12800,64000,
   '2026-01-31T12:00:00Z','2026-01-31T12:01:04Z'),
  ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000202','DEMO:ENTIDAD-2','{}',
   'pipeline','cluster fixture 2','dictaminado','sin_hallazgos',null,
   'Sin señales que crucen el umbral de dos familias.',
   '{}',
   '[{"rfc":"DEMO:ENTIDAD-2","nivel":"sin_hallazgos","tipologia":null,"evidencia_ids":[],"cobertura_completa":true}]'::jsonb,
   0.00,'MXN',true,'[]'::jsonb,'[]'::jsonb,0,false,3,3,5400,21000,
   '2026-01-31T12:00:00Z','2026-01-31T12:00:41Z')
on conflict (id) do nothing;

-- evaluacion_pistas indexada por pista_id (los ids son bigserial: se resuelven por huella)
update forense.casos k
   set evaluacion_pistas = (
     select coalesce(jsonb_object_agg(p.id::text, jsonb_build_object(
              'estado', case when p.huella = 'fixture-e1-entidad0' then 'confirmada_parcial' else 'confirmada' end,
              'evidencia_ids', '[]'::jsonb,
              'motivo', 'fixture')), '{}'::jsonb)
       from forense.pistas p
      where p.corrida_id = k.corrida_id
        and p.huella in ('fixture-d2-entidad0','fixture-f1-entidad0','fixture-r2-entidad0','fixture-e1-entidad0'))
 where k.id = '00000000-0000-4000-8000-000000000100';

update forense.casos k
   set evaluacion_pistas = (
     select coalesce(jsonb_object_agg(p.id::text, jsonb_build_object(
              'estado', 'refutada', 'evidencia_ids', '[]'::jsonb,
              'motivo', 'defensa aceptada: despacho_contable')), '{}'::jsonb)
       from forense.pistas p
      where p.corrida_id = k.corrida_id and p.huella = 'fixture-r1-entidad1')
 where k.id = '00000000-0000-4000-8000-000000000101';

-- ---------------------------------------------------------------------
-- Tareas del caso 0 (dos rondas) — necesarias para bitácora con tarea_id
-- ---------------------------------------------------------------------
insert into forense.tareas_agente (id, caso_id, corrida_id, cluster_id, agente, ronda, intento,
                                   version_contexto, estado, idempotency_key, tool_calls, iniciado, terminado)
values
  ('00000000-0000-4000-8000-000000000300','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200','documental',1,0,1,'completada','fixture-t-doc-r1',4,'2026-01-31T12:00:10Z','2026-01-31T12:00:48Z'),
  ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200','financiero',1,0,1,'completada','fixture-t-fin-r1',5,'2026-01-31T12:00:10Z','2026-01-31T12:01:02Z'),
  ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200','relacional',1,0,1,'completada','fixture-t-rel-r1',4,'2026-01-31T12:00:10Z','2026-01-31T12:00:55Z'),
  ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200','documental',2,0,2,'completada','fixture-t-doc-r2',2,'2026-01-31T12:01:30Z','2026-01-31T12:01:58Z'),
  ('00000000-0000-4000-8000-000000000304','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200','financiero',2,0,2,'completada','fixture-t-fin-r2',2,'2026-01-31T12:01:30Z','2026-01-31T12:02:05Z'),
  ('00000000-0000-4000-8000-000000000305','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200','auditor',2,0,2,'completada','fixture-t-aud',1,'2026-01-31T12:02:10Z','2026-01-31T12:02:40Z'),
  ('00000000-0000-4000-8000-000000000306','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000200','defensor',2,0,2,'completada','fixture-t-def',0,'2026-01-31T12:02:10Z','2026-01-31T12:02:44Z'),
  ('00000000-0000-4000-8000-000000000310','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','relacional',1,0,1,'completada','fixture-t-rel-c1',4,'2026-01-31T12:00:10Z','2026-01-31T12:00:44Z'),
  ('00000000-0000-4000-8000-000000000311','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','defensor',2,0,1,'completada','fixture-t-def-c1',3,'2026-01-31T12:00:50Z','2026-01-31T12:01:02Z'),
  ('00000000-0000-4000-8000-000000000320','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000202','documental',1,0,1,'completada','fixture-t-doc-c2',3,'2026-01-31T12:00:10Z','2026-01-31T12:00:38Z')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Pizarrón: 5 señales del caso 0 en dos rondas
-- ---------------------------------------------------------------------
insert into forense.senales (cluster_id, caso_id, ronda, intento, version_contexto, idempotency_key,
                             familia, agente, titular, detalle, rfcs, ids, frontera, confianza, refuta, creado)
values
  ('00000000-0000-4000-8000-000000000200','00000000-0000-4000-8000-000000000100',1,0,1,'fixture-senal-1','D','documental',
   'DEMO:ENTIDAD-0 facturó 1.5M en 12 meses sin un solo CFDI de nómina y con 1 empleado declarado',
   '{"facturacion_12m":"1500000.00","nomina_12m":"0.00","empleados_declarados":1,"comprobacion":"D2"}'::jsonb,
   '{DEMO:ENTIDAD-0}','{CFDI:00000000-0000-4000-9000-000000000001,CFDI:00000000-0000-4000-9000-000000000004}','{}','alta',false,'2026-01-31T12:00:40Z'),
  ('00000000-0000-4000-8000-000000000200','00000000-0000-4000-8000-000000000100',1,0,1,'fixture-senal-2','F','financiero',
   'DEMO:ENTIDAD-0 dispersa 93% de lo recibido a una persona física en 3 días',
   '{"pct_dispersado":"0.93","destinos_fisicos":1,"dias":3,"comprobacion":"F1"}'::jsonb,
   '{DEMO:ENTIDAD-0}','{MOV:4,MOV:5,MOV:6}','{DEMO:PF-9}','alta',false,'2026-01-31T12:00:58Z'),
  ('00000000-0000-4000-8000-000000000200','00000000-0000-4000-8000-000000000100',1,0,1,'fixture-senal-3','R','relacional',
   'Ciclo de facturas DEMO:ENTIDAD-0 → 3 → 4 → 0 por 1.2M con retorno en 15 días',
   '{"tipo":"ciclo","ruta":["DEMO:ENTIDAD-0","DEMO:ENTIDAD-3","DEMO:ENTIDAD-4","DEMO:ENTIDAD-0"],"monto_ini":"1200000.00","monto_fin":"1140720.00","dias":15,"comprobacion":"R2"}'::jsonb,
   '{DEMO:ENTIDAD-0,DEMO:ENTIDAD-3,DEMO:ENTIDAD-4}','{CFDI:00000000-0000-4000-9000-000000000001,CFDI:00000000-0000-4000-9000-000000000002,CFDI:00000000-0000-4000-9000-000000000003}','{}','alta',false,'2026-01-31T12:00:52Z'),
  ('00000000-0000-4000-8000-000000000200','00000000-0000-4000-8000-000000000100',2,0,2,'fixture-senal-4','D','documental',
   'Los tres RFC del ciclo comparten domicilio y representante, y ninguno declara nómina',
   '{"atributos":["domicilio","representante"],"rfcs":3,"comprobacion":"D2"}'::jsonb,
   '{DEMO:ENTIDAD-0,DEMO:ENTIDAD-3,DEMO:ENTIDAD-4}',
   array['ATR:["DEMO:ENTIDAD-3","domicilio","Av. Demo 100, Piso 3"]'],'{}','media',false,'2026-01-31T12:01:55Z'),
  ('00000000-0000-4000-8000-000000000200','00000000-0000-4000-8000-000000000100',2,0,2,'fixture-senal-5','F','financiero',
   'El dinero del ciclo vuelve a la cuenta de origen conservando 95% del monto inicial',
   '{"conservado":"0.9506","saltos":3,"dias":15,"comprobacion":"F4"}'::jsonb,
   '{DEMO:ENTIDAD-0}','{MOV:1,MOV:2,MOV:3}','{}','alta',false,'2026-01-31T12:02:02Z')
on conflict (idempotency_key) do nothing;

-- ---------------------------------------------------------------------
-- Evidencia (validada / refutada)
-- ---------------------------------------------------------------------
insert into forense.evidencia (caso_id, idempotency_key, tipo, ref_id, monto, pista_codigo, familia,
                               rfcs_afectados, descripcion, agente, ronda, intento,
                               valida_tecnica, refutada, validada, hecho_validado, motivo_descartada)
values
  ('00000000-0000-4000-8000-000000000100','fixture-ev-1','cfdi','00000000-0000-4000-9000-000000000001',1200000.00,'R2','R',
   '{DEMO:ENTIDAD-0,DEMO:ENTIDAD-3}','Primera factura del ciclo','relacional',1,0,true,false,true,
   '{"total":"1200000.00","fecha":"2025-11-05T10:00:00Z","emisor":"DEMO:ENTIDAD-0","receptor":"DEMO:ENTIDAD-3"}'::jsonb,null),
  ('00000000-0000-4000-8000-000000000100','fixture-ev-2','movimiento','3',1140720.00,'F4','F',
   '{DEMO:ENTIDAD-4,DEMO:ENTIDAD-0}','Retorno del dinero a la cuenta de origen','financiero',1,0,true,false,true,
   '{"monto":"1140720.00","fecha":"2025-11-21T09:00:00Z","conservado":"0.9506"}'::jsonb,null),
  ('00000000-0000-4000-8000-000000000100','fixture-ev-3','lista','["DEMO:ENTIDAD-4","69B","presunto","2025-12-15"]',null,'E1','E',
   '{DEMO:ENTIDAD-4}','Contraparte publicada en 69-B con estatus presunto','externo',1,0,true,false,true,
   '{"lista":"69B","estatus":"presunto","fecha_publicacion":"2025-12-15"}'::jsonb,null),
  ('00000000-0000-4000-8000-000000000100','fixture-ev-4','cfdi','00000000-0000-4000-9000-00000000000d',300000.00,'D2','D',
   '{DEMO:ENTIDAD-0}','CFDI cancelado citado como facturación vigente','documental',1,0,true,true,false,
   '{"cancelado":true,"fecha_cancelacion":"2025-12-27T10:00:00Z"}'::jsonb,'CFDI cancelado: no sostiene el hallazgo'),
  ('00000000-0000-4000-8000-000000000101','fixture-ev-5','atributo','["DEMO:ENTIDAD-1","domicilio","Av. Demo 100, Piso 3"]',null,'R1','R',
   '{DEMO:ENTIDAD-1}','Domicilio compartido con clientes del despacho','relacional',1,0,true,true,false,
   '{"atributo":"domicilio","n_rfcs":4}'::jsonb,'Defensa aceptada: domicilio fiscal prestado por despacho contable')
on conflict (idempotency_key) do nothing;

update forense.evidencia e
   set pista_id = p.id
  from forense.pistas p
 where p.corrida_id = '00000000-0000-4000-8000-000000000001'
   and ((e.idempotency_key = 'fixture-ev-1' and p.huella = 'fixture-r2-entidad0')
     or (e.idempotency_key = 'fixture-ev-2' and p.huella = 'fixture-f1-entidad0')
     or (e.idempotency_key = 'fixture-ev-3' and p.huella = 'fixture-e1-entidad0')
     or (e.idempotency_key = 'fixture-ev-4' and p.huella = 'fixture-d2-entidad0')
     or (e.idempotency_key = 'fixture-ev-5' and p.huella = 'fixture-r1-entidad1'))
   and e.pista_id is distinct from p.id;

-- ---------------------------------------------------------------------
-- Defensas: tres sobre el caso presuncion_alta (docs/05) y una aceptada
-- sobre el caso del despacho contable.
-- ---------------------------------------------------------------------
insert into forense.defensas (caso_id, idempotency_key, trampa_codigo, pista_objetivo, argumento, ids,
                              herramientas_usadas, evidencia_objetivo_ids, resultado,
                              respuesta_investigador, aceptado)
values
  ('00000000-0000-4000-8000-000000000100','fixture-def-1','grupo_corporativo',null,
   'Las tres empresas pertenecerían a un grupo corporativo con operación intercompañía legítima.',
   '{CFDI:00000000-0000-4000-9000-000000000001}','{"perfil":2,"relacionados":1}'::jsonb,'{}','no_refuta',
   'No hay contrato ni estructura corporativa declarada; el dinero regresa al origen en 15 días sin servicio comprobable.',false),
  ('00000000-0000-4000-8000-000000000100','fixture-def-2','margen_delgado',null,
   'El decremento de 5% por salto sería el margen normal de una comercializadora.',
   '{CFDI:00000000-0000-4000-9000-000000000002,CFDI:00000000-0000-4000-9000-000000000003}','{"pares":1}'::jsonb,'{}','parcial',
   'El margen es plausible, pero no explica el retorno del dinero al emisor original ni la ausencia de nómina.',false),
  ('00000000-0000-4000-8000-000000000100','fixture-def-3','cfdi_cancelado',null,
   'Un CFDI citado por el Auditor está cancelado y no puede sostener el hallazgo documental.',
   '{CFDI:00000000-0000-4000-9000-00000000000d}','{"facturas":1}'::jsonb,'{}','refuta',
   'Aceptado: esa evidencia queda descartada; el dictamen se sostiene en las tres restantes.',true),
  ('00000000-0000-4000-8000-000000000101','fixture-def-4','despacho_contable',null,
   'El domicilio compartido corresponde al despacho contable que presta domicilio fiscal a sus clientes; hay nómina, antigüedad y contraprestación coherente.',
   array['ATR:["DEMO:ENTIDAD-1","domicilio","Av. Demo 100, Piso 3"]','CFDI:00000000-0000-4000-9000-000000000005'],
   '{"perfil":1,"relacionados":1,"facturas":1}'::jsonb,'{}','refuta',
   'Aceptado: la anomalía queda explicada y el caso cierra como anomalia_explicada.',true)
on conflict (idempotency_key) do nothing;

update forense.defensas d
   set evidencia_objetivo_ids = array[e.id]
  from forense.evidencia e
 where ((d.idempotency_key = 'fixture-def-3' and e.idempotency_key = 'fixture-ev-4')
     or (d.idempotency_key = 'fixture-def-4' and e.idempotency_key = 'fixture-ev-5'))
   and d.evidencia_objetivo_ids is distinct from array[e.id];

-- ---------------------------------------------------------------------
-- Expediente del caso presuncion_alta (secciones fijas de docs/21 §2 y §4)
-- ---------------------------------------------------------------------
insert into forense.expedientes (caso_id, idempotency_key, version, markdown, autor, creado)
values (
  '00000000-0000-4000-8000-000000000100','fixture-exp-1',1,
  E'# Expediente DEMO:ENTIDAD-0\n\n'
  '**Nivel: presuncion_alta** — nivel máximo del sistema. La determinación de operaciones inexistentes corresponde a la autoridad fiscal.\n\n'
  '## 1. Resumen\nCiclo de facturación de 1,200,000.00 MXN entre tres RFC relacionados con retorno del dinero al emisor en 15 días.\n\n'
  '## 2. Entidad\nDEMO:ENTIDAD-0, alta 2025-02-10, giro comercio_mayoreo, 1 empleado declarado.\n\n'
  '## 3. Trayectoria\nAlta 2025-02; primer CFDI 2025-09; pico 2025-11 (1,500,000.00); contraparte publicada en 69-B el 2025-12-15.\nSerie mensual calculada por `forense.v_trayectoria_rfc`; no se redacta de memoria.\n\n'
  '## 4. Hallazgos por familia\n- D2 sin nómina frente a facturación (CFDI:...0001, CFDI:...0004)\n- F1 dispersión del 93% a persona física (MOV:4, MOV:5, MOV:6)\n- R2 ciclo de facturas (CFDI:...0001, ...0002, ...0003)\n- E1 contraparte en 69-B presunto (LISTA:["DEMO:ENTIDAD-4","69B","presunto","2025-12-15"])\n\n'
  '## 5. Cadena de explicación\n1. Qué disparó: D2 y R2 sobre DEMO:ENTIDAD-0.\n'
  '2. Qué transacciones: CFDI ...0001/...0002/...0003, ventana 2025-11-05 a 2025-11-20, 1,200,000.00 → 1,140,720.00 MXN.\n'
  '3. Qué empresa: DEMO:ENTIDAD-0 comparte domicilio y representante con DEMO:ENTIDAD-3 y DEMO:ENTIDAD-4.\n'
  '4. A dónde fue el dinero: MOV:1 → MOV:2 → MOV:3 devuelve 95.06% a la cuenta de origen; MOV:4/5/6 dispersan 1,120,000.00 a DEMO:PF-9.\n'
  '5. Por qué se concluye: cuatro familias con evidencia validada; se probaron y fallaron las explicaciones de grupo corporativo y margen delgado.\n\n'
  '## 6. Defensas evaluadas\ngrupo_corporativo (no_refuta), margen_delgado (parcial), cfdi_cancelado (refuta, evidencia descartada).\n\n'
  '## 7. Límites\nDEMO:ENTIDAD-4 conserva cobertura parcial: falta conciliar 2 pagos. DEMO:PF-9 no recibe atribución propia.\n\n'
  '## 8. Monto en riesgo\n3,504,720.00 MXN sumando CFDI únicos validados.\n',
  'agente','2026-01-31T12:03:00Z')
on conflict (idempotency_key) do nothing;

insert into forense.expediente_chat (caso_id, rol, mensaje, seleccion, version_resultante, creado)
select '00000000-0000-4000-8000-000000000100','user',
       '¿Puedes hacer más corto el resumen y dejar los montos con dos decimales?', '## 1. Resumen', null,
       '2026-01-31T12:05:00Z'
 where not exists (select 1 from forense.expediente_chat
                    where caso_id = '00000000-0000-4000-8000-000000000100' and rol = 'user');

insert into forense.expediente_chat (caso_id, rol, mensaje, seleccion, version_resultante, creado)
select '00000000-0000-4000-8000-000000000100','agente',
       'Propongo reescribir el resumen en dos líneas conservando las citas CFDI:...0001 y MOV:3. Aplicar creará la versión 2.',
       '## 1. Resumen', null, '2026-01-31T12:05:20Z'
 where not exists (select 1 from forense.expediente_chat
                    where caso_id = '00000000-0000-4000-8000-000000000100' and rol = 'agente');

-- ---------------------------------------------------------------------
-- Bitácora: 20 eventos del caso presuncion_alta en dos rondas.
-- seq explícito para que reejecutar el seed no duplique (unique caso_id,seq).
-- ---------------------------------------------------------------------
insert into forense.bitacora (corrida_id, caso_id, cluster_id, seq, ronda, intento, tarea_id, ts,
                              agente, tipo_evento, payload, duracion_ms, tokens_in, tokens_out, modelo)
values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',1,null,0,null,'2026-01-31T12:00:00Z','sistema','caso_creado','{"origen":"pipeline","rfc":"DEMO:ENTIDAD-0"}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',2,null,0,null,'2026-01-31T12:00:02Z','sistema','cluster_armado','{"n_rfcs":3,"score":3.10}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',3,null,0,null,'2026-01-31T12:00:04Z','sistema','pista_cargada','{"codigos":["D2","F1","R2","E1"]}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',4,1,0,null,'2026-01-31T12:00:10Z','sistema','ronda_inicio','{"ronda":1,"agentes":["documental","financiero","relacional"]}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',5,1,0,'00000000-0000-4000-8000-000000000300','2026-01-31T12:00:14Z','documental','razonamiento','{"texto":"Reviso facturación contra nómina y empleados declarados"}',1200,2100,180,'fixture-model'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',6,1,0,'00000000-0000-4000-8000-000000000300','2026-01-31T12:00:16Z','documental','tool_call','{"tool":"perfil","args":{"rfc":"DEMO:ENTIDAD-0"}}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',7,1,0,'00000000-0000-4000-8000-000000000300','2026-01-31T12:00:17Z','documental','tool_result','{"tool":"perfil","cache":false,"facturado_12m":"1500000.00","nomina_12m":"0.00"}',380,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',8,1,0,'00000000-0000-4000-8000-000000000300','2026-01-31T12:00:40Z','documental','senal_escrita','{"idempotency_key":"fixture-senal-1","familia":"D","confianza":"alta"}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',9,1,0,'00000000-0000-4000-8000-000000000302','2026-01-31T12:00:52Z','relacional','senal_escrita','{"idempotency_key":"fixture-senal-3","familia":"R","confianza":"alta"}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',10,1,0,'00000000-0000-4000-8000-000000000301','2026-01-31T12:00:58Z','financiero','senal_escrita','{"idempotency_key":"fixture-senal-2","familia":"F","confianza":"alta"}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',11,1,0,null,'2026-01-31T12:01:05Z','sistema','ronda_fin','{"ronda":1,"senales":3}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',12,1,0,null,'2026-01-31T12:01:08Z','sistema','frontera_detectada','{"rfcs":["DEMO:PF-9"],"decision":"no_expandir_sin_facturacion"}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',13,1,0,null,'2026-01-31T12:01:12Z','sistema','despertar','{"despertados":["documental","financiero"],"motivo":"senal R: cluster de prestanombres"}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',14,2,0,null,'2026-01-31T12:01:30Z','sistema','ronda_inicio','{"ronda":2,"agentes":["documental","financiero"]}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',15,2,0,'00000000-0000-4000-8000-000000000303','2026-01-31T12:01:36Z','documental','senal_leida','{"idempotency_key":"fixture-senal-3"}',120,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',16,2,0,'00000000-0000-4000-8000-000000000303','2026-01-31T12:01:55Z','documental','senal_escrita','{"idempotency_key":"fixture-senal-4","familia":"D","confianza":"media"}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',17,2,0,'00000000-0000-4000-8000-000000000304','2026-01-31T12:02:02Z','financiero','senal_escrita','{"idempotency_key":"fixture-senal-5","familia":"F","confianza":"alta"}',null,null,null,null),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',18,2,0,'00000000-0000-4000-8000-000000000305','2026-01-31T12:02:35Z','auditor','auditoria','{"familias":["D","F","R","E"],"evidencia_propuesta":4}',null,4800,900,'fixture-model'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',19,2,0,'00000000-0000-4000-8000-000000000306','2026-01-31T12:02:44Z','defensor','defensa_argumento','{"defensas":3,"aceptadas":1}',null,5200,1100,'fixture-model'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000200',20,2,0,null,'2026-01-31T12:03:02Z','sistema','dictamen','{"nivel":"presuncion_alta","familias":["D","F","R","E"],"evidencia_validada":3,"evidencia_descartada":1}',null,null,null,null)
on conflict (caso_id, seq) do nothing;

insert into forense.bitacora (corrida_id, caso_id, cluster_id, seq, ronda, intento, tarea_id, ts,
                              agente, tipo_evento, payload)
values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201',1,null,0,null,'2026-01-31T12:00:00Z','sistema','caso_creado','{"origen":"pipeline","rfc":"DEMO:ENTIDAD-1"}'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201',2,1,0,'00000000-0000-4000-8000-000000000310','2026-01-31T12:00:20Z','relacional','senal_escrita','{"familia":"R","titular":"domicilio compartido con 3 RFC"}'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201',3,1,0,null,'2026-01-31T12:00:46Z','sistema','ronda_fin','{"ronda":1,"senales":1}'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201',4,2,0,'00000000-0000-4000-8000-000000000311','2026-01-31T12:00:58Z','defensor','defensa_argumento','{"trampa":"despacho_contable","resultado":"refuta"}'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201',5,2,0,null,'2026-01-31T12:01:00Z','sistema','evidencia_descartada','{"idempotency_key":"fixture-ev-5","motivo":"defensa aceptada"}'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201',6,2,0,null,'2026-01-31T12:01:04Z','sistema','dictamen','{"nivel":"anomalia_explicada","trampa":"despacho_contable"}'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000202',1,null,0,null,'2026-01-31T12:00:00Z','sistema','caso_creado','{"origen":"pipeline","rfc":"DEMO:ENTIDAD-2"}'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000202',2,1,0,'00000000-0000-4000-8000-000000000320','2026-01-31T12:00:30Z','documental','tool_result','{"tool":"pares","cache":false,"dentro_de_rango":true}'),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000202',3,1,0,null,'2026-01-31T12:00:41Z','sistema','dictamen','{"nivel":"sin_hallazgos","motivo":"no cruza la regla de dos familias"}')
on conflict (caso_id, seq) do nothing;

-- Eventos previos al caso (carga del snapshot), con caso_id NULL
insert into forense.bitacora (corrida_id, caso_id, cluster_id, seq, ts, agente, tipo_evento, payload)
select '00000000-0000-4000-8000-000000000001', null, null, null, '2026-01-31T11:59:00Z', 'sistema',
       'pista_cargada',
       '{"evento_real":"snapshot_fixture_cargado","contribuyentes":8,"cfdi":16,"movimientos":8}'::jsonb
 where not exists (
   select 1 from forense.bitacora
    where corrida_id = '00000000-0000-4000-8000-000000000001' and caso_id is null
      and payload->>'evento_real' = 'snapshot_fixture_cargado');

-- El contador de bitácora queda alineado con los seq insertados a mano
update forense.casos k
   set bitacora_seq = greatest(k.bitacora_seq,
        coalesce((select max(b.seq) from forense.bitacora b where b.caso_id = k.id), 0))
 where k.corrida_id = '00000000-0000-4000-8000-000000000001';

-- Agregados por giro listos para la UI (el fixture no corre 003)
refresh materialized view forense.v_pares_giro;
