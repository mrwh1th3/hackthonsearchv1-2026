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
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';

import { RAIZ } from '../integration/_ayudas.mjs';

const WEB = path.join(RAIZ, 'web');
const BUILD_ID = path.join(WEB, '.next', 'BUILD_ID');

// ---------------------------------------------------------------------
// Build rancio: el fallo más caro de un e2e
//
// `next start` sirve lo que hay en web/.next. Si ese build es anterior al
// último cambio de web/, la prueba pasa en verde sobre bits viejos y dice
// «la webapp funciona» de un código que nadie ha ejecutado. Eso es peor que
// no tener prueba: es una prueba que miente en el sentido tranquilizador.
//
// Dos señales, y se toma la MÁS NUEVA de las dos:
//   1. el último commit de este HEAD que toca web/ (la que pide el encargo);
//   2. el mtime más nuevo de los archivos de web/ rastreados por git —
//      cambios editados y sin commitear, que el commit no ve. `.next` y
//      `node_modules` están en .gitignore, así que `git ls-files` no los
//      lista y no se cuentan a sí mismos.
//
// Por omisión el desajuste FALLA con el SHA y las dos fechas. Con
// E2E_RECONSTRUIR=1 se reconstruye antes de registrar las pruebas (útil en
// un banco desatendido); el resto del archivo se salta con motivo si el
// build sigue rancio, para que ningún `ok` cuelgue de bits viejos.
// ---------------------------------------------------------------------

function git(args) {
  const r = spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) return null;
  return (r.stdout ?? '').trim();
}

/** Epoch (s) del último commit de HEAD que toca web/, y su SHA corto. */
function ultimoCommitWeb() {
  const salida = git(['log', '-1', '--format=%ct %h %s', 'HEAD', '--', 'web']);
  if (!salida) return null;
  const [ts, sha, ...resto] = salida.split(' ');
  return { epoch: Number(ts), sha, asunto: resto.join(' ').slice(0, 60) };
}

/** Epoch (s) del archivo rastreado de web/ modificado más recientemente. */
function ultimaFuenteWeb() {
  const salida = git(['ls-files', '-z', '--', 'web']);
  if (salida === null) return null;
  let mejor = null;
  for (const rel of salida.split('\0')) {
    if (!rel) continue;
    let st;
    try { st = fs.statSync(path.join(RAIZ, rel)); } catch { continue; } // borrado sin commitear
    const epoch = Math.floor(st.mtimeMs / 1000);
    if (!mejor || epoch > mejor.epoch) mejor = { epoch, ruta: rel };
  }
  return mejor;
}

function fecha(epoch) {
  return epoch ? new Date(epoch * 1000).toISOString().replace('T', ' ').slice(0, 19) : '—';
}

function estadoBuild() {
  if (!fs.existsSync(BUILD_ID)) {
    return { existe: false, rancio: false, motivo: 'falta web/.next: corre `npm run build --prefix web`' };
  }
  const build = Math.floor(fs.statSync(BUILD_ID).mtimeMs / 1000);
  const commit = ultimoCommitWeb();
  const fuente = ultimaFuenteWeb();
  const candidatos = [
    commit && { epoch: commit.epoch, que: `commit ${commit.sha} «${commit.asunto}»` },
    fuente && { epoch: fuente.epoch, que: `archivo ${fuente.ruta} sin reconstruir` },
  ].filter(Boolean);
  if (!candidatos.length) {
    // Sin git no hay referencia: no se inventa una. Se dice y se sigue.
    return { existe: true, rancio: false, build, referencia: null,
             motivo: 'sin git en este árbol: no se puede fechar el último cambio de web/' };
  }
  const ref = candidatos.reduce((a, b) => (b.epoch > a.epoch ? b : a));
  const rancio = build < ref.epoch;
  return {
    existe: true, rancio, build, referencia: ref,
    motivo: rancio
      ? `web/.next/BUILD_ID es de ${fecha(build)} y ${ref.que} es de ${fecha(ref.epoch)} ` +
        `(${ref.epoch - build} s más nuevo): el e2e estaría probando un build viejo. ` +
        'Corre `npm run build --prefix web` (o E2E_RECONSTRUIR=1 para que lo haga la prueba).'
      : `build de ${fecha(build)}, ${ref.que} de ${fecha(ref.epoch)}`,
  };
}

