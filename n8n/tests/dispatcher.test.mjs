// n8n/tests/dispatcher.test.mjs — avance de la máquina desde DB (17 §3, §4).
//
// SIMULADO: los helpers son la implementación en memoria de dispatcher.mjs, no
// las funciones SQL de forense-db. Que la SQL se comporte igual es un gate
// posterior; aquí se fija el CONTRATO que esa SQL debe cumplir.

import test from 'node:test';
import assert from 'node:assert/strict';

import { crearDispatcher, crearHelpersEnMemoria } from '../runtime/dispatcher.mjs';
import { AHORA, UUID } from './_ayudas.mjs';

function montar({ pasos = [], lease_ms = 90_000, max_slots = 8, inicio = AHORA } = {}) {
  const helpers = crearHelpersEnMemoria({ lease_ms, max_slots });
  helpers.sembrarCaso({ id: UUID.caso });
  helpers.sembrarEjecucion({ id: UUID.ejecucion, caso_id: UUID.caso, tarea_id: UUID.tarea, rol: 'documental' });
  let t = inicio;
  const eventos = [];
  const guion = [...pasos];
  const ejecutados = [];
  const dispatcher = crearDispatcher({
    helpers,
    ahora: () => t,
    registrar: (e) => eventos.push(e),
    ejecutarPaso: async (entrada) => {
      ejecutados.push(entrada);
      const siguiente = guion.shift() ?? { estado_interno: 'terminado', estado_tarea: 'completada' };
      if (typeof siguiente === 'function') return siguiente(entrada);
      return { checkpoint: { paso: (entrada.checkpoint?.paso ?? 0) + 1 }, ...siguiente };
    },
  });
  return { helpers, dispatcher, eventos, ejecutados, avanzarReloj: (ms) => { t += ms; }, ahora: () => t };
}

test('[SIMULADO] el dispatcher avanza un paso, guarda checkpoint y pide redespacho', async () => {
  const banco = montar({ pasos: [{ estado_interno: 'solicitar_modelo' }] });
  const r = await banco.dispatcher.avanzar({ execution_id: UUID.ejecucion, owner: 'worker-1' });
  assert.equal(r.avanzo, true);
  assert.equal(r.terminal, false);
  assert.equal(r.redespachar, true, 'un paso no terminal se redespacha, no se espera en el nodo');
  assert.equal(r.revision, 2, 'el CAS sube la revisión');
  assert.ok(banco.eventos.some((e) => e.tipo_evento === 'checkpoint_guardado'));
});

test('[SIMULADO] un paso terminal finaliza la tarea y libera el lease', async () => {
  const banco = montar({ pasos: [{ estado_interno: 'terminado', estado_tarea: 'completada' }] });
  const r = await banco.dispatcher.avanzar({ execution_id: UUID.ejecucion, owner: 'worker-1' });
  assert.equal(r.terminal, true);
  assert.equal(banco.helpers._estado.tareas.get(UUID.tarea).estado, 'completada');
  assert.equal(banco.helpers._estado.ejecuciones.get(UUID.ejecucion).owner, null, 'el lease se libera');
});

test('[SIMULADO] correrHastaTerminal encadena pasos acotados hasta cerrar', async () => {
  const banco = montar({
    pasos: [
      { estado_interno: 'solicitar_modelo' },
      { estado_interno: 'ejecutar_herramienta' },
      { estado_interno: 'validar_salida' },
      { estado_interno: 'terminado', estado_tarea: 'completada' },
    ],
  });
  const r = await banco.dispatcher.correrHastaTerminal({ execution_id: UUID.ejecucion, owner: 'worker-1' });
  assert.equal(r.terminal, true);
  assert.equal(r.pasos, 4);
  assert.equal(banco.ejecutados.length, 4, 'cada vuelta es UNA ejecución acotada');
});

test('[SIMULADO] otro worker con lease vigente no roba el paso: queda pendiente, no fallido', async () => {
  const banco = montar({ pasos: [{ estado_interno: 'solicitar_modelo' }] });
  const claim = banco.helpers.claim_step({ execution_id: UUID.ejecucion, owner: 'worker-1', ahora: banco.ahora() });
  assert.equal(claim.ok, true);
  const r = await banco.dispatcher.avanzar({ execution_id: UUID.ejecucion, owner: 'worker-2' });
  assert.equal(r.avanzo, false);
  assert.equal(r.pendiente, true, 'sin slot ≠ fallida (17 §3)');
  assert.equal(r.error.codigo, 'slot_ocupado');
});

