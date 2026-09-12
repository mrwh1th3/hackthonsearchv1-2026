// Manifest de prompts: hash por archivo, allowlist de herramientas, contrato de salida y
// modelo propuesto por rol. `version_prompts` (08) cambia si cambia cualquier archivo de
// la carpeta; se guarda en `corridas` para comparar experimentos (10).
//
//   node n8n/prompts/manifest.mjs --check   → verifica que manifest.json esté al día
//   node n8n/prompts/manifest.mjs --write   → lo regenera
//
// Requiere las dependencias de contracts instaladas (npm ci --prefix contracts).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { contractVersion } from '../../contracts/index.mjs';
import {
  ROLES_LLM, SCHEMA_SALIDA_POR_ROL, MODELO_PROPUESTO_POR_ROL, TECHO_CARACTERES,
  TOOLS_DE_SISTEMA, FEWSHOT_POR_ROL, FEWSHOT_POR_DEFECTO, toolsPorRol,
  MOTIVOS_REINTENTO, ROLES_CON_REINTENTO, AMBITO_TECHO_POR_DEFECTO, TECHO_SYSTEM_CARACTERES,
} from './ensamblar.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RUTA_MANIFEST = path.join(AQUI, 'manifest.json');

export const REGLA_HASH = 'sha256 de cada archivo de n8n/prompts/ excepto manifest.json, ordenados por nombre; version_prompts = primeros 12 hex del sha256 de los hashes concatenados en ese orden';

export function listarArchivos() {
  return fs.readdirSync(AQUI)
    .filter(nombre => nombre !== 'manifest.json')
    .filter(nombre => fs.statSync(path.join(AQUI, nombre)).isFile())
    .sort();
}

export function construirManifest() {
  const archivos = listarArchivos().map(name => {
    const contenido = fs.readFileSync(path.join(AQUI, name), 'utf8');
    return {
      name,
      sha256: createHash('sha256').update(contenido, 'utf8').digest('hex'),
      chars: contenido.length,
    };
  });

  const version_prompts = createHash('sha256')
    .update(archivos.map(a => a.sha256).join(''), 'utf8')
    .digest('hex')
    .slice(0, 12);

  const tools_por_rol = {};
  for (const rol of [...ROLES_LLM, 'mapper']) {
    tools_por_rol[rol] = { r1: toolsPorRol(rol, 1), r2: toolsPorRol(rol, 2) };
  }

  return {
    version_manifest: 'prompts.v1',
    // Se lee de contracts, no se copia: al subir el coordinador a 1.1.0 el manifest lo
    // refleja al regenerarse y el test lo compara contra `contractVersion`.
    contracts_version: contractVersion,
    regla_hash: REGLA_HASH,
    nota: 'Auditor Final no aparece: es código determinista, no un prompt. Los modelos son propuestas de 17 §7 para medir, no una asignación final.',
    version_prompts,
    archivos,
    roles: [...ROLES_LLM, 'mapper'],
    tools_por_rol,
    tools_de_sistema_prohibidas: [...TOOLS_DE_SISTEMA],
    fewshot_por_rol: { ...FEWSHOT_POR_ROL },
    fewshot_por_defecto: FEWSHOT_POR_DEFECTO,
    variantes: [
      ...[...ROLES_LLM, 'mapper'],
      ...Object.keys(FEWSHOT_POR_ROL).map(rol => `${rol}+fewshot`),
    ],
    // El reintento es una variante con sufijo (`<rol>+reintento:<motivo>`): 35 combinaciones
    // no caben en una lista útil, así que se publican sus dos ejes y la regla de nombre.
    motivos_reintento: [...MOTIVOS_REINTENTO],
    roles_con_reintento: [...ROLES_CON_REINTENTO],
    sufijo_variante_reintento: 'reintento:<motivo>',
    ambito_techo_por_defecto: AMBITO_TECHO_POR_DEFECTO,
    techo_system_caracteres: TECHO_SYSTEM_CARACTERES,
    schema_salida_por_rol: { ...SCHEMA_SALIDA_POR_ROL },
    modelo_propuesto_por_rol: { ...MODELO_PROPUESTO_POR_ROL },
    techo_caracteres_por_rol: { ...TECHO_CARACTERES },
  };
}

export function leerManifest() {
  return JSON.parse(fs.readFileSync(RUTA_MANIFEST, 'utf8'));
}

export function escribirManifest() {
  const manifest = construirManifest();
  fs.writeFileSync(RUTA_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

/** @returns {{ok: boolean, diferencias: string[]}} */
export function verificarManifest() {
  const esperado = construirManifest();
  let actual;
  try {
    actual = leerManifest();
  } catch (error) {
    return { ok: false, diferencias: [`manifest.json ilegible: ${error.message}`] };
  }
  const diferencias = [];
  if (actual.version_prompts !== esperado.version_prompts) {
    diferencias.push(`version_prompts ${actual.version_prompts} != ${esperado.version_prompts}`);
  }
  const porNombre = new Map((actual.archivos ?? []).map(a => [a.name, a]));
  for (const a of esperado.archivos) {
    const previo = porNombre.get(a.name);
    if (!previo) diferencias.push(`archivo sin registrar: ${a.name}`);
    else if (previo.sha256 !== a.sha256) diferencias.push(`sha256 distinto en ${a.name}`);
    else if (previo.chars !== a.chars) diferencias.push(`chars distinto en ${a.name}`);
    porNombre.delete(a.name);
  }
  for (const sobrante of porNombre.keys()) diferencias.push(`archivo en manifest que ya no existe: ${sobrante}`);
  for (const clave of [
    'version_manifest', 'contracts_version', 'regla_hash', 'roles', 'tools_de_sistema_prohibidas',
    'tools_por_rol', 'schema_salida_por_rol', 'modelo_propuesto_por_rol', 'techo_caracteres_por_rol',
    'fewshot_por_rol', 'fewshot_por_defecto', 'variantes', 'motivos_reintento',
    'roles_con_reintento', 'sufijo_variante_reintento', 'ambito_techo_por_defecto',
    'techo_system_caracteres',
  ]) {
    if (JSON.stringify(actual[clave]) !== JSON.stringify(esperado[clave])) {
      diferencias.push(`${clave} desactualizado`);
    }
  }
  return { ok: diferencias.length === 0, diferencias };
}

const ejecutadoDirectamente = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (ejecutadoDirectamente) {
  const modo = process.argv[2] ?? '--check';
  if (modo === '--write') {
    const m = escribirManifest();
    console.log(`manifest.json regenerado: version_prompts=${m.version_prompts} (${m.archivos.length} archivos)`);
  } else {
    const { ok, diferencias } = verificarManifest();
    if (ok) {
      console.log(`manifest.json al día: version_prompts=${leerManifest().version_prompts}`);
    } else {
      console.error('manifest.json desactualizado:');
      for (const d of diferencias) console.error(`  - ${d}`);
      process.exitCode = 1;
    }
  }
}
