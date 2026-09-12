import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  resultadoDesdeCallback,
  estadoDesdeCallback,
  procesarCallback,
} from '../../integrations/elevenlabs/callback.mjs';
import { crearAlmacenDedupe } from '../../integrations/elevenlabs/dedupe.mjs';

const SECRETO = 'secreto_de_prueba_no_real';

function cuerpoFirmado(objeto, secreto, ahoraMs) {
  const crudo = JSON.stringify(objeto);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const hex = createHmac('sha256', secreto).update(`${tEpochS}.${crudo}`).digest('hex');
  return { rawBody: crudo, headers: { 'elevenlabs-signature': `t=${tEpochS},v0=${hex}` } };
}

test('resultadoDesdeCallback: "completed" con análisis explícito → finalizada + aviso_entregado true', () => {
  const r = resultadoDesdeCallback({ type: 'completed', analysis: { aviso_entregado: true } });
  assert.equal(r.estado, 'finalizada');
  assert.equal(r.aviso_entregado, true);
});

test('resultadoDesdeCallback: sin analysis → aviso_entregado/solicita_no_llamar/numero_equivocado son null (desconocido, no false)', () => {
  const r = resultadoDesdeCallback({ type: 'completed' });
  assert.equal(r.aviso_entregado, null);
  assert.equal(r.solicita_no_llamar, null);
  assert.equal(r.numero_equivocado, null);
});

test('resultadoDesdeCallback: aviso_entregado=true en una llamada no finalizada se descarta a null (sin evidencia real)', () => {
  const r = resultadoDesdeCallback({ type: 'ringing', analysis: { aviso_entregado: true } });
  assert.equal(r.estado, 'en_curso');
  assert.equal(r.aviso_entregado, null);
});

test('resultadoDesdeCallback: tipo no reconocido → resultado_desconocido, nunca se inventa "Sonando" (16 línea 27)', () => {
  const r = resultadoDesdeCallback({ type: 'algo_nuevo_del_proveedor' });
  assert.equal(r.estado, 'resultado_desconocido');
});

test('estadoDesdeCallback: forma reducida de compatibilidad con voz-adaptador.mjs', () => {
  const r = estadoDesdeCallback({ type: 'no_answer' });
  assert.deepEqual(r, { estado: 'sin_respuesta', aviso_entregado: null });
});

test('procesarCallback: HMAC inválido/expirado se rechaza sin tocar el estado', () => {
  const { rawBody } = cuerpoFirmado({ type: 'completed' }, SECRETO, Date.now());
  const resultado = procesarCallback({
    rawBody,
    headers: { 'elevenlabs-signature': 't=1,v0=deadbeef' },
    secreto: SECRETO,
    ahora: Date.now(),
    estadoActual: 'en_curso',
  });
  assert.equal(resultado.aceptado, false);
  assert.equal(resultado.estado, 'en_curso');
});

test('procesarCallback: callback duplicado (mismo conversation_id) no cambia el estado la segunda vez', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const { rawBody, headers } = cuerpoFirmado(
    { type: 'completed', conversation_id: 'conv-dup-1', analysis: { aviso_entregado: true } },
    SECRETO,
    ahoraMs,
  );
  const almacenDedupe = crearAlmacenDedupe();

  const primero = procesarCallback({ rawBody, headers, secreto: SECRETO, ahora: ahoraMs, estadoActual: 'en_curso', almacenDedupe });
  assert.equal(primero.aceptado, true);
  assert.equal(primero.duplicado, false);
  assert.equal(primero.estado, 'finalizada');

  // Simula que, para quien procesa, el estado persistido seguía en 'en_curso'
  // cuando llegó esta segunda entrega (duplicada) del mismo callback.
  const segundo = procesarCallback({ rawBody, headers, secreto: SECRETO, ahora: ahoraMs, estadoActual: 'en_curso', almacenDedupe });
  assert.equal(segundo.aceptado, true);
  assert.equal(segundo.duplicado, true);
  assert.equal(segundo.estado, 'en_curso'); // no se recalculó la transición: se devolvió el estado tal cual llegó
  // Discriminante real de "no se reprocesó" (no un simple eco del argumento):
  // en el camino fresco estas claves SIEMPRE están presentes (ver primero.*).
  assert.notEqual(primero.cambio_estado, undefined);
  assert.notEqual(primero.aviso_entregado, undefined);
  assert.equal(segundo.cambio_estado, undefined);
  assert.equal(segundo.aviso_entregado, undefined);
});

test('procesarCallback: timeout ambiguo del POST saliente (sin callback) → resultado_desconocido vía marcarTimeout', async () => {
  const { marcarTimeout } = await import('../../integrations/elevenlabs/estados.mjs');
  const r = marcarTimeout('solicitando');
  assert.equal(r.estado, 'resultado_desconocido');
});

test('procesarCallback: JSON inválido en el cuerpo no lanza, responde no aceptado', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const crudoRoto = '{esto no es json';
  const tEpochS = Math.floor(ahoraMs / 1000);
  const hex = createHmac('sha256', SECRETO).update(`${tEpochS}.${crudoRoto}`).digest('hex');
  const resultado = procesarCallback({
    rawBody: crudoRoto,
    headers: { 'elevenlabs-signature': `t=${tEpochS},v0=${hex}` },
    secreto: SECRETO,
    ahora: ahoraMs,
    estadoActual: 'en_curso',
  });
  assert.equal(resultado.aceptado, false);
  assert.equal(resultado.motivo, 'json_invalido');
});

test('procesarCallback: solicita_no_llamar solo se marca con respaldo explícito del análisis', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const { rawBody, headers } = cuerpoFirmado(
    { type: 'completed', conversation_id: 'conv-2', analysis: { solicita_no_llamar: true } },
    SECRETO,
    ahoraMs,
  );
  const resultado = procesarCallback({ rawBody, headers, secreto: SECRETO, ahora: ahoraMs, estadoActual: 'en_curso' });
  assert.equal(resultado.solicita_no_llamar, true);
  assert.equal(resultado.aviso_entregado, null);
});
