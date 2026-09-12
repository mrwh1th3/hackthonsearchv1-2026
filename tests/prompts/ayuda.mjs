// Utilidades compartidas de tests/prompts. No es un archivo de test: `node --test` sólo
// recoge `*.test.mjs` de este directorio.
//
// Dueño: forense-prompts. Sólo lee; no escribe nada en disco.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, '../..');
export const DIR_PROMPTS = path.join(RAIZ, 'n8n/prompts');
export const DIR_FIXTURES_CONTRATO = path.join(RAIZ, 'contracts/fixtures/valid');
export const DIR_FIXTURES_LOCALES = path.join(AQUI, 'fixtures');
export const DIR_SCHEMAS = path.join(RAIZ, 'contracts/schemas');

/** Fixture válido publicado por el coordinador en contracts (no se modifica aquí). */
export function fixtureContrato(nombre) {
  return JSON.parse(fs.readFileSync(path.join(DIR_FIXTURES_CONTRATO, `${nombre}.json`), 'utf8'));
}

/** Fixture adversarial propio de tests/prompts. */
export function fixtureLocal(nombre) {
  return JSON.parse(fs.readFileSync(path.join(DIR_FIXTURES_LOCALES, `${nombre}.json`), 'utf8'));
}

export function leerArchivoPrompt(nombre) {
  return fs.readFileSync(path.join(DIR_PROMPTS, nombre), 'utf8');
}

export function archivosPrompt() {
  return fs.readdirSync(DIR_PROMPTS).filter(n => n.endsWith('.md')).sort();
}

export function schemaContracts(archivo) {
  return JSON.parse(fs.readFileSync(path.join(DIR_SCHEMAS, `${archivo}.schema.json`), 'utf8'));
}

/** Resuelve `agents.especialista` → el nodo `$defs.especialista` de agents.schema.json. */
export function nodoDeContrato(nombreContrato) {
  const [archivo, definicion] = nombreContrato.split('.');
  return schemaContracts(archivo).$defs[definicion];
}

/** Roles con fixture de contexto publicado en contracts, con el fixture que les toca. */
export const CASOS_ROL = Object.freeze([
  { rol: 'documental', fixture: 'contexto-r1', ronda: 1 },
  { rol: 'documental', fixture: 'contexto-r2', ronda: 2 },
  { rol: 'auditor', fixture: 'contexto-auditor', ronda: 1 },
  { rol: 'defensor', fixture: 'contexto-defensor', ronda: 1 },
  { rol: 'replica', fixture: 'contexto-replica', ronda: 1 },
  { rol: 'redactor', fixture: 'contexto-redactor', ronda: 1 },
  { rol: 'editor', fixture: 'contexto-editor', ronda: 1 },
]);

/**
 * Los cinco especialistas comparten estructura de paquete: para cubrirlos todos se reusa
 * `contexto-r1` cambiando rol, familia de la pista y su código.
 */
export function contextoEspecialista(rol, { ronda = 1 } = {}) {
  const familias = { documental: ['D', 'D2'], financiero: ['F', 'F2'], relacional: ['R', 'R2'], temporal: ['T', 'T1'], externo: ['E', 'E1'] };
  const [familia, codigo] = familias[rol];
  const fx = fixtureContrato(ronda === 2 ? 'contexto-r2' : 'contexto-r1');
  fx.rol = rol;
  for (const p of fx.datos.pistas) {
    p.familia = familia;
    p.codigo = codigo;
  }
  return fx;
}

/** Normaliza espacios y saltos de línea: los .md envuelven las frases a 90 columnas. */
export function plano(texto) {
  return texto.replace(/\s+/g, ' ');
}

/** Cuenta ocurrencias no solapadas de una cadena literal. */
export function contar(texto, aguja) {
  return texto.split(aguja).length - 1;
}
