import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  adaptarCuerpoProveedor,
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

// --- Formato real documentado por ElevenLabs (hallazgo QA #2):
// {type:'post_call_transcription'|'post_call_audio', data:{conversation_id, agent_id, status, analysis, metadata}}.

test('adaptarCuerpoProveedor: post_call_transcription con data.status="done" → finalizada, campos leídos de data.*', () => {
  const cuerpo = {
    type: 'post_call_transcription',
    data: {
      conversation_id: 'conv-pc-1',
      agent_id: 'agent_x',
      status: 'done',
      analysis: { aviso_entregado: true },
      metadata: { call_duration_secs: 24 },
    },
  };
  const normalizado = adaptarCuerpoProveedor(cuerpo);
  assert.equal(normalizado.formato, 'post_call');
  assert.equal(normalizado.estado, 'finalizada');
  assert.equal(normalizado.conversation_id, 'conv-pc-1');

  const resultado = resultadoDesdeCallback(cuerpo);
  assert.equal(resultado.estado, 'finalizada');
  assert.equal(resultado.aviso_entregado, true);
  assert.equal(resultado.conversation_id, 'conv-pc-1');
});

test('adaptarCuerpoProveedor: post_call_audio (variante de audio) se reconoce igual que post_call_transcription', () => {
  const cuerpo = {
    type: 'post_call_audio',
    data: { conversation_id: 'conv-pc-2', status: 'done', analysis: {} },
  };
  const normalizado = adaptarCuerpoProveedor(cuerpo);
  assert.equal(normalizado.formato, 'post_call');
  assert.equal(normalizado.estado, 'finalizada');
});

test('adaptarCuerpoProveedor: post_call con data.status desconocido → resultado_desconocido, NUNCA finalizada por default (regla 4)', () => {
  const cuerpo = {
    type: 'post_call_transcription',
    data: { conversation_id: 'conv-pc-3', status: 'un_valor_nuevo_del_proveedor', analysis: { aviso_entregado: true } },
  };
  const resultado = resultadoDesdeCallback(cuerpo);
  assert.equal(resultado.estado, 'resultado_desconocido');
  // aviso_entregado no puede quedar en true sobre un estado que no es 'finalizada',
  // sin importar lo que diga el análisis: no hay evidencia real de entrega.
  assert.equal(resultado.aviso_entregado, null);
});

test('adaptarCuerpoProveedor: post_call sin status → resultado_desconocido (ausencia no es éxito)', () => {
  const cuerpo = { type: 'post_call_transcription', data: { conversation_id: 'conv-pc-4' } };
  assert.equal(resultadoDesdeCallback(cuerpo).estado, 'resultado_desconocido');
});

test('adaptarCuerpoProveedor: formato plano (heredado) sigue funcionando igual que antes', () => {
  const normalizado = adaptarCuerpoProveedor({ type: 'completed', conversation_id: 'conv-plano-1' });
  assert.equal(normalizado.formato, 'plano');
  assert.equal(normalizado.estado, 'finalizada');
});

test('procesarCallback: pipeline completo con formato post_call_transcription real (firma → dedupe → estado)', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const { rawBody, headers } = cuerpoFirmado(
    {
      type: 'post_call_transcription',
      data: { conversation_id: 'conv-pc-5', status: 'done', analysis: { aviso_entregado: true } },
    },
    SECRETO,
    ahoraMs,
  );
  const resultado = procesarCallback({ rawBody, headers, secreto: SECRETO, ahora: ahoraMs, estadoActual: 'en_curso' });
  assert.equal(resultado.aceptado, true);
  assert.equal(resultado.estado, 'finalizada');
  assert.equal(resultado.aviso_entregado, true);
  assert.equal(resultado.conversation_id, 'conv-pc-5');
});

test('procesarCallback + dedupe: post_call_transcription y post_call_audio de la MISMA llamada no se descartan entre sí', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const almacenDedupe = crearAlmacenDedupe();
  const transcripcion = cuerpoFirmado(
    { type: 'post_call_transcription', data: { conversation_id: 'conv-pc-6', status: 'done', analysis: {} } },
    SECRETO,
    ahoraMs,
  );
  const audio = cuerpoFirmado(
    { type: 'post_call_audio', data: { conversation_id: 'conv-pc-6', status: 'done', analysis: {} } },
    SECRETO,
    ahoraMs,
  );
  const r1 = procesarCallback({ ...transcripcion, secreto: SECRETO, ahora: ahoraMs, estadoActual: 'en_curso', almacenDedupe });
  const r2 = procesarCallback({ ...audio, secreto: SECRETO, ahora: ahoraMs, estadoActual: 'en_curso', almacenDedupe });
  assert.equal(r1.duplicado, false);
  assert.equal(r2.duplicado, false, 'post_call_audio no debe leerse como duplicado de post_call_transcription');
});

test('procesarCallback + dedupe: dos ENTREGAS repetidas del mismo post_call_transcription sí son duplicado', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const almacenDedupe = crearAlmacenDedupe();
  const { rawBody, headers } = cuerpoFirmado(
    { type: 'post_call_transcription', data: { conversation_id: 'conv-pc-7', status: 'done', analysis: {} } },
    SECRETO,
    ahoraMs,
  );
  const primero = procesarCallback({ rawBody, headers, secreto: SECRETO, ahora: ahoraMs, estadoActual: 'en_curso', almacenDedupe });
  const segundo = procesarCallback({ rawBody, headers, secreto: SECRETO, ahora: ahoraMs, estadoActual: 'en_curso', almacenDedupe });
  assert.equal(primero.duplicado, false);
  assert.equal(segundo.duplicado, true);
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
