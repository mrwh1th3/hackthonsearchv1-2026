// =====================================================================
// tests/e2e/webapp.test.mjs — la webapp construida y servida de verdad.
//
//   npm run build --prefix web        (una vez)
//   node --test tests/e2e/webapp.test.mjs
//
// Dueño: forense-qa. No modifica web/: la construye y la ejercita por HTTP.
//
// Se levanta `next start` en un puerto libre con el origen de datos fixture y
// sin backend de n8n configurado, que es exactamente el estado en el que la
// webapp tiene que seguir siendo navegable: 200 en las pantallas, 401 sin
// sesión y 503 —no 500— en la mutación que necesita un backend ausente.
//
// Si falta web/.next, las pruebas se SALTAN con motivo en vez de fallar: el
// build es responsabilidad de quien corre el banco, no de esta prueba.
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';

import { RAIZ } from '../integration/_ayudas.mjs';

const WEB = path.join(RAIZ, 'web');
const hayBuild = fs.existsSync(path.join(WEB, '.next', 'BUILD_ID'));
const saltar = !hayBuild && 'falta web/.next: corre `npm run build --prefix web`';

const PASSWORD = '1234';
// Caso del fixture con expediente del Redactor (db/seeds/seed_fake.sql y
// web/lib/data/fixture.ts comparten estos ids).
const CASO = '00000000-0000-4000-8000-000000000100';

/** Puerto libre pedido al sistema operativo, para no chocar con el dev server. */
function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let servidor; let base;

