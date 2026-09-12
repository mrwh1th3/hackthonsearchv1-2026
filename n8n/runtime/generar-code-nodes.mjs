#!/usr/bin/env node
// n8n/runtime/generar-code-nodes.mjs — genera los Code nodes desde funciones puras (17 §2).
//
// «Code nodes se generan desde funciones puras probadas, no ocho copias
// editadas a mano.» Este script extrae la región marcada de un módulo de
// n8n/runtime y la envuelve con el preámbulo del nodo Code de n8n.
//
// Uso:  node n8n/runtime/generar-code-nodes.mjs          (escribe n8n/code/)
//       node n8n/runtime/generar-code-nodes.mjs --check  (falla si hay deriva)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_N8N = path.resolve(AQUI, '..');

const MARCA_INICIO = '// <<<CODE_NODE_INICIO';
const MARCA_FIN = '// <<<CODE_NODE_FIN';

const PREAMBULO = 'const x = $input.first().json;';
const EPILOGO = 'return [{ json: salida }];';

// Algunos nodos no se alimentan solo del nodo anterior: necesitan la identidad
// del claim (`$('Decidir accion')`), el artefacto de contexto
// (`$('Cargar ejecución')`) o TODOS los ítems del lote de herramientas
// (`$input.all()`). El preámbulo es parte del contrato del nodo, así que se
// declara aquí junto a su fuente y no se escribe a mano dentro del JSON.
const PASO = "const paso = $('Decidir accion').first().json;";
const EJECUCION = "const ejecucion = $('Cargar ejecución').first().json;";
// Corrida: la identidad de la corrida (id, investigación, idempotencia) vive en
// el nodo que la abrió y no se re-deriva en cada vuelta del bucle.
const CORRIDA = "const corrida = $('Validar e idempotencia').first().json;";
// Salida de varios ítems (un cluster por ítem) para el subworkflow en modo
// `each`. El cuerpo garantiza al menos uno.
const ITEMS = 'return salida.map((json) => ({ json }));';

const nodo = (archivo, nota, preambulo = PREAMBULO, epilogo = EPILOGO) => ({
  fuente: path.join(RAIZ_N8N, 'runtime', 'nodos', `${archivo}.mjs`),
  destino: path.join(RAIZ_N8N, 'code', `${archivo}.js`),
  preambulo,
  epilogo,
  nota,
});

export const GENERADOS = [
  {
    fuente: path.join(RAIZ_N8N, 'runtime', 'auditor-final.mjs'),
    destino: path.join(RAIZ_N8N, 'code', 'auditor-final.js'),
    preambulo: PREAMBULO,
    epilogo: EPILOGO,
    nota: 'Auditor Final (07). Entrada preparada por backend, nunca JSON de agente sin validar.',
  },
  nodo('decidir-paso', 'Worker: traduce el checkpoint a la rama de ESTA ejecución (17 §3).'),
  nodo(
    'construir-cuerpo',
    'Worker: compone el body de /v1/messages con el system embebido y el transcript del checkpoint (17 §5.2).',
    [
      PASO,
      EJECUCION,
      'const reserva = $input.first().json;',
      'const x = Object.assign({}, ejecucion, paso, {',
      '  request_id: reserva.request_id ?? paso.request_id,',
      '  mensajes: (ejecucion.checkpoint || {}).mensajes,',
      "  sin_herramientas: paso.motivo_request === 'reparacion',",
      '  max_tokens: MAX_TOKENS_SALIDA[ejecucion.rol] ?? 2000,',
      '  techo_caracteres: CATALOGO_PROMPTS.techos[ejecucion.rol] ?? 0,',
      '  catalogo_prompts: CATALOGO_PROMPTS,',
      '});',
    ].join('\n'),
  ),
  nodo(
    'clasificar-transporte',
    'Worker: 429/5xx con Retry-After, timeout ambiguo (17 §6).',
    [
      EJECUCION,
      'const respuesta = $input.first().json;',
      'const x = Object.assign({}, respuesta, {',
      // `.item` (no `.first()`): el backoff vuelve a pasar por la reserva, así
      // que hay varias ejecuciones del nodo y hace falta la del ítem actual.
      "  intento: Number($('Reservar request').item.json.intento_transporte ?? 0) + 1,",
      '  deadline_at: ejecucion.deadline_at,',
      '});',
    ].join('\n'),
  ),
  nodo(
    'interpretar-respuesta',
    'Worker: stop_reason, cola de tool_use y parseo de salida (17 §5.5–5.8).',
    [
      PASO,
      EJECUCION,
      'const x = Object.assign({}, paso, {',
      '  rol: ejecucion.rol,',
      "  respuesta: $('POST /v1/messages').first().json,",
      '  mensajes_previos: (ejecucion.checkpoint || {}).mensajes ?? [],',
      '});',
    ].join('\n'),
  ),
  nodo(
    'expandir-cola-tools',
    'Worker: un ítem por tool_use de la respuesta, en orden y con p_operacion de backend (17 §5.5).',
    [
      PASO,
      EJECUCION,
      'const x = Object.assign({}, ejecucion, paso, {',
      '  checkpoint: ejecucion.checkpoint,',
      '  base_rest: BASE_REST,',
      '});',
    ].join('\n'),
    'return salida.items.map((json) => ({ json }));',
  ),
  nodo(
    'armar-tool-results',
    'Worker: un tool_result por cada tool_use_id, en orden, sobre TODO el lote (17 §5.5).',
    [
      PASO,
      EJECUCION,
      'const x = Object.assign({}, paso, {',
      "  cola: $('Expandir cola de tools').all().map((i) => i.json),",
      '  resultados: $input.all().map((i) => i.json),',
      '  mensajes_previos: (ejecucion.checkpoint || {}).mensajes ?? [],',
      '});',
    ].join('\n'),
  ),
  nodo('evaluar-frontera', 'Investigación: tabla de despertar de 03 y frontera material (07 §2.6).'),
  nodo('normalizar-investigacion', 'Investigación: une webhook y subworkflow; rechaza campos no aceptados.'),
  // Corrida: un solo criterio de admisión, dos puntos de entrada. El despacho
  // inicial recibe la cola COMPLETA del SELECT por score y cero casos activos;
  // el redespacho de cada vuelta recibe la cola VIVA y los casos activos que
  // devuelve `forense.cola_corrida`. Mismo cuerpo, distinto preámbulo: la
  // admisión no puede divergir entre la primera vuelta y las siguientes.
  {
    fuente: path.join(RAIZ_N8N, 'runtime', 'nodos', 'despachar-clusters.mjs'),
    destino: path.join(RAIZ_N8N, 'code', 'despachar-clusters-inicial.js'),
    preambulo: [
      CORRIDA,
      'const filas = $input.all().map((i) => i.json);',
      'const x = {',
      '  corrida_id: corrida.corrida_id,',
      '  investigacion_id: corrida.investigacion_id ?? null,',
      '  idempotency_base: corrida.idempotency_key,',
      '  max_activos: MAX_ACTIVOS,',
      '  casos_activos: 0,',
      // `alwaysOutputData` en el SELECT anterior hace que este nodo corra aunque
      // no haya clusters; el ítem vacío se descarta por no traer cluster_id.
      '  pendientes: filas.filter((f) => f && f.cluster_id)',
      '    .map((f) => ({ cluster_id: f.cluster_id, score: f.score })),',
      '};',
    ].join('\n'),
    epilogo: ITEMS,
    nota: 'Corrida: despacho inicial — admite hasta MAX_ACTIVOS clusters y deja el resto EN COLA (17 §2, regla 10).',
  },
  {
    fuente: path.join(RAIZ_N8N, 'runtime', 'nodos', 'despachar-clusters.mjs'),
    destino: path.join(RAIZ_N8N, 'code', 'despachar-clusters-cola.js'),
    preambulo: [
      CORRIDA,
      'const cola = $input.first().json;',
      'const x = {',
      '  corrida_id: corrida.corrida_id,',
      '  investigacion_id: corrida.investigacion_id ?? null,',
      '  idempotency_base: corrida.idempotency_key,',
      '  max_activos: MAX_ACTIVOS,',
      '  casos_activos: cola.casos_activos,',
      '  pendientes: cola.pendientes ?? [],',
      '};',
    ].join('\n'),
    epilogo: ITEMS,
    nota: 'Corrida: redespacho por vuelta — llena los slots que se liberaron mientras quede cola (hallazgo alto H11).',
  },
];