function reconstruir() {
  const r = spawnSync('npm', ['run', 'build', '--prefix', 'web'], {
    cwd: RAIZ, encoding: 'utf8', timeout: 900000,
  });
  return { code: r.status ?? -1, salida: `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim() };
}

let BUILD = estadoBuild();
let RECONSTRUIDO = null;
if (BUILD.existe && BUILD.rancio && process.env.E2E_RECONSTRUIR === '1') {
  RECONSTRUIDO = reconstruir();
  BUILD = estadoBuild();
}

const saltar = (!BUILD.existe && BUILD.motivo) ||
  (BUILD.rancio && `build rancio: ${BUILD.motivo}`);

test('el build de web/.next no está rancio', { skip: !BUILD.existe && BUILD.motivo }, () => {
  if (RECONSTRUIDO) {
    assert.equal(RECONSTRUIDO.code, 0,
      `E2E_RECONSTRUIR=1 pero \`npm run build --prefix web\` salió ${RECONSTRUIDO.code}:\n` +
      RECONSTRUIDO.salida.slice(-2000));
  }
  assert.equal(BUILD.rancio, false, BUILD.motivo);
  console.log(`[build] ${BUILD.motivo}`);
});

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

/**
 * Un bloque de texto del documento con el que se puede construir una
 * `seleccion` verificable: `paragraph`/`heading` (verificarSeleccion no
 * reconstruye tablas ni listas con la misma semántica) y de 10..300
 * caracteres — a partir de ~345 la enumeración anclada del servidor se
 * declara `indeterminada` por presupuesto y no verificaría nada.
 *
 * `texto_hash` se calcula igual que el editor: sha256 del texto seleccionado
 * (web/lib/document/documento.ts → hashTexto → sha256Hex).
 */