test('[SIMULADO] lease vencido: el token sube y el dueño viejo ya no puede guardar', async () => {
  const banco = montar({ lease_ms: 1000 });
  const primero = banco.helpers.claim_step({ execution_id: UUID.ejecucion, owner: 'worker-viejo', ahora: banco.ahora() });
  banco.avanzarReloj(5000);
  const segundo = banco.helpers.claim_step({ execution_id: UUID.ejecucion, owner: 'worker-nuevo', ahora: banco.ahora() });
  assert.equal(segundo.ok, true);
  assert.equal(BigInt(segundo.fencing_token) > BigInt(primero.fencing_token), true, 'el fencing token incrementa al reasignar');

  const guardadoViejo = banco.helpers.save_checkpoint({
    execution_id: UUID.ejecucion, fence: primero.fencing_token,
    revision_expected: primero.revision, patch: { estado_interno: 'terminado' },
  });
  assert.equal(guardadoViejo.ok, false);
  assert.equal(guardadoViejo.error.codigo, 'fence_vencido');
  assert.notEqual(banco.helpers._estado.ejecuciones.get(UUID.ejecucion).estado_interno, 'terminado');
});

test('[SIMULADO] el CAS rechaza una revisión vieja sin pisar el trabajo ajeno', () => {
  const banco = montar();
  const claim = banco.helpers.claim_step({ execution_id: UUID.ejecucion, owner: 'w', ahora: banco.ahora() });
  const primero = banco.helpers.save_checkpoint({
    execution_id: UUID.ejecucion, fence: claim.fencing_token,
    revision_expected: claim.revision, patch: { estado_interno: 'solicitar_modelo' },
  });
  assert.equal(primero.ok, true);
  const repetido = banco.helpers.save_checkpoint({
    execution_id: UUID.ejecucion, fence: claim.fencing_token,
    revision_expected: claim.revision, patch: { estado_interno: 'error' },
  });
  assert.equal(repetido.ok, false);
  assert.equal(repetido.error.codigo, 'conflicto_cas');
  assert.equal(repetido.revision_actual, primero.revision);
});

test('[SIMULADO] cancelar el caso detiene los próximos pasos', async () => {
  const banco = montar({ pasos: [{ estado_interno: 'solicitar_modelo' }] });
  banco.helpers.cancelar(UUID.caso);
  const r = await banco.dispatcher.avanzar({ execution_id: UUID.ejecucion, owner: 'worker-1' });
  assert.equal(r.avanzo, false);
  assert.equal(r.error.codigo, 'caso_cancelado');
  assert.equal(banco.ejecutados.length, 0, 'no se ejecutó ningún paso tras la cancelación');
});

test('[SIMULADO] un resultado tardío no reabre una tarea ya terminal', async () => {
  const banco = montar({ pasos: [{ estado_interno: 'terminado', estado_tarea: 'completada' }] });
  await banco.dispatcher.avanzar({ execution_id: UUID.ejecucion, owner: 'worker-1' });
  const tarde = banco.helpers.finish_step({
    execution_id: UUID.ejecucion, fence: '99', estado: 'error', resultado: { tardio: true },
  });
  assert.equal(tarde.ok, true);
  assert.equal(banco.helpers._estado.tareas.get(UUID.tarea).estado, 'completada', 'el estado terminal no se degrada');
});

test('[SIMULADO] reclamar el mismo tool_use_id dos veces no duplica la mutación', () => {
  const banco = montar();
  const claim = banco.helpers.claim_step({ execution_id: UUID.ejecucion, owner: 'w', ahora: banco.ahora() });
  const base = { execution_id: UUID.ejecucion, fence: claim.fencing_token, request_id: 'req-1', tool_use_id: 'toolu_1', args_hash: 'h' };
  assert.equal(banco.helpers.claim_tool(base).nuevo, true);
  assert.equal(banco.helpers.claim_tool(base).nuevo, false, 'la reentrega devuelve el registro previo');
  assert.equal(banco.helpers._estado.herramientas.size, 1);
});

test('[SIMULADO] reservar el mismo request_id dos veces no abre dos solicitudes', () => {
  const banco = montar();
  const claim = banco.helpers.claim_step({ execution_id: UUID.ejecucion, owner: 'w', ahora: banco.ahora() });
  const base = { execution_id: UUID.ejecucion, fence: claim.fencing_token, request_id: 'req-1' };
  assert.equal(banco.helpers.reserve_request(base).nuevo, true);
  assert.equal(banco.helpers.reserve_request(base).nuevo, false);
  assert.equal(banco.helpers._estado.solicitudes.size, 1);
});

