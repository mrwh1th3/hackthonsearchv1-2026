// n8n/tests/ledger.test.mjs — idempotencia de requests y herramientas (17 §4, §6, 06). SIMULADO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearLedger, idOperacion, hashArgs, uuidDeterminista } from '../runtime/ledger.mjs';
import { validateContract } from '../../contracts/index.mjs';
import { UUID } from './_ayudas.mjs';

test('p_operacion es un UUID determinista de (tarea_id, paso, tool_use_id)', () => {
  const a = idOperacion(UUID.tarea, 3, 'toolu_1');
  const b = idOperacion(UUID.tarea, 3, 'toolu_1');
  const c = idOperacion(UUID.tarea, 4, 'toolu_1');
  assert.equal(a, b);
  assert.notEqual(a, c);
  // `tools.llamada.p_operacion` es common.uuid: debe validar como UUID.
  const llamada = {
    tarea_id: UUID.tarea, caso_id: UUID.caso, p_operacion: a, fencing_token: '1',
    herramienta: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' },
  };
  assert.equal(validateContract('tools.llamada', llamada).ok, true);
});

test('idOperacion exige la tupla completa', () => {
  assert.throws(() => idOperacion(null, 1, 'toolu_1'));
  assert.throws(() => idOperacion(UUID.tarea, 1, null));
});

test('hashArgs es estable frente al orden de claves', () => {
  assert.equal(hashArgs({ a: 1, b: 2 }), hashArgs({ b: 2, a: 1 }));
  assert.notEqual(hashArgs({ a: 1 }), hashArgs({ a: 2 }));
});

test('reservar el mismo request_id dos veces no crea dos solicitudes', () => {
  const ledger = crearLedger();
  const primera = ledger.reservarRequest({ execution_id: UUID.ejecucion, request_id: 'r1', paso: 1, rol: 'documental' });
  const segunda = ledger.reservarRequest({ execution_id: UUID.ejecucion, request_id: 'r1', paso: 1, rol: 'documental' });
  assert.equal(primera.nuevo, true);
  assert.equal(segunda.nuevo, false);
  assert.equal(ledger.resumen().contadores.requests_nuevos, 1);
});

test('los intentos de transporte se registran bajo el mismo request lógico', () => {
  const ledger = crearLedger();
  ledger.reservarRequest({ execution_id: UUID.ejecucion, request_id: 'r1', paso: 1 });
  ledger.registrarIntentoTransporte('r1');
  ledger.registrarIntentoTransporte('r1');
  const registro = ledger.obtenerRequest('r1');
  assert.equal(registro.intento_transporte, 2);
  assert.equal(registro.estado, 'enviado');
  assert.equal(ledger.resumen().requests.total, 1, 'dos HTTP no son dos requests lógicos');
});

test('doble entrega del mismo tool_use_id devuelve el resultado registrado sin consumir cuota', () => {
  const ledger = crearLedger();
  ledger.reservarRequest({ execution_id: UUID.ejecucion, request_id: 'r1', paso: 1 });
  const primera = ledger.reclamarTool({
    execution_id: UUID.ejecucion, tarea_id: UUID.tarea, paso: 1,
    request_id: 'r1', tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' },
  });
  assert.equal(primera.nuevo, true);
  ledger.completarTool({ request_id: 'r1', tool_use_id: 'toolu_1' }, { resultado: { ok: true, data: { rfc: 'DEMO:ENTIDAD-0' } } });

  const reentrega = ledger.reclamarTool({
    execution_id: UUID.ejecucion, tarea_id: UUID.tarea, paso: 1,
    request_id: 'r1', tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' },
  });
  assert.equal(reentrega.nuevo, false);
  assert.deepEqual(reentrega.registro.resultado, { ok: true, data: { rfc: 'DEMO:ENTIDAD-0' } });
  assert.equal(ledger.resumen().contadores.tools_nuevos, 1, 'la reentrega no consume cuota');
  assert.equal(reentrega.operacion_id, primera.operacion_id, 'misma operación backend');
});

test('una invocación nueva con los mismos argumentos SÍ consume', () => {
  const ledger = crearLedger();
  ledger.reservarRequest({ execution_id: UUID.ejecucion, request_id: 'r1', paso: 1 });
  ledger.reservarRequest({ execution_id: UUID.ejecucion, request_id: 'r2', paso: 3 });
  const argumentos = { p_rfc: 'DEMO:ENTIDAD-0' };
  ledger.reclamarTool({ execution_id: UUID.ejecucion, tarea_id: UUID.tarea, paso: 1, request_id: 'r1', tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos });
  ledger.reclamarTool({ execution_id: UUID.ejecucion, tarea_id: UUID.tarea, paso: 3, request_id: 'r2', tool_use_id: 'toolu_9', nombre: 'forense_perfil', argumentos });
  assert.equal(ledger.resumen().contadores.tools_nuevos, 2);
});

test('timeout ambiguo deja estado desconocido y no se anuncia exactly-once', () => {
  const ledger = crearLedger();
  ledger.reservarRequest({ execution_id: UUID.ejecucion, request_id: 'r1', paso: 1 });
  ledger.registrarIntentoTransporte('r1');
  ledger.marcarDesconocido('r1');
  const registro = ledger.obtenerRequest('r1');
  assert.equal(registro.estado, 'desconocido');
  assert.equal(registro.ambiguo, true);
  assert.deepEqual(ledger.resumen().ambiguos, ['r1']);
  assert.equal(ledger.resumen().requests.completado, 0);
});

test('completar un request registra usage e ID del proveedor cuando existen', () => {
  const ledger = crearLedger();
  ledger.reservarRequest({ execution_id: UUID.ejecucion, request_id: 'r1', paso: 1 });
  ledger.completarRequest('r1', { provider_request_id: 'msg_sim_1', usage: { input_tokens: 10, output_tokens: 2 } });
  const registro = ledger.obtenerRequest('r1');
  assert.equal(registro.estado, 'completado');
  assert.equal(registro.provider_request_id, 'msg_sim_1');
  assert.deepEqual(registro.usage, { input_tokens: 10, output_tokens: 2 });
});

test('no se puede completar un request que no fue reservado antes del HTTP', () => {
  const ledger = crearLedger();
  assert.throws(() => ledger.completarRequest('inexistente'), /no reservado/);
});

test('uuidDeterminista produce UUID con formato válido', () => {
  const id = uuidDeterminista('x', 'y');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
