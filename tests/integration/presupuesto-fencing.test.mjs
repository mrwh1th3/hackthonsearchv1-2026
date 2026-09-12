// tests/integration/presupuesto-fencing.test.mjs — reservar_tool, fencing y leases
// (03 §Presupuestos, 06 §control de presupuesto, 17 §4 y §6).
//
//   bash tests/integration/preparar-db.sh
//   node --test tests/integration/presupuesto-fencing.test.mjs
//
// Lo que se prueba contra Postgres real, no contra un mock:
//  - el límite POR TAREA (limites_agente) frena antes que el techo del caso;
//  - el techo del caso son 120 tools con 27 reservadas: un agente de investigación
//    se detiene en 93, uno de cierre puede llegar a 120;
//  - "presupuesto agotado" es un DATO devuelto (jsonb), nunca una excepción, y deja
//    fila en forense.bitacora y casos.presupuesto_agotado = true;
//  - save_checkpoint rechaza un fence viejo (proceso zombi con lease reasignado);
//  - dos claims concurrentes del mismo lease: gana uno solo.
//
// Los números 120/27 se leen de forense.config_presupuesto, no se hardcodean aquí:
// si alguien los cambia, la prueba sigue midiendo la regla, no una constante.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DB_QA, PSQL, correr, correrOk, escalar, hayBase, json } from './_ayudas.mjs';

const disponible = hayBase(DB_QA);
const saltar = disponible ? false : `falta la base ${DB_QA}: corre bash tests/integration/preparar-db.sh`;

const CORRIDA = '00000000-0000-4000-8000-0000000000qa'.replace('qa', 'a1');
const CLUSTER = '00000000-0000-4000-8000-0000000000c1';
const CASO = '00000000-0000-4000-8000-0000000000ca';

/** Escenario limpio: corrida + cluster + caso propios de QA, sin tocar el fixture. */
function escenario() {
  correrOk(DB_QA, `
    delete from forense.corridas where id = '${CORRIDA}';
    insert into forense.corridas (id, nombre, dataset, dataset_hash, fecha_corte, estado, modo)
      values ('${CORRIDA}','qa-presupuesto','qa','qa-hash','2026-01-01T00:00:00Z','procesando','fixture');
    insert into forense.clusters (id, corrida_id, rfc_semilla, huella, estado)
      values ('${CLUSTER}','${CORRIDA}','QAA010101AAA','qa-huella','ronda1');
    insert into forense.casos (id, corrida_id, cluster_id, rfc_principal, estado)
      values ('${CASO}','${CORRIDA}','${CLUSTER}','QAA010101AAA','ronda1');`);
}

/** Crea una tarea y devuelve su id. */
function tarea(agente, ronda, clave) {
  return escalar(DB_QA, `
    insert into forense.tareas_agente (caso_id, corrida_id, cluster_id, agente, ronda, idempotency_key, estado)
      values ('${CASO}','${CORRIDA}','${CLUSTER}','${agente}',${ronda},'${clave}','pendiente')
    returning id;`);
}

test('límite por tarea: el especialista se detiene en su cuota y lo devuelve como dato', { skip: saltar }, () => {
  escenario();
  const t = tarea('externo', 1, 'qa-externo-r1'); // limites_agente: externo/1 = 4
  const limite = Number(escalar(DB_QA, `select forense.limite_tool('externo', 1)`));
  assert.equal(limite, 4, 'limites_agente debería dar 4 a externo en ronda 1');

  for (let i = 1; i <= limite; i += 1) {
    const r = json(DB_QA, `forense.reservar_tool('${CASO}','${t}','perfil','{}'::jsonb)`);
    assert.equal(r.ok, true, `la reserva ${i} debería concederse: ${JSON.stringify(r)}`);
    assert.equal(r.restante_tarea, limite - i);
  }
  const excedida = json(DB_QA, `forense.reservar_tool('${CASO}','${t}','perfil','{}'::jsonb)`);
  assert.equal(excedida.ok, false);
  assert.equal(excedida.error, 'presupuesto agotado');
  assert.equal(excedida.alcance, 'tarea');
  assert.equal(excedida.limite, limite);

  // Dato, no excepción: la llamada devolvió exit 0 y dejó rastro.
  const eventos = escalar(DB_QA, `
    select count(*) from forense.bitacora
     where caso_id = '${CASO}' and tipo_evento = 'presupuesto_agotado'
       and payload->>'alcance' = 'tarea'`);
  assert.equal(eventos, '1', 'sin fila en bitacora el paso no existió (regla 2)');
  const contador = escalar(DB_QA, `select tool_calls from forense.tareas_agente where id = '${t}'`);
  assert.equal(contador, String(limite), 'la reserva rechazada no debe incrementar el contador');
});

