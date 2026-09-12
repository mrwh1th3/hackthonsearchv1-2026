// tests/integration/rls-scope.test.mjs — RLS, grants y superficie ejecutable (05 §RLS, 19 §Protección).
//
//   bash tests/integration/preparar-db.sh
//   node --test tests/integration/rls-scope.test.mjs
//
// Qué se afirma y qué NO:
//  - anon LEE los hechos de la corrida fixture (casos, bitácora, señales, clusters, pistas).
//  - anon NO escribe en ninguna de ellas.
//  - anon NO puede EJECUTAR las funciones de control del schema forense
//    (reservar_tool, log, clonar_corrida, correr_pistas…): sólo las tres vistas-función
//    de lectura que 003 le concede explícitamente.
//  - `forense.ground_truth` SÍ es legible por anon **a propósito**: lo fija 05 §RLS y lo
//    ratifica DECISIONES H4 02:20 (la vista de Estadísticas la necesita y el dataset es
//    sintético). Lo que el sistema promete es que ninguna RPC del agente la lee; eso se
//    prueba en reglas-invariantes.test.mjs sobre pg_proc.prosrc.
//  - las tablas privadas de runtime (ejecuciones_agente, llm_solicitudes, …) no tienen
//    policy ni grant: anon no las ve.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DB_QA, FIXTURE, correr, escalar, filas, hayBase } from './_ayudas.mjs';

const disponible = hayBase(DB_QA);
const saltar = disponible ? false : `falta la base ${DB_QA}: corre bash tests/integration/preparar-db.sh`;

const PUBLICAS_DEMO = ['casos', 'bitacora', 'senales', 'clusters', 'pistas', 'corridas', 'expedientes'];
const PRIVADAS_RUNTIME = [
  'ejecuciones_agente', 'artefactos_contexto', 'llm_solicitudes',
  'tool_ejecuciones', 'pasos_pipeline', 'slots_runtime', 'tool_cache',
];

test('anon lee los hechos de la corrida fixture', { skip: saltar }, () => {
  for (const tabla of PUBLICAS_DEMO) {
    const n = escalar(DB_QA, `select count(*) from forense.${tabla}`, { rol: 'anon' });
    assert.ok(Number(n) > 0, `anon debería leer filas de forense.${tabla}, leyó ${n}`);
  }
  // Y los lee acotados por corrida: el fixture es una corrida identificable.
  const n = escalar(DB_QA, `select count(*) from forense.casos where corrida_id = '${FIXTURE.corrida}'`, { rol: 'anon' });
  assert.ok(Number(n) > 0, 'la corrida fixture debe tener casos visibles para anon');
});

test('anon no ve las tablas privadas de runtime', { skip: saltar }, () => {
  for (const tabla of PRIVADAS_RUNTIME) {
    const r = correr(DB_QA, `select count(*) from forense.${tabla};`, { rol: 'anon', detener: true });
    assert.notEqual(r.code, 0, `anon no debería poder leer forense.${tabla}`);
    assert.match(r.error, /permission denied|no autorizado/i,
      `forense.${tabla}: se esperaba permission denied, se obtuvo ${r.error}`);
  }
});

test('anon no puede insertar ni actualizar ni borrar', { skip: saltar }, () => {
  const mutaciones = [
    [`insert into forense.pistas (corrida_id, codigo, familia, rfc, score, estado)
        values ('${FIXTURE.corrida}','D2','D','XAXX010101000',1,'nueva');`, 'insert en pistas'],
    [`insert into forense.bitacora (agente, tipo_evento) values ('anon-intruso','razonamiento');`, 'insert en bitacora'],
    [`update forense.casos set nivel = 'presuncion_alta';`, 'update en casos'],
    [`delete from forense.senales;`, 'delete en senales'],
    [`insert into forense.ground_truth (corrida_id, rfc, es_fraude)
        values ('${FIXTURE.corrida}','XAXX010101000', false);`, 'insert en ground_truth'],
  ];
  for (const [sql, etiqueta] of mutaciones) {
    const r = correr(DB_QA, sql, { rol: 'anon', detener: true });
    assert.notEqual(r.code, 0, `${etiqueta}: anon no debería poder escribir`);
    assert.match(r.error, /permission denied|row-level security|violates/i,
      `${etiqueta}: error inesperado ${r.error}`);
  }
});

test('ground_truth es legible por anon POR DECISIÓN explícita (05 §RLS, DECISIONES H4 02:20)', { skip: saltar }, () => {
  const n = escalar(DB_QA, 'select count(*) from forense.ground_truth', { rol: 'anon' });
  assert.ok(Number(n) > 0,
    'si esto falla, alguien retiró el grant: /estadisticas deja de funcionar y hay que ' +
    'actualizar DECISIONES H4 02:20 antes de cambiarlo');
});

test('anon no puede EJECUTAR las funciones de control del schema forense', { skip: saltar }, () => {
  const prohibidas = [
    [`select forense.log(null,'anon-intruso','razonamiento','{}'::jsonb);`, 'log'],
    [`select forense.reservar_tool(null,null,'perfil','{}'::jsonb);`, 'reservar_tool'],
    [`select forense.clonar_corrida('${FIXTURE.corrida}','robada');`, 'clonar_corrida'],
    [`select forense.correr_pistas('${FIXTURE.corrida}');`, 'correr_pistas'],
    [`select forense.claim_step(null,null,null,null);`, 'claim_step'],
    [`select forense.next_seq(null);`, 'next_seq'],
  ];
  for (const [sql, nombre] of prohibidas) {
    const r = correr(DB_QA, sql, { rol: 'anon', detener: true });
    assert.notEqual(r.code, 0, `anon no debería poder ejecutar forense.${nombre}`);
    assert.match(r.error, /permission denied|does not exist|no existe/i,
      `forense.${nombre}: error inesperado ${r.error}`);
  }
  // Y la bitácora no recibió nada del intruso.
  const n = escalar(DB_QA, `select count(*) from forense.bitacora where agente = 'anon-intruso'`);
  assert.equal(n, '0', 'ninguna llamada de anon debió dejar rastro escrito');
});

