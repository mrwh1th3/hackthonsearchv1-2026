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

test('verificarFirma: forma objeto con secreto por nombre ({crudo, firma, secreto, ahora_ms}) es la forma canónica (hallazgo QA #3)', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const firma = firmar(CUERPO, SECRETO, tEpochS);
  const resultado = verificarFirma({ crudo: CUERPO, firma, secreto: SECRETO, ahora_ms: ahoraMs });
  assert.equal(resultado.valido, true);
});

test('verificarFirma: forma objeto con secreto por nombre y tolerancia_s propia respeta esa ventana', () => {
  const tEpochS = Math.floor(Date.UTC(2026, 0, 31, 12, 0, 0) / 1000);
  const firma = firmar(CUERPO, SECRETO, tEpochS);
  const ahoraMsFueraDeVentanaCorta = (tEpochS + 30) * 1000;
  const resultado = verificarFirma({ crudo: CUERPO, firma, secreto: SECRETO, ahora_ms: ahoraMsFueraDeVentanaCorta, tolerancia_s: 10 });
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'fuera_de_ventana');
});

test('verificarFirma: forma objeto SIN secreto nombrado cae al secreto posicional (compatibilidad transicional, no la forma canónica)', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const firma = firmar(CUERPO, SECRETO, tEpochS);
  const resultado = verificarFirma({ crudo: CUERPO, firma, ahora_ms: ahoraMs }, undefined, SECRETO);
  assert.equal(resultado.valido, true);
});

// Hallazgo QA #5: el default (t=/v0=, HMAC-SHA256 sobre "<ts>.<crudo>") está
// confirmado contra la documentación pública de ElevenLabs — estos dos tests
// prueban que sigue siendo posible configurar un esquema DISTINTO vía
// `opciones` sin tocar el resto del módulo, para una cuenta/entorno que use
// un header o formato propio (alternativa configurable, no cableada).
test('verificarFirma: esquema alternativo configurable (header y prefijos propios) funciona vía `opciones`', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const opcionesAlternativas = {
    header: 'x-legado-signature',
    prefijoTimestamp: 'ts=',
    prefijoFirma: 'sha256=',
    separador: ';',
    construirMensaje: (t, crudo) => `${crudo}:${t}`,
  };
  const mensaje = opcionesAlternativas.construirMensaje(tEpochS, CUERPO);
  const hex = createHmac('sha256', SECRETO).update(mensaje).digest('hex');
  const encabezado = `ts=${tEpochS};sha256=${hex}`;

  const resultado = verificarFirma(CUERPO, { 'X-Legado-Signature': encabezado }, SECRETO, ahoraMs, opcionesAlternativas);
  assert.equal(resultado.valido, true);
});

test('verificarFirma: el esquema por default NO valida una firma construida con el esquema alternativo (no se mezclan)', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const mensajeAlternativo = `${CUERPO}:${tEpochS}`; // formato del esquema alternativo, no el default
  const hex = createHmac('sha256', SECRETO).update(mensajeAlternativo).digest('hex');
  const resultado = verificarFirma(CUERPO, { 'elevenlabs-signature': `t=${tEpochS},v0=${hex}` }, SECRETO, ahoraMs);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'firma_invalida');
});

test('verificarFirma: v0 no hexadecimal no lanza (longitud distinta → firma_invalida)', () => {
  const ahoraMs = Date.UTC(2026, 0, 31, 12, 0, 0);
  const tEpochS = Math.floor(ahoraMs / 1000);
  const resultado = verificarFirma(CUERPO, { 'elevenlabs-signature': `t=${tEpochS},v0=no-es-hex` }, SECRETO, ahoraMs);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.motivo, 'firma_invalida');
});
