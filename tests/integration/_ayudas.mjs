// tests/integration/_ayudas.mjs — utilidades compartidas de las pruebas de integración.
// Dueño: forense-qa. No escribe en db/, n8n/ ni web/: sólo los lee y los ejercita.
//
// Todo se ejecuta con `psql -f <archivo temporal>` y argumentos literales: nada
// de la prueba se interpola en una línea de shell.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, '../..');

export const PGBIN = process.env.PGBIN || '/opt/homebrew/opt/postgresql@17/bin';
export const PSQL = path.join(PGBIN, 'psql');
export const DB_QA = process.env.DB_QA || 'forense_qa';
export const DB_COMPARTIDA = process.env.DB_COMPARTIDA || 'forense';

/**
 * Techo de una consulta del banco. 300 s, no 120: `correr_pistas` sobre gen-v1
 * tarda decenas de segundos y bastante más si la máquina está cargada. El
 * servidor se detiene 20 s ANTES que el cliente (ver `correr`).
 */
export const TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || 300000);

const ENTORNO_PG = {
  ...process.env,
  PGHOST: process.env.PGHOST || 'localhost',
  PGUSER: process.env.PGUSER || 'postgres',
  PGPORT: process.env.PGPORT || '5432',
};

/** ¿Hay binario de psql? Sin él las pruebas de DB se saltan con motivo explícito. */
export function hayPsql() {
  try {
    fs.accessSync(PSQL, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** ¿Existe la base? */
export function hayBase(db) {
  if (!hayPsql()) return false;
  const r = correr(db, 'select 1');
  return r.code === 0;
}

/**
 * Ejecuta SQL en `db`. `rol` hace `set role <rol>` antes (para ejercitar RLS y
 * grants como anon/authenticated/service_role).
 * @returns {{code:number, salida:string, error:string}}
 */
export function correr(db, sql, { rol = null, detener = false } = {}) {
  // `statement_timeout` un poco por debajo del timeout del cliente. Sin él,
  // matar el psql deja VIVO el backend del servidor: la consulta sigue
  // corriendo, se queda con el lock de `v_pares_giro` (correr_pistas la
  // refresca) y la siguiente prueba del banco se bloquea detrás de un proceso
  // que ya nadie está mirando. Con él, el servidor cancela primero y el error
  // viaja en stderr con motivo.
  const cuerpo = (detener ? '\\set ON_ERROR_STOP on\n' : '') +
    `set statement_timeout = ${TIMEOUT_MS - 20000};\n` +
    (rol ? `set role ${rol};\n` : '') + sql + '\n';
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-sql-')), 'q.sql');
  fs.writeFileSync(tmp, cuerpo, 'utf8');
  try {
    const r = spawnSync(PSQL, ['-d', db, '-X', '-q', '-t', '-A', '-f', tmp], {
      // Un timeout corto se ve como `psql exit -1` sin stderr, que es el peor
      // diagnóstico posible; por eso el servidor corta primero (statement_timeout).
      env: ENTORNO_PG, encoding: 'utf8', timeout: TIMEOUT_MS,
    });
    return { code: r.status ?? -1, salida: (r.stdout ?? '').trim(), error: (r.stderr ?? '').trim() };
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

/** Igual que `correr` pero exige exit 0 y devuelve stdout. */
export function correrOk(db, sql, opciones = {}) {
  const r = correr(db, sql, { ...opciones, detener: true });
  if (r.code !== 0) {
    throw new Error(`psql exit ${r.code} en ${db}:\n${r.error || r.salida}\n--- sql ---\n${sql}`);
  }
  return r.salida;
}

/** Ejecuta una consulta que devuelve UN valor jsonb y lo parsea. */
export function json(db, sqlExpresion, opciones = {}) {
  const salida = correrOk(db, `select (${sqlExpresion})::text`, opciones);
  return JSON.parse(salida);
}

/** Ejecuta una consulta y devuelve las filas como array de arrays de texto. */
export function filas(db, sql, opciones = {}) {
  const salida = correr(db, sql, { ...opciones, detener: true });
  if (salida.code !== 0) throw new Error(salida.error || salida.salida);
  if (!salida.salida) return [];
  return salida.salida.split('\n').map((l) => l.split('|'));
}

/** Primera celda de la primera fila, como texto. */
export function escalar(db, sql, opciones = {}) {
  const f = filas(db, sql, opciones);
  return f.length ? f[0][0] : null;
}

// ---------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------

let _contratos = null;
/** Carga contracts/index.mjs, o null si falta `npm ci --prefix contracts`. */
export async function contratos() {
  if (_contratos !== null) return _contratos;
  try {
    _contratos = await import(path.join(RAIZ, 'contracts/index.mjs'));
  } catch {
    _contratos = false;
  }
  return _contratos;
}

export function leerJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, rel), 'utf8'));
}

// ---------------------------------------------------------------------
// UUIDs del fixture (db/seeds/seed_fake.sql)
// ---------------------------------------------------------------------

export const FIXTURE = Object.freeze({
  corrida: '00000000-0000-4000-8000-000000000001',
  // los casos/clusters del seed se resuelven por consulta, no se hardcodean
});

export const CORRIDA_GEN_V1 = '3fc52b5a-3e4b-54f4-a714-b3303b6f0347';

// ---------------------------------------------------------------------
// Techos de tiempo: el orden importa
// ---------------------------------------------------------------------

/**
 * Techo de una prueba de `node --test`, derivado del techo del cliente.
 *
 * INVARIANTE (QA-006): `statement_timeout` < timeout del cliente psql
 * (`TIMEOUT_MS`) < timeout de la prueba de node. Si se invierte, node mata la
 * prueba ANTES de que el servidor cancele la consulta y pasan dos cosas, las
 * dos malas: el diagnóstico se pierde (node reporta «test timed out», no el
 * error de SQL) y el backend sigue vivo con el lock de `v_pares_giro` que
 * `correr_pistas` toma para refrescarla, así que la siguiente prueba se
 * bloquea detrás de un proceso que ya nadie mira.
 *
 * Así estaba `inyeccion-008.test.mjs`: tres pruebas a 120 s contra un cliente
 * de 300 s. Con la máquina descargada pasaban (el clon de gen-v1 tarda ~3 s
 * desde 014); con la máquina cargada —que es justo cuando corre la suite
 * entera y cuando el juez inyecta en vivo— node cortaba primero.
 *
 * @param consultasLargas cuántas consultas que pueden agotar el techo del
 *   cliente encadena la prueba (clonar, correr_pistas, armar_clusters...).
 */
export function techoPrueba(consultasLargas = 1) {
  return TIMEOUT_MS * Math.max(1, consultasLargas) + 60000;
}

// ---------------------------------------------------------------------
// Limpieza de clones huérfanos
// ---------------------------------------------------------------------

/**
 * Borra los clones de gen-v1 que dejó una ejecución anterior del banco.
 *
 * Cada clon copia el dominio entero (~8 mil CFDI). Acumulados hacen dos daños
 * medibles: `rendimiento-pistas.test.mjs` mide compitiendo contra ellos (su
 * propio aviso «N corrida(s) grandes además de gen-v1» lo dice) y la base de
 * QA crece hasta que un `psql` con timeout parece un fallo de la prueba.
 *
 * Dos anclas para que esto no pueda borrar de más:
 *  a) `corrida_origen_id = gen-v1`. gen-v1 tiene origen NULL, así que la
 *     consulta no la alcanza ni aunque su nombre cambie. Un `LIKE` sobre el
 *     nombre sí podría: 'gen-v1 + inyección …' y 'gen-v1' comparten prefijo.
 *  b) edad > EDAD_HUERFANO_MIN. El timeout más alto del banco es 15 min, así
 *     que un clon de la sesión EN CURSO nunca llega a esa edad: el barrido
 *     sólo alcanza restos de ejecuciones anteriores, aunque node lance los
 *     ficheros de prueba en paralelo.
 *
 * No lanza: la base de QA es desechable y una limpieza fallida no es un
 * resultado de prueba.
 */
export const EDAD_HUERFANO_MIN = Number(process.env.QA_EDAD_HUERFANO_MIN || 30);

export function limpiarClonesHuerfanos({ db = DB_QA, minutos = EDAD_HUERFANO_MIN } = {}) {
  if (!hayPsql()) return [];
  const r = correr(db, `
    with muertas as (
      select c.id, c.nombre,
             (select count(*) from forense.cfdi f where f.corrida_id = c.id) as cfdi
        from forense.corridas c
       where c.corrida_origen_id = '${CORRIDA_GEN_V1}'::uuid
         and coalesce(c.inicio, 'epoch'::timestamptz) < now() - interval '${Number(minutos)} minutes'
    ), borradas as (
      delete from forense.corridas where id in (select id from muertas) returning id
    )
    select m.nombre || ' (' || m.cfdi || ' CFDI)' from muertas m
     where m.id in (select id from borradas);`);
  if (r.code !== 0) {
    console.log(`[limpieza] barrido de clones huérfanos no ejecutado: ${r.error.slice(0, 200)}`);
    return [];
  }
  const nombres = r.salida ? r.salida.split('\n').filter(Boolean) : [];
  if (nombres.length) {
    console.log(`[limpieza] ${nombres.length} clon(es) huérfano(s) de gen-v1 borrados ` +
      `(> ${minutos} min): ${nombres.join('; ')}`);
  }
  return nombres;
}

// Se ejecuta al cargar el módulo, o sea al arrancar CADA fichero de prueba y
// antes de que ninguno cree estado. Es idempotente y la ancla de edad la hace
// inofensiva para los clones de la sesión en curso.
if (hayBase(DB_QA)) limpiarClonesHuerfanos();
