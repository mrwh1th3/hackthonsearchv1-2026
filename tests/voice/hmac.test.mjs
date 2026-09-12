import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { verificarFirma, TOLERANCIA_FIRMA_S } from '../../integrations/elevenlabs/hmac.mjs';

const SECRETO = 'secreto_de_prueba_no_real';
const CUERPO = JSON.stringify({ type: 'completed', conversation_id: 'conv_1', analysis: { aviso_entregado: true } });

function firmar(cuerpo, secreto, tEpochS) {
  const mensaje = `${tEpochS}.${cuerpo}`;
  const hex = createHmac('sha256', secreto).update(mensaje).digest('hex');
  return `t=${tEpochS},v0=${hex}`;
}

test('verificarFirma: firma válida dentro de la ventana → válido', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const firma = firmar(CUERPO, SECRETO, tEpochS);
  const resultado = verificarFirma(CUERPO, { 'ElevenLabs-Signature': firma }, SECRETO, ahoraMs);
  assert.equal(resultado.valido, true);
});

test('verificarFirma: header en minúsculas también funciona (case-insensitive)', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const firma = firmar(CUERPO, SECRETO, tEpochS);
  const resultado = verificarFirma(CUERPO, { 'elevenlabs-signature': firma }, SECRETO, ahoraMs);
  assert.equal(resultado.valido, true);
});

test('verificarFirma: HMAC inválido (secreto incorrecto) rechazado', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const firma = firmar(CUERPO, 'otro_secreto', tEpochS);
  const resultado = verificarFirma(CUERPO, { 'elevenlabs-signature': firma }, SECRETO, ahoraMs);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'firma_invalida');
});

test('verificarFirma: firma expirada (fuera de la ventana de tolerancia) rechazada', () => {
  const tEpochS = Math.floor(Date.UTC(2026, 0, 31, 12, 0, 0) / 1000);
  const firma = firmar(CUERPO, SECRETO, tEpochS);
  const ahoraMsMuchoDespues = (tEpochS + TOLERANCIA_FIRMA_S + 60) * 1000;
  const resultado = verificarFirma(CUERPO, { 'elevenlabs-signature': firma }, SECRETO, ahoraMsMuchoDespues);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'fuera_de_ventana');
});

test('verificarFirma: cuerpo reserializado (no crudo) no coincide con la firma original', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const firma = firmar(CUERPO, SECRETO, tEpochS);
  const cuerpoReserializado = JSON.stringify(JSON.parse(CUERPO), null, 2); // mismos datos, bytes distintos
  const resultado = verificarFirma(cuerpoReserializado, { 'elevenlabs-signature': firma }, SECRETO, ahoraMs);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'firma_invalida');
});

test('verificarFirma: sin header de firma → sin_firma', () => {
  const resultado = verificarFirma(CUERPO, {}, SECRETO, Date.now());
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'sin_firma');
});

test('verificarFirma: header malformado (sin v0) → firma_malformada', () => {
  const resultado = verificarFirma(CUERPO, { 'elevenlabs-signature': 't=123456' }, SECRETO, Date.now());
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'firma_malformada');
});

test('verificarFirma: cuerpo no crudo (objeto en vez de string) rechazado sin lanzar', () => {
  const resultado = verificarFirma({ type: 'completed' }, {}, SECRETO, Date.now());
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'cuerpo_no_crudo');
});

test('verificarFirma: forma objeto de voz-adaptador.mjs ({crudo, firma, ahora_ms}) es compatible', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const firma = firmar(CUERPO, SECRETO, tEpochS);
  const resultado = verificarFirma({ crudo: CUERPO, firma, ahora_ms: ahoraMs }, undefined, SECRETO);
  assert.equal(resultado.valido, true);
});

test('verificarFirma: v0 no hexadecimal no lanza (longitud distinta → firma_invalida)', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const resultado = verificarFirma(CUERPO, { 'elevenlabs-signature': `t=${tEpochS},v0=no-es-hex` }, SECRETO, ahoraMs);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'firma_invalida');
});