export function extraerRegion(rutaFuente) {
  const texto = fs.readFileSync(rutaFuente, 'utf8');
  const inicio = texto.indexOf(MARCA_INICIO);
  const fin = texto.indexOf(MARCA_FIN);
  if (inicio < 0 || fin < 0 || fin < inicio) throw new Error(`marcadores CODE_NODE ausentes en ${rutaFuente}`);
  const cuerpo = texto.slice(inicio + MARCA_INICIO.length, fin);
  const lineas = cuerpo.split('\n').slice(1); // descarta el resto de la línea del marcador
  // Quita la indentación común (la región vive dentro de una función).
  const sangrias = lineas.filter((l) => l.trim().length > 0).map((l) => l.match(/^ */)[0].length);
  const sangria = sangrias.length > 0 ? Math.min(...sangrias) : 0;
  return lineas.map((l) => l.slice(sangria)).join('\n').replace(/\s+$/, '');
}

export function construirArchivo(definicion) {
  const relativa = path.relative(path.dirname(definicion.destino), definicion.fuente).split(path.sep).join('/');
  return [
    '// ARCHIVO GENERADO — no editar a mano.',
    `// Fuente: ${relativa} (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs`,
    `// ${definicion.nota}`,
    '',
    definicion.preambulo,
    extraerRegion(definicion.fuente),
    definicion.epilogo,
    '',
  ].join('\n');
}

export function generar({ check = false } = {}) {
  const informe = [];
  for (const definicion of GENERADOS) {
    const contenido = construirArchivo(definicion);
    const existe = fs.existsSync(definicion.destino);
    const actual = existe ? fs.readFileSync(definicion.destino, 'utf8') : null;
    const igual = actual === contenido;
    if (!check && !igual) {
      fs.mkdirSync(path.dirname(definicion.destino), { recursive: true });
      fs.writeFileSync(definicion.destino, contenido);
    }
    informe.push({ destino: definicion.destino, igual, escrito: !check && !igual });
  }
  return informe;
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const check = process.argv.includes('--check');
  const informe = generar({ check });
  const deriva = informe.filter((r) => !r.igual);
  for (const r of informe) {
    console.log(`${r.igual ? 'ok      ' : check ? 'DERIVA  ' : 'escrito '} ${path.relative(process.cwd(), r.destino)}`);
  }
  if (check && deriva.length > 0) {
    console.error('Los Code nodes generados no coinciden con la fuente. Ejecuta el generador.');
    process.exit(1);
  }
}