test('anon SÍ ejecuta las tres funciones de lectura que 003 le concede', { skip: saltar }, () => {
  for (const sql of [
    `select count(*) from forense.v_grafo('${FIXTURE.corrida}', (select rfc from forense.contribuyentes where corrida_id='${FIXTURE.corrida}' limit 1), 1);`,
    `select count(*) from forense.v_trayectoria_rfc('${FIXTURE.corrida}', (select rfc from forense.contribuyentes where corrida_id='${FIXTURE.corrida}' limit 1));`,
    `select forense.v_metricas_corrida('${FIXTURE.corrida}') is not null;`,
  ]) {
    const r = correr(DB_QA, sql, { rol: 'anon', detener: true });
    assert.equal(r.code, 0, `anon debería poder ejecutar esta lectura: ${r.error}`);
  }
});

test('toda escritura del pipeline depende de saltarse RLS: ninguna tabla tiene policy de escritura', { skip: saltar }, () => {
  // Hallazgo documentado (QA-006, severidad baja): las migraciones habilitan RLS en las
  // 29 tablas y sólo crean policies `for select`. No es un fallo en Supabase, donde
  // service_role trae BYPASSRLS; sí es una dependencia implícita del proveedor que
  // conviene que quede escrita. Esta prueba falla el día que alguien añada una policy
  // de escritura, para que la decisión se revise a propósito.
  const escritura = filas(DB_QA, `
    select tablename || '.' || policyname || ' (' || cmd || ')'
      from pg_policies where schemaname = 'forense' and cmd <> 'SELECT' order by 1;`)
    .map((x) => x[0]).filter(Boolean);
  assert.deepEqual(escritura, [],
    `aparecieron policies de escritura: revisar si el pipeline ya no necesita BYPASSRLS: ${escritura.join(', ')}`);
  const bypass = escalar(DB_QA, `select rolbypassrls from pg_roles where rolname = 'service_role'`);
  assert.equal(bypass, 't',
    'service_role sin BYPASSRLS no puede escribir ni una fila con este esquema; ' +
    'corre bash tests/integration/preparar-db.sh para replicar Supabase');
});

test('service_role sí escribe (es quien opera el pipeline)', { skip: saltar }, () => {
  const r = correr(DB_QA, `
    insert into forense.bitacora (corrida_id, agente, tipo_evento, payload)
      values ('${FIXTURE.corrida}','qa-service-role','razonamiento','{"prueba":"rls"}'::jsonb);
    select count(*) from forense.bitacora where agente = 'qa-service-role';`,
  { rol: 'service_role', detener: true });
  assert.equal(r.code, 0, `service_role debería poder escribir: ${r.error}`);
  assert.equal(r.salida.split('\n').pop(), '1');
  // limpieza como postgres para no dejar basura en la base de QA
  correr(DB_QA, `delete from forense.bitacora where agente = 'qa-service-role';`);
});

test('ninguna función del schema forense queda ejecutable por PUBLIC', { skip: saltar }, () => {
  // Guarda de regresión: 002-006 terminan con `revoke execute ... from public`.
  // Si una migración nueva añade funciones sin repetir el revoke, esta prueba las nombra.
  //
  // Las funciones que devuelven `trigger` se miden aparte: Postgres las rechaza en
  // cualquier invocación directa («trigger functions can only be called as triggers»),
  // así que una sin revoke era un hueco cosmético, no explotable. QA-002 (007 dejó
  // forense.trg_investigacion_completa sin revoke) quedó CERRADO en la oleada 3: hoy
  // la lista está vacía y se exige que siga vacía, con la comprobación de invocación
  // como segunda barrera si una migración futura vuelve a abrir una.
  const expuestas = filas(DB_QA, `
    select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'forense'
       and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('public', p.oid, 'execute')
     order by 1;`).map((x) => x[0]).filter(Boolean);
  assert.deepEqual(expuestas, [],
    `funciones de forense ejecutables por PUBLIC (falta un revoke al final de la migración): ${expuestas.join(', ')}`);

  // Y las de trigger que quedaron con execute a PUBLIC, que no se puedan llamar.
  const triggers = filas(DB_QA, `
    select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'forense' and p.prorettype = 'trigger'::regtype
       and has_function_privilege('public', p.oid, 'execute')
     order by 1;`).map((x) => x[0]).filter(Boolean);
  for (const t of triggers) {
    const r = correr(DB_QA, `select forense.${t}();`, { detener: true });
    assert.notEqual(r.code, 0, `forense.${t}() se dejó invocar directamente por PUBLIC`);
    assert.match(r.error, /trigger functions can only be called as triggers/,
      `forense.${t}() falló por otro motivo: ${r.error}`);
  }
  assert.deepEqual(triggers, [],
    'QA-002 se reabrió: funciones de trigger ejecutables por PUBLIC (falta el revoke al ' +
    `final de la migración que las creó): ${triggers.join(', ')}`);
});