function seleccionVerificable(contenidoJson) {
  const textoDe = (b) => (Array.isArray(b.content) ? b.content : []).map((t) => t.text ?? '').join('');
  const bloque = contenidoJson.content.find(
    (b) => (b.type === 'paragraph' || b.type === 'heading') && b.attrs?.id
      && textoDe(b).length >= 10 && textoDe(b).length <= 300);
  assert.ok(bloque, 'el documento del fixture no tiene ningún bloque de texto de 10..300 caracteres');
  const texto = textoDe(bloque);
  return {
    bloqueId: bloque.attrs.id,
    texto,
    seleccion: {
      from: 1,
      to: 1 + texto.length,
      block_ids: [bloque.attrs.id],
      texto_hash: createHash('sha256').update(texto, 'utf8').digest('hex'),
    },
  };
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
      // Sin webhooks: es la condición que debe dar 503 y no 500. Los nombres
      // son los que lee web/lib/security/webhook.ts, no una variante parecida.
      N8N_WEBHOOK_BASE: '',
      INTERNAL_WEBHOOK_SECRET: '',
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
        // Cuerpo VÁLIDO según product.investigar: si no lo fuera, el 422 del
        // contrato taparía el 503 y la prueba no mediría la falta de backend.
        body: JSON.stringify({
          mensaje: 'e2e: sigue el dinero de este cluster',
          directriz_id: 'seguir_dinero',
          directriz_version: 1,
          contexto: {
            corrida_id: '00000000-0000-4000-8000-000000000001',
            rfcs: [],
            evidencia_ids: [],
            periodo: {
              desde: '2025-02-01T00:00:00.000Z',
              hasta_exclusivo: '2026-02-01T00:00:00.000Z',
              timezone: 'America/Monterrey',
            },
          },
          investigacion_padre_id: null,
          idempotency_key: randomUUID(),
        }),
      });
      const c = await cuerpo(bueno);
      assert.equal(bueno.status, 503,
        `sin backend esperaba 503, llegó ${bueno.status}: ${c.texto.slice(0, 300)}`);
      assert.equal(c.json?.error, 'backend_no_configurado');
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

      // El `texto_hash` se calcula COMO LO CALCULA EL EDITOR: sha256 del texto
      // seleccionado (web/lib/document/documento.ts → hashTexto → sha256Hex),
      // sobre el texto real de un bloque de esta versión. Un hash inventado
      // sería `desplazada` y la propuesta legítima moriría en 409.
      //
      // El bloque se DESCUBRE, no se supone: tiene que ser de texto
      // (paragraph/heading — verificarSeleccion no reconstruye tablas ni
      // listas con la misma semántica) y de menos de 300 caracteres, porque
      // la enumeración anclada del servidor se declara `indeterminada` por
      // presupuesto a partir de ~345 y entonces la respuesta sería 200 sin
      // haber verificado nada.
      const { texto, seleccion } = seleccionVerificable(doc.contenido_json);
      const hash = seleccion.texto_hash;

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
          seleccion,
          mensaje: 'Aclara que la cifra viene de SQL, no del modelo.',
          evidencia_ids: [], idempotency_key: randomUUID(),
        }),
      });
      const cpr = await cuerpo(propuesta);
      assert.equal(propuesta.status, 200, cpr.texto.slice(0, 300));
      const respuesta = cpr.json;
      assert.ok(respuesta.propuesta || respuesta.patch || respuesta.modo === 'propuesta',
        `la propuesta no devolvió propuesta: ${JSON.stringify(respuesta).slice(0, 300)}`);
      // Lo que se mide no es el 200: es que el servidor CONFIRMÓ el hash. Con
      // `indeterminada` la petición también sale 200 y no se habría probado
      // que el texto seleccionado es el que está en la versión base.
      assert.equal(respuesta.seleccion_verificada, true,
        'el servidor no verificó el texto_hash: la propuesta pasó sin comprobar la selección');

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
      assert.equal((await cuerpo(desplazada)).json?.error, 'seleccion_desplazada');

      // Y el caso que de verdad protege el texto_hash: el bloque SIGUE ahí,
      // pero el texto que el usuario tenía seleccionado ya no es el que está
      // guardado. Se usa `texto + 'x'`: más largo que el bloque, así que no
      // es ninguna de sus subcadenas y la enumeración anclada lo prueba.
      const movida = await conSesion('/api/reportes/propuestas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caso_id: CASO, version_base: doc.version, modo: 'propuesta',
          seleccion: {
            ...seleccion,
            texto_hash: createHash('sha256').update(`${texto}x`, 'utf8').digest('hex'),
          },
          mensaje: 'sobre un texto que ya cambió',
          evidencia_ids: [], idempotency_key: randomUUID(),
        }),
      });
      const cm = await cuerpo(movida);
      assert.equal(movida.status, 409,
        `un texto_hash que no corresponde al bloque devolvió ${movida.status}: ${cm.texto.slice(0, 300)}`);
      assert.equal(cm.json?.error, 'seleccion_desplazada');
      // El motivo distingue este 409 del de bloques ausentes: sin él, la
      // prueba no sabría cuál de las dos comprobaciones se ejecutó.
      assert.equal(cm.json?.motivo, 'texto_hash',
        `409 por otro motivo: ${JSON.stringify(cm.json).slice(0, 300)}`);

      // Proponer —ni siquiera el rechazo— versiona.
      assert.equal((await versiones()).length, antes.length,
        'el ciclo de propuestas creó una versión sin pasar por Aplicar');
    });

    // Esta prueba va la ÚLTIMA del archivo: Aplicar sube el documento a la
    // versión 2 y cualquier prueba posterior que asumiera `version_base: 1`
    // empezaría a recibir 409 conflicto_version.
    await t.test('Aplicar versiona una sola vez: propuesta → versión 2, y el doble Aplicar es idempotente', async () => {
      const versiones = async () => {
        const r = await conSesion(`/api/reportes/versiones?caso_id=${CASO}`);
        assert.equal(r.status, 200);
        return (await r.json()).versiones;
      };

      const antes = await versiones();
      const doc = antes[antes.length - 1];
      const { seleccion } = seleccionVerificable(doc.contenido_json);

      // DOS propuestas sobre la MISMA versión base, como dos pestañas abiertas.
      // La segunda se aplica al final para medir el conflicto de versión: una
      // propuesta ya aplicada no sirve para eso (vuelve a devolver su versión,
      // que es la idempotencia que se prueba antes).
      const proponer = async (mensaje) => {
        const r = await conSesion('/api/reportes/propuestas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caso_id: CASO, version_base: doc.version, modo: 'propuesta',
            seleccion, mensaje, evidencia_ids: [], idempotency_key: randomUUID(),
          }),
        });
        const c = await cuerpo(r);
        assert.equal(r.status, 200, c.texto.slice(0, 300));
        const id = c.json?.propuesta?.propuesta_id;
        assert.ok(id,
          `la propuesta no trae propuesta_id y Aplicar no tendría qué aplicar: ${JSON.stringify(c.json).slice(0, 300)}`);
        return id;
      };
      const propuestaId = await proponer('Deja explícito que el importe lo calcula SQL.');
      const propuestaRezagada = await proponer('Otra redacción de la misma sección.');

      // `caso_id` va en la query: el cuerpo es exactamente editor.aplicar
      // (`additionalProperties: false`), así que meterlo dentro daría 422.
      const clave = randomUUID();
      const cuerpoAplicar = JSON.stringify({
        propuesta_id: propuestaId,
        version_base: doc.version,
        idempotency_key: clave,
      });
      const aplicar = async () => conSesion(`/api/reportes/aplicar?caso_id=${CASO}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: cuerpoAplicar,
      });

      const primera = await aplicar();
      const c1 = await cuerpo(primera);
      assert.equal(primera.status, 200, c1.texto.slice(0, 300));
      assert.equal(c1.json.version, doc.version + 1,
        `Aplicar dejó el documento en la versión ${c1.json.version}`);
      assert.equal(c1.json.repetido, false, 'la primera aplicación se declaró repetida');
      assert.ok(c1.json.reporte?.contenido_json, 'Aplicar no devolvió el reporte versionado');
      const listaTrasAplicar = await versiones();
      assert.equal(listaTrasAplicar.length, antes.length + 1,
        'Aplicar no creó exactamente una versión');
      assert.equal(listaTrasAplicar[listaTrasAplicar.length - 1].version, doc.version + 1);

      // Doble clic / reentrega del webhook: misma clave, misma versión. Si
      // creara una versión 3, cada reintento de red duplicaría el historial.
      const segunda = await aplicar();
      const c2 = await cuerpo(segunda);
      assert.equal(segunda.status, 200, c2.texto.slice(0, 300));
      assert.equal(c2.json.version, c1.json.version,
        'el segundo Aplicar con la misma idempotency_key creó otra versión');
      assert.equal(c2.json.repetido, true, 'el segundo Aplicar no se declaró repetido');
      assert.equal((await versiones()).length, listaTrasAplicar.length,
        'el segundo Aplicar añadió una versión al historial');

      // 15 §10: la segunda pestaña aplica una propuesta calculada sobre la
      // versión 1, que ya no es la vigente. El servidor no reintenta solo:
      // 409 y el cliente conserva su borrador.
      const vieja = await conSesion(`/api/reportes/aplicar?caso_id=${CASO}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propuesta_id: propuestaRezagada,
          version_base: doc.version,
          idempotency_key: randomUUID(),
        }),
      });
      const c3 = await cuerpo(vieja);
      assert.equal(vieja.status, 409,
        `aplicar sobre una version_base vencida devolvió ${vieja.status}: ${c3.texto.slice(0, 300)}`);
      assert.equal(c3.json?.error, 'conflicto_version');
      assert.equal(c3.json?.version_actual, c1.json.version);
    });
  } finally {
    parar();
  }
});