test('[SIMULADO] la barrera de dos tareas no espera cinco y avanza una sola vez', () => {
  const helpers = crearHelpersEnMemoria();
  helpers.sembrarCaso({ id: UUID.caso });
  for (const id of ['t1', 't2']) {
    helpers.sembrarEjecucion({ id: `e-${id}`, caso_id: UUID.caso, tarea_id: id, rol: 'documental' });
  }
  helpers.registrarBarrera({ caso_id: UUID.caso, paso: 'ronda2', tareas_esperadas: ['t1', 't2'] });

  let r = helpers.advance_case_if_ready({ caso_id: UUID.caso, paso: 'ronda2' });
  assert.equal(r.avanza, false);
  assert.deepEqual(r.faltantes.sort(), ['t1', 't2']);

  helpers.finish_step({ execution_id: 'e-t1', fence: '0', estado: 'completada' });
  helpers.finish_step({ execution_id: 'e-t2', fence: '0', estado: 'error' });

  r = helpers.advance_case_if_ready({ caso_id: UUID.caso, paso: 'ronda2' });
  assert.equal(r.avanza, true, 'error y timeout son terminales: la barrera cierra');
  const segunda = helpers.advance_case_if_ready({ caso_id: UUID.caso, paso: 'ronda2' });
  assert.equal(segunda.avanza, false);
  assert.equal(segunda.motivo, 'ya_avanzada', 'dos callbacks no disparan dos auditores');
});

test('[SIMULADO] el reconciliador devuelve los leases vencidos y solo esos', () => {
  const banco = montar({ lease_ms: 1000 });
  assert.deepEqual(banco.dispatcher.reconciliar(), []);
  banco.helpers.claim_step({ execution_id: UUID.ejecucion, owner: 'worker-caido', ahora: banco.ahora() });
  assert.deepEqual(banco.dispatcher.reconciliar(), [], 'un lease vigente no se recupera');
  banco.avanzarReloj(5000);
  const expirados = banco.dispatcher.reconciliar();
  assert.equal(expirados.length, 1);
  assert.equal(expirados[0].execution_id, UUID.ejecucion);
  assert.equal(expirados[0].owner, 'worker-caido');
});

test('[SIMULADO] el límite de pasos activos frena el despacho sin marcar nada como fallido', async () => {
  const helpers = crearHelpersEnMemoria({ max_slots: 1 });
  helpers.sembrarCaso({ id: UUID.caso });
  helpers.sembrarEjecucion({ id: 'e-1', caso_id: UUID.caso, tarea_id: 't1', rol: 'documental' });
  helpers.sembrarEjecucion({ id: 'e-2', caso_id: UUID.caso, tarea_id: 't2', rol: 'financiero' });
  const dispatcher = crearDispatcher({ helpers, ahora: () => AHORA, ejecutarPaso: async () => ({ estado_interno: 'solicitar_modelo', checkpoint: {} }) });
  helpers.claim_step({ execution_id: 'e-1', owner: 'w1', ahora: AHORA });
  const r = await dispatcher.avanzar({ execution_id: 'e-2', owner: 'w2' });
  assert.equal(r.avanzo, false);
  assert.equal(r.pendiente, true);
  assert.equal(r.error.codigo, 'sin_slot');
  assert.equal(helpers._estado.tareas.get('t2').estado, 'pendiente', 'pendiente, nunca fallida');
});

test('[SIMULADO] una excepción del paso se guarda como error, no cuelga el caso', async () => {
  const banco = montar({ pasos: [() => { throw new Error('el nodo explotó'); }] });
  const r = await banco.dispatcher.avanzar({ execution_id: UUID.ejecucion, owner: 'worker-1' });
  assert.equal(r.terminal, true);
  assert.equal(banco.helpers._estado.ejecuciones.get(UUID.ejecucion).estado_interno, 'error');
  assert.equal(banco.helpers._estado.tareas.get(UUID.tarea).estado, 'error');
});

test('[SIMULADO] un paso ya terminal no se vuelve a reclamar', () => {
  const banco = montar();
  banco.helpers._estado.ejecuciones.get(UUID.ejecucion).estado_interno = 'terminado';
  const claim = banco.helpers.claim_step({ execution_id: UUID.ejecucion, owner: 'w', ahora: banco.ahora() });
  assert.equal(claim.ok, false);
  assert.equal(claim.error.codigo, 'paso_terminal');
});