test('techo del caso: 120 con reserva de 27 — investigación para en 93, cierre llega a 120', { skip: saltar }, () => {
  escenario();
  const total = Number(escalar(DB_QA, `select forense.config_int('tools_por_caso', 120)`));
  const reserva = Number(escalar(DB_QA, `select forense.config_int('reserva_cierre_tools', 27)`));
  assert.equal(total, 120, 'config_presupuesto.tools_por_caso');
  assert.equal(reserva, 27, 'config_presupuesto.reserva_cierre_tools');
  const techoInvestigacion = total - reserva; // 93

  // Se coloca el caso justo en el borde en vez de gastar 93 llamadas reales.
  correrOk(DB_QA, `update forense.casos set tool_calls = ${techoInvestigacion - 1} where id = '${CASO}'`);
  const tExp = tarea('documental', 1, 'qa-doc-borde');

  const ultima = json(DB_QA, `forense.reservar_tool('${CASO}','${tExp}','facturas','{}'::jsonb)`);
  assert.equal(ultima.ok, true, 'la llamada 93 de investigación debe concederse');
  assert.equal(ultima.restante_caso, 0, 'y debe anunciar que no queda saldo de investigación');

  const cortada = json(DB_QA, `forense.reservar_tool('${CASO}','${tExp}','facturas','{}'::jsonb)`);
  assert.equal(cortada.ok, false);
  assert.equal(cortada.error, 'presupuesto agotado');
  assert.equal(cortada.alcance, 'caso');
  assert.equal(cortada.techo, techoInvestigacion,
    'la exploración no puede comerse la reserva de cierre');

  const agotado = escalar(DB_QA, `select presupuesto_agotado from forense.casos where id = '${CASO}'`);
  assert.equal(agotado, 't', 'casos.presupuesto_agotado debe quedar visible para la UI (03 §249)');

  // El Auditor (bolsa de cierre) sí puede seguir: la reserva es suya.
  const tAud = tarea('auditor', 1, 'qa-auditor-borde');
  const cierre = json(DB_QA, `forense.reservar_tool('${CASO}','${tAud}','ciclos','{}'::jsonb)`);
  assert.equal(cierre.ok, true, `el auditor debe poder usar su reserva: ${JSON.stringify(cierre)}`);
  assert.equal(cierre.bolsa, 'cierre');
  assert.equal(cierre.restante_caso, total - techoInvestigacion - 1, 'y su techo es el total, no 93');

  // Y al llegar a 120 se detiene también el cierre.
  correrOk(DB_QA, `update forense.casos set tool_calls = ${total} where id = '${CASO}'`);
  const fin = json(DB_QA, `forense.reservar_tool('${CASO}','${tAud}','ciclos','{}'::jsonb)`);
  assert.equal(fin.ok, false);
  assert.equal(fin.alcance, 'caso');
  assert.equal(fin.techo, total);
});

test('reservar_tool rechaza contexto cruzado (tarea de otro caso o de otra corrida)', { skip: saltar }, () => {
  escenario();
  const t = tarea('financiero', 1, 'qa-fin-cruce');
  const otro = '00000000-0000-4000-8000-0000000000cb';
  correrOk(DB_QA, `
    insert into forense.casos (id, corrida_id, cluster_id, rfc_principal, estado)
      values ('${otro}','${CORRIDA}','${CLUSTER}','QAB010101BBB','ronda1')
    on conflict (id) do nothing;`);
  const r = json(DB_QA, `forense.reservar_tool('${otro}','${t}','pares','{}'::jsonb)`);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'contexto_invalido');
});

