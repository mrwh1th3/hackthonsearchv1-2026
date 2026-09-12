import test from 'node:test';
import assert from 'node:assert/strict';

import {
  crearAlmacenDedupe,
  reservarSolicitud,
  liberarParaReintentoManual,
  registrarCallback,
} from '../../integrations/elevenlabs/dedupe.mjs';
import { ErrorVoz } from '../../integrations/elevenlabs/estados.mjs';

test('reservarSolicitud: cinco entregas repetidas del mismo evento producen una sola reserva (16 línea 124)', () => {
  const almacen = crearAlmacenDedupe();
  const eventId = 'evt-801';
  const resultados = Array.from({ length: 5 }, () => reservarSolicitud(almacen, { event_id: eventId }));
  const reservadas = resultados.filter((r) => r.reservado === true);
  assert.equal(reservadas.length, 1);
  assert.equal(resultados[0].reservado, true);
  for (const rechazo of resultados.slice(1)) {
    assert.equal(rechazo.reservado, false);
    assert.equal(rechazo.motivo, 'evento_ya_solicitado');
  }
});

test('reservarSolicitud: eventos distintos reservan independientemente', () => {
  const almacen = crearAlmacenDedupe();
  assert.equal(reservarSolicitud(almacen, { event_id: 'evt-A' }).reservado, true);
  assert.equal(reservarSolicitud(almacen, { event_id: 'evt-B' }).reservado, true);
});

test('reservarSolicitud: sin event_id lanza ErrorVoz', () => {
  const almacen = crearAlmacenDedupe();
  assert.throws(() => reservarSolicitud(almacen, {}), ErrorVoz);
});

test('liberarParaReintentoManual: permite una nueva reserva solo tras liberar explícitamente (16 línea 29)', () => {
  const almacen = crearAlmacenDedupe();
  reservarSolicitud(almacen, { event_id: 'evt-801' });
  assert.equal(reservarSolicitud(almacen, { event_id: 'evt-801' }).reservado, false);

  liberarParaReintentoManual(almacen, { event_id: 'evt-801' });
  assert.equal(reservarSolicitud(almacen, { event_id: 'evt-801' }).reservado, true);
});

test('registrarCallback: correlaciona por conversation_id; un segundo callback con el mismo conversation_id es duplicado', () => {
  const almacen = crearAlmacenDedupe();
  const primero = registrarCallback(almacen, { event_id: 'evt-1', conversation_id: 'conv-1', call_sid: null });
  assert.equal(primero.nuevo, true);
  const segundo = registrarCallback(almacen, { event_id: 'evt-1', conversation_id: 'conv-1', call_sid: null });
  assert.equal(segundo.nuevo, false);
  assert.equal(segundo.motivo, 'callback_duplicado');
});

test('registrarCallback: correlaciona por call_sid cuando no hay conversation_id', () => {
  const almacen = crearAlmacenDedupe();
  const primero = registrarCallback(almacen, { event_id: 'evt-1', conversation_id: null, call_sid: 'CA123' });
  assert.equal(primero.nuevo, true);
  const segundo = registrarCallback(almacen, { event_id: 'evt-1', conversation_id: null, call_sid: 'CA123' });
  assert.equal(segundo.nuevo, false);
});

test('registrarCallback: sin conversation_id ni call_sid cae a event_id', () => {
  const almacen = crearAlmacenDedupe();
  const primero = registrarCallback(almacen, { event_id: 'evt-1', conversation_id: null, call_sid: null });
  assert.equal(primero.nuevo, true);
  const segundo = registrarCallback(almacen, { event_id: 'evt-1', conversation_id: null, call_sid: null });
  assert.equal(segundo.nuevo, false);
});

test('registrarCallback: sin ninguna identidad lanza ErrorVoz', () => {
  const almacen = crearAlmacenDedupe();
  assert.throws(() => registrarCallback(almacen, {}), ErrorVoz);
});
