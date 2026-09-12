import test from 'node:test';
import assert from 'node:assert/strict';

import {
  transicionarEstado,
  marcarTimeout,
  reintentoManual,
  ESTADOS_TERMINALES,
} from '../../integrations/elevenlabs/estados.mjs';
import { ErrorVoz } from '../../integrations/elevenlabs/estados.mjs';

test('transicionarEstado: camino feliz pendiente → solicitando → aceptada → en_curso → finalizada', () => {
  let estado = 'pendiente';
  for (const señal of ['solicitando', 'aceptada', 'en_curso', 'finalizada']) {
    const r = transicionarEstado(estado, señal);
    assert.equal(r.cambio, true);
    estado = r.estado;
  }
  assert.equal(estado, 'finalizada');
});

test('transicionarEstado: timeout ambiguo en cualquier estado no terminal → resultado_desconocido', () => {
  for (const estado of ['pendiente', 'solicitando', 'aceptada', 'en_curso']) {
    const r = marcarTimeout(estado);
    assert.equal(r.estado, 'resultado_desconocido');
    assert.equal(r.cambio, true);
  }
});

test('transicionarEstado: un estado terminal es absorbente (sin redial automático, 16 línea 29)', () => {
  for (const terminal of ESTADOS_TERMINALES) {
    const r = transicionarEstado(terminal, 'solicitando');
    assert.equal(r.cambio, false);
    assert.equal(r.estado, terminal);
    assert.equal(r.motivo, 'estado_terminal');
  }
});

test('transicionarEstado: callback duplicado/tardío que repite el mismo destino no cambia nada y no lanza', () => {
  const primero = transicionarEstado('en_curso', 'finalizada');
  assert.equal(primero.cambio, true);
  // Un segundo callback "completed" tardío llega cuando ya estamos en finalizada.
  const segundo = transicionarEstado(primero.estado, 'finalizada');
  assert.equal(segundo.cambio, false);
  assert.equal(segundo.estado, 'finalizada');
});

test('transicionarEstado: señal no permitida desde el estado actual no cambia nada (no lanza)', () => {
  const r = transicionarEstado('pendiente', 'finalizada');
  assert.equal(r.cambio, false);
  assert.equal(r.motivo, 'transicion_no_permitida');
});

test('transicionarEstado: estado local desconocido lanza ErrorVoz', () => {
  assert.throws(() => transicionarEstado('inventado', 'aceptada'), ErrorVoz);
});

test('reintentoManual: sube el intento y vuelve a pendiente sin reescribir la fila anterior', () => {
  const llamada = { id: 'a', event_id: 'evt-1', intento: 1, estado: 'fallida', conversation_id: 'c1', aviso_entregado: false, error: null, destino_enmascarado: '*******4567' };
  const reintento = reintentoManual(llamada);
  assert.equal(reintento.intento, 2);
  assert.equal(reintento.estado, 'pendiente');
  assert.notEqual(reintento.id, llamada.id);
  assert.equal(reintento.conversation_id, null);
});

test('reintentoManual: rechaza reintentar una llamada omitida o finalizada', () => {
  assert.throws(() => reintentoManual({ id: 'a', event_id: 'e', intento: 1, estado: 'omitida' }), ErrorVoz);
  assert.throws(() => reintentoManual({ id: 'a', event_id: 'e', intento: 1, estado: 'finalizada' }), ErrorVoz);
});

test('reintentoManual: rechaza superar el máximo de 3 intentos de product.llamada', () => {
  assert.throws(() => reintentoManual({ id: 'a', event_id: 'e', intento: 3, estado: 'fallida' }), ErrorVoz);
});
