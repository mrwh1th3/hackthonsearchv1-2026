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

const nodo = (archivo, nota) => ({
  fuente: path.join(RAIZ_N8N, 'runtime', 'nodos', `${archivo}.mjs`),
  destino: path.join(RAIZ_N8N, 'code', `${archivo}.js`),
  preambulo: PREAMBULO,
  epilogo: EPILOGO,
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
  nodo('construir-cuerpo', 'Worker: compone el body de /v1/messages con insumos de DB (17 §5.2).'),
  nodo('clasificar-transporte', 'Worker: 429/5xx con Retry-After, timeout ambiguo (17 §6).'),
  nodo('interpretar-respuesta', 'Worker: stop_reason, cola de tool_use y parseo de salida (17 §5.5–5.8).'),
  nodo('armar-tool-results', 'Worker: un tool_result por cada tool_use_id, en orden (17 §5.5).'),
  nodo('evaluar-frontera', 'Investigación: tabla de despertar de 03 y frontera material (07 §2.6).'),
  nodo('normalizar-investigacion', 'Investigación: une webhook y subworkflow; rechaza campos no aceptados.'),
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
