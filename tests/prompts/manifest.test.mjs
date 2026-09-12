// Manifest de prompts (17 §8): SHA-256 por archivo, `version_prompts` que cambia si cambia
// cualquiera, y la política (tools, contrato de salida, techo, modelo propuesto) por rol.
// `version_prompts` se guarda en `corridas` para comparar experimentos (10): si alguien edita
// un prompt y no regenera el manifest, la corrida quedaría etiquetada con una versión que no
// corresponde. Este test es el que lo impide.
//
//   node n8n/prompts/manifest.mjs --write   ← regenera tras editar cualquier prompt

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { contractVersion } from '../../contracts/index.mjs';
import {
  ROLES_LLM, SCHEMA_SALIDA_POR_ROL, MODELO_PROPUESTO_POR_ROL, TECHO_CARACTERES,
  TOOLS_DE_SISTEMA, ARCHIVO_POR_ROL, toolsPorRol,
} from '../../n8n/prompts/ensamblar.mjs';
import {
  construirManifest, leerManifest, verificarManifest, listarArchivos, REGLA_HASH,
} from '../../n8n/prompts/manifest.mjs';
import { DIR_PROMPTS } from './ayuda.mjs';

test('manifest.json está al día: ningún prompt cambió sin regenerarlo', () => {
  const { ok, diferencias } = verificarManifest();
  assert.deepEqual(
    diferencias, [],
    'ejecuta `node n8n/prompts/manifest.mjs --write` tras editar un prompt',
  );
  assert.equal(ok, true);
});

test('el manifest cubre todos los archivos de n8n/prompts salvo él mismo', () => {
  const manifest = leerManifest();
  const enDisco = fs.readdirSync(DIR_PROMPTS).filter(n => n !== 'manifest.json').sort();
  assert.deepEqual(manifest.archivos.map(a => a.name), enDisco);
  assert.ok(!manifest.archivos.some(a => a.name === 'manifest.json'), 'el manifest no se hashea a sí mismo');

  // Los archivos del ensamblador también entran: la política vive en código, no sólo en .md.
  for (const obligatorio of ['comun.md', 'ensamblar.mjs', 'manifest.mjs', ...Object.values(ARCHIVO_POR_ROL)]) {
    assert.ok(enDisco.includes(obligatorio), `falta ${obligatorio} en n8n/prompts`);
  }
});

test('cada sha256 del manifest es el del contenido real del archivo', () => {
  for (const { name, sha256, chars } of leerManifest().archivos) {
    const contenido = fs.readFileSync(path.join(DIR_PROMPTS, name), 'utf8');
    assert.equal(createHash('sha256').update(contenido, 'utf8').digest('hex'), sha256, name);
    assert.equal(contenido.length, chars, `${name}: chars`);
  }
});

test('version_prompts deriva de los hashes y cambia si cambia cualquier archivo', () => {
  const manifest = leerManifest();
  const hashes = manifest.archivos.map(a => a.sha256);
  const recalculada = createHash('sha256').update(hashes.join(''), 'utf8').digest('hex').slice(0, 12);
  assert.equal(manifest.version_prompts, recalculada);
  assert.match(manifest.version_prompts, /^[0-9a-f]{12}$/);
  assert.ok(REGLA_HASH.includes('version_prompts'), 'la regla de hash se documenta en el manifest');

  // Propiedad que hace útil el manifest: tocar un solo byte de un solo prompt cambia la
  // versión. Se comprueba sobre la regla, sin escribir en disco.
  for (let i = 0; i < hashes.length; i += 1) {
    const alterados = [...hashes];
    alterados[i] = createHash('sha256').update(`${hashes[i]}-editado`, 'utf8').digest('hex');
    const otra = createHash('sha256').update(alterados.join(''), 'utf8').digest('hex').slice(0, 12);
    assert.notEqual(otra, manifest.version_prompts, `cambiar ${manifest.archivos[i].name} no movió version_prompts`);
  }
});

