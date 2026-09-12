// n8n/tests/voz.test.mjs — el runtime CONSUME integrations/elevenlabs (16).
//
// Hasta H7 esto probaba un stub propio del runtime (`construirLlamada`,
// `verificarFirma` que siempre decía que no). forense-voice entregó el módulo
// real en la oleada 2b y `tests/voice/*.test.mjs` (dueño: forense-voice) ya
// prueba payload, HMAC, estados, dedupe y callback. Aquí queda SÓLO lo que es
// del runtime y nadie más comprueba:
//
//   1. `n8n/runtime/voz-adaptador.mjs` apunta al módulo real, no a un stub.
//   2. La forma POSICIONAL de `verificarFirma` es la que usa el Code node.
//   3. El JSON exportado lleva el verificador REAL embebido, no el stub, y no
//      acepta un callback sin verificar.
//   4. El endpoint del workflow es el del módulo, no una URL copiada a mano.
//
// Sigue sin haber llamada, credencial ni número: la cuenta ElevenLabs tiene
// cero números salientes (21 §5).

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  verificarFirma, estadoDesdeCallback, construirPayload,
  ENDPOINT_LLAMADA, TOLERANCIA_FIRMA_S, ESTADOS_LLAMADA, VARIABLES_PERMITIDAS, ErrorVoz,
} from '../runtime/voz-adaptador.mjs';

const RAIZ_N8N = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wf = (nombre) => JSON.parse(
  fs.readFileSync(path.join(RAIZ_N8N, 'workflows', `${nombre}.json`), 'utf8'));
const nodo = (nombre, n) => wf(nombre).nodes.find((x) => x.name === n);

test('voz-adaptador re-exporta el módulo real de forense-voice, no un stub', () => {
  // Si alguien reinstalara el stub, estas funciones volverían a no existir.
  for (const f of [verificarFirma, estadoDesdeCallback, construirPayload]) {
    assert.equal(typeof f, 'function');
  }
  assert.equal(ENDPOINT_LLAMADA, 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call');
  assert.equal(TOLERANCIA_FIRMA_S, 300);
  assert.ok(ESTADOS_LLAMADA.includes('finalizada'));
  assert.ok(VARIABLES_PERMITIDAS.length > 0);
  assert.equal(typeof ErrorVoz, 'function');
});

test('verificarFirma en forma POSICIONAL: acepta la firma buena y sólo esa', () => {
  const secreto = 'secreto-de-prueba';
  const crudo = '{"type":"post_call_transcription","conversation_id":"c1"}';
  const t = 1_757_640_000;
  const v0 = createHmac('sha256', secreto).update(`${t}.${crudo}`).digest('hex');
  const headers = { 'elevenlabs-signature': `t=${t},v0=${v0}` };
  const ahora = t * 1000;

  const ok = verificarFirma(crudo, headers, secreto, ahora, {});
  assert.equal(ok.valido, true, `la firma buena debió pasar: ${ok.motivo}`);

  // Cuerpo alterado en un byte → la firma ya no corresponde.
  assert.equal(verificarFirma(`${crudo} `, headers, secreto, ahora, {}).valido, false);
  // Fuera de la ventana temporal (replay).
  assert.equal(
    verificarFirma(crudo, headers, secreto, ahora + (TOLERANCIA_FIRMA_S + 60) * 1000, {}).motivo,
    'fuera_de_ventana',
  );
  // Sin secreto no se acepta nada: el lado seguro es rechazar.
  assert.equal(verificarFirma(crudo, headers, null, ahora, {}).motivo, 'secreto_no_configurado');
  // Sin cabecera de firma tampoco.
  assert.equal(verificarFirma(crudo, {}, secreto, ahora, {}).motivo, 'sin_firma');
});

test('el Code node exportado lleva el verificador REAL embebido, no el stub', () => {
  const js = nodo('FORENSE_resultado_llamada', 'Verificar HMAC').parameters.jsCode;
  // Embebido verbatim desde integrations/, con su firma posicional.
  assert.match(js, /EMBEBIDO VERBATIM de integrations\/elevenlabs\/hmac\.mjs/);
  assert.match(js, /function verificarFirma\(a, b, c, d, e\)/);
  assert.match(js, /function estadoDesdeCallback/);
  // Llamado en forma posicional, con el cuerpo CRUDO y el secreto de entorno.
  assert.match(js, /verificarFirma\(crudo, x\.headers \?\? \{\}, secreto, Date\.now\(\), \{\}\)/);
  assert.match(js, /FORENSE_ELEVENLABS_WEBHOOK_SECRET/);
  // El stub de la oleada 1 ya no puede estar activo.
  assert.doesNotMatch(js, /const VERIFICACION_DISPONIBLE = false/);
  // Y sigue sin haber camino que acepte un callback sin verificar.
  assert.match(js, /if \(!r\.valido\) throw new Error/);
});

test('el Code node embebido es JavaScript válido y no reimplementa el HMAC', () => {
  const js = nodo('FORENSE_resultado_llamada', 'Verificar HMAC').parameters.jsCode;
  // `$input`/`$env` los inyecta n8n; para parsear basta con declararlos.
  assert.doesNotThrow(() => new Function('$input', '$env', js));
  // Una sola definición de la verificación: si alguien copiara la lógica a
  // mano junto a la embebida, habría dos.
  assert.equal((js.match(/function verificarFirma\b/g) ?? []).length, 1);
});

test('el endpoint de la llamada sale del módulo, no de una URL copiada', () => {
  assert.equal(nodo('FORENSE_notificar_completada', 'POST outbound-call').parameters.url,
    ENDPOINT_LLAMADA);
});

test('estadoDesdeCallback nunca inventa la entrega: sin análisis, aviso_entregado no es true', () => {
  // 16 §2.7: `aviso_entregado` sólo se afirma si el análisis lo respalda. Sin
  // análisis vuelve null (desconocido), NUNCA true.
  const r = estadoDesdeCallback({ type: 'post_call_transcription' });
  assert.notEqual(r.aviso_entregado, true);
  assert.equal(r.estado, 'resultado_desconocido');
});
