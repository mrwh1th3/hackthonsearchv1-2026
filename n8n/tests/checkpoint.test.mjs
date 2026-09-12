// n8n/tests/checkpoint.test.mjs — máquina, CAS y fencing (17 §3, §4). SIMULADO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContract } from '../../contracts/index.mjs';
import {
  ESTADOS, TRANSICIONES, aDTO, avanzar, crearAlmacenCheckpoints, esTerminal,
  fenceVigente, nuevoEstadoInterno, siguiente,
} from '../runtime/checkpoint.mjs';
import { UUID, HASH, DEADLINE, AHORA } from './_ayudas.mjs';

function internoBase(overrides = {}) {
  return nuevoEstadoInterno({
    execution_id: UUID.ejecucion, caso_id: UUID.caso, tarea_id: UUID.tarea, rol: 'documental',
    context_hash: HASH, prompt_hash: HASH, deadline_at: DEADLINE, ...overrides,
  });
}

test('el camino feliz recorre la secuencia de 17 §3', () => {
  let estado = 'preparar_contexto';
  const camino = [estado];
  for (const evento of ['contexto_listo', 'tool_use', 'resultados_listos', 'end_turn', 'valida']) {
    estado = siguiente(estado, evento);
    camino.push(estado);
  }
  assert.deepEqual(camino, [
    'preparar_contexto', 'solicitar_modelo', 'ejecutar_herramienta',
    'solicitar_modelo', 'validar_salida', 'terminado',
  ]);
  assert.equal(esTerminal(estado), true);
});

test('reparar_json, espera_reintento, error y timeout son ramas explícitas', () => {
  assert.equal(siguiente('validar_salida', 'invalida'), 'reparar_json');
  assert.equal(siguiente('reparar_json', 'reparacion_preparada'), 'solicitar_modelo');
  assert.equal(siguiente('solicitar_modelo', 'max_tokens'), 'reparar_json');
  assert.equal(siguiente('solicitar_modelo', 'refusal'), 'error');
  assert.equal(siguiente('solicitar_modelo', 'reintentable'), 'espera_reintento');
  assert.equal(siguiente('espera_reintento', 'agotado'), 'error');
  assert.equal(siguiente('solicitar_modelo', 'deadline'), 'timeout');
  for (const estado of ESTADOS) assert.ok(TRANSICIONES[estado], `falta ${estado}`);
});

test('una transición inventada lanza en vez de inventar estado', () => {
  assert.throws(() => siguiente('terminado', 'end_turn'), /transición inválida/);
  assert.throws(() => siguiente('preparar_contexto', 'tool_use'), /transición inválida/);
});

test('la proyección al contrato runtime.checkpoint tiene 10 campos exactos y valida', () => {
  const interno = internoBase();
  const dto = aDTO(interno);
  assert.equal(Object.keys(dto).length, 10);
  const r = validateContract('runtime.checkpoint', dto);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  // Los contadores internos NO viajan en el DTO (additionalProperties:false).
  assert.equal(dto.reparaciones_json, undefined);
  assert.equal(interno.reparaciones_json, 0);
});

test('avanzar incrementa el paso y conserva el estado privado', () => {
  const interno = internoBase();
  interno.mensajes = [{ role: 'user', content: [] }];
  const siguienteInterno = avanzar(interno, 'contexto_listo');
  assert.equal(siguienteInterno.estado_interno, 'solicitar_modelo');
  assert.equal(siguienteInterno.paso, interno.paso + 1);
  assert.equal(siguienteInterno.mensajes.length, 1);
});

test('fencing: los tokens son BIGINT, no cadenas léxicas', () => {
  assert.equal(fenceVigente('10', '9'), true, '"10" > "9" aunque lexicográficamente sea menor');
  assert.equal(fenceVigente('9', '10'), false);
  assert.equal(fenceVigente('2', '2'), true);
});

test('CAS: dos callbacks con la misma revisión no guardan dos veces', () => {
  const almacen = crearAlmacenCheckpoints();
  const claim = almacen.reclamar({ caso_id: UUID.caso, paso: 0, owner: 'ejecucion-A', ahora: AHORA });
  assert.equal(claim.ok, true);
  const interno = internoBase({ fencing_token: claim.fencing_token, revision: claim.revision });
  const primera = almacen.guardar({
    caso_id: UUID.caso, paso: 0, fencing_token: claim.fencing_token,
    revision_esperada: 1, checkpoint: aDTO(interno), ahora: AHORA,
  });
  assert.equal(primera.ok, true);
  assert.equal(primera.revision, 2);
  const segunda = almacen.guardar({
    caso_id: UUID.caso, paso: 0, fencing_token: claim.fencing_token,
    revision_esperada: 1, checkpoint: aDTO(interno), ahora: AHORA,
  });
  assert.equal(segunda.ok, false);
  assert.equal(segunda.error.codigo, 'conflicto_cas');
  assert.equal(segunda.revision_actual, 2);
});

test('un dueño con lease vencido no puede guardar: fence viejo rechazado', () => {
  const almacen = crearAlmacenCheckpoints({ lease_ms: 90_000 });
  const viejo = almacen.reclamar({ caso_id: UUID.caso, paso: 0, owner: 'ejecucion-vieja', ahora: AHORA });
  assert.equal(viejo.fencing_token, '1');
  const nuevo = almacen.reclamar({ caso_id: UUID.caso, paso: 0, owner: 'ejecucion-nueva', ahora: AHORA + 100_000 });
  assert.equal(nuevo.ok, true);
  assert.equal(nuevo.reasignado, true);
  assert.equal(nuevo.fencing_token, '2');
  const intento = almacen.guardar({
    caso_id: UUID.caso, paso: 0, fencing_token: viejo.fencing_token,
    revision_esperada: 1, checkpoint: aDTO(internoBase()), ahora: AHORA + 100_001,
  });
  assert.equal(intento.ok, false);
  assert.equal(intento.error.codigo, 'fence_vencido');
  const conNuevo = almacen.guardar({
    caso_id: UUID.caso, paso: 0, fencing_token: nuevo.fencing_token,
    revision_esperada: 1, checkpoint: aDTO(internoBase()), ahora: AHORA + 100_002,
  });
  assert.equal(conNuevo.ok, true);
});

test('el slot ocupado con lease vigente no se reasigna', () => {
  const almacen = crearAlmacenCheckpoints({ lease_ms: 90_000 });
  almacen.reclamar({ caso_id: UUID.caso, paso: 0, owner: 'A', ahora: AHORA });
  const b = almacen.reclamar({ caso_id: UUID.caso, paso: 0, owner: 'B', ahora: AHORA + 1000 });
  assert.equal(b.ok, false);
  assert.equal(b.error.codigo, 'slot_ocupado');
});

test('recover_expired lista los leases vencidos para el reconciliador', () => {
  const almacen = crearAlmacenCheckpoints({ lease_ms: 1000 });
  almacen.reclamar({ caso_id: UUID.caso, paso: 0, owner: 'A', ahora: AHORA });
  assert.equal(almacen.expirados(AHORA + 500).length, 0);
  const vencidos = almacen.expirados(AHORA + 2000);
  assert.equal(vencidos.length, 1);
  assert.equal(vencidos[0].owner, 'A');
});

test('guardar sin claim previo se rechaza', () => {
  const almacen = crearAlmacenCheckpoints();
  const r = almacen.guardar({ caso_id: UUID.caso, paso: 7, fencing_token: '1', revision_esperada: 1, checkpoint: aDTO(internoBase()) });
  assert.equal(r.ok, false);
  assert.equal(r.error.codigo, 'slot_inexistente');
});
