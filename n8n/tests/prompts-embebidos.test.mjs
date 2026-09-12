// n8n/tests/prompts-embebidos.test.mjs — los prompts que viajan dentro del JSON.
//
// El worker no puede leer `n8n/prompts/` en ejecución, así que el generador
// EMBEBE el system por rol en el Code node «Construir cuerpo Messages» y lo
// sella con `version_prompts` y el sha256 del manifest (17 §8).
//
// LO QUE ESTO PRUEBA:
//  1. que lo embebido es exactamente lo que `n8n/prompts/ensamblar.mjs` produce
//     —el ensamblador es la fuente, el nodo no reescribe el prompt—;
//  2. que el JSON lleva el sello del manifest;
//  3. que un `.md` cambiado sin regenerar el manifest hace fallar la generación
//     (no se embebe texto que el manifest no describe).
//
// LO QUE NO PRUEBA: nada de la calidad del prompt ni del modelo. Los prompts son
// de forense-prompts; aquí solo se comprueba el transporte.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalogoPrompts } from '../runtime/generar-workflows.mjs';
import { construirCuerpoNodo } from '../runtime/nodos/construir-cuerpo.mjs';
import {
  ensamblar, leerPrompt, renderContratoCompacto, toolsPorRol,
  ARCHIVO_POR_ROL, ROLES_LLM, SCHEMA_SALIDA_POR_ROL,
} from '../prompts/ensamblar.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ_REPO = path.resolve(RAIZ, '..');
const DIR_PROMPTS = path.join(RAIZ, 'prompts');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DIR_PROMPTS, 'manifest.json'), 'utf8'));

const worker = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', 'FORENSE_ejecutar_agente.json'), 'utf8'));
const nodoCuerpo = worker.nodes.find((n) => n.name === 'Construir cuerpo Messages');

const catalogo = catalogoPrompts();

const fixture = (nombre) => JSON.parse(
  fs.readFileSync(path.join(RAIZ_REPO, 'contracts', 'fixtures', 'valid', `${nombre}.json`), 'utf8'),
);

// rol → fixture de paquete de contexto válido (contracts v1).
const PAQUETES = {
  documental: 'contexto-r1',
  auditor: 'contexto-auditor',
  defensor: 'contexto-defensor',
  replica: 'contexto-replica',
  redactor: 'contexto-redactor',
  editor: 'contexto-editor',
};

