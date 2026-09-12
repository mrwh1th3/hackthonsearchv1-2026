import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateContract } from '../../contracts/index.mjs';
import { construirPayload, VARIABLES_PERMITIDAS, enmascararTelefono } from '../../integrations/elevenlabs/payload.mjs';
import { ErrorVoz } from '../../integrations/elevenlabs/estados.mjs';
import { crearAlmacenDedupe, reservarSolicitud } from '../../integrations/elevenlabs/dedupe.mjs';

const aquí = path.dirname(fileURLToPath(import.meta.url));
const raíz = path.resolve(aquí, '../..');
const leerFixture = (relativo) => JSON.parse(fs.readFileSync(path.join(raíz, 'contracts/fixtures', relativo), 'utf8'));

const eventoCompleta = leerFixture('valid/evento-completa.json');
const perfilSinTelefono = leerFixture('valid/perfil.json');
const llamadaOmitidaEsperada = leerFixture('valid/llamada.json');
const eventoConTelefonoInyectado = leerFixture('invalid/evento-con-telefono.json');
const perfilSinConsentimiento = leerFixture('invalid/llamada-sin-consentimiento.json'); // es un perfil, ver README

const CONFIG_VALIDA = Object.freeze({ agent_id: 'agent_demo', agent_phone_number_id: 'phone_demo' });