async function arrancar() {
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  servidor = spawn('npm', ['run', 'start', '--', '--port', String(puerto), '--hostname', '127.0.0.1'], {
    cwd: WEB,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_PUBLIC_DATA_SOURCE: 'fixture',
      DEMO_PASSWORD: PASSWORD,
      SESSION_SECRET: 'test',
      NEXT_TELEMETRY_DISABLED: '1',
      // Sin URL de webhooks: es la condición que debe dar 503 y no 500.
      N8N_WEBHOOK_BASE_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  servidor.stdout.on('data', (d) => { salida += d; });
  servidor.stderr.on('data', (d) => { salida += d; });

  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`${base}/login`, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch { /* todavía no escucha */ }
    await esperar(500);
  }
  throw new Error(`next start no respondió en 60 s:\n${salida.slice(-2000)}`);
}

function parar() {
  if (servidor && !servidor.killed) servidor.kill('SIGTERM');
}

/** Lee el cuerpo UNA vez y lo devuelve como texto y como JSON si se puede. */
async function cuerpo(r) {
  const texto = await r.text();
  try { return { texto, json: JSON.parse(texto) }; } catch { return { texto, json: null }; }
}

/** fetch con Origin del propio servidor (isSameOriginRequest lo exige en POST). */
function pedir(ruta, opciones = {}) {
  const cabeceras = { Origin: base, ...(opciones.headers ?? {}) };
  return fetch(`${base}${ruta}`, { redirect: 'manual', ...opciones, headers: cabeceras });
}

let cookie = null;
function conSesion(ruta, opciones = {}) {
  assert.ok(cookie, 'no hay cookie de sesión: la prueba de login debe correr antes');
  return pedir(ruta, { ...opciones, headers: { Cookie: cookie, ...(opciones.headers ?? {}) } });
}

test('webapp servida con next start', { skip: saltar, timeout: 300000, concurrency: false }, async (t) => {
  await arrancar();
  try {
    await t.test('sin cookie, la API responde 401 y la página redirige a /login', async () => {
      const api = await pedir('/api/historial');
      assert.equal(api.status, 401, 'una API privada contestó sin sesión');

      const pagina = await pedir('/historial');
      assert.ok([302, 307].includes(pagina.status), `esperaba redirección, llegó ${pagina.status}`);
      assert.match(pagina.headers.get('location') ?? '', /\/login/);
    });

    await t.test('login con la contraseña del demo devuelve cookie de sesión', async () => {
      const mal = await pedir('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: 'auditor', password: 'equivocada' }),
      });
      assert.equal(mal.status, 401, 'una contraseña incorrecta abrió sesión');

      const r = await pedir('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: 'auditor', password: PASSWORD }),
      });
      assert.equal(r.status, 200, await r.text());
      const set = r.headers.get('set-cookie');
      assert.ok(set, 'el login no devolvió cookie');
      cookie = set.split(';')[0];
      assert.match(set, /HttpOnly/i, 'la cookie de sesión no es HttpOnly');
    });

    await t.test('12 rutas responden 200 con sesión', async () => {
      const RUTAS = [
        '/', '/corridas', '/datos', '/estadisticas', '/historial', '/metodo',
        '/notificaciones', '/perfil',
        '/corridas/00000000-0000-4000-8000-000000000001',
        `/casos/${CASO}/expediente`,
        '/api/historial', `/api/reportes/versiones?caso_id=${CASO}`,
      ];
      assert.equal(RUTAS.length, 12);
      const fallos = [];
      for (const ruta of RUTAS) {
        const r = await conSesion(ruta);
        if (r.status !== 200) fallos.push(`${ruta} → ${r.status}`);
      }
      assert.deepEqual(fallos, [], `rutas que no dieron 200: ${fallos.join(', ')}`);
    });

    await t.test('sin backend, /api/investigaciones da 503 y un cuerpo inválido da 400', async () => {
      const malo = await conSesion('/api/investigaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'esto no es json',
      });
      assert.equal(malo.status, 400, 'un cuerpo ilegible no dio 400');

      const bueno = await conSesion('/api/investigaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: '00000000-0000-4000-8000-00000000e2e1',
          modo: 'caso',
          manifiesto: { objetivos: [] },
          mensaje: 'e2e',
        }),
      });
      const c = await cuerpo(bueno);
      assert.ok([422, 503].includes(bueno.status),
        `sin backend esperaba 503 (o 422 del contrato), llegó ${bueno.status}: ${c.texto.slice(0, 300)}`);
      if (bueno.status === 503) assert.equal(c.json?.error, 'backend_no_configurado');
    });
    await t.test('una pregunta responde sin versionar; una propuesta no toca el documento', async () => {
      const versiones = async () => {
        const r = await conSesion(`/api/reportes/versiones?caso_id=${CASO}`);
        assert.equal(r.status, 200);
        return (await r.json()).versiones;
      };

      const antes = await versiones();
      assert.ok(antes.length >= 1, 'el caso del fixture no tiene ni una versión');
      const doc = antes[antes.length - 1];
      const bloques = doc.contenido_json.content.map((b) => b.attrs?.id).filter(Boolean);
      assert.ok(bloques.length >= 2, 'el documento del fixture no tiene bloques con id');

      // Un hash con la forma del contrato; el servidor valida los block_ids
      // contra el índice de la versión, que es lo que evita editar a ciegas.
      const hash = createHash('sha256').update('seleccion-e2e').digest('hex');

      const pregunta = await conSesion('/api/reportes/propuestas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caso_id: CASO, version_base: doc.version, modo: 'pregunta',
          mensaje: '¿De dónde sale el importe del resumen?',
          evidencia_ids: [], idempotency_key: randomUUID(),
        }),
      });
      const cp = await cuerpo(pregunta);
      assert.equal(pregunta.status, 200, cp.texto.slice(0, 300));
      const cuerpoPregunta = cp.json;
      assert.equal(cuerpoPregunta.modo, 'pregunta');
      assert.ok(cuerpoPregunta.mensaje, 'la pregunta no devolvió mensaje');
      assert.equal(cuerpoPregunta.patch, undefined, 'una pregunta devolvió un patch');
      assert.equal((await versiones()).length, antes.length,
        'preguntar creó una versión: el chat no versiona (regla 11)');

      const propuesta = await conSesion('/api/reportes/propuestas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caso_id: CASO, version_base: doc.version, modo: 'propuesta',
          seleccion: { from: 0, to: 40, block_ids: [bloques[1]], texto_hash: hash },
          mensaje: 'Aclara que la cifra viene de SQL, no del modelo.',
          evidencia_ids: [], idempotency_key: randomUUID(),
        }),
      });
      const cpr = await cuerpo(propuesta);
      assert.equal(propuesta.status, 200, cpr.texto.slice(0, 300));
      const respuesta = cpr.json;
      assert.ok(respuesta.propuesta || respuesta.patch || respuesta.modo === 'propuesta',
        `la propuesta no devolvió propuesta: ${JSON.stringify(respuesta).slice(0, 300)}`);

      // Proponer tampoco versiona: sólo Aplicar lo hace (regla 11).
      assert.equal((await versiones()).length, antes.length,
        'proponer creó una versión sin pasar por Aplicar');

      // Y una selección de bloques que ya no existen se rechaza con 409.
      const desplazada = await conSesion('/api/reportes/propuestas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caso_id: CASO, version_base: doc.version, modo: 'propuesta',
          seleccion: { from: 0, to: 5, block_ids: ['blk-inexistente'], texto_hash: hash },
          mensaje: 'sobre un bloque que ya no está',
          evidencia_ids: [], idempotency_key: randomUUID(),
        }),
      });
      assert.equal(desplazada.status, 409, `selección desplazada devolvió ${desplazada.status}`);
    });
  } finally {
    parar();
  }
});