test('el JSON del worker lleva el sello del manifest de prompts', () => {
  const js = nodoCuerpo.parameters.jsCode;
  assert.match(js, /const CATALOGO_PROMPTS = \{/, 'el catálogo se inyecta como constante del Code node');
  assert.ok(js.includes(`"version_prompts": "${MANIFEST.version_prompts}"`), 'falta version_prompts del manifest');
  assert.ok(js.includes(`"manifest_sha256": "${catalogo.manifest_sha256}"`), 'falta el sha256 del manifest');
  assert.ok(js.includes(`"contracts_version": "${MANIFEST.contracts_version}"`));
  // DECISIONES H3 01:36.
  assert.ok(js.includes('"ambito_techo": "paquete"'));
});

test('el catálogo embebido trae los diez roles con instrucciones, contrato y allowlist', () => {
  assert.deepEqual(Object.keys(catalogo.roles).sort(), [...ROLES_LLM].sort());
  for (const rol of ROLES_LLM) {
    const r = catalogo.roles[rol];
    assert.equal(r.instrucciones, leerPrompt(ARCHIVO_POR_ROL[rol]).trimEnd(), `${rol}: instrucciones`);
    assert.equal(r.contrato, renderContratoCompacto(SCHEMA_SALIDA_POR_ROL[rol]), `${rol}: contrato de salida`);
    assert.deepEqual(r.tools_r1, [...toolsPorRol(rol, 1)], `${rol}: allowlist de ronda 1`);
    assert.deepEqual(r.tools_r2, [...toolsPorRol(rol, 2)], `${rol}: allowlist de ronda informada`);
  }
  assert.equal(catalogo.comun, leerPrompt('comun.md').trimEnd());
});

// Ésta es la prueba que importa: el nodo no reimplementa el prompt, produce el
// MISMO system que el ensamblador de forense-prompts, bloque de identidad
// incluido. Si el ensamblador cambia de forma, este test falla.
for (const [rol, nombreFixture] of Object.entries(PAQUETES)) {
  test(`[SIMULADO] el system embebido para ${rol} es idéntico al de ensamblar.mjs`, () => {
    const paquete = fixture(nombreFixture);
    const esperado = ensamblar(rol, paquete, { ambito_techo: 'paquete' });
    const salida = construirCuerpoNodo({
      rol,
      paquete,
      ronda: paquete.ronda,
      modelo: 'claude-sonnet-5',
      max_tokens: 2000,
      mensajes: esperado.messages_iniciales,
      catalogo_prompts: catalogo,
      techo_caracteres: catalogo.techos[rol],
    });
    assert.equal(salida.system, esperado.system, `${rol}: el system del Code node se separó del ensamblador`);
    assert.equal(salida.version_prompts, MANIFEST.version_prompts);
    assert.equal(salida.ambito_techo, 'paquete');
    assert.equal(salida.cuerpo.system, esperado.system);
  });
}

test('[SIMULADO] la parte fija del system coincide para los diez roles, haya fixture o no', () => {
  for (const rol of ROLES_LLM) {
    const r = catalogo.roles[rol];
    const tools = r.tools_r1;
    const lista = tools.length === 0
      ? 'Ninguna. No tienes herramientas: no simules llamadas ni pidas datos nuevos.'
      : tools.map((t) => `- ${t}`).join('\n');
    const esperado = [
      catalogo.comun,
      r.instrucciones,
      `## Contrato de salida\n\n${r.contrato}`,
      `## Herramientas permitidas en esta tarea\n\n${lista}\nCualquier otra herramienta está denegada en el backend; intentarla gasta presupuesto y queda en bitácora.`,
    ].join('\n\n---\n\n');
    const salida = construirCuerpoNodo({
      rol,
      paquete: { ronda: 1, intento: 0, limites: {}, cobertura: {}, familias_evaluables: [] },
      ronda: 1,
      modelo: 'claude-sonnet-5',
      mensajes: [{ role: 'user', content: 'paquete' }],
      catalogo_prompts: catalogo,
    });
    assert.ok(salida.system.startsWith(esperado), `${rol}: la parte fija del system no coincide`);
  }
});

test('[SIMULADO] un rol sin tools no recibe la clave tools en el cuerpo (17 §5.8)', () => {
  for (const rol of ['replica', 'redactor', 'editor']) {
    const salida = construirCuerpoNodo({
      rol,
      paquete: { ronda: 1, limites: {}, cobertura: {} },
      modelo: 'claude-opus-5',
      mensajes: [{ role: 'user', content: 'x' }],
      catalogo_prompts: catalogo,
    });
    assert.equal('tools' in salida.cuerpo, false, `${rol} no puede recibir herramientas`);
  }
  // Reparación acotada: tampoco lleva tools aunque el rol tenga allowlist.
  const reparacion = construirCuerpoNodo({
    rol: 'documental',
    paquete: { ronda: 1, limites: {}, cobertura: {} },
    modelo: 'claude-sonnet-5',
    mensajes: [{ role: 'user', content: 'x' }],
    sin_herramientas: true,
    catalogo_prompts: catalogo,
  });
  assert.equal('tools' in reparacion.cuerpo, false);
});

test('[SIMULADO] el techo de caracteres se aplica al PAQUETE, no al system', () => {
  const rol = 'documental';
  const enorme = [{ role: 'user', content: 'x'.repeat(catalogo.techos[rol] + 1) }];
  assert.throws(
    () => construirCuerpoNodo({
      rol,
      paquete: { ronda: 1, limites: {}, cobertura: {} },
      modelo: 'claude-sonnet-5',
      mensajes: enorme,
      catalogo_prompts: catalogo,
      techo_caracteres: catalogo.techos[rol],
    }),
    /supera el techo/,
  );
  // El system de un especialista ronda los 9-10k: con ámbito 'total' no cabría
  // el paquete. Con ámbito 'paquete' (DECISIONES H3 01:36) sí.
  const ok = construirCuerpoNodo({
    rol,
    paquete: { ronda: 1, limites: {}, cobertura: {} },
    modelo: 'claude-sonnet-5',
    mensajes: [{ role: 'user', content: 'y'.repeat(5000) }],
    catalogo_prompts: catalogo,
    techo_caracteres: catalogo.techos[rol],
  });
  assert.ok(ok.caracteres_system > 5000, 'el system del especialista es grande: por eso el techo mide el paquete');
  assert.ok(ok.caracteres_paquete <= catalogo.techos[rol]);
});

// Si alguien edita un prompt y no regenera el manifest, el JSON llevaría texto
// que el manifest no describe, sellado con un version_prompts que miente.
test('la generación FALLA si un prompt cambia sin regenerar el manifest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-'));
  for (const nombre of fs.readdirSync(DIR_PROMPTS)) {
    fs.copyFileSync(path.join(DIR_PROMPTS, nombre), path.join(tmp, nombre));
  }
  // El catálogo se construye bien sobre la copia intacta…
  assert.equal(catalogoPrompts({ dir: tmp }).version_prompts, MANIFEST.version_prompts);
  // …y falla en cuanto el contenido deja de coincidir con su sha256.
  fs.appendFileSync(path.join(tmp, 'comun.md'), '\nregla extra no declarada en el manifest\n');
  assert.throws(() => catalogoPrompts({ dir: tmp }), /comun\.md: sha256 .* Regenera/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// DECISIONES H3 01:36 fija el techo del system en «≤10k medido». La medida real
// con paquete de contexto de verdad (bloque de identidad incluido): los cinco
// especialistas se quedan en 8.5–9.3k, y los roles de cierre
// (auditor/defensor/redactor) llegan a ~10.05k, es decir **rozan y pasan por
// poco** el redondeo de esa decisión. El techo que se prueba aquí es 10 500:
// es la cifra medida, no una holgura elegida a ojo. Si un prompt crece y lo
// supera, esta prueba falla y el coordinador decide, no se degrada en silencio.
const TECHO_SYSTEM = 10_500;

test('[SIMULADO] el system por rol cabe en el techo medido y se reporta su tamaño', () => {
  const medidas = [];
  for (const rol of ROLES_LLM) {
    const nombreFixture = PAQUETES[rol];
    const paquete = nombreFixture ? fixture(nombreFixture) : { ronda: 1, intento: 0, limites: {}, cobertura: {}, familias_evaluables: [] };
    const salida = construirCuerpoNodo({
      rol,
      paquete,
      ronda: paquete.ronda ?? 1,
      modelo: 'claude-sonnet-5',
      mensajes: [{ role: 'user', content: 'paquete' }],
      catalogo_prompts: catalogo,
    });
    medidas.push([rol, salida.caracteres_system]);
  }
  const excedidos = medidas.filter(([, n]) => n > TECHO_SYSTEM);
  assert.deepEqual(
    excedidos, [],
    `system por rol (caracteres): ${medidas.map(([r, n]) => `${r}=${n}`).join(' ')}`,
  );
  // Y el system NO se cuenta contra el techo del paquete: ese es el sentido de
  // ambito_techo='paquete'. Un especialista con system de ~9k y techo de 12k
  // se quedaría sin sitio para las pistas si se contaran juntos.
  const documental = medidas.find(([r]) => r === 'documental')[1];
  assert.ok(documental > catalogo.techos.documental / 2, 'el system de un especialista ocupa más de medio techo');
});