function perfilValido(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000900',
    nombre: 'Auditor Demo',
    organizacion: 'Escenario sintético',
    timezone: 'America/Monterrey',
    telefono_e164: '+528111234567',
    llamadas_activadas: true,
    consentimiento_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('construirPayload: caso enviable valida como contracts product.llamada y product.perfil de entrada es válido', () => {
  const perfil = perfilValido();
  assert.equal(validateContract('product.perfil', perfil).ok, true);

  const resultado = construirPayload(eventoCompleta, perfil, CONFIG_VALIDA);
  assert.equal(resultado.omitida, false);
  assert.equal(resultado.cuerpo.to_number, perfil.telefono_e164);
  assert.equal(resultado.cuerpo.agent_id, CONFIG_VALIDA.agent_id);

  const validacion = validateContract('product.llamada', resultado.llamada);
  assert.equal(validacion.ok, true, JSON.stringify(validacion.errors));
  assert.equal(resultado.llamada.estado, 'pendiente');
  assert.match(resultado.llamada.destino_enmascarado, /^\*{4,}[0-9]{0,4}$/);
});

test('construirPayload: las únicas dynamic_variables son exactamente VARIABLES_PERMITIDAS', () => {
  const resultado = construirPayload(eventoCompleta, perfilValido(), CONFIG_VALIDA);
  const claves = Object.keys(resultado.cuerpo.conversation_initiation_client_data.dynamic_variables);
  assert.deepEqual(claves.sort(), [...VARIABLES_PERMITIDAS].sort());
});

test('construirPayload: nombre_usuario truncado a 60, ningún campo fiscal en el body', () => {
  const perfil = perfilValido({ nombre: 'N'.repeat(200) });
  const resultado = construirPayload(eventoCompleta, perfil, CONFIG_VALIDA);
  const variables = resultado.cuerpo.conversation_initiation_client_data.dynamic_variables;
  assert.equal(variables.nombre_usuario.length, 60);

  const crudo = JSON.stringify(resultado.cuerpo);
  for (const prohibido of ['rfc', 'monto', 'cfdi', 'nivel']) {
    assert.equal(crudo.toLowerCase().includes(prohibido), false, `el body no debe mencionar "${prohibido}"`);
  }
});

test('construirPayload: sin teléfono en el perfil → omitida, igual a la fixture valid/llamada.json', () => {
  const resultado = construirPayload(eventoCompleta, perfilSinTelefono, CONFIG_VALIDA);
  assert.equal(resultado.omitida, true);
  assert.equal(resultado.motivo, 'sin_telefono');
  assert.equal(resultado.cuerpo, null);

  const { id: _ignorada, ...restoObtenido } = resultado.llamada;
  const { id: _ignoradaEsperada, ...restoEsperado } = llamadaOmitidaEsperada;
  assert.deepEqual(restoObtenido, restoEsperado);
  assert.equal(validateContract('product.llamada', resultado.llamada).ok, true);
});

test('construirPayload: un evento con "telefono" inyectado se ignora; el número nunca sale del perfil (16 línea 128)', () => {
  // El propio fixture es inválido contra el contrato (additionalProperties:false) —
  // documenta que ese campo no debería llegar nunca, y aun si llegara, no se usa.
  assert.equal(validateContract('product.evento_completa', eventoConTelefonoInyectado).ok, false);

  const resultado = construirPayload(eventoConTelefonoInyectado, perfilSinTelefono, CONFIG_VALIDA);
  assert.equal(resultado.omitida, true);
  assert.equal(resultado.motivo, 'sin_telefono');
  assert.equal(JSON.stringify(resultado).includes('+10000000000'), false);
});

test('construirPayload: perfil con llamadas_activadas=true pero sin teléfono/consentimiento es inválido y se omite', () => {
  // fixtures/invalid/llamada-sin-consentimiento.json es, pese al nombre del archivo,
  // la forma de un `perfil` que viola el allOf de contracts product.perfil.
  assert.equal(validateContract('product.perfil', perfilSinConsentimiento).ok, false);

  const resultado = construirPayload(eventoCompleta, perfilSinConsentimiento, CONFIG_VALIDA);
  assert.equal(resultado.omitida, true);
  // Orden determinista: teléfono se comprueba antes que preferencia/consentimiento.
  assert.equal(resultado.motivo, 'sin_telefono');
});

test('construirPayload: llamadas_activadas=false → omitida con motivo específico', () => {
  const resultado = construirPayload(eventoCompleta, perfilValido({ llamadas_activadas: false }), CONFIG_VALIDA);
  assert.equal(resultado.omitida, true);
  assert.equal(resultado.motivo, 'llamadas_desactivadas');
});

test('construirPayload: sin consentimiento_at → omitida con motivo específico', () => {
  const resultado = construirPayload(eventoCompleta, perfilValido({ consentimiento_at: null }), CONFIG_VALIDA);
  assert.equal(resultado.omitida, true);
  assert.equal(resultado.motivo, 'sin_consentimiento');
});

test('construirPayload: configuración de agente incompleta → omitida, no revienta', () => {
  const resultado = construirPayload(eventoCompleta, perfilValido(), { agent_id: null, agent_phone_number_id: 'phone_demo' });
  assert.equal(resultado.omitida, true);
  assert.equal(resultado.motivo, 'configuracion_incompleta');
});

test('construirPayload: una variable con forma de RFC lanza ErrorVoz en vez de enviarse', () => {
  const perfil = perfilValido({ nombre: 'AAA010101AAA contribuyente' });
  assert.throws(() => construirPayload(eventoCompleta, perfil, CONFIG_VALIDA), ErrorVoz);
});

test('construirPayload: un event_id con forma de UUID que por coincidencia contiene un segmento con forma de RFC NO lanza (hallazgo QA #4)', () => {
  // "abc010101def" (3 letras + 6 dígitos + 3 alfanuméricos) es, por sí solo,
  // indistinguible de un RFC — pero aquí vive dentro de un UUID válido, que
  // es completion_event_id (identificador opaco de sistema, no dato fiscal).
  const eventoConUuidRfcLike = { ...eventoCompleta, event_id: '00000000-0000-4000-8000-abc010101def' };
  const resultado = construirPayload(eventoConUuidRfcLike, perfilValido(), CONFIG_VALIDA);
  assert.equal(resultado.omitida, false);
  assert.equal(
    resultado.cuerpo.conversation_initiation_client_data.dynamic_variables.completion_event_id,
    '00000000-0000-4000-8000-abc010101def',
  );
});

test('reservarSolicitud + construirPayload: cinco entregas del mismo evento producen un único cuerpo enviable (16 línea 124)', () => {
  const almacen = crearAlmacenDedupe();
  const cuerposEnviados = [];
  for (let i = 0; i < 5; i += 1) {
    const reserva = reservarSolicitud(almacen, { event_id: eventoCompleta.event_id });
    if (!reserva.reservado) continue; // exactamente lo que hace el runtime: no construye ni envía de nuevo
    const resultado = construirPayload(eventoCompleta, perfilValido(), CONFIG_VALIDA);
    if (!resultado.omitida) cuerposEnviados.push(resultado.cuerpo);
  }
  assert.equal(cuerposEnviados.length, 1);
});

test('enmascararTelefono: siempre al menos 4 asteriscos y últimos 4 dígitos visibles', () => {
  assert.match(enmascararTelefono('+528111234567'), /^\*{4,}[0-9]{0,4}$/);
  assert.equal(enmascararTelefono('+528111234567').endsWith('4567'), true);
});
