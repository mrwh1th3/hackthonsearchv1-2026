// n8n/tests/transporte.test.mjs — backoff, Retry-After y timeout ambiguo (17 §6). SIMULADO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularEspera, clasificar, enviarConReintentos, BASE_BACKOFF_MS, MAX_BACKOFF_MS } from '../runtime/transporte.mjs';
import { relojSimulado, DEADLINE } from './_ayudas.mjs';

test('clasificación de respuestas', () => {
  assert.equal(clasificar({ status: 200 }), 'ok');
  assert.equal(clasificar({ status: 429 }), 'reintentable');
  assert.equal(clasificar({ status: 503 }), 'reintentable');
  assert.equal(clasificar({ status: 400 }), 'error');
  assert.equal(clasificar({ status: 401 }), 'error');
  assert.equal(clasificar({ tipo: 'timeout' }), 'ambiguo');
});

test('Retry-After manda sobre el backoff calculado', () => {
  assert.equal(calcularEspera({ intento: 0, retry_after: '3', aleatorio: () => 1 }), 3000);
  const fecha = new Date(Date.parse('2026-01-31T12:00:10Z')).toUTCString();
  assert.equal(calcularEspera({ intento: 0, retry_after: fecha, ahora_ms: Date.parse('2026-01-31T12:00:00Z'), aleatorio: () => 1 }), 10000);
});

test('el backoff crece con jitter y tiene techo', () => {
  assert.equal(calcularEspera({ intento: 0, aleatorio: () => 1 }), BASE_BACKOFF_MS);
  assert.equal(calcularEspera({ intento: 1, aleatorio: () => 1 }), BASE_BACKOFF_MS * 2);
  assert.equal(calcularEspera({ intento: 20, aleatorio: () => 1 }), MAX_BACKOFF_MS);
  assert.ok(calcularEspera({ intento: 3, aleatorio: () => 0.25 }) < calcularEspera({ intento: 3, aleatorio: () => 1 }));
});

test('429 se reintenta hasta dos veces y luego tiene éxito', async () => {
  const reloj = relojSimulado();
  const respuestas = [
    { status: 429, headers: { 'retry-after': '1' } },
    { status: 429, headers: {} },
    { status: 200, headers: {}, body: { ok: true } },
  ];
  let i = 0;
  const r = await enviarConReintentos({
    ejecutar: async () => respuestas[i++],
    deadline_at: DEADLINE,
    ahora: reloj.ahora, dormir: reloj.dormir, aleatorio: () => 0.5,
  });
  assert.equal(r.ok, true);
  assert.equal(r.intentos, 3, '1 intento + 2 reintentos de transporte');
  assert.deepEqual(r.esperas_ms, [1000, 500]);
});

test('tras dos reintentos de transporte se rinde sin inventar reintento forense', async () => {
  const reloj = relojSimulado();
  const r = await enviarConReintentos({
    ejecutar: async () => ({ status: 500, headers: {} }),
    deadline_at: DEADLINE,
    ahora: reloj.ahora, dormir: reloj.dormir, aleatorio: () => 0.5,
  });
  assert.equal(r.ok, false);
  assert.equal(r.intentos, 3);
  assert.equal(r.error.codigo, 'reintentos_transporte_agotados');
});

test('un 400 no se reintenta', async () => {
  let llamadas = 0;
  const r = await enviarConReintentos({
    ejecutar: async () => { llamadas += 1; return { status: 400, headers: {} }; },
    deadline_at: DEADLINE,
    ahora: relojSimulado().ahora,
  });
  assert.equal(llamadas, 1);
  assert.equal(r.error.codigo, 'error_proveedor');
});

test('timeout ambiguo no se reintenta automáticamente y se marca desconocido', async () => {
  let llamadas = 0;
  const r = await enviarConReintentos({
    ejecutar: async () => { llamadas += 1; return { tipo: 'timeout' }; },
    deadline_at: DEADLINE,
    ahora: relojSimulado().ahora,
  });
  assert.equal(llamadas, 1, 'repetir podría duplicar coste externo');
  assert.equal(r.estado, 'desconocido');
  assert.equal(r.error.codigo, 'timeout_ambiguo');
});

test('el backoff nunca cruza el deadline del paso', async () => {
  const reloj = relojSimulado(Date.parse('2026-01-31T12:11:59Z'));
  const r = await enviarConReintentos({
    ejecutar: async () => ({ status: 429, headers: { 'retry-after': '120' } }),
    deadline_at: DEADLINE,
    ahora: reloj.ahora, dormir: reloj.dormir, aleatorio: () => 0.5,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.codigo, 'deadline_excedido');
});

test('una excepción del transporte se convierte en dato, no en crash', async () => {
  const r = await enviarConReintentos({
    ejecutar: async () => { const e = new Error('socket cerrado'); e.tipo = 'conexion_interrumpida'; throw e; },
    deadline_at: DEADLINE,
    ahora: relojSimulado().ahora,
  });
  assert.equal(r.estado, 'desconocido');
});