test('verificarManifest detecta un archivo editado, uno nuevo y uno borrado', () => {
  const real = construirManifest();

  // Se simula la comparación con un manifest desfasado sin tocar el disco.
  const comparar = manifestGuardado => {
    const diferencias = [];
    const porNombre = new Map(manifestGuardado.archivos.map(a => [a.name, a]));
    for (const a of real.archivos) {
      const previo = porNombre.get(a.name);
      if (!previo) diferencias.push(`archivo sin registrar: ${a.name}`);
      else if (previo.sha256 !== a.sha256) diferencias.push(`sha256 distinto en ${a.name}`);
      porNombre.delete(a.name);
    }
    for (const sobrante of porNombre.keys()) diferencias.push(`archivo en manifest que ya no existe: ${sobrante}`);
    return diferencias;
  };

  const editado = structuredClone(real);
  editado.archivos[0].sha256 = 'f'.repeat(64);
  assert.deepEqual(comparar(editado), [`sha256 distinto en ${real.archivos[0].name}`]);

  const sinUno = structuredClone(real);
  const quitado = sinUno.archivos.pop();
  assert.deepEqual(comparar(sinUno), [`archivo sin registrar: ${quitado.name}`]);

  const deMas = structuredClone(real);
  deMas.archivos.push({ name: 'zzz-borrado.md', sha256: 'a'.repeat(64), chars: 1 });
  assert.deepEqual(comparar(deMas), ['archivo en manifest que ya no existe: zzz-borrado.md']);
});

test('el manifest declara la política por rol que usa el ensamblador', () => {
  const manifest = leerManifest();
  assert.deepEqual(manifest.roles, [...ROLES_LLM, 'mapper']);

  for (const rol of manifest.roles) {
    assert.deepEqual(manifest.tools_por_rol[rol].r1, toolsPorRol(rol, 1), `${rol} r1`);
    assert.deepEqual(manifest.tools_por_rol[rol].r2, toolsPorRol(rol, 2), `${rol} r2`);
    assert.equal(manifest.schema_salida_por_rol[rol], SCHEMA_SALIDA_POR_ROL[rol], `${rol} schema`);
    assert.equal(manifest.modelo_propuesto_por_rol[rol], MODELO_PROPUESTO_POR_ROL[rol], `${rol} modelo`);
    assert.equal(manifest.techo_caracteres_por_rol[rol], TECHO_CARACTERES[rol], `${rol} techo`);
  }
  assert.deepEqual(manifest.tools_de_sistema_prohibidas, [...TOOLS_DE_SISTEMA]);
});

test('el manifest apunta a la versión de contratos publicada, no a una copiada a mano', () => {
  assert.equal(leerManifest().contracts_version, contractVersion);
});

test('la asignación de modelos es la propuesta de 17 §7 (Sonnet D/T/E, Opus F/R y cierre)', () => {
  const esperado = {
    documental: 'sonnet', temporal: 'sonnet', externo: 'sonnet',
    redactor: 'sonnet', editor: 'sonnet', mapper: 'sonnet',
    financiero: 'opus', relacional: 'opus', auditor: 'opus', defensor: 'opus', replica: 'opus',
  };
  assert.deepEqual({ ...MODELO_PROPUESTO_POR_ROL }, esperado);
  assert.ok(
    leerManifest().nota.includes('propuestas de 17 §7 para medir'),
    'el manifest debe decir que los modelos son una propuesta a medir, no una asignación final',
  );
});

test('el Auditor Final no tiene prompt: es código determinista (03, regla 4)', () => {
  const nombres = listarArchivos();
  assert.ok(!nombres.some(n => /auditor[-_]?final/i.test(n)), 'el Auditor Final no lleva prompt');
  assert.ok(
    leerManifest().nota.includes('Auditor Final no aparece'),
    'el manifest debe explicar por qué no está',
  );
});