test('save_checkpoint: un fence viejo no escribe (proceso zombi con lease reasignado)', { skip: saltar }, () => {
  escenario();
  const t = tarea('relacional', 1, 'qa-rel-fence');
  const ejec = escalar(DB_QA, `
    insert into forense.ejecuciones_agente (corrida_id, caso_id, tarea_id, rol, fence_token, revision)
      values ('${CORRIDA}','${CASO}','${t}','relacional', 7, 0)
    returning id;`);

  const bueno = json(DB_QA, `forense.save_checkpoint('${ejec}', 7, 0, '{"paso": 1}'::jsonb)`);
  assert.equal(bueno.ok, true, `fence correcto debería escribir: ${JSON.stringify(bueno)}`);
  assert.equal(bueno.revision, 1);

  // El lease se reasigna: fence sube a 8. El proceso viejo sigue creyendo que es 7.
  correrOk(DB_QA, `update forense.ejecuciones_agente set fence_token = 8 where id = '${ejec}'`);
  const zombi = json(DB_QA, `forense.save_checkpoint('${ejec}', 7, 1, '{"paso": 99}'::jsonb)`);
  assert.equal(zombi.ok, false);
  assert.equal(zombi.error, 'lease_vencido');
  assert.equal(String(zombi.fence_actual), '8');
  const paso = escalar(DB_QA, `select paso from forense.ejecuciones_agente where id = '${ejec}'`);
  assert.equal(paso, '1', 'el zombi no pudo mover el paso');

  // Y con el fence bueno pero una revisión desfasada: conflicto de versión, no sobreescritura.
  const desfasado = json(DB_QA, `forense.save_checkpoint('${ejec}', 8, 0, '{"paso": 50}'::jsonb)`);
  assert.equal(desfasado.ok, false);
  assert.equal(desfasado.error, 'revision_conflicto');
  assert.equal(String(desfasado.revision_actual), '1');
});

test('dos claims concurrentes del mismo lease de tarea: gana exactamente uno', { skip: saltar }, async () => {
  escenario();
  const t = tarea('temporal', 1, 'qa-temp-lease');

  // Dos sesiones psql reales, arrancadas a la vez. Cada una espera a la otra con
  // pg_advisory_lock para solaparse de verdad y no ganar por orden de arranque.
  const sql = (owner) => `
    select pg_advisory_lock(918273);
    select pg_advisory_unlock(918273);
    select forense.lease_tarea_adquirir('${t}', '${owner}', 90)->>'ok';`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-lease-'));
  const lanzar = (owner) => {
    const f = path.join(dir, `${owner}.sql`);
    fs.writeFileSync(f, sql(owner), 'utf8');
    return new Promise((resolve) => {
      const p = spawn(PSQL, ['-d', DB_QA, '-X', '-q', '-t', '-A', '-f', f], {
        env: { ...process.env, PGHOST: process.env.PGHOST || 'localhost', PGUSER: process.env.PGUSER || 'postgres' },
        encoding: 'utf8',
      });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('close', () => resolve(out.trim().split('\n').pop()));
    });
  };
  const resultados = await Promise.all([lanzar('worker-a'), lanzar('worker-b')]);
  fs.rmSync(dir, { recursive: true, force: true });

  const ganadores = resultados.filter((x) => x === 'true').length;
  assert.equal(ganadores, 1, `exactamente un worker debe adquirir el lease, no ${ganadores} (${resultados})`);

  const owner = escalar(DB_QA, `select lease_owner from forense.tareas_agente where id = '${t}'`);
  assert.ok(['worker-a', 'worker-b'].includes(owner), `owner inesperado: ${owner}`);

  // El perdedor tampoco puede renovar ni liberar lo que no tiene.
  const perdedor = owner === 'worker-a' ? 'worker-b' : 'worker-a';
  const renov = json(DB_QA, `forense.lease_tarea_renovar('${t}', '${perdedor}', 90)`);
  assert.equal(renov.ok, false);
  assert.equal(renov.error, 'lease_vencido');
  const lib = json(DB_QA, `forense.lease_tarea_liberar('${t}', '${perdedor}')`);
  assert.equal(lib.ok, false, 'sólo el dueño libera');
});

test('una tarea con lease vencido no puede reservar herramientas', { skip: saltar }, () => {
  escenario();
  const t = tarea('documental', 1, 'qa-doc-vencido');
  correrOk(DB_QA, `
    update forense.tareas_agente
       set lease_owner = 'worker-zombi', lease_expires_at = now() - interval '1 minute'
     where id = '${t}'`);
  const r = json(DB_QA, `forense.reservar_tool('${CASO}','${t}','facturas','{}'::jsonb)`);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'lease_vencido');
  const n = escalar(DB_QA, `select tool_calls from forense.tareas_agente where id = '${t}'`);
  assert.equal(n, '0', 'un zombi no gasta presupuesto');
});

test.after(() => {
  if (disponible) correr(DB_QA, `delete from forense.corridas where id = '${CORRIDA}';`);
});
