import test from 'node:test';
import assert from 'node:assert/strict';

import * as ElevenLabs from '../../integrations/elevenlabs/index.mjs';

// Paridad de nombres con n8n/runtime/voz-adaptador.mjs (README, tabla de compatibilidad):
// cualquier import que hoy apunte al stub debe encontrar el mismo vocabulario aquí.
const EXPORTS_ESPERADOS = [
  'ENDPOINT_LLAMADA', 'RUTA_CALLBACK', 'TOLERANCIA_FIRMA_S',
  'ESTADOS_LLAMADA', 'VARIABLES_PERMITIDAS', 'ErrorVoz',
  'construirPayload', 'verificarFirma', 'estadoDesdeCallback',
  'resultadoDesdeCallback', 'procesarCallback',
  'transicionarEstado', 'marcarTimeout', 'reintentoManual',
  'crearAlmacenDedupe', 'reservarSolicitud', 'liberarParaReintentoManual', 'registrarCallback',
];

test('index.mjs re-exporta todo el vocabulario esperado por el runtime', () => {
  for (const nombre of EXPORTS_ESPERADOS) {
    assert.notEqual(ElevenLabs[nombre], undefined, `falta el export "${nombre}"`);
  }
});

test('index.mjs: ESTADOS_LLAMADA coincide exactamente con n8n/runtime/voz-adaptador.mjs', () => {
  assert.deepEqual(ElevenLabs.ESTADOS_LLAMADA, [
    'pendiente', 'solicitando', 'aceptada', 'en_curso', 'finalizada',
    'fallida', 'sin_respuesta', 'omitida', 'resultado_desconocido',
  ]);
});

test('index.mjs: ENDPOINT_LLAMADA y RUTA_CALLBACK coinciden con el stub', () => {
  assert.equal(ElevenLabs.ENDPOINT_LLAMADA, 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call');
  assert.equal(ElevenLabs.RUTA_CALLBACK, '/webhook/forense/elevenlabs-resultado');
  assert.equal(ElevenLabs.TOLERANCIA_FIRMA_S, 300);
});
