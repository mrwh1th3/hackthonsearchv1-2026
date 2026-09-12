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
  const cuerpo = (detener ? '\\set ON_ERROR_STOP on\n' : '') +
    (rol ? `set role ${rol};\n` : '') + sql + '\n';
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-sql-')), 'q.sql');
  fs.writeFileSync(tmp, cuerpo, 'utf8');
  try {
    const r = spawnSync(PSQL, ['-d', db, '-X', '-q', '-t', '-A', '-f', tmp], {
      env: ENTORNO_PG, encoding: 'utf8', timeout: 120000,
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
