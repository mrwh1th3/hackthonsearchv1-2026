#!/usr/bin/env node
// n8n/runtime/generar-workflows.mjs — emite los JSON importables de n8n/workflows.
//
// Por qué un generador y no JSON a mano (17 §2): los cuerpos de los Code nodes
// se leen de `n8n/code/*.js`, que a su vez se generan desde `n8n/runtime`. Así
// un cambio en la lógica no deja el workflow con una copia vieja pegada.
//
// Lo que estos archivos NO son: no están importados, ni probados contra la
// instancia, ni activados. `typeVersion` proviene de la tabla de
// n8n/workflows/MANIFEST.md §0.3 (observado en la instancia o «según SDK MCP»);
// la versión de n8n sigue sin confirmar.
//
// Uso:  node n8n/runtime/generar-workflows.mjs          (escribe n8n/workflows/)
//       node n8n/runtime/generar-workflows.mjs --check  (falla si hay deriva)

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  ARCHIVO_POR_ROL, ROLES_LLM, SCHEMA_SALIDA_POR_ROL, TECHO_CARACTERES,
  renderContratoCompacto, toolsPorRol,
  MOTIVOS_REINTENTO, ROLES_CON_REINTENTO, VARIANTE_REINTENTO_SIN_MOTIVO, FEWSHOT_POR_ROL,
} from '../prompts/ensamblar.mjs';
import { MAX_TOKENS_SALIDA } from './config.mjs';
// Voz: el endpoint y las variables permitidas son de forense-voice
// (integrations/elevenlabs). El runtime los CONSUME, no los redefine.
import { ENDPOINT_LLAMADA } from '../../integrations/elevenlabs/index.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_N8N = path.resolve(AQUI, '..');

// Base REST de las once RPC de 06. NO es un secreto (la clave la aporta la
// credencial `Forense Supabase`), pero sí es específica del entorno: se
// resuelve al importar, como los workflowId. Ver IMPORT.md §Variables.
export const BASE_REST_PENDIENTE = 'https://PENDIENTE_SUPABASE_REF.supabase.co/rest/v1';

export const CREDENCIALES = Object.freeze({
  postgres: { postgres: { name: 'Forense Postgres' } },
  supabase: { supabaseApi: { name: 'Forense Supabase' } },
  anthropic: { anthropicApi: { name: 'Anthropic account' } },
  webhook: { httpHeaderAuth: { name: 'Forense Webhook' } },
  elevenlabs: { httpHeaderAuth: { name: 'ElevenLabs Forense' } },
});

/** Pares (type, typeVersion) permitidos — MANIFEST §0.3. */
export const TIPOS_PERMITIDOS = Object.freeze({
  'n8n-nodes-base.code': 2,
  'n8n-nodes-base.postgres': 2.7,
  'n8n-nodes-base.httpRequest': 4.2,
  'n8n-nodes-base.respondToWebhook': 1.5,
  'n8n-nodes-base.webhook': 2.1,
  'n8n-nodes-base.if': 2.3,
  'n8n-nodes-base.switch': 3.4,
  'n8n-nodes-base.stickyNote': 1,
  'n8n-nodes-base.executeWorkflow': 1.3,
  'n8n-nodes-base.executeWorkflowTrigger': 1.2,
  'n8n-nodes-base.scheduleTrigger': 1.3,
  'n8n-nodes-base.set': 3.5,
  'n8n-nodes-base.errorTrigger': 1,
  'n8n-nodes-base.wait': 1.1,
});

function cuerpoCodeNode(archivo) {
  const ruta = path.join(RAIZ_N8N, 'code', `${archivo}.js`);
  if (!fs.existsSync(ruta)) {
    throw new Error(`falta ${ruta}: ejecuta node n8n/runtime/generar-code-nodes.mjs`);
  }
  return fs.readFileSync(ruta, 'utf8').replace(/\s+$/, '');
}

// -------------------------------------------------------- catálogo de prompts
//
// 17 §8: «manifest con SHA-256 de contenido, schemas, herramientas y política.
// `version_prompts` cambia si cambia cualquiera». El worker no puede leer
// `n8n/prompts/` en ejecución (un Code node no importa archivos del repo) ni
// existe todavía una tabla de prompts, así que el system por rol se EMBEBE en
// el JSON en tiempo de generación, sellado con `version_prompts` y el sha256
// del manifest.
//
// Si un `.md` cambia sin regenerar el manifest, esta función FALLA (el sha256
// del archivo no coincide con el del manifest). Si el manifest cambia, cambia
// la constante embebida y `--check` detecta la deriva del JSON. Los prompts son
// de forense-prompts: aquí solo se leen.
const DIR_PROMPTS = path.join(RAIZ_N8N, 'prompts');

function sha256(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export function catalogoPrompts({ dir = DIR_PROMPTS } = {}) {
  const rutaManifest = path.join(dir, 'manifest.json');
  const crudoManifest = fs.readFileSync(rutaManifest, 'utf8');
  const manifest = JSON.parse(crudoManifest);
  const esperados = new Map((manifest.archivos ?? []).map((a) => [a.name, a.sha256]));

  const leer = (nombre) => {
    const texto = fs.readFileSync(path.join(dir, nombre), 'utf8');
    const real = sha256(texto);
    const esperado = esperados.get(nombre);
    if (esperado === undefined) {
      throw new Error(`${nombre} no está en n8n/prompts/manifest.json: regenera el manifest antes de embeber prompts`);
    }
    if (esperado !== real) {
      throw new Error(`${nombre}: sha256 ${real} ≠ ${esperado} del manifest. Regenera n8n/prompts/manifest.json (dueño: forense-prompts).`);
    }
    return texto.trimEnd();
  };

  const roles = {};
  for (const rol of ROLES_LLM) {
    roles[rol] = {
      instrucciones: leer(ARCHIVO_POR_ROL[rol]),
      // El contrato de salida se RENDERIZA desde contracts con el mismo
      // ensamblador que usa el runtime: no se transcribe a mano.
      contrato: renderContratoCompacto(SCHEMA_SALIDA_POR_ROL[rol]),
      schema_salida: SCHEMA_SALIDA_POR_ROL[rol],
      tools_r1: [...toolsPorRol(rol, 1)],
      tools_r2: [...toolsPorRol(rol, 2)],
    };
  }
  return {
    version_prompts: manifest.version_prompts,
    contracts_version: manifest.contracts_version,
    manifest_sha256: sha256(crudoManifest),
    // DECISIONES H3 01:36: los techos de 12k/24k de 08 + 17 §7 miden el
    // PAQUETE de contexto, no el system.
    ambito_techo: 'paquete',
    comun: leer('comun.md'),
    techos: { ...TECHO_CARACTERES },
    roles,
  };
}

// Módulos de `integrations/` (dueño: forense-voice) embebidos VERBATIM en un
// Code node. No se copia lógica a mano: se lee el archivo, se quitan los
// `import`/`export` de ESM (n8n Code nodes no son módulos) y se declara el
// `require` equivalente. Si forense-voice cambia el módulo, el JSON cambia y
// `--check` lo detecta; lo que NO ocurre es que el workflow lleve una copia
// vieja de la verificación de firma.
const DIR_INTEGRACIONES = path.resolve(RAIZ_N8N, '..', 'integrations');

export function embeberModulo(relativa, { requires = [] } = {}) {
  const ruta = path.join(DIR_INTEGRACIONES, relativa);
  const texto = fs.readFileSync(ruta, 'utf8');
  const cuerpo = texto
    .split('\n')
    .filter((l) => !/^\s*import\s/.test(l))
    .join('\n')
    .replace(/^export\s+(const|function|class|let)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .trimEnd();
  return [
    `// ===== EMBEBIDO VERBATIM de integrations/${relativa} (dueño: forense-voice).`,
    '// Generado por n8n/runtime/generar-workflows.mjs — no editar aquí.',
    ...requires.map((r) => `const { ${r.nombres.join(', ')} } = require('${r.modulo}');`),
    cuerpo,
    `// ===== fin de integrations/${relativa}`,
  ].join('\n');
}

/** Constantes que el generador inyecta en el cuerpo de un Code node. */
function bloqueConstantes(pares) {
  const lineas = ['// Constantes inyectadas por n8n/runtime/generar-workflows.mjs.'];
  for (const [nombre, valor, nota] of pares) {
    if (nota) lineas.push(`// ${nota}`);
    lineas.push(`const ${nombre} = ${JSON.stringify(valor, null, 2)};`);
  }
  return lineas.join('\n');
}

// ---------------------------------------------------------------- constructores

let columna = 0;
let fila = 0;
const posicion = () => [columna * 220, fila * 140];

function nodo(name, type, parameters, extras = {}) {
  const typeVersion = TIPOS_PERMITIDOS[type];
  if (typeVersion === undefined) throw new Error(`tipo no permitido: ${type}`);
  return { parameters, type, typeVersion, position: posicion(), name, ...extras };
}

const code = (name, archivo, constantes = null) => nodo(
  name,
  'n8n-nodes-base.code',
  { jsCode: constantes ? `${bloqueConstantes(constantes)}\n\n${cuerpoCodeNode(archivo)}` : cuerpoCodeNode(archivo) },
);

const codeInline = (name, jsCode) => nodo(name, 'n8n-nodes-base.code', { jsCode });

const sql = (name, query, reemplazos = null, notaDependencia = null) => nodo(
  name,
  'n8n-nodes-base.postgres',
  {
    operation: 'executeQuery',
    query: notaDependencia ? `-- ${notaDependencia}\n${query}` : query,
    options: reemplazos ? { queryReplacement: reemplazos } : {},
  },
  { credentials: CREDENCIALES.postgres },
);

function condicionBooleana(expresion, operacion = 'true') {
  return {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{
      id: 'c1',
      leftValue: expresion,
      rightValue: '',
      operator: { type: 'boolean', operation: operacion, singleValue: true },
    }],
    combinator: 'and',
  };
}

function condicionIgual(expresion, valor) {
  return {
    options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
    conditions: [{
      id: `c_${valor}`,
      leftValue: expresion,
      rightValue: valor,
      operator: { type: 'string', operation: 'equals' },
    }],
    combinator: 'and',
  };
}

const si = (name, expresion, operacion = 'true') => nodo(
  name, 'n8n-nodes-base.if', { conditions: condicionBooleana(expresion, operacion), options: {} },
);

const ruta = (name, expresion, claves) => nodo(
  name,
  'n8n-nodes-base.switch',
  {
    rules: {
      values: claves.map((clave) => ({
        conditions: condicionIgual(expresion, clave),
        renameOutput: true,
        outputKey: clave,
      })),
    },
    options: { fallbackOutput: 'none' },
  },
);

const esperar = (name, expresionMs) => nodo(
  name, 'n8n-nodes-base.wait', { resume: 'timeInterval', amount: expresionMs, unit: 'ms' },
);

const subworkflow = (name, destino, campos, { esperar: esperarFin = false, modo = 'once' } = {}) => nodo(
  name,
  'n8n-nodes-base.executeWorkflow',
  {
    workflowId: {
      __rl: true,
      mode: 'list',
      value: `PENDIENTE_${destino.toUpperCase()}`,
      cachedResultName: destino,
    },
    workflowInputs: { mappingMode: 'defineBelow', value: campos },
    mode: modo,
    options: { waitForSubWorkflow: esperarFin },
  },
);

const nota = (name, contenido, alto = 220, ancho = 380) => nodo(
  name, 'n8n-nodes-base.stickyNote', { content: contenido, height: alto, width: ancho, color: 4 },
);

function conectar(pares) {
  const connections = {};
  for (const [origen, destinos, salida = 0] of pares) {
    connections[origen] ??= { main: [] };
    while (connections[origen].main.length <= salida) connections[origen].main.push([]);
    for (const destino of [].concat(destinos)) {
      connections[origen].main[salida].push({ node: destino, type: 'main', index: 0 });
    }
  }
  return connections;
}

function workflow(name, nodes, connections) {
  return { name, nodes, connections, active: false, settings: { executionOrder: 'v1' } };
}

// ------------------------------------------------- FORENSE_ejecutar_agente

// Convención de cableado del worker (cierra los saltos de MANIFEST §2.1):
//
//  - La IDENTIDAD del claim (execution_id, fencing_token, revision, caso_id,
//    tarea_id, rol, paso, paso_pipeline, request_id) se lee siempre de
//    `$('Decidir accion')`, que está aguas arriba de las tres ramas. No se
//    reenvía por eco en cada SELECT ni se vuelve a inventar.
//  - La CARGA de cada paso viaja por `$json` entre nodos contiguos.
//  - Las funciones de 17 §4 devuelven `jsonb`; se abren con `jsonb_to_record`
//    para que el grafo lea columnas con nombre y no navegue un objeto anidado.
const ID = (campo) => `={{ $('Decidir accion').first().json.${campo} }}`;

export function workerEjecutarAgente() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };

  add(nodo('Paso entrante', 'n8n-nodes-base.executeWorkflowTrigger', { inputSource: 'passthrough' }));

  add(sql(
    'Reclamar paso',
    [
      'SELECT c.ok, c.error, c.execution_id, c.fence AS fencing_token, c.revision, c.paso,',
      '       c.estado_interno, c.rol, c.tarea_id, c.caso_id, c.corrida_id,',
      '       c.editor_operacion_id, c.checkpoint, c.deadline_at, $2::text AS owner',
      '  FROM jsonb_to_record(forense.claim_step($1::uuid, $2::text))',
      '    AS c(ok boolean, error text, execution_id uuid, fence bigint, revision int, paso int,',
      '         estado_interno text, rol text, tarea_id uuid, caso_id uuid, corrida_id uuid,',
      '         editor_operacion_id uuid, checkpoint jsonb, deadline_at timestamptz)',
    ].join('\n'),
    '={{ $json.execution_id }}, ={{ $json.owner }}',
    '17 §4: claim_step devuelve jsonb {ok, fence, revision, estado_interno, checkpoint…}.',
  ));

  add(si('¿Claim vigente?', '={{ $json.ok }}'));

  fila = 1; columna = 3;
  add(codeInline('Paso no reclamable', [
    '// El slot es de otro owner con lease vigente. Una tarea sin slot queda',
    '// PENDIENTE, nunca fallida (17 §3). El reconciliador la retomará.',
    'const x = $input.first().json;',
    'const salida = {',
    "  estado: 'en_cola',",
    "  motivo: x.error ?? 'lease de otro owner vigente',",
    '  execution_id: x.execution_id ?? null,',
    '  caso_id: x.caso_id ?? null,',
    '  corrida_id: x.corrida_id ?? null,',
    '  tarea_id: x.tarea_id ?? null,',
    '  owner: x.owner ?? null,',
    '};',
    'return [{ json: salida }];',
  ].join('\n')));
  // Regla 2 de CLAUDE.md: si no escribió en bitacora, el paso no existió. La UI
  // necesita este evento para mostrar «en cola» sin inventar animación.
  add(sql(
    'Registrar en_cola',
    [
      '-- La identidad se resuelve DESDE LA EJECUCIÓN, no desde la respuesta del',
      '-- claim: cuando claim_step falla devuelve {ok:false, error} y ni caso_id',
      '-- ni corrida_id vienen en el payload. forense.bitacora.corrida_id es NOT',
      '-- NULL, así que confiar en ese payload rompía justo el evento que la',
      '-- regla 2 exige para la rama en cola.',
      'WITH id AS (',
      '  SELECT e.caso_id, e.corrida_id, e.tarea_id, e.rol',
      '    FROM forense.ejecuciones_agente e WHERE e.id = $1::uuid',
      '), ev AS (',
      '  SELECT forense.log(',
      "           p_caso => id.caso_id, p_agente => coalesce(id.rol, 'sistema'),",
      "           p_tipo => 'paso_en_cola', p_payload => $2::jsonb,",
      '           p_tarea => id.tarea_id, p_corrida => id.corrida_id)',
      '    FROM id',
      ')',
      "SELECT id.caso_id, id.corrida_id, id.tarea_id, 'paso_en_cola'::text AS tipo_evento,",
      '       true AS registrado',
      '  FROM id, ev',
    ].join('\n'),
    '={{ $json.execution_id }}, ={{ JSON.stringify({ execution_id: $json.execution_id, motivo: $json.motivo, owner: $json.owner }) }}',
    "Sin evento persistido no hay progreso visible (regla 2; 21 §3.3). 'paso_en_cola' PENDE del check de bitacora: ver IMPORT.md §Variables.",
  ));

  fila = 0; columna = 3;
  add(sql(
    'Cargar ejecución',
    [
      '-- Echo de la identidad del claim + artefacto de contexto inmutable (17 §7).',
      'SELECT $1::uuid AS execution_id, $2::text AS owner, $3::bigint AS fencing_token,',
      '       e.revision, e.paso, e.estado_interno, e.rol, e.tarea_id, e.caso_id, e.corrida_id,',
      '       e.editor_operacion_id, e.checkpoint_json AS checkpoint, e.deadline_at,',
      '       e.model_id AS modelo, e.prompt_hash, e.context_hash,',
      '       a.contenido AS paquete, t.ronda, t.intento, t.agente,',
      "       coalesce(p.paso, 'ronda' || coalesce(t.ronda::text, '1')) AS paso_pipeline",
      '  FROM forense.ejecuciones_agente e',
      '  LEFT JOIN forense.artefactos_contexto a',
      '         ON a.ejecucion_id = e.id AND a.hash = e.context_hash',
      '  LEFT JOIN forense.tareas_agente t ON t.id = e.tarea_id',
      '  LEFT JOIN LATERAL (SELECT pp.paso FROM forense.pasos_pipeline pp',
      "                      WHERE pp.caso_id = e.caso_id AND pp.estado = 'abierto'",
      '                      ORDER BY pp.creado DESC, pp.id DESC LIMIT 1) p ON true',
      ' WHERE e.id = $1::uuid',
    ].join('\n'),
    '={{ $json.execution_id }}, ={{ $json.owner }}, ={{ $json.fencing_token }}',
    'El paquete de contexto es el artefacto inmutable de la ejecución, no un JSON recompuesto por el nodo.',
  ));

  add(code('Decidir accion', 'decidir-paso'));
  add(ruta('Ruta del paso', '={{ $json.accion }}', ['solicitar_modelo', 'ejecutar_herramienta', 'cerrar']));

  // --- rama modelo
  fila = 0; columna = 6;
  add(sql(
    'Reservar request',
    [
      'SELECT r.ok, r.error, r.duplicado, r.request_id, r.bolsa, r.restante, r.intento_transporte',
      '  FROM jsonb_to_record(forense.reserve_request($1::uuid, $2::bigint, $3::text, $4::int, $5::text))',
      '    AS r(ok boolean, error text, duplicado boolean, request_id text, bolsa text,',
      '         restante int, intento_transporte int)',
    ].join('\n'),
    `${ID('execution_id')}, ${ID('fencing_token')}, ${ID('request_id')}, ${ID('paso')}, ={{ $('Cargar ejecución').first().json.modelo }}`,
    '17 §5.3: la reserva ocurre ANTES del HTTP. request_id es TEXT y determinista (execution:paso:motivo): un reintento de transporte reusa el mismo y no consume cuota nueva.',
  ));
  add(code('Construir cuerpo Messages', 'construir-cuerpo', [
    ['CATALOGO_PROMPTS', catalogoPrompts(),
      'Prompts de n8n/prompts sellados con version_prompts y el sha256 del manifest (17 §8).'],
    ['MAX_TOKENS_SALIDA', { ...MAX_TOKENS_SALIDA }, 'Techo de salida por rol (17 §7).'],
    ['MOTIVOS_REINTENTO', [...MOTIVOS_REINTENTO],
      'Motivos tipificados de reintento (07 §3). Cualquier otro valor NO es motivo.'],
    ['ROLES_CON_REINTENTO', [...ROLES_CON_REINTENTO],
      'Sólo estos roles degradan a reintento sin motivo; Réplica/Redactor/Editor no reintentan.'],
    ['VARIANTE_REINTENTO_SIN_MOTIVO', VARIANTE_REINTENTO_SIN_MOTIVO,
      'Sufijo de la variante degradada (decisión H9 07:33). No es un motivo.'],
    ['ROLES_FEWSHOT', Object.keys(FEWSHOT_POR_ROL),
      'Roles con ejemplo adversarial: fuera de esta lista `fewshot` no cambia la variante.'],
  ]));
  // Rama hoja: el hueco declarado por el ensamblado deja evento ANTES de que la
  // respuesta del modelo exista. Va aparte del camino principal para que un fallo
  // de escritura del aviso no impida la llamada, pero el evento no es opcional
  // (regla 2): sin él, la corrida no puede explicar por qué el prompt cambió.
  fila = 1; columna = 8;
  add(sql(
    'Registrar aviso de reintento',
    [
      'WITH ev AS (',
      '  INSERT INTO forense.bitacora (corrida_id, caso_id, tarea_id, ronda, intento, agente, tipo_evento, payload)',
      "  SELECT $2::uuid, $3::uuid, $4::uuid, $5::int, $6::int, $7::text, 'razonamiento',",
      "         jsonb_build_object('evento_real', 'aviso_reintento', 'aviso', $1::text,",
      "                            'variante_prompt', $8::text, 'prompt_hash', $9::text)",
      "   WHERE $1::text IS NOT NULL AND $1::text <> '' AND $1::text <> 'null'",
      '  RETURNING id',
      ')',
      'SELECT $3::uuid AS caso_id, $4::uuid AS tarea_id, $8::text AS variante_prompt,',
      "       'razonamiento'::text AS tipo_evento, 'aviso_reintento'::text AS evento_real,",
      '       (SELECT count(*) FROM ev) > 0 AS registrado',
    ].join('\n'),
    [
      '={{ $json.aviso_reintento ?? \'\' }}', `${ID('corrida_id')}`, `${ID('caso_id')}`, `${ID('tarea_id')}`,
      "={{ $('Cargar ejecución').first().json.ronda ?? 1 }}",
      '={{ $json.intento ?? 0 }}', `${ID('rol')}`,
      '={{ $json.variante_prompt }}', '={{ $json.prompt_hash }}',
    ].join(', '),
    "El enum de bitacora ya admite 'reintento_inicio', pero ese evento es del bucle de reintento (07 §3) y lo cuenta 10: reusarlo aquí inflaría los reintentos. El aviso viaja como 'razonamiento' con payload.evento_real='aviso_reintento'. La consulta devuelve SIEMPRE una fila: sin aviso, registrado=false.",
  ));

  fila = 0; columna = 8;
  add(nodo(
    'POST /v1/messages',
    'n8n-nodes-base.httpRequest',
    {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'anthropicApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify($('Construir cuerpo Messages').first().json.cuerpo) }}",
      options: {
        timeout: 45000,
        response: { response: { fullResponse: true, neverError: true } },
      },
    },
    { credentials: CREDENCIALES.anthropic, retryOnFail: false },
  ));
  add(code('Clasificar transporte', 'clasificar-transporte'));
  // Ruta EXCLUYENTE: una respuesta correcta no puede caer además en la rama de
  // «desconocido». El Code node decide, el switch solo enruta.
  add(ruta('Ruta de transporte', '={{ $json.ruta }}', ['continuar', 'reintentar', 'desconocido', 'error']));

  fila = 2; columna = 10;
  add(esperar('Backoff', '={{ $json.espera_ms }}'));

  fila = 3; columna = 10;
  add(sql(
    'Marcar desconocido',
    [
      'UPDATE forense.llm_solicitudes',
      "   SET estado = 'desconocido', error = $2::text, actualizado = now()",
      ' WHERE request_id = $1::text',
      "RETURNING request_id, estado, 'error'::text AS estado_interno,",
      "          jsonb_build_object('estado_interno','error','ultimo_evento','ambiguo',",
      "                             'diagnostico', $2::text) AS checkpoint",
    ].join('\n'),
    `${ID('request_id')}, ={{ 'timeout_ambiguo: ' + ($json.motivo ?? 'sin respuesta del proveedor') }}`,
    '17 §6: timeout ambiguo. Puede haber coste externo sin respuesta; no se afirma exactly-once. El paso cierra en error.',
  ));

  fila = 4; columna = 10;
  add(sql(
    'Marcar error de request',
    [
      'UPDATE forense.llm_solicitudes',
      "   SET estado = 'error', error = $2::text, actualizado = now()",
      ' WHERE request_id = $1::text',
      "RETURNING request_id, estado, 'error'::text AS estado_interno,",
      "          jsonb_build_object('estado_interno','error','ultimo_evento','transporte',",
      "                             'diagnostico', $2::text) AS checkpoint",
    ].join('\n'),
    `${ID('request_id')}, ={{ ($json.clase ?? 'error') + ': ' + ($json.motivo ?? 'error permanente del proveedor') }}`,
    'Error permanente del proveedor o reintentos de transporte agotados: el paso cierra en error, no reintenta solo.',
  ));

  fila = 0; columna = 11;
  add(code('Interpretar respuesta', 'interpretar-respuesta'));
  // 17 §8: la validación es de DOS niveles. El Code node solo comprueba
  // estructura (no puede cargar ajv); la autoritativa contra el schema del rol
  // y los IDs vive en backend. Sin este nodo, `salida_estructura_ok` llegaría al
  // checkpoint como si fuera una salida válida.
  add(sql(
    'Validar salida contra contrato',
    [
      'SELECT v.ok AS salida_valida, v.errores,',
      '       $4::text AS estado_interno,',
      "       ($5::jsonb || jsonb_build_object('salida_valida', coalesce(v.ok, false),",
      "                                        'errores_contrato', coalesce(v.errores, '[]'::jsonb))) AS checkpoint",
      '  FROM jsonb_to_record(forense.validar_salida_rol($1::uuid, $2::text, $3::jsonb))',
      '    AS v(ok boolean, errores jsonb)',
    ].join('\n'),
    `${ID('execution_id')}, ${ID('rol')}, ={{ JSON.stringify($json.salida ?? null) }}, ={{ $json.estado_interno }}, ={{ JSON.stringify($json.checkpoint) }}`,
    'DEPENDE de forense-db (004/005): validación de contrato + IDs + unidades. Un ID existente no prueba una frase (17 §8).',
  ));
  add(sql(
    'Completar request',
    [
      'UPDATE forense.llm_solicitudes',
      "   SET estado = 'completado', provider_request_id = $2::text,",
      '       usage = $3::jsonb, modelo = coalesce($4::text, modelo),',
      "       tokens_in = ($3::jsonb->>'input_tokens')::int,",
      "       tokens_out = ($3::jsonb->>'output_tokens')::int,",
      '       actualizado = now()',
      ' WHERE request_id = $1::text',
      'RETURNING request_id, estado, $5::text AS estado_interno, $6::jsonb AS checkpoint',
    ].join('\n'),
    `${ID('request_id')}, ={{ $('Interpretar respuesta').first().json.provider_request_id }}, ={{ JSON.stringify($('Interpretar respuesta').first().json.usage) }}, ={{ $('Interpretar respuesta').first().json.modelo }}, ={{ $json.estado_interno }}, ={{ JSON.stringify($json.checkpoint) }}`,
    'IDs y usage reales del proveedor (17 §5.4); el contenido de razonamiento no sale de backend.',
  ));

  // --- rama herramientas: TODOS los tool_use de la respuesta, un ítem por
  // herramienta, secuencialmente (17 §5.5).
  fila = 1; columna = 6;
  add(code('Expandir cola de tools', 'expandir-cola-tools', [
    ['BASE_REST', BASE_REST_PENDIENTE, 'Se resuelve al importar (IMPORT.md §Variables); la clave la aporta la credencial.'],
  ]));
  add(sql(
    'Reclamar tool',
    [
      'SELECT t.ok, t.duplicado, t.tool_ejecucion_id, t.estado, t.resultado_ref, t.error,',
      '       $4::text AS tool_use_id, $6::text AS nombre, forense.args_hash($5::jsonb) AS args_hash',
      '  FROM jsonb_to_record(forense.claim_tool($1::uuid, $2::bigint, $3::text, $4::text,',
      '                                          forense.args_hash($5::jsonb), $6::text))',
      '    AS t(ok boolean, duplicado boolean, tool_ejecucion_id bigint, estado text,',
      '         resultado_ref jsonb, error text)',
    ].join('\n'),
    `${ID('execution_id')}, ${ID('fencing_token')}, ={{ $json.request_id }}, ={{ $json.tool_use_id }}, ={{ JSON.stringify($json.argumentos_backend) }}, ={{ $json.nombre }}`,
    '17 §4: unicidad (request_id, tool_use_id). `duplicado=true` es una REENTREGA: el ledger ya tiene el resultado y la RPC lo devuelve por p_operacion sin consumir cuota (06 §Runtime).',
  ));
  add(nodo(
    'Llamar RPC forense',
    'n8n-nodes-base.httpRequest',
    {
      method: 'POST',
      url: "={{ $('Expandir cola de tools').item.json.base_rest }}/rpc/{{ $('Expandir cola de tools').item.json.nombre }}",
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      specifyBody: 'json',
      // p_operacion / p_tarea / p_caso los fija el backend: nunca $fromAI (17 §1).
      jsonBody: "={{ JSON.stringify($('Expandir cola de tools').item.json.argumentos_backend) }}",
      options: {
        timeout: 20000,
        response: { response: { fullResponse: true, neverError: true } },
      },
    },
    { credentials: CREDENCIALES.supabase, retryOnFail: false },
  ));
  add(sql(
    'Registrar resultado tool',
    [
      'SELECT f.ok, $1::bigint AS tool_ejecucion_id, $2::text AS estado,',
      '       $4::text AS tool_use_id, $5::jsonb AS resultado, $6::boolean AS duplicado',
      '  FROM jsonb_to_record(forense.finish_tool($1::bigint, $2::text, $3::jsonb, null))',
      '    AS f(ok boolean)',
    ].join('\n'),
    "={{ $('Reclamar tool').item.json.tool_ejecucion_id }}, ={{ $json.statusCode >= 200 && $json.statusCode < 300 ? 'completado' : 'error' }}, ={{ JSON.stringify($json.body ?? null) }}, ={{ $('Expandir cola de tools').item.json.tool_use_id }}, ={{ JSON.stringify($json.body ?? null) }}, ={{ $('Reclamar tool').item.json.duplicado === true }}",
    'La RPC de 06 ya escribió evidencia y bitácora una sola vez; aquí solo se cierra el ledger de la operación.',
  ));
  add(code('Armar tool_results', 'armar-tool-results'));

  // --- cierre
  fila = 0; columna = 14;
  add(sql(
    'Guardar checkpoint',
    [
      'SELECT g.ok, g.error, g.revision, g.revision_actual, $5::text AS estado_interno',
      '  FROM jsonb_to_record(forense.save_checkpoint($1::uuid, $2::bigint, $3::int, $4::jsonb))',
      '    AS g(ok boolean, error text, revision int, revision_actual int)',
    ].join('\n'),
    `${ID('execution_id')}, ${ID('fencing_token')}, ${ID('revision')}, ={{ JSON.stringify($json.checkpoint) }}, ={{ $json.estado_interno }}`,
    '17 §3: CAS sobre (execution, revision) + fencing. Un lease vencido no puede escribir; el conflicto de revisión frena una segunda escritura del mismo paso.',
  ));
  add(si('¿Estado terminal?', '={{ ["terminado","error","timeout"].includes($json.estado_interno) }}'));

  fila = 1; columna = 16;
  // Regla 2: la rama que NO cierra también deja rastro. Sin este evento la UI
  // no puede animar el avance del paso (21 §3.3).
  add(sql(
    'Registrar paso guardado',
    [
      'WITH ev AS (',
      '  SELECT forense.log(',
      "           p_caso => $1::uuid, p_agente => $2::text, p_tipo => 'paso_checkpoint',",
      '           p_payload => $3::jsonb, p_tarea => $4::uuid, p_corrida => $5::uuid)',
      ')',
      "SELECT $1::uuid AS caso_id, 'paso_checkpoint'::text AS tipo_evento, true AS registrado FROM ev",
    ].join('\n'),
    `${ID('caso_id')}, ${ID('rol')}, ={{ JSON.stringify({ execution_id: $('Decidir accion').first().json.execution_id, estado_interno: $json.estado_interno, revision: $json.revision }) }}, ${ID('tarea_id')}, ${ID('corrida_id')}`,
    "Regla 2 de CLAUDE.md. 'paso_checkpoint' PENDE del check de bitacora: ver IMPORT.md §Variables.",
  ));
  add(subworkflow('Redespachar paso', 'FORENSE_ejecutar_agente', {
    tarea_id: ID('tarea_id'),
    execution_id: ID('execution_id'),
    owner: ID('owner'),
  }, { esperar: false }));

  fila = 0; columna = 16;
  add(sql(
    'Finalizar paso',
    [
      'SELECT f.ok, f.error, f.revision, f.estado_interno, f.tarea_id, f.caso_id',
      '  FROM jsonb_to_record(forense.finish_step($1::uuid, $2::bigint, $3::int, $4::text,',
      "                                           '{}'::jsonb, $5::text))",
      '    AS f(ok boolean, error text, revision int, estado_interno text,',
      '         tarea_id uuid, caso_id uuid)',
    ].join('\n'),
    `${ID('execution_id')}, ${ID('fencing_token')}, ={{ $json.revision }}, ={{ $json.estado_interno }}, ={{ $('Decidir accion').first().json.razon ?? null }}`,
    'finish_step recibe el estado INTERNO (terminado|error|timeout) y deriva el estado de la tarea; libera slot y lease.',
  ));
  add(sql(
    'Avanzar caso si listo',
    [
      'SELECT a.ok, a.avanzo, a.paso, a.revision, a.esperadas, a.pendientes, a.motivo',
      '  FROM jsonb_to_record(forense.advance_case_if_ready($1::uuid, $2::text, $3::int))',
      '    AS a(ok boolean, avanzo boolean, paso text, revision int, esperadas int,',
      '         pendientes jsonb, motivo text)',
    ].join('\n'),
    `={{ $json.caso_id }}, ${ID('paso_pipeline')}, ={{ null }}`,
    'Firma de tres argumentos (DECISIONES H3 01:35): la barrera es POR PASO. La cierra esta función sobre el conjunto exacto de tarea_id, no un Merge de cinco ramas.',
  ));

  fila = 4; columna = 0;
  add(nota('Nota worker', [
    'FORENSE_ejecutar_agente — worker de paso (17 §3).',
    '',
    'Una ejecución = UN request de modelo O UN lote de herramientas,',
    'guarda checkpoint y termina. No hay nodo AI Agent: los argumentos',
    'salen de los bloques tool_use parseados por código y',
    'p_tarea / p_caso / p_operacion los fija el backend.',
    '',
    'Identidad del claim: siempre $(\'Decidir accion\'), nunca reinventada.',
    'Inactivo. Credenciales por nombre, sin IDs ni secretos.',
    'Los workflowId PENDIENTE_* se resuelven después de importar (17 §2).',
  ].join('\n'), 300, 440));

  const connections = conectar([
    ['Paso entrante', 'Reclamar paso'],
    ['Reclamar paso', '¿Claim vigente?'],
    ['¿Claim vigente?', 'Cargar ejecución', 0],
    ['¿Claim vigente?', 'Paso no reclamable', 1],
    ['Paso no reclamable', 'Registrar en_cola'],
    ['Cargar ejecución', 'Decidir accion'],
    ['Decidir accion', 'Ruta del paso'],
    ['Ruta del paso', 'Reservar request', 0],
    ['Ruta del paso', 'Expandir cola de tools', 1],
    ['Ruta del paso', 'Guardar checkpoint', 2],
    ['Reservar request', 'Construir cuerpo Messages'],
    ['Construir cuerpo Messages', ['POST /v1/messages', 'Registrar aviso de reintento']],
    ['POST /v1/messages', 'Clasificar transporte'],
    ['Clasificar transporte', 'Ruta de transporte'],
    ['Ruta de transporte', 'Interpretar respuesta', 0],
    ['Ruta de transporte', 'Backoff', 1],
    ['Ruta de transporte', 'Marcar desconocido', 2],
    ['Ruta de transporte', 'Marcar error de request', 3],
    // El backoff vuelve por la RESERVA, no directo al HTTP: 17 §4 exige que
    // «cada HTTP nuevo es un intento registrado, aunque sea reparación o
    // retry». `reserve_request` con el mismo request_id incrementa
    // `intento_transporte` sin consumir cuota nueva, y ese contador es el que
    // frena el bucle en `Clasificar transporte`. Saltándose este nodo, el
    // intento se quedaba congelado en 1 y el backoff giraba hasta el deadline.
    ['Backoff', 'Reservar request'],
    ['Marcar desconocido', 'Guardar checkpoint'],
    ['Marcar error de request', 'Guardar checkpoint'],
    ['Interpretar respuesta', 'Validar salida contra contrato'],
    ['Validar salida contra contrato', 'Completar request'],
    ['Completar request', 'Guardar checkpoint'],
    ['Expandir cola de tools', 'Reclamar tool'],
    ['Reclamar tool', 'Llamar RPC forense'],
    ['Llamar RPC forense', 'Registrar resultado tool'],
    ['Registrar resultado tool', 'Armar tool_results'],
    ['Armar tool_results', 'Guardar checkpoint'],
    ['Guardar checkpoint', '¿Estado terminal?'],
    ['¿Estado terminal?', 'Finalizar paso', 0],
    ['¿Estado terminal?', 'Registrar paso guardado', 1],
    ['Registrar paso guardado', 'Redespachar paso'],
    ['Finalizar paso', 'Avanzar caso si listo'],
  ]);

  return workflow('FORENSE_ejecutar_agente', nodes, connections);
}

// ---------------------------------------------- FORENSE_investigar_cluster

export function investigarCluster() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };

  add(nodo('Desde corrida', 'n8n-nodes-base.executeWorkflowTrigger', { inputSource: 'passthrough' }));

  fila = 1; columna = 0;
  add(nodo(
    'Webhook investigar',
    'n8n-nodes-base.webhook',
    {
      httpMethod: 'POST',
      path: 'forense/investigar',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      options: {},
    },
    { credentials: CREDENCIALES.webhook },
  ));

  fila = 0; columna = 1;
  add(code('Normalizar entrada', 'normalizar-investigacion'));

  add(sql(
    'Resolver y reclamar cluster',
    [
      'SELECT r.ok, r.estado, r.caso_id, r.cluster_id, r.corrida_id,',
      '       $6::uuid AS investigacion_id, $5::text AS idempotency_key,',
      '       r.owner AS lease_owner, r.motivo',
      '  FROM jsonb_to_record(forense.reclamar_cluster($1::uuid, $2::uuid, $3::text, $4::text, $5::text))',
      '    AS r(ok boolean, estado text, caso_id uuid, cluster_id uuid, corrida_id uuid,',
      '         owner text, motivo text)',
    ].join('\n'),
    '={{ $json.corrida_id }}, ={{ $json.cluster_id }}, ={{ $json.origen }}, ={{ $json.valor_untrusted }}, ={{ $json.idempotency_key }}, ={{ $json.investigacion_id }}',
    'Primero resuelve/arma el cluster en el snapshot y DESPUÉS lo reclama (07 §2). Ocupado → en_cola, sin duplicar caso.',
  ));

  fila = 1; columna = 3;
  add(nodo('Responder 202', 'n8n-nodes-base.respondToWebhook', {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify({ caso_id: $json.caso_id, cluster_id: $json.cluster_id, corrida_id: $json.corrida_id, estado: $json.estado }) }}',
    options: { responseCode: 202 },
  }));

  fila = 0; columna = 4;
  add(sql(
    'Crear caso',
    [
      'SELECT c.caso_id, c.cluster_id, c.corrida_id,',
      '       $6::uuid AS investigacion_id, $4::text AS idempotency_key,',
      '       0 AS intento',
      '  FROM jsonb_to_record(forense.crear_caso($1::uuid, $2::uuid, $7::text, $3::text,',
      '                                          $4::text, $5::text))',
      '    AS c(ok boolean, creado boolean, caso_id uuid, cluster_id uuid, corrida_id uuid)',
    ].join('\n'),
    "={{ $json.corrida_id }}, ={{ $json.cluster_id }}, ={{ $('Normalizar entrada').first().json.valor_untrusted }}, ={{ $json.idempotency_key }}, ={{ $execution.id }}, ={{ $json.investigacion_id }}, ={{ $('Normalizar entrada').first().json.origen }}",
    'Una sola vez, con n8n_execution_id e intento=0. Emite caso_creado, cluster_armado y pista_cargada en bitacora.',
  ));

  add(sql(
    'Contexto ronda 1',
    [
      'SELECT x.caso_id, $2::uuid AS cluster_id, $3::uuid AS corrida_id,',
      '       $4::uuid AS investigacion_id, x.context_hash,',
      '       coalesce(k.version_contexto, 1) AS version_contexto,',
      "       ARRAY(SELECT forense.rol_de_familia(f) FROM unnest(x.familias_evaluables) f)",
      '         AS roles_evaluables,',
      '       x.familias_evaluables',
      '  FROM jsonb_to_record(forense.preparar_contexto_ronda1($1::uuid))',
      '    AS x(ok boolean, caso_id uuid, context_hash text, familias_evaluables text[])',
      '  LEFT JOIN forense.clusters k ON k.id = $2::uuid',
    ].join('\n'),
    '={{ $json.caso_id }}, ={{ $json.cluster_id }}, ={{ $json.corrida_id }}, ={{ $json.investigacion_id }}',
    'Resumen ≤40 RFC y pistas POR FAMILIA. R1 no recibe señales ajenas (17 §7); persiste ronda1 y ronda_inicio.',
  ));

  add(sql(
    'Crear tareas R1',
    [
      'SELECT t.caso_id, $3::uuid AS cluster_id, $4::uuid AS corrida_id,',
      '       $5::uuid AS investigacion_id,',
      "       (x.value #>> '{}')::uuid AS tarea_id,",
      "       ARRAY(SELECT (e.value #>> '{}')::uuid",
      '               FROM jsonb_array_elements(t.tareas) e) AS tarea_ids,',
      "       '{}'::bigint[] AS snapshot_senales,",
      "       (now() + interval '15 minutes') AS deadline, t.version_contexto",
      '  FROM jsonb_to_record(forense.crear_tareas_ronda($1::uuid, 1,',
      "         ARRAY(SELECT jsonb_array_elements_text($2::jsonb))::text[], 0))",
      '    AS t(ok boolean, caso_id uuid, ronda int, intento int, tareas jsonb,',
      '         version_contexto int)',
      '  LEFT JOIN LATERAL jsonb_array_elements(t.tareas) AS x ON true',
    ].join('\n'),
    '={{ $json.caso_id }}, ={{ JSON.stringify($json.roles_evaluables) }}, ={{ $json.cluster_id }}, ={{ $json.corrida_id }}, ={{ $json.investigacion_id }}',
    'Omite familias no evaluables con resultado.motivo_omision = no_evaluable. Devuelve el conjunto exacto de tarea_id.',
  ));

  add(subworkflow('Despachar especialistas', 'FORENSE_ejecutar_agente', {
    tarea_id: '={{ $json.tarea_id }}',
    owner: '={{ $execution.id }}',
  }, { esperar: false, modo: 'each' }));

  add(sql(
    'Registrar barrera R1',
    [
      'INSERT INTO forense.pasos_pipeline',
      "       (caso_id, paso, revision, tareas_esperadas, snapshot_senales, estado, deadline)",
      "VALUES ($1::uuid, 'ronda1', 1, $2::uuid[], $3::bigint[], 'abierto', $4::timestamptz)",
      'RETURNING *',
    ].join('\n'),
    // tareas_esperadas es uuid[] y snapshot_senales bigint[]: necesitan LITERAL
    // de array de Postgres, no JSON. `JSON.stringify` produciría ["a","b"] y el
    // INSERT fallaría en ejecución aunque PREPARE lo acepte (comprobado con
    // psql contra 001–003; ver IMPORT.md §Verificación). `estado` solo admite
    // abierto|cerrado|cancelado|timeout: 'esperando' violaba el CHECK.
    `={{ $json.caso_id }}, ={{ ${'`{${($json.tarea_ids ?? []).join(",")}}`'} }}, ={{ ${'`{${($json.snapshot_senales ?? []).join(",")}}`'} }}, ={{ $json.deadline }}`,
    'La barrera es el CONJUNTO despachado (17 §3), no un conteo de filas ni un Merge de cinco ramas.',
  ));

  add(sql(
    'Esperar barrera R1',
    [
      'SELECT $1::uuid AS caso_id, $2::uuid AS cluster_id, $3::uuid AS corrida_id,',
      '       $4::uuid AS investigacion_id, b.paso, b.completa, b.faltantes, b.vencida,',
      "       coalesce(b.estado, '{}'::jsonb) AS resultados,",
      "       CASE WHEN b.vencida THEN jsonb_build_array('barrera_vencida')",
      "            ELSE '[]'::jsonb END AS limitaciones",
      "  FROM jsonb_to_record(forense.estado_barrera($1::uuid, 'ronda1'))",
      '    AS b(ok boolean, existe boolean, paso text, completa boolean, faltantes jsonb,',
      '         vencida boolean, estado jsonb)',
    ].join('\n'),
    '={{ $json.caso_id }}, ={{ $json.cluster_id }}, ={{ $json.corrida_id }}, ={{ $json.investigacion_id }}',
    'Conexión corta: {completa, faltantes, vencida}. Nunca un bucle SQL bloqueante esperando al modelo (17 §2).',
  ));

  add(si('¿Barrera completa?', '={{ $json.completa || $json.vencida }}'));

  fila = 1; columna = 10;
  add(esperar('Espera barrera', '={{ 10000 }}'));

  fila = 0; columna = 10;
  add(sql(
    'Ronda fin R1',
    'SELECT * FROM forense.cerrar_ronda($1::uuid, $2::int, $3::jsonb)',
    "={{ $json.caso_id }}, ={{ 1 }}, ={{ JSON.stringify({ resultados: $json.resultados, limitaciones: $json.limitaciones, vencida: $json.vencida }) }}",
    'Escribe el evento ronda_fin con forense.log (no existe registrar_evento) y devuelve los insumos DETERMINISTAS de la frontera: señales de la ronda, familias evaluables, version_contexto y rutas materiales. Cero señales también exige resultado explícito (07 §2.5). DEPENDE de forense-db (004/005).',
  ));

  add(code('Evaluar frontera y despertar', 'evaluar-frontera'));
  add(si('¿Hay ronda 2?', '={{ $json.saltar_ronda2 }}', 'false'));

  fila = 1; columna = 13;
  add(sql(
    'Expandir y crear tareas R2',
    [
      'SELECT $1::uuid AS caso_id, $4::uuid AS cluster_id, $5::uuid AS corrida_id,',
      '       $6::uuid AS investigacion_id,',
      "       (x.value #>> '{}')::uuid AS tarea_id,",
      "       ARRAY(SELECT (e.value #>> '{}')::uuid",
      '               FROM jsonb_array_elements(v.tareas) e) AS tarea_ids,',
      "       coalesce((v.r->'ronda2'->>'version_contexto')::int, 1) AS version_contexto,",
      "       (now() + interval '15 minutes') AS deadline",
      '  FROM (SELECT forense.expandir_y_crear_tareas_r2($1::uuid,',
      "                 ARRAY(SELECT jsonb_array_elements_text($2::jsonb))::text[],",
      "                 ARRAY(SELECT jsonb_array_elements_text($3::jsonb))::text[]) AS r) v0",
      '  CROSS JOIN LATERAL (SELECT v0.r AS r,',
      "                             coalesce(v0.r->'ronda2'->'tareas', v0.r->'tareas',",
      "                                      '[]'::jsonb) AS tareas) v",
      '  LEFT JOIN LATERAL jsonb_array_elements(v.tareas) AS x ON true',
    ].join('\n'),
    '={{ $json.caso_id }}, ={{ JSON.stringify($json.despertados) }}, ={{ JSON.stringify($json.frontera) }}, ={{ $json.cluster_id }}, ={{ $json.corrida_id }}, ={{ $json.investigacion_id }}',
    'La expansión usa la ÚNICA cuota del cluster e incrementa version_contexto; no vuelve a ronda 1 (07 §2.6–2.8).',
  ));
  add(subworkflow('Despachar R2', 'FORENSE_ejecutar_agente', {
    tarea_id: '={{ $json.tarea_id }}',
    owner: '={{ $execution.id }}',
  }, { esperar: false, modo: 'each' }));
  add(sql(
    'Barrera R2',
    [
      'SELECT $1::uuid AS caso_id, $2::uuid AS cluster_id, $3::uuid AS corrida_id,',
      '       $4::uuid AS investigacion_id, b.paso, b.completa, b.faltantes, b.vencida',
      "  FROM jsonb_to_record(forense.estado_barrera($1::uuid, 'ronda2'))",
      '    AS b(ok boolean, paso text, completa boolean, faltantes jsonb, vencida boolean)',
    ].join('\n'),
    '={{ $json.caso_id }}, ={{ $json.cluster_id }}, ={{ $json.corrida_id }}, ={{ $json.investigacion_id }}',
    'Dos tareas despertadas NO esperan cinco.',
  ));

  fila = 0; columna = 13;
  add(sql(
    'Auditoría',
    [
      'SELECT a.caso_id, $3::uuid AS cluster_id, $4::uuid AS corrida_id,',
      '       $5::uuid AS investigacion_id, a.tarea_id, a.rol',
      '  FROM jsonb_to_record(forense.abrir_tarea_cierre($1::uuid, $2::text))',
      '    AS a(ok boolean, caso_id uuid, rol text, tarea_id uuid, ejecucion_id uuid)',
    ].join('\n'),
    "={{ $json.caso_id }}, ={{ 'auditor' }}, ={{ $json.cluster_id }}, ={{ $json.corrida_id }}, ={{ $json.investigacion_id }}",
    'Auditor y Defensor TAMBIÉN crean tarea: necesitan p_tarea válido y consumen la cuota global (07).',
  ));
  add(subworkflow('Ejecutar auditor', 'FORENSE_ejecutar_agente', {
    tarea_id: '={{ $json.tarea_id }}',
    owner: '={{ $execution.id }}',
  }, { esperar: true }));
  add(sql(
    'Validar evidencia propuesta',
    [
      'SELECT $1::uuid AS caso_id, $2::uuid AS tarea_id,',
      "       (v.resultado->>'validadas')::int AS validadas,",
      "       (v.resultado->>'descartadas')::int AS descartadas,",
      '       $3::uuid AS cluster_id, $4::uuid AS corrida_id, $5::uuid AS investigacion_id',
      '  FROM (SELECT public.forense_validar_evidencia($1::uuid) AS resultado) v',
    ].join('\n'),
    "={{ $json.caso_id }}, ={{ $json.tarea_id }}, ={{ $('Auditoría').first().json.cluster_id }}, ={{ $('Auditoría').first().json.corrida_id }}, ={{ $('Auditoría').first().json.investigacion_id }}",
    'Pertenencia, valores y soporte resueltos desde DB: un ID existente no demuestra la hipótesis.',
  ));
  add(sql(
    'Defensa',
    [
      'SELECT a.caso_id, $3::uuid AS cluster_id, $4::uuid AS corrida_id,',
      '       $5::uuid AS investigacion_id, a.tarea_id, a.rol,',
      '       a.tarea_id AS tarea_replica_id',
      '  FROM jsonb_to_record(forense.abrir_tarea_cierre($1::uuid, $2::text))',
      '    AS a(ok boolean, caso_id uuid, rol text, tarea_id uuid, ejecucion_id uuid)',
    ].join('\n'),
    "={{ $json.caso_id }}, ={{ 'defensor' }}, ={{ $json.cluster_id }}, ={{ $json.corrida_id }}, ={{ $json.investigacion_id }}",
    'Persiste defendiendo y emite defensa_inicio. Hasta 15 herramientas.',
  ));
  add(subworkflow('Ejecutar defensor', 'FORENSE_ejecutar_agente', {
    tarea_id: '={{ $json.tarea_id }}',
    owner: '={{ $execution.id }}',
  }, { esperar: true }));
  add(subworkflow('Réplica', 'FORENSE_ejecutar_agente', {
    tarea_id: '={{ $json.tarea_replica_id }}',
    owner: '={{ $execution.id }}',
  }, { esperar: true }));
  add(sql(
    'Aplicar resolución',
    'SELECT * FROM forense.aplicar_resolucion_replica($1::uuid, $2::uuid)',
    '={{ $json.caso_id }}, ={{ $json.tarea_replica_id }}',
    'Transacción: evaluacion_pistas del caso y solo evidencias objetivo. NUNCA cambia pistas.estado global (07 §15).',
  ));
  add(sql(
    'Paquete auditor final',
    // `paquete_auditor_final` (010) NO devuelve la forma exacta que consume
    // `dictaminar()`: tres adaptaciones deterministas, todas en SQL, ninguna
    // en el Code node y ninguna a partir de texto libre.
    //   1. `caso.n_reintentos` — 010 lo emite dentro de `presupuesto`.
    //   2. `presupuesto.permite_reintento` — 010 emite `agotado`; el techo de
    //      2 reintentos vive en `Claim de reintento` y se replica aquí.
    //   3. `evidencia[].hecho_validado.monto_centavos` — 010 lo emite en la
    //      raíz del ítem (entero, redondeado desde el NUMERIC de la columna).
    //      `dictaminar` lo lee dentro de `hecho_validado` y LANZA si falta.
    // Ver `solicitudes_coordinador` de la entrega: si 010 cambia, se borra
    // esta capa, no se duplica.
    [
      'SELECT p.caso_id, p.cluster_id, p.corrida_id, p.investigacion_id,',
      "       p.caso || jsonb_build_object('n_reintentos',",
      "         coalesce(p.presupuesto->'n_reintentos', '0'::jsonb)) AS caso,",
      '       p.pistas,',
      '       (SELECT coalesce(jsonb_agg(e || jsonb_build_object(',
      "                 'hecho_validado',",
      "                 case when e->>'monto_centavos' is null then '{}'::jsonb",
      "                      else jsonb_build_object('monto_centavos',",
      "                             (e->>'monto_centavos')::bigint) end",
      "                 || coalesce(e->'hecho_validado', '{}'::jsonb))",
      "               ORDER BY e->>'evidencia_id'), '[]'::jsonb)",
      '          FROM jsonb_array_elements(p.evidencia) e) AS evidencia,',
      '       p.pendientes, p.cobertura_completa,',
      "       p.presupuesto || jsonb_build_object('permite_reintento',",
      "         coalesce((p.presupuesto->>'agotado')::boolean, false) = false",
      "         AND coalesce((p.presupuesto->>'n_reintentos')::int, 0) < 2) AS presupuesto",
      '  FROM forense.paquete_auditor_final($1::uuid) p',
    ].join('\n'),
    '={{ $json.caso_id }}',
    'Entrada preparada por backend, nunca JSON de agente sin validar (07 §Code node). Adapta la forma de 010 a la que consume dictaminar(): n_reintentos, permite_reintento y monto_centavos dentro de hecho_validado.',
  ));
  add(code('Auditor Final', 'auditor-final'));
  add(si('¿Rechazo reparable?', '={{ $json.rechazo !== null }}'));

  fila = 2; columna = 22;
  add(sql(
    'Claim de reintento',
    [
      'UPDATE forense.casos',
      '   SET n_reintentos = n_reintentos + 1',
      ' WHERE id = $1::uuid AND n_reintentos < 2',
      'RETURNING id AS caso_id, n_reintentos, $2::jsonb AS rechazo',
    ].join('\n'),
    '={{ $json.caso_id }}, ={{ JSON.stringify($json.rechazo) }}',
    'Autoriza 1 y 2. Emite rechazo_auditor_final y reintento_inicio.',
  ));
  add(subworkflow('Llamar reintento', 'FORENSE_reintento', {
    caso_id: '={{ $json.caso_id }}',
    intento: '={{ $json.n_reintentos }}',
    motivo: '={{ $json.rechazo.motivo }}',
    objetivo: '={{ $json.rechazo.objetivo }}',
  }, { esperar: true }));

  fila = 0; columna = 22;
  add(sql(
    'Guardar dictamen',
    'SELECT * FROM forense.guardar_dictamen($1::uuid, $2::jsonb)',
    '={{ $json.caso_id }}, ={{ JSON.stringify($json) }}',
    'Nivel máximo presuncion_alta (regla 7). Guarda familias, monto deduplicado y resultado_por_rfc; no hereda el nivel a satélites.',
  ));
  add(sql(
    'Redacción',
    [
      'SELECT a.caso_id, $3::uuid AS cluster_id, $4::uuid AS corrida_id,',
      '       $5::uuid AS investigacion_id, a.tarea_id, a.rol, 1 AS version',
      '  FROM jsonb_to_record(forense.abrir_tarea_cierre($1::uuid, $2::text))',
      '    AS a(ok boolean, caso_id uuid, rol text, tarea_id uuid, ejecucion_id uuid)',
    ].join('\n'),
    "={{ $json.caso_id }}, ={{ 'redactor' }}, ={{ $json.cluster_id }}, ={{ $json.corrida_id }}, ={{ $json.investigacion_id }}",
    'Sin tools. Incluye las secciones fijas Trayectoria y Cadena de explicación (21 §2 y §4).',
  ));
  add(subworkflow('Ejecutar redactor', 'FORENSE_ejecutar_agente', {
    tarea_id: '={{ $json.tarea_id }}',
    owner: '={{ $execution.id }}',
  }, { esperar: true }));
  add(sql(
    'Validar citas',
    'SELECT * FROM forense.validar_expediente($1::uuid, $2::int)',
    '={{ $json.caso_id }}, ={{ $json.version }}',
    'Cada cita resuelve a un ID validado; cada paso de la cadena cita un ID o declara «sin evidencia».',
  ));
  add(sql(
    'Cerrar caso',
    'SELECT * FROM forense.cerrar_caso($1::uuid, $2::text)',
    '={{ $json.caso_id }}, ={{ $json.estado_final }}',
    'dictaminado | error, terminado, duracion_ms, libera lease. Presupuesto agotado → parcial con no_concluyente.',
  ));
  add(subworkflow('Avisar agregador', 'FORENSE_notificar_completada', {
    investigacion_id: '={{ $json.investigacion_id }}',
    caso_id: '={{ $json.caso_id }}',
  }, { esperar: false }));

  fila = 4; columna = 0;
  add(nota('Nota barrera', [
    'FORENSE_investigar_cluster (07 §2, 17 §3).',
    '',
    'La barrera espera el CONJUNTO de tarea_id despachados hasta que todas',
    'estén completada|error|timeout|omitida. Si se despertaron dos',
    'especialistas, no se esperan cinco.',
    '',
    'El nivel lo calcula el Code node «Auditor Final» (determinista,',
    'generado desde n8n/runtime/auditor-final.mjs). El LLM no lo decide.',
    'Máximo: presuncion_alta.',
  ].join('\n'), 280, 440));

  const connections = conectar([
    ['Desde corrida', 'Normalizar entrada'],
    ['Webhook investigar', 'Normalizar entrada'],
    ['Normalizar entrada', 'Resolver y reclamar cluster'],
    ['Resolver y reclamar cluster', ['Responder 202', 'Crear caso']],
    ['Crear caso', 'Contexto ronda 1'],
    ['Contexto ronda 1', 'Crear tareas R1'],
    ['Crear tareas R1', ['Despachar especialistas', 'Registrar barrera R1']],
    ['Registrar barrera R1', 'Esperar barrera R1'],
    ['Esperar barrera R1', '¿Barrera completa?'],
    ['¿Barrera completa?', 'Ronda fin R1', 0],
    ['¿Barrera completa?', 'Espera barrera', 1],
    ['Espera barrera', 'Esperar barrera R1'],
    ['Ronda fin R1', 'Evaluar frontera y despertar'],
    ['Evaluar frontera y despertar', '¿Hay ronda 2?'],
    ['¿Hay ronda 2?', 'Expandir y crear tareas R2', 0],
    ['¿Hay ronda 2?', 'Auditoría', 1],
    ['Expandir y crear tareas R2', ['Despachar R2', 'Barrera R2']],
    ['Barrera R2', 'Auditoría'],
    ['Auditoría', 'Ejecutar auditor'],
    ['Ejecutar auditor', 'Validar evidencia propuesta'],
    ['Validar evidencia propuesta', 'Defensa'],
    ['Defensa', 'Ejecutar defensor'],
    ['Ejecutar defensor', 'Réplica'],
    ['Réplica', 'Aplicar resolución'],
    ['Aplicar resolución', 'Paquete auditor final'],
    ['Paquete auditor final', 'Auditor Final'],
    ['Auditor Final', '¿Rechazo reparable?'],
    ['¿Rechazo reparable?', 'Claim de reintento', 0],
    ['¿Rechazo reparable?', 'Guardar dictamen', 1],
    ['Claim de reintento', 'Llamar reintento'],
    ['Llamar reintento', 'Paquete auditor final'],
    ['Guardar dictamen', 'Redacción'],
    ['Redacción', 'Ejecutar redactor'],
    ['Ejecutar redactor', 'Validar citas'],
    ['Validar citas', 'Cerrar caso'],
    ['Cerrar caso', 'Avisar agregador'],
  ]);

  return workflow('FORENSE_investigar_cluster', nodes, connections);
}

// ------------------------------------------------------------ FORENSE_reintento
//
// 07 §3 + 17 §3: entra tras el claim del padre con `intento` ya incrementado.
// No incrementa contadores, no crea caso y no se invoca a sí mismo.

export function reintento() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };
  const R = (campo) => `={{ $('Validar intento').first().json.${campo} }}`;

  add(nodo('Entrada reintento', 'n8n-nodes-base.executeWorkflowTrigger', { inputSource: 'passthrough' }));

  add(codeInline('Validar intento', [
    '// 03: máximo dos reintentos forenses por caso. El padre ya hizo el claim',
    '// (UPDATE ... WHERE n_reintentos < 2): aquí NO se incrementa nada.',
    'const x = $input.first().json;',
    'const intento = Number(x.intento);',
    'if (![1, 2].includes(intento)) throw new Error(`intento fuera de rango: ${x.intento}`);',
    'if (!x.caso_id) throw new Error(\'caso_id obligatorio\');',
    "const motivo = x.motivo ?? null;",
    "const MOTIVOS = ['evidencia_insuficiente', 'cadena_incompleta', 'defensa_no_considerada', 'evidencia_invalida', 'contradiccion'];",
    'if (!MOTIVOS.includes(motivo)) throw new Error(`motivo no tipificado: ${motivo}`);',
    'const objetivo = x.objetivo ?? null;',
    "if (!objetivo || (typeof objetivo === 'string' && objetivo.trim() === '')) {",
    "  throw new Error('objetivo vacío: un reintento sin objetivo concreto es otra ronda 1');",
    '}',
    'const salida = { caso_id: x.caso_id, intento, motivo, objetivo, corrida_id: x.corrida_id ?? null, cluster_id: x.cluster_id ?? null };',
    'return [{ json: salida }];',
  ].join('\n')));

  add(sql(
    'Cargar caso vigente',
    [
      '-- version_contexto y la cuota de expansión viven en el CLUSTER, no en el',
      '-- caso (001): el reintento conserva la versión vigente, no la reinicia.',
      'SELECT c.id AS caso_id, c.corrida_id, c.cluster_id, c.nivel, c.n_reintentos,',
      '       c.tool_calls, c.presupuesto_agotado,',
      '       k.version_contexto, k.expandido AS expansiones_usadas,',
      '       $2::int AS intento, $3::text AS motivo, $4::jsonb AS objetivo',
      '  FROM forense.casos c',
      '  LEFT JOIN forense.clusters k ON k.corrida_id = c.corrida_id AND k.id = c.cluster_id',
      ' WHERE c.id = $1::uuid',
    ].join('\n'),
    `${R('caso_id')}, ${R('intento')}, ${R('motivo')}, ={{ JSON.stringify($json.objetivo) }}`,
    'Conserva caso, historial y versión de contexto (17 §3): el reintento no reconstruye el cluster.',
  ));

  add(ruta('Ruta por motivo', R('motivo'), [
    'evidencia_insuficiente', 'cadena_incompleta', 'defensa_no_considerada',
    'evidencia_invalida', 'contradiccion',
  ]));

  fila = 1; columna = 4;
  add(sql(
    'Seleccionar autores',
    'SELECT * FROM forense.autores_reintento($1::uuid, $2::text, $3::jsonb)',
    `${R('caso_id')}, ${R('motivo')}, ${R('objetivo')}`,
    'Por motivo (07 §3): comprobación pendiente en familia evaluable, ruta concreta, trampa con evidencias objetivo, autor de la evidencia inválida o autores en contradicción. NUNCA «todos los faltantes por defecto». DEPENDE de forense-db.',
  ));

  add(si('¿Queda cuota de expansión?', '={{ $json.puede_expandir }}'));

  fila = 2; columna = 6;
  add(sql(
    'Registrar límite de expansión',
    [
      'WITH ev AS (',
      '  SELECT forense.log(',
      "           p_caso => $1::uuid, p_agente => 'sistema', p_tipo => 'presupuesto_agotado',",
      '           p_payload => $2::jsonb, p_corrida => $3::uuid)',
      ')',
      'SELECT $1::uuid AS caso_id, $4::text[] AS autores, false AS expandido,',
      "       'cuota_expansion_agotada'::text AS limitacion FROM ev",
    ].join('\n'),
    `${R('caso_id')}, ={{ JSON.stringify({ alcance: 'expansion', intento: $('Validar intento').first().json.intento }) }}, ${R('corrida_id')}, ={{ \`{\${($json.autores ?? []).join(",")}}\` }}`,
    'Si la única expansión del cluster ya se usó, se registra el límite y el reintento sigue SIN expandir (07 §3).',
  ));

  fila = 1; columna = 6;
  add(sql(
    'Expandir para reintento',
    'SELECT * FROM forense.expandir_cluster_reintento($1::uuid, $2::jsonb)',
    `${R('caso_id')}, ${R('objetivo')}`,
    'Solo para cadena_incompleta y solo si queda la cuota. DEPENDE de forense-db.',
  ));

  fila = 1; columna = 7;
  add(sql(
    'Crear tareas de revisión',
    'SELECT * FROM forense.crear_tareas_revision($1::uuid, $2::int, $3::text[], $4::jsonb)',
    `${R('caso_id')}, ${R('intento')}, ={{ \`{\${($json.autores ?? []).join(",")}}\` }}, ${R('objetivo')}`,
    'Ronda 2 con intento 1|2 y la version_contexto vigente; las señales nuevas se enlazan a las previas y la historia se conserva. DEPENDE de forense-db.',
  ));

  add(subworkflow('Despachar revisión', 'FORENSE_ejecutar_agente', {
    tarea_id: '={{ $json.tarea_id }}',
    owner: '={{ $execution.id }}',
  }, { esperar: false, modo: 'each' }));

  fila = 1; columna = 9;
  add(sql(
    'Barrera reintento',
    // `forense.estado_barrera` devuelve UN jsonb escalar, no una tabla: con
    // `SELECT *` n8n recibía `{estado_barrera:{…}}` y el IF siguiente leía
    // `$json.completa` = undefined, es decir, la barrera nunca cerraba por la
    // rama buena. Lo cazó `n8n/tests/verificar-forma-nodos.mjs` en H8.
    // Mismo patrón que «Esperar barrera R1»: jsonb_to_record y las columnas
    // de identidad proyectadas a mano.
    [
      'SELECT $1::uuid AS caso_id, b.paso, b.completa, b.faltantes, b.vencida',
      '  FROM jsonb_to_record(forense.estado_barrera($1::uuid, $2::text))',
      '    AS b(ok boolean, existe boolean, paso text, completa boolean,',
      '         faltantes jsonb, vencida boolean, estado jsonb)',
    ].join('\n'),
    `${R('caso_id')}, ={{ 'reintento' + $('Validar intento').first().json.intento }}`,
    'Mismo patrón que la barrera de ronda: el conjunto exacto de tarea_id, no un conteo.',
  ));
  add(si('¿Barrera reintento completa?', '={{ $json.completa || $json.vencida }}'));

  fila = 2; columna = 11;
  add(esperar('Espera barrera reintento', '={{ 10000 }}'));

  fila = 1; columna = 11;
  add(sql(
    'Revalidar si cambió evidencia',
    'SELECT * FROM forense.revalidar_caso($1::uuid)',
    R('caso_id'),
    'Repite validaciones y defensas aplicables ANTES del dictamen: evidencia nueva no entra sin validar. DEPENDE de forense-db.',
  ));

  add(codeInline('Retornar al padre', [
    '// El padre reanuda DONDE indica este resultado: no repite preparación ni',
    '// crea un caso nuevo (07 §3).',
    'const x = $input.first().json;',
    "const paso = $('Validar intento').first().json;",
    "const REANUDAR = {",
    "  evidencia_insuficiente: 'auditoria',",
    "  cadena_incompleta: 'auditoria',",
    "  defensa_no_considerada: 'defensa',",
    "  evidencia_invalida: 'auditoria',",
    "  contradiccion: 'replica',",
    '};',
    'const salida = {',
    '  caso_id: paso.caso_id,',
    '  intento: paso.intento,',
    "  reanudar_en: REANUDAR[paso.motivo] ?? 'auditoria',",
    '  limitaciones: x.limitaciones ?? [],',
    '};',
    'return [{ json: salida }];',
  ].join('\n')));

  fila = 4; columna = 0;
  add(nota('Nota reintento', [
    'FORENSE_reintento (07 §3, 17 §3).',
    '',
    'intento ∈ {1,2} y NO se incrementa aquí: el claim es del padre.',
    'Se seleccionan autores por motivo, no «todos los faltantes».',
    'Agotar reintentos nunca sube el nivel (regla 10 de CLAUDE.md).',
  ].join('\n'), 220, 400));

  const connections = conectar([
    ['Entrada reintento', 'Validar intento'],
    ['Validar intento', 'Cargar caso vigente'],
    ['Cargar caso vigente', 'Ruta por motivo'],
    ['Ruta por motivo', 'Seleccionar autores', 0],
    ['Ruta por motivo', 'Seleccionar autores', 1],
    ['Ruta por motivo', 'Seleccionar autores', 2],
    ['Ruta por motivo', 'Seleccionar autores', 3],
    ['Ruta por motivo', 'Seleccionar autores', 4],
    ['Seleccionar autores', '¿Queda cuota de expansión?'],
    ['¿Queda cuota de expansión?', 'Expandir para reintento', 0],
    ['¿Queda cuota de expansión?', 'Registrar límite de expansión', 1],
    ['Expandir para reintento', 'Crear tareas de revisión'],
    ['Registrar límite de expansión', 'Crear tareas de revisión'],
    ['Crear tareas de revisión', ['Despachar revisión', 'Barrera reintento']],
    ['Barrera reintento', '¿Barrera reintento completa?'],
    ['¿Barrera reintento completa?', 'Revalidar si cambió evidencia', 0],
    ['¿Barrera reintento completa?', 'Espera barrera reintento', 1],
    ['Espera barrera reintento', 'Barrera reintento'],
    ['Revalidar si cambió evidencia', 'Retornar al padre'],
  ]);

  return workflow('FORENSE_reintento', nodes, connections);
}

// --------------------------------------------------- FORENSE_editar_expediente
//
// 15 + 17 §6: presupuesto propio por operación (3 requests, deadline 90 s).
// Chat propone y «Aplicar» versiona: este workflow NUNCA cambia el expediente.

export function editarExpediente() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };
  const E = (campo) => `={{ $('Validar solicitud').first().json.${campo} }}`;

  add(nodo(
    'Webhook editar',
    'n8n-nodes-base.webhook',
    {
      httpMethod: 'POST',
      path: 'forense/editar',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      options: {},
    },
    { credentials: CREDENCIALES.webhook },
  ));

  add(codeInline('Validar solicitud', [
    '// Contrato editor.solicitud (contracts v1). El TEXTO del documento es dato,',
    '// nunca system prompt (17 §7): viaja marcado y no se obedece.',
    'const x = $input.first().json;',
    'const c = x.body ?? x;',
    "const PROHIBIDOS = ['system', 'system_prompt', 'modelo', 'model', 'nivel', 'dictamen', 'telefono'];",
    'const presentes = PROHIBIDOS.filter((k) => c[k] !== undefined);',
    'if (presentes.length > 0) throw new Error(`campos no aceptados: ${presentes.join(\', \')}`);',
    "if (!c.caso_id) throw new Error('caso_id obligatorio');",
    "if (!c.idempotency_key) throw new Error('idempotency_key obligatoria');",
    "const modo = c.modo ?? 'propuesta';",
    "if (!['pregunta', 'propuesta'].includes(modo)) throw new Error(`modo no soportado: ${modo}`);",
    'if (c.version_base === undefined || c.version_base === null) {',
    "  throw new Error('version_base obligatoria: sin ella no se detecta el conflicto de documento');",
    '}',
    'const salida = {',
    '  caso_id: c.caso_id,',
    '  modo,',
    '  version_base: Number(c.version_base),',
    '  idempotency_key: c.idempotency_key,',
    '  instruccion_untrusted: c.instruccion ?? null,',
    '  seleccion: c.seleccion ?? null,',
    '  directriz_id: c.directriz_id ?? null,',
    '};',
    'return [{ json: salida }];',
  ].join('\n')));

  add(sql(
    'Cargar versión base',
    'SELECT * FROM forense.cargar_version_expediente($1::uuid, $2::int)',
    `${E('caso_id')}, ${E('version_base')}`,
    'Versión base, evidencia y argumentos verificados y dictamen; persiste el mensaje del usuario. DEPENDE de forense-db (006).',
  ));

  add(sql(
    'Abrir operación editor',
    [
      'INSERT INTO forense.ejecuciones_agente',
      '       (corrida_id, caso_id, editor_operacion_id, rol, estado_interno, context_hash,',
      '        prompt_hash, model_id, deadline_at)',
      'SELECT c.corrida_id, NULL, gen_random_uuid(), $2::text, $3::text, $4::text,',
      '       $5::text, $6::text, now() + interval \'90 seconds\'',
      '  FROM forense.casos c WHERE c.id = $1::uuid',
      'RETURNING id AS execution_id, editor_operacion_id, rol, deadline_at, corrida_id',
    ].join('\n'),
    `${E('caso_id')}, ={{ 'editor' }}, ={{ 'preparar_contexto' }}, ={{ $json.context_hash }}, ={{ $json.prompt_hash }}, ={{ $json.modelo }}`,
    'XOR de 001: una operación del editor NO lleva tarea_id y tiene presupuesto propio (3 requests, deadline 90 s de 17 §6).',
  ));

  add(subworkflow('Ejecutar editor', 'FORENSE_ejecutar_agente', {
    execution_id: '={{ $json.execution_id }}',
    owner: '={{ $execution.id }}',
  }, { esperar: true }));

  add(codeInline('Validar propuesta', [
    '// La propuesta no puede introducir IDs ajenos, montos distintos ni cambiar',
    '// el nivel: el dictamen es determinista y el editor no lo toca (regla 4).',
    'const x = $input.first().json;',
    "const base = $('Cargar versión base').first().json;",
    "const solicitud = $('Validar solicitud').first().json;",
    'const salida_modelo = x.salida ?? {};',
    'const permitidas = new Set((base.citas_permitidas ?? []).map(String));',
    'const citas = (salida_modelo.citas ?? []).map(String);',
    'const ajenas = citas.filter((id) => !permitidas.has(id));',
    'if (ajenas.length > 0) throw new Error(`citas fuera del paquete del documento: ${ajenas.join(\', \')}`);',
    'if (salida_modelo.nivel !== undefined && salida_modelo.nivel !== base.nivel) {',
    "  throw new Error('una edición no puede cambiar el nivel del dictamen');",
    '}',
    '// Documento cambiado bajo los pies: se conserva el borrador y se avisa.',
    'const conflicto = Number(base.version_actual) !== Number(solicitud.version_base);',
    'const salida = {',
    '  caso_id: solicitud.caso_id,',
    '  modo: solicitud.modo,',
    "  modo_salida: solicitud.modo === 'pregunta' ? 'respuesta' : (solicitud.seleccion ? 'fragmento' : 'documento'),",
    '  conflicto,',
    '  version_base: solicitud.version_base,',
    '  mensaje: salida_modelo.mensaje ?? null,',
    '  patch: salida_modelo.patch ?? null,',
    '  diff: salida_modelo.diff ?? null,',
    '  citas,',
    '};',
    'return [{ json: salida }];',
  ].join('\n')));

  add(ruta('Ruta por modo', '={{ $json.modo_salida }}', ['respuesta', 'fragmento', 'documento']));

  fila = 1; columna = 7;
  add(sql(
    'Guardar propuesta',
    'SELECT * FROM forense.guardar_propuesta_edicion($1::uuid, $2::int, $3::jsonb, $4::jsonb, $5::text[])',
    `={{ $json.caso_id }}, ={{ $json.version_base }}, ={{ JSON.stringify($json.patch) }}, ={{ JSON.stringify($json.diff) }}, ={{ \`{\${($json.citas ?? []).join(",")}}\` }}`,
    'Guarda la propuesta y devuelve propuesta_id. NO cambia el expediente: «Aplicar» es una operación determinista del BFF que versiona (regla 11). DEPENDE de forense-db (006).',
  ));

  fila = 0; columna = 8;
  add(nodo('Responder edición', 'n8n-nodes-base.respondToWebhook', {
    respondWith: 'json',
    responseBody: "={{ JSON.stringify({ modo: $('Validar propuesta').first().json.modo_salida, mensaje: $('Validar propuesta').first().json.mensaje, propuesta_id: $json.propuesta_id ?? null, conflicto: $('Validar propuesta').first().json.conflicto }) }}",
    options: { responseCode: 200 },
  }));

  fila = 3; columna = 0;
  add(nota('Nota editor', [
    'FORENSE_editar_expediente (15, 16, 17 §6).',
    '',
    'Chat PROPONE; «Aplicar» versiona y es del BFF, no de aquí.',
    'Una edición no reactiva el aviso de fin ya emitido (16 §1).',
    'El texto del documento es dato, no instrucción.',
  ].join('\n'), 220, 400));

  const connections = conectar([
    ['Webhook editar', 'Validar solicitud'],
    ['Validar solicitud', 'Cargar versión base'],
    ['Cargar versión base', 'Abrir operación editor'],
    ['Abrir operación editor', 'Ejecutar editor'],
    ['Ejecutar editor', 'Validar propuesta'],
    ['Validar propuesta', 'Ruta por modo'],
    ['Ruta por modo', 'Responder edición', 0],
    ['Ruta por modo', 'Guardar propuesta', 1],
    ['Ruta por modo', 'Guardar propuesta', 2],
    ['Guardar propuesta', 'Responder edición'],
  ]);

  return workflow('FORENSE_editar_expediente', nodes, connections);
}

// -------------------------------------------------------------- FORENSE_corrida

export function corrida() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };
  const C = (campo) => `={{ $('Validar e idempotencia').first().json.${campo} }}`;

  add(nodo(
    'Webhook corrida',
    'n8n-nodes-base.webhook',
    {
      httpMethod: 'POST',
      path: 'forense/corrida',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      options: {},
    },
    { credentials: CREDENCIALES.webhook },
  ));

  add(sql(
    'Validar e idempotencia',
    'SELECT * FROM forense.abrir_corrida($1::text, $2::text, $3::uuid)',
    '={{ $json.body.dataset }}, ={{ $json.body.idempotency_key }}, ={{ $json.body.corrida_origen_id }}',
    'Reutiliza la corrida `lista` con la misma idempotency_key o crea una `preparando`. `dataset` selecciona un ORIGEN AUTORIZADO, nunca una URL arbitraria. DEPENDE de forense-db.',
  ));

  fila = 1; columna = 2;
  add(nodo('Responder corrida 202', 'n8n-nodes-base.respondToWebhook', {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify({ corrida_id: $json.corrida_id, estado: $json.estado }) }}',
    options: { responseCode: 202 },
  }));

  fila = 0; columna = 2;
  add(sql(
    'Cargar o clonar snapshot',
    'SELECT * FROM forense.cargar_o_clonar_snapshot($1::uuid, $2::uuid)',
    `${C('corrida_id')}, ${C('corrida_origen_id')}`,
    'Snapshot COMPLETO; con corrida_origen_id clona (regla 10: corridas aisladas). DEPENDE de forense-db.',
  ));

  add(sql(
    'Verificar integridad',
    'SELECT * FROM forense.verificar_integridad_corrida($1::uuid)',
    C('corrida_id'),
    'Conteos, dataset_hash, fecha_corte y familias_evaluables → `lista`; fallo → `error` con causa. Una corrida vacía no se investiga. DEPENDE de forense-db.',
  ));

  add(sql(
    'Correr pistas',
    'SELECT forense.correr_pistas($1::uuid) AS pistas_insertadas',
    C('corrida_id'),
    'La función hace el claim atómico de `lista` a `procesando`: n8n NO anticipa el cambio de estado (003).',
  ));

  add(sql(
    'Armar clusters',
    'SELECT forense.armar_clusters($1::uuid) AS clusters_armados',
    C('corrida_id'),
    'DEPENDE de 004 (forense-db).',
  ));

  add(sql(
    'Clusters por score',
    [
      'SELECT k.id AS cluster_id, k.corrida_id, k.score, k.estado,',
      "       $2::uuid AS investigacion_id, $3::text AS idempotency_key",
      '  FROM forense.clusters k',
      ' WHERE k.corrida_id = $1::uuid',
      ' ORDER BY k.score DESC NULLS LAST, k.id',
    ].join('\n'),
    `${C('corrida_id')}, ${C('investigacion_id')}, ${C('idempotency_key')}`,
    'Cola COMPLETA ordenada por score; el límite de 4 activos lo impone el nodo siguiente, no este SELECT.',
  ));

  add(codeInline('Despachar hasta 4', [
    '// 17 §2: el límite propio de DB controla ocho pasos y CUATRO clusters. Un',
    '// límite de n8n no sustituye ese control. Lo que no cabe queda EN COLA, no',
    '// fallido (regla 10: no se pierde la cola si se acaba el tiempo).',
    'const MAX_ACTIVOS = 4;',
    'const filas = $input.all().map((i) => i.json);',
    'const admitidos = filas.slice(0, MAX_ACTIVOS);',
    'const en_cola = filas.slice(MAX_ACTIVOS);',
    'return admitidos.map((f) => ({ json: {',
    '  cluster_id: f.cluster_id,',
    '  corrida_id: f.corrida_id,',
    '  investigacion_id: f.investigacion_id ?? null,',
    '  idempotency_key: `${f.idempotency_key}:${f.cluster_id}`,',
    '  admitidos: admitidos.length,',
    '  en_cola: en_cola.length,',
    '  cola_restante: en_cola.map((c) => c.cluster_id),',
    '} }));',
  ].join('\n')));

  add(subworkflow('Despachar cluster', 'FORENSE_investigar_cluster', {
    cluster_id: '={{ $json.cluster_id }}',
    corrida_id: '={{ $json.corrida_id }}',
    investigacion_id: '={{ $json.investigacion_id }}',
    idempotency_key: '={{ $json.idempotency_key }}',
  }, { esperar: false, modo: 'each' }));

  add(sql(
    'Esperar y reconciliar',
    'SELECT * FROM forense.estado_corrida($1::uuid)',
    C('corrida_id'),
    'Espera SOLO los clusters admitidos y reconcilia errores, timeouts y leases. Terminar de despachar NO cierra la corrida. DEPENDE de forense-db.',
  ));
  add(si('¿Corrida terminada?', '={{ $json.terminada }}'));

  fila = 1; columna = 10;
  add(esperar('Espera corrida', '={{ 10000 }}'));

  fila = 0; columna = 10;
  add(sql(
    'Métricas',
    'SELECT forense.v_metricas_corrida($1::uuid) AS metricas',
    C('corrida_id'),
    'Pese al prefijo v_, el contrato de 05/10 es una FUNCIÓN que devuelve jsonb.',
  ));

  add(sql(
    'Cerrar corrida',
    [
      'UPDATE forense.corridas',
      '   SET estado = $2::text, fin = now(), metricas = $3::jsonb',
      ' WHERE id = $1::uuid',
      'RETURNING id AS corrida_id, estado, fin, metricas',
    ].join('\n'),
    `${C('corrida_id')}, ={{ $('Esperar y reconciliar').first().json.estado_final }}, ={{ JSON.stringify($json.metricas) }}`,
    '`completada` con conteos completados/en cola/error y cobertura; `error` si falla antes de tener resultados utilizables.',
  ));

  fila = 3; columna = 0;
  add(nota('Nota corrida', [
    'FORENSE_corrida (07 §1, 17 §2, regla 10).',
    '',
    'Cuatro clusters activos como máximo; el resto queda EN COLA.',
    'Una corrida vacía no se investiga y terminar de despachar',
    'no es cerrar la corrida.',
  ].join('\n'), 220, 400));

  const connections = conectar([
    ['Webhook corrida', 'Validar e idempotencia'],
    ['Validar e idempotencia', ['Responder corrida 202', 'Cargar o clonar snapshot']],
    ['Cargar o clonar snapshot', 'Verificar integridad'],
    ['Verificar integridad', 'Correr pistas'],
    ['Correr pistas', 'Armar clusters'],
    ['Armar clusters', 'Clusters por score'],
    ['Clusters por score', 'Despachar hasta 4'],
    ['Despachar hasta 4', ['Despachar cluster', 'Esperar y reconciliar']],
    ['Esperar y reconciliar', '¿Corrida terminada?'],
    ['¿Corrida terminada?', 'Métricas', 0],
    ['¿Corrida terminada?', 'Espera corrida', 1],
    ['Espera corrida', 'Esperar y reconciliar'],
    ['Métricas', 'Cerrar corrida'],
  ]);

  return workflow('FORENSE_corrida', nodes, connections);
}

// ------------------------------------------------------------- FORENSE_inyectar
//
// 21 §3 (normativo): una inyección NUNCA muta un snapshot existente.

export function inyectar() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };
  const I = (campo) => `={{ $('Registrar inyección').first().json.${campo} }}`;

  add(nodo(
    'Webhook inyectar',
    'n8n-nodes-base.webhook',
    {
      httpMethod: 'POST',
      path: 'forense/inyectar',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      options: {},
    },
    { credentials: CREDENCIALES.webhook },
  ));

  add(sql(
    'Registrar inyección',
    'SELECT * FROM forense.registrar_inyeccion($1::uuid, $2::uuid, $3::text, $4::text)',
    "={{ $json.body.corrida_base_id }}, ={{ $json.body.ingesta_id }}, ={{ $json.body.idempotency_key }}, ={{ $json.body.prioridad ?? 'inyectados' }}",
    "Inserta en forense.inyecciones con estado 'recibida' y escribe bitacora con tipo_evento='inyeccion' (21 §3.2). Contrato product.inyectar de contracts 1.2.0. DEPENDE de 008 (forense-db).",
  ));

  fila = 1; columna = 2;
  add(nodo('Responder inyección 202', 'n8n-nodes-base.respondToWebhook', {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify({ inyeccion_id: $json.inyeccion_id, estado: $json.estado }) }}',
    options: { responseCode: 202 },
  }));

  fila = 0; columna = 2;
  add(sql(
    'Validar filas',
    'SELECT * FROM forense.validar_inyeccion($1::uuid)',
    I('inyeccion_id'),
    'Validación determinista de 19: claves, FK contra el snapshot base MÁS las filas nuevas, moneda, fechas ≤ fecha_corte (si una la supera, la corrida nueva adopta la fecha máxima inyectada y lo declara), duplicados por UUID = rechazo con motivo, y SIN etiquetas. DEPENDE de 008.',
  ));
  add(si('¿Inyección validada?', '={{ $json.validada }}'));

  fila = 1; columna = 4;
  add(sql(
    'Cerrar inyección rechazada',
    [
      'UPDATE forense.inyecciones',
      "   SET estado = 'rechazada', diagnostico = $2::jsonb, terminado = now()",
      ' WHERE id = $1::uuid',
      'RETURNING id AS inyeccion_id, estado, diagnostico',
    ].join('\n'),
    `${I('inyeccion_id')}, ={{ JSON.stringify($json.diagnostico) }}`,
    'Rechazo con motivo legible: la UI lo muestra en /inyecciones/[id] (21 §3.3).',
  ));

  fila = 0; columna = 4;
  add(sql(
    'Clonar corrida',
    'SELECT * FROM forense.clonar_corrida_con_inyeccion($1::uuid, $2::uuid)',
    `${I('corrida_base_id')}, ${I('ingesta_id')}`,
    'Transacción única: copia el snapshot base, inserta las filas nuevas, calcula un dataset_hash nuevo y deja la corrida `lista`. La corrida base queda intacta (regla 10 y 21 §3). DEPENDE de 008.',
  ));

  add(sql(
    'Recalcular pistas y clusters',
    [
      'SELECT $1::uuid AS corrida_nueva_id, $2::uuid AS inyeccion_id,',
      '       forense.correr_pistas($1::uuid) AS pistas_insertadas,',
      '       forense.armar_clusters($1::uuid) AS clusters_armados',
    ].join('\n'),
    `={{ $json.corrida_nueva_id }}, ${I('inyeccion_id')}`,
    'Sobre la corrida NUEVA. Estado de la inyección: pistas_recalculadas.',
  ));

  add(sql(
    'Clusters afectados primero',
    'SELECT * FROM forense.clusters_por_prioridad_inyeccion($1::uuid, $2::uuid)',
    `={{ $json.corrida_nueva_id }}, ${I('inyeccion_id')}`,
    'Ordena primero los clusters que contienen rfcs_afectados; el resto queda en_cola (21 §3 y regla 10 intactas). DEPENDE de 008.',
  ));

  add(codeInline('Priorizar afectados', [
    '// 21 §3: los clusters con RFC inyectados se despachan PRIMERO; el resto',
    '// espera. El juez tiene que ver la reacción en segundos, sin perder la',
    '// corrida de referencia.',
    'const MAX_ACTIVOS = 4;',
    'const filas = $input.all().map((i) => i.json);',
    'const afectados = filas.filter((f) => f.afectado === true);',
    'const resto = filas.filter((f) => f.afectado !== true);',
    'const admitidos = [...afectados, ...resto].slice(0, MAX_ACTIVOS);',
    'return admitidos.map((f) => ({ json: {',
    '  cluster_id: f.cluster_id,',
    '  corrida_id: f.corrida_id,',
    '  inyeccion_id: f.inyeccion_id ?? null,',
    '  investigacion_id: f.investigacion_id ?? null,',
    '  afectado: f.afectado === true,',
    '  idempotency_key: `inyeccion:${f.inyeccion_id}:${f.cluster_id}`,',
    '  afectados_total: afectados.length,',
    '  en_cola: Math.max(0, filas.length - admitidos.length),',
    '} }));',
  ].join('\n')));

  add(subworkflow('Despachar afectados', 'FORENSE_investigar_cluster', {
    cluster_id: '={{ $json.cluster_id }}',
    corrida_id: '={{ $json.corrida_id }}',
    investigacion_id: '={{ $json.investigacion_id }}',
    idempotency_key: '={{ $json.idempotency_key }}',
  }, { esperar: false, modo: 'each' }));

  add(sql(
    'Cerrar inyección',
    [
      'UPDATE forense.inyecciones',
      "   SET estado = 'investigando', corrida_nueva_id = $2::uuid, terminado = NULL",
      ' WHERE id = $1::uuid',
      'RETURNING id AS inyeccion_id, estado, corrida_nueva_id, creado',
    ].join('\n'),
    `${I('inyeccion_id')}, ={{ $('Recalcular pistas y clusters').first().json.corrida_nueva_id }}`,
    'La latencia recibida→dictamen se mide sobre los eventos persistidos, no aquí: el cierre a `completada` lo hace el agregador cuando los casos terminan (21 §3.4).',
  ));

  fila = 3; columna = 0;
  add(nota('Nota inyección', [
    'FORENSE_inyectar (21 §3, normativo).',
    '',
    'Una inyección NUNCA muta un snapshot: crea corrida nueva',
    'con corrida_origen_id = base, recalcula y despacha primero',
    'los clusters con RFC inyectados.',
    '',
    'Cada paso deja evento con tipo_evento = inyeccion:',
    'sin evento persistido no hay timeline ni animación.',
  ].join('\n'), 260, 420));

  const connections = conectar([
    ['Webhook inyectar', 'Registrar inyección'],
    ['Registrar inyección', ['Responder inyección 202', 'Validar filas']],
    ['Validar filas', '¿Inyección validada?'],
    ['¿Inyección validada?', 'Clonar corrida', 0],
    ['¿Inyección validada?', 'Cerrar inyección rechazada', 1],
    ['Clonar corrida', 'Recalcular pistas y clusters'],
    ['Recalcular pistas y clusters', 'Clusters afectados primero'],
    ['Clusters afectados primero', 'Priorizar afectados'],
    ['Priorizar afectados', ['Despachar afectados', 'Cerrar inyección']],
  ]);

  return workflow('FORENSE_inyectar', nodes, connections);
}

// -------------------------------------------------- FORENSE_notificar_completada

export function notificarCompletada() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };
  const N = (campo) => `={{ $('Releer evento desde DB').first().json.${campo} }}`;

  add(nodo(
    'Webhook investigación completa',
    'n8n-nodes-base.webhook',
    {
      httpMethod: 'POST',
      path: 'forense/investigacion-completa',
      authentication: 'headerAuth',
      responseMode: 'onReceived',
      options: {},
    },
    { credentials: CREDENCIALES.webhook },
  ));

  add(sql(
    'Releer evento desde DB',
    'SELECT * FROM forense.leer_evento_salida($1::uuid)',
    '={{ $json.body.evento_id }}',
    'NO confía en el payload: relee evento y estado desde DB. Un teléfono en el payload se IGNORA (16 §2). DEPENDE de 007 (forense-db).',
  ));

  add(sql(
    'Reclamar evento',
    'SELECT * FROM forense.reclamar_evento_salida($1::uuid, $2::text)',
    `${N('evento_id')}, ={{ $execution.id }}`,
    'Claim atómico con lease; unicidad (investigacion_id, tipo_evento). Cinco entregas del webhook NO generan cinco llamadas (16 §2). DEPENDE de 007.',
  ));

  add(sql(
    'Resolver destinatario',
    'SELECT * FROM forense.destinatario_aviso($1::uuid)',
    N('investigacion_id'),
    'Perfil propietario, teléfono E.164, preferencia de llamadas vigente y permiso guardado. El teléfono sale del PERFIL, jamás del prompt (16 §3). DEPENDE de 007.',
  ));

  add(si('¿Puede llamar?', '={{ $json.puede_llamar }}'));

  fila = 1; columna = 5;
  add(sql(
    'Omitir con motivo',
    'SELECT * FROM forense.omitir_llamada($1::uuid, $2::text)',
    `${N('investigacion_id')}, ={{ $json.motivo_omision }}`,
    "Estado `omitida` con motivo; el aviso DENTRO de la app se mantiene: la voz es un extra, no el canal (16 §2).",
  ));

  fila = 0; columna = 5;
  add(sql(
    'Crear intento de llamada',
    'SELECT * FROM forense.crear_intento_llamada($1::uuid, $2::uuid)',
    `${N('investigacion_id')}, ${N('evento_id')}`,
    "Congela destinatario y configuración y reclama `solicitando` ANTES del POST (16 §2.5). Devuelve las dynamic_variables ya normalizadas: sin RFC, montos ni sospechas. DEPENDE de 007.",
  ));

  add(nodo(
    'POST outbound-call',
    'n8n-nodes-base.httpRequest',
    {
      method: 'POST',
      url: ENDPOINT_LLAMADA,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      // 16 §3: nunca RFC, montos, sospechas ni reporte. El cuerpo lo arma la
      // RPC anterior con variables normalizadas y acotadas.
      jsonBody: '={{ JSON.stringify($json.cuerpo_elevenlabs) }}',
      options: {
        timeout: 20000,
        response: { response: { fullResponse: true, neverError: true } },
      },
    },
    { credentials: CREDENCIALES.elevenlabs, retryOnFail: false },
  ));

  add(sql(
    'Guardar aceptación',
    'SELECT * FROM forense.guardar_aceptacion_llamada($1::uuid, $2::int, $3::jsonb)',
    "={{ $('Crear intento de llamada').first().json.llamada_id }}, ={{ $json.statusCode }}, ={{ JSON.stringify($json.body) }}",
    'HTTP 200 = solicitud ACEPTADA, no que alguien contestó. Timeout después de enviar → `resultado_desconocido` y reconciliación, nunca redial ciego (16 §2.7). DEPENDE de 007.',
  ));

  fila = 3; columna = 0;
  add(nota('Nota voz', [
    'FORENSE_notificar_completada (16 §2).',
    '',
    'Una llamada por INVESTIGACIÓN, nunca una por cluster ni una por',
    'cada entrega duplicada del webhook. Editar el reporte no vuelve',
    'a llamar. El fallo de la llamada no invalida el reporte.',
    '',
    'Bloqueo externo conocido (21 §5): la cuenta ElevenLabs tiene CERO',
    'números salientes. Se entrega el circuito y la interfaz; la',
    'llamada real no se ha ejecutado.',
  ].join('\n'), 260, 430));

  const connections = conectar([
    ['Webhook investigación completa', 'Releer evento desde DB'],
    ['Releer evento desde DB', 'Reclamar evento'],
    ['Reclamar evento', 'Resolver destinatario'],
    ['Resolver destinatario', '¿Puede llamar?'],
    ['¿Puede llamar?', 'Crear intento de llamada', 0],
    ['¿Puede llamar?', 'Omitir con motivo', 1],
    ['Crear intento de llamada', 'POST outbound-call'],
    ['POST outbound-call', 'Guardar aceptación'],
  ]);

  return workflow('FORENSE_notificar_completada', nodes, connections);
}

// --------------------------------------------------- FORENSE_resultado_llamada

export function resultadoLlamada() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };

  add(nodo(
    'Webhook resultado',
    'n8n-nodes-base.webhook',
    {
      httpMethod: 'POST',
      path: 'forense/elevenlabs-resultado',
      // La HMAC se verifica sobre el cuerpo CRUDO: sin rawBody, n8n reserializa
      // el JSON y la firma deja de coincidir (16 §3).
      options: { rawBody: true },
      responseMode: 'responseNode',
    },
  ));

  add(codeInline('Verificar HMAC', [
    '// 16 §3: firma sobre el cuerpo CRUDO + ventana temporal. Firma inválida →',
    '// 401 sin escribir nada.',
    '//',
    '// El stub de la oleada 1 (VERIFICACION_DISPONIBLE=false) desapareció en H8:',
    '// aquí va el verificador REAL de forense-voice, embebido verbatim por el',
    '// generador. Se llama en su FORMA POSICIONAL',
    '// verificarFirma(rawBody, headers, secreto, ahora_ms, opciones).',
    '//',
    '// REQUISITO DE DESPLIEGUE: n8n sólo expone `crypto` a los Code nodes si',
    '// NODE_FUNCTION_ALLOW_BUILTIN incluye `crypto` (ver IMPORT.md §Variables).',
    '// Sin eso este nodo lanza y el callback se RECHAZA, que es el lado seguro.',
    embeberModulo('elevenlabs/hmac.mjs', {
      requires: [{ modulo: 'crypto', nombres: ['createHmac', 'timingSafeEqual'] }],
    }),
    embeberModulo('elevenlabs/callback.mjs'),
    '',
    'const x = $input.first().json;',
    '// El cuerpo CRUDO: sin él no hay firma que verificar (un JSON reserializado',
    "// no reproduce los bytes firmados). El webhook va en modo 'raw body'",
    '// (options.rawBody = true en «Webhook resultado»), y en ese modo n8n NO',
    '// entrega siempre un string: según versión llega Buffer, o {data,type} de',
    '// un Buffer serializado, o base64. `verificarFirma` exige string y si no lo',
    '// es devuelve `cuerpo_no_crudo`, así que la normalización va aquí y se',
    '// prueba aparte (n8n/tests/voz.test.mjs), no se supone.',
    'function cuerpoCrudo(j) {',
    '  for (const v of [j.body, j.rawBody, j.data]) {',
    "    if (typeof v === 'string') return v;",
    '    if (v && typeof v === \'object\') {',
    '      if (typeof Buffer !== \'undefined\' && Buffer.isBuffer(v)) return v.toString(\'utf8\');',
    "      if (v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data).toString('utf8');",
    '    }',
    '  }',
    '  return null;',
    '}',
    'const crudo = cuerpoCrudo(x);',
    'if (typeof crudo !== \'string\' || crudo.length === 0) {',
    "  throw new Error('el webhook no entregó el cuerpo crudo (¿options.rawBody?): no se puede verificar la firma (401)');",
    '}',
    'const secreto = $env.FORENSE_ELEVENLABS_WEBHOOK_SECRET ?? null;',
    'const r = verificarFirma(crudo, x.headers ?? {}, secreto, Date.now(), {});',
    'if (!r.valido) throw new Error(`callback rechazado (401): ${r.motivo}`);',
    'const evento = JSON.parse(crudo);',
    'const salida = Object.assign(',
    '  { valido: true, tolerancia_s: TOLERANCIA_FIRMA_S, evento },',
    '  estadoDesdeCallback(evento),',
    ');',
    'return [{ json: salida }];',
  ].join('\n')));

  add(sql(
    'Deduplicar callback',
    'SELECT * FROM forense.registrar_callback_llamada($1::text, $2::text, $3::jsonb)',
    '={{ $json.evento.conversation_id }}, ={{ $json.evento.call_sid }}, ={{ JSON.stringify($json.evento) }}',
    'Deduplica por evento/identidad del proveedor y correlaciona por conversation_id/callSid. Un callback que llega ANTES de guardar el POST se conserva para conciliación posterior (16 §2.7). DEPENDE de 007.',
  ));

  add(sql(
    'Actualizar llamada',
    'SELECT * FROM forense.actualizar_llamada($1::uuid, $2::text, $3::boolean)',
    '={{ $json.llamada_id }}, ={{ $json.estado_llamada }}, ={{ $json.aviso_entregado }}',
    'Mapea SOLO hechos recibidos: sin callback de timbrado no se muestra «Sonando». `aviso_entregado` solo si el análisis lo respalda. El fallo de voz no revierte la investigación ni borra el reporte (16 §2.7). DEPENDE de 007.',
  ));

  add(nodo('Responder acuse', 'n8n-nodes-base.respondToWebhook', {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify({ recibido: true }) }}',
    options: { responseCode: 200 },
  }));

  fila = 2; columna = 0;
  add(nota('Nota callback', [
    'FORENSE_resultado_llamada (16 §3).',
    '',
    'rawBody + HMAC sobre el cuerpo crudo. El acuse no lleva datos',
    'del caso. Sin verificador instalado, el nodo RECHAZA.',
  ].join('\n'), 200, 400));

  const connections = conectar([
    ['Webhook resultado', 'Verificar HMAC'],
    ['Verificar HMAC', 'Deduplicar callback'],
    ['Deduplicar callback', 'Actualizar llamada'],
    ['Actualizar llamada', 'Responder acuse'],
  ]);

  return workflow('FORENSE_resultado_llamada', nodes, connections);
}

// --------------------------------------------------------- FORENSE_reconciliador

export function reconciliador() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };

  add(nodo('Cada 10 s', 'n8n-nodes-base.scheduleTrigger', {
    rule: { interval: [{ field: 'seconds', secondsInterval: 10 }] },
  }));

  add(sql(
    'Slots vencidos',
    [
      'SELECT r.ok, r.clusters, r.tareas, r.ejecuciones, r.slots, r.solicitudes, r.pasos',
      '  FROM jsonb_to_record(forense.recover_expired(now()))',
      '    AS r(ok boolean, clusters int, tareas int, ejecuciones int, slots int,',
      '         solicitudes int, pasos int)',
    ].join('\n'),
    null,
    'Leases vencidos, tareas huérfanas y pasos sin avance. La ejecución conserva su fence_token: el siguiente claim_step lo incrementa y deja fuera al proceso viejo (17 §4).',
  ));

  add(sql(
    'Pasos recuperables',
    [
      'SELECT e.id AS execution_id, e.caso_id, e.tarea_id, e.corrida_id, e.rol,',
      "       'reconciliador'::text AS owner",
      '  FROM forense.ejecuciones_agente e',
      "  WHERE e.estado_interno NOT IN ('terminado','error','timeout')",
      '    AND e.lease_owner IS NULL',
      '    AND (e.deadline_at IS NULL OR e.deadline_at > now())',
      '  ORDER BY e.actualizado',
      '  LIMIT 8',
    ].join('\n'),
    null,
    '17 §2: ocho pasos activos como máximo. El reconciliador es RECUPERACIÓN, no el camino normal: el dispatcher es inmediato al guardar checkpoint.',
  ));

  add(subworkflow('Redespachar pasos', 'FORENSE_ejecutar_agente', {
    execution_id: '={{ $json.execution_id }}',
    tarea_id: '={{ $json.tarea_id }}',
    owner: '={{ $json.owner }}',
  }, { esperar: false, modo: 'each' }));

  fila = 1; columna = 2;
  add(sql(
    'Barreras vencidas',
    'SELECT * FROM forense.cerrar_barreras_vencidas(now())',
    null,
    'Cierra barreras con deadline vencido marcando limitaciones y llama a advance_case_if_ready. Error o timeout NO es ausencia de fraude (07). DEPENDE de forense-db.',
  ));

  add(sql(
    'Outbox pendiente',
    'SELECT * FROM forense.eventos_salida_pendientes($1::int)',
    '={{ 20 }}',
    'Reenvía eventos de eventos_salida no entregados (16 §2). El backoff de outbox NO equivale a repetir una llamada ya aceptada. DEPENDE de 007.',
  ));

  add(subworkflow('Reenviar outbox', 'FORENSE_notificar_completada', {
    evento_id: '={{ $json.evento_id }}',
  }, { esperar: false, modo: 'each' }));

  fila = 3; columna = 0;
  add(nota('Nota reconciliador', [
    'FORENSE_reconciliador (17 §3).',
    '',
    'Cada 10 s, configurable y a validar en la instancia.',
    'Es la RED DE SEGURIDAD, no el camino normal.',
    'No hace polling al LLM.',
  ].join('\n'), 200, 400));

  const connections = conectar([
    ['Cada 10 s', ['Slots vencidos', 'Barreras vencidas']],
    ['Slots vencidos', 'Pasos recuperables'],
    ['Pasos recuperables', 'Redespachar pasos'],
    ['Barreras vencidas', 'Outbox pendiente'],
    ['Outbox pendiente', 'Reenviar outbox'],
  ]);

  return workflow('FORENSE_reconciliador', nodes, connections);
}

// ---------------------------------------------------------------- FORENSE_errores

export function errores() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };

  add(nodo('Error Trigger', 'n8n-nodes-base.errorTrigger', {}));

  add(sql(
    'Resolver por execution.id',
    [
      'SELECT c.id AS caso_id, c.corrida_id, c.cluster_id, t.id AS tarea_id, t.agente,',
      '       t.lease_owner, t.estado AS estado_tarea, $1::text AS n8n_execution_id',
      '  FROM forense.casos c',
      '  LEFT JOIN forense.tareas_agente t ON t.caso_id = c.id',
      ' WHERE c.n8n_execution_id = $1::text',
      ' ORDER BY t.iniciado DESC NULLS LAST',
      ' LIMIT 1',
    ].join('\n'),
    '={{ $json.execution.id }}',
    'Localiza caso y tarea por el n8n_execution_id persistido: un error técnico sin caso no puede cerrar nada.',
  ));

  add(si('¿Propietario vigente?', '={{ $json.lease_owner !== null }}'));

  fila = 1; columna = 3;
  add(sql(
    'Registrar y liberar',
    [
      'WITH ev AS (',
      '  SELECT forense.log(',
      "           p_caso => $1::uuid, p_agente => coalesce($2::text, 'sistema'), p_tipo => 'error',",
      '           p_payload => $3::jsonb, p_tarea => $4::uuid, p_corrida => $5::uuid)',
      '), t AS (',
      '  UPDATE forense.tareas_agente',
      "     SET estado = 'error', terminado = now(), error = $6::text,",
      '         lease_owner = NULL, lease_expires_at = NULL',
      '   WHERE id = $4::uuid',
      '  RETURNING id',
      ')',
      "SELECT $1::uuid AS caso_id, $4::uuid AS tarea_id, 'error'::text AS estado_tarea,",
      '       true AS registrado FROM ev, t',
    ].join('\n'),
    "={{ $json.caso_id }}, ={{ $json.agente }}, ={{ JSON.stringify({ execution_id: $json.n8n_execution_id, error: $('Error Trigger').first().json.execution?.error?.message ?? null }) }}, ={{ $json.tarea_id }}, ={{ $json.corrida_id }}, ={{ $('Error Trigger').first().json.execution?.error?.message ?? 'error técnico de ejecución' }}",
    'Causa en bitácora, tarea a `error` y lease liberado. Una tarea fallida PASA por la barrera para conservar los resultados de las demás (07).',
  ));

  fila = 3; columna = 0;
  add(nota('Nota errores', [
    'FORENSE_errores (07).',
    '',
    'Entrada de OTRA ejecución, no un catch de la rama normal.',
    'No corre en pruebas manuales de n8n: se prueba con un webhook',
    'automático y un fallo controlado.',
    '',
    'Comprueba owner/fence antes de escribir: un proceso viejo no',
    'cierra un caso ajeno.',
  ].join('\n'), 240, 420));

  const connections = conectar([
    ['Error Trigger', 'Resolver por execution.id'],
    ['Resolver por execution.id', '¿Propietario vigente?'],
    ['¿Propietario vigente?', 'Registrar y liberar', 0],
  ]);

  return workflow('FORENSE_errores', nodes, connections);
}

// --------------------------------------------------- contrato entre nodos
//
// Qué campos publica cada nodo. Es el contrato que cierra el hueco de
// MANIFEST §2.1: «nadie comprueba todavía que lo que un nodo emite sea lo que
// el siguiente espera». `n8n/tests/workflows.test.mjs` recorre el grafo y
// exige que cada `$json.campo` y cada `$('Nodo').first().json.campo` esté
// publicado por un antecesor real.
//
// Para los nodos Postgres cuyas funciones todavía no existen (004/005 de
// forense-db) esta tabla ES la especificación de lo que deben devolver: si la
// función real devuelve otra cosa, el test de la migración lo verá aquí.
//
// Los nodos de paso (if/switch/wait/respondToWebhook/executeWorkflow sin
// espera) no publican campos propios: reenvían los de su antecesor.
export const TIPOS_TRANSPARENTES = Object.freeze([
  'n8n-nodes-base.if',
  'n8n-nodes-base.switch',
  'n8n-nodes-base.wait',
  'n8n-nodes-base.respondToWebhook',
  'n8n-nodes-base.stickyNote',
]);

const IDENTIDAD_PASO = [
  'execution_id', 'owner', 'fencing_token', 'revision', 'caso_id', 'corrida_id',
  'tarea_id', 'rol', 'paso', 'paso_pipeline', 'request_id',
];

export const CONTRATOS_NODOS = Object.freeze({
  FORENSE_ejecutar_agente: Object.freeze({
    'Paso entrante': ['tarea_id', 'execution_id', 'owner', 'motivo'],
    'Reclamar paso': ['ok', 'error', 'execution_id', 'fencing_token', 'revision', 'paso',
      'estado_interno', 'rol', 'tarea_id', 'caso_id', 'corrida_id', 'editor_operacion_id',
      'checkpoint', 'deadline_at', 'owner'],
    'Paso no reclamable': ['estado', 'motivo', 'execution_id', 'caso_id', 'corrida_id', 'tarea_id', 'owner'],
    'Registrar en_cola': ['caso_id', 'corrida_id', 'tarea_id', 'tipo_evento', 'registrado'],
    'Cargar ejecución': ['execution_id', 'owner', 'fencing_token', 'revision', 'paso', 'estado_interno',
      'rol', 'tarea_id', 'caso_id', 'corrida_id', 'editor_operacion_id', 'checkpoint', 'deadline_at',
      'modelo', 'prompt_hash', 'context_hash', 'paquete', 'ronda', 'intento', 'agente', 'paso_pipeline'],
    'Decidir accion': [...IDENTIDAD_PASO, 'accion', 'evento', 'razon', 'motivo_request',
      'estado_interno', 'estado_tarea', 'reparaciones_json', 'pending_tool_use_ids', 'checkpoint'],
    'Reservar request': ['ok', 'error', 'duplicado', 'request_id', 'bolsa', 'restante', 'intento_transporte'],
    'Construir cuerpo Messages': [...IDENTIDAD_PASO, 'modelo', 'cuerpo', 'system', 'herramientas_enviadas',
      'version_prompts', 'prompt_hash', 'variante_prompt', 'intento', 'motivo_reintento',
      'aviso_reintento', 'ambito_techo', 'caracteres_system', 'caracteres_paquete'],
    'Registrar aviso de reintento': ['caso_id', 'tarea_id', 'variante_prompt', 'tipo_evento',
      'evento_real', 'registrado'],
    'POST /v1/messages': ['statusCode', 'headers', 'body'],
    'Clasificar transporte': ['clase', 'ruta', 'espera_ms', 'intento', 'reintentar',
      'retry_after_respetado', 'motivo'],
    'Marcar desconocido': ['request_id', 'estado', 'estado_interno', 'checkpoint'],
    'Marcar error de request': ['request_id', 'estado', 'estado_interno', 'checkpoint'],
    'Interpretar respuesta': [...IDENTIDAD_PASO, 'provider_request_id', 'usage', 'modelo', 'stop_reason',
      'bloques_assistant', 'contrato', 'requiere_validacion_contrato', 'tipo', 'cola', 'evento',
      'pending_tool_use_ids', 'salida', 'errores', 'texto', 'diagnostico', 'salida_valida',
      'estado_interno', 'checkpoint'],
    'Validar salida contra contrato': ['salida_valida', 'errores', 'estado_interno', 'checkpoint'],
    'Completar request': ['request_id', 'estado', 'estado_interno', 'checkpoint'],
    'Expandir cola de tools': [...IDENTIDAD_PASO, 'tool_use_id', 'nombre', 'orden', 'autorizada',
      'argumentos_backend', 'base_rest', 'total_en_lote'],
    'Reclamar tool': ['ok', 'duplicado', 'tool_ejecucion_id', 'estado', 'resultado_ref', 'error',
      'tool_use_id', 'nombre', 'args_hash'],
    'Llamar RPC forense': ['statusCode', 'headers', 'body'],
    'Registrar resultado tool': ['ok', 'tool_ejecucion_id', 'estado', 'tool_use_id', 'resultado', 'duplicado'],
    'Armar tool_results': [...IDENTIDAD_PASO, 'mensaje', 'tool_use_ids', 'con_error', 'reentregas',
      'estado_interno', 'estado_tarea', 'checkpoint'],
    'Guardar checkpoint': ['ok', 'error', 'revision', 'revision_actual', 'estado_interno'],
    'Registrar paso guardado': ['caso_id', 'tipo_evento', 'registrado'],
    'Redespachar paso': [],
    'Finalizar paso': ['ok', 'error', 'revision', 'estado_interno', 'tarea_id', 'caso_id'],
    'Avanzar caso si listo': ['ok', 'avanzo', 'paso', 'revision', 'esperadas', 'pendientes', 'motivo'],
  }),
  FORENSE_investigar_cluster: Object.freeze({
    'Desde corrida': ['cluster_id', 'corrida_id', 'investigacion_id', 'idempotency_key', 'origen', 'valor'],
    'Webhook investigar': ['headers', 'params', 'query', 'body'],
    'Normalizar entrada': ['corrida_id', 'cluster_id', 'origen', 'valor_untrusted',
      'investigacion_id', 'idempotency_key', 'entrada'],
    'Resolver y reclamar cluster': ['ok', 'estado', 'caso_id', 'cluster_id', 'corrida_id',
      'investigacion_id', 'idempotency_key', 'lease_owner', 'motivo'],
    'Crear caso': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'idempotency_key', 'intento'],
    'Contexto ronda 1': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'context_hash',
      'version_contexto', 'roles_evaluables', 'familias_evaluables'],
    'Crear tareas R1': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'tarea_id',
      'tarea_ids', 'snapshot_senales', 'deadline', 'version_contexto'],
    'Despachar especialistas': [],
    // INSERT ... RETURNING *: las columnas son las de forense.pasos_pipeline.
    'Registrar barrera R1': ['caso_id', 'paso', 'revision', 'tareas_esperadas',
      'snapshot_senales', 'estado', 'deadline'],
    'Esperar barrera R1': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'paso',
      'completa', 'faltantes', 'vencida', 'resultados', 'limitaciones'],
    'Ronda fin R1': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'senales',
      'familias_evaluables', 'version_contexto', 'roles_por_expansion', 'rfcs_frontera',
      'ruta_material', 'expansiones_usadas', 'tipo_evento', 'registrado'],
    'Evaluar frontera y despertar': ['caso_id', 'corrida_id', 'cluster_id', 'investigacion_id',
      'despertados', 'motivos', 'frontera', 'saltar_ronda2', 'version_contexto'],
    'Expandir y crear tareas R2': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id',
      'tarea_id', 'tarea_ids', 'version_contexto', 'deadline'],
    'Despachar R2': [],
    'Barrera R2': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'paso',
      'completa', 'faltantes', 'vencida'],
    'Auditoría': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'tarea_id', 'rol'],
    'Ejecutar auditor': ['caso_id', 'tarea_id', 'estado_interno'],
    'Validar evidencia propuesta': ['caso_id', 'tarea_id', 'validadas', 'descartadas',
      'cluster_id', 'corrida_id', 'investigacion_id'],
    'Defensa': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'tarea_id', 'rol',
      'tarea_replica_id'],
    'Ejecutar defensor': ['caso_id', 'tarea_id', 'tarea_replica_id', 'estado_interno'],
    'Réplica': ['caso_id', 'tarea_replica_id', 'estado_interno'],
    'Aplicar resolución': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'resoluciones'],
    'Paquete auditor final': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'caso',
      'pistas', 'evidencia', 'pendientes', 'cobertura_completa', 'presupuesto'],
    'Auditor Final': ['rechazo', 'nivel', 'familias', 'monto_en_riesgo_centavos', 'regla',
      'limitaciones', 'caso_id', 'cluster_id', 'corrida_id', 'investigacion_id'],
    'Claim de reintento': ['caso_id', 'n_reintentos', 'rechazo'],
    'Llamar reintento': ['caso_id', 'reanudar_en', 'limitaciones'],
    'Guardar dictamen': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'nivel', 'version'],
    'Redacción': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'tarea_id', 'rol', 'version'],
    'Ejecutar redactor': ['caso_id', 'tarea_id', 'version', 'estado_interno'],
    'Validar citas': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'version',
      'ok', 'estado_final'],
    'Cerrar caso': ['caso_id', 'cluster_id', 'corrida_id', 'investigacion_id', 'estado_final',
      'duracion_ms'],
    'Avisar agregador': [],
  }),
  FORENSE_reintento: Object.freeze({
    'Entrada reintento': ['caso_id', 'intento', 'motivo', 'objetivo', 'corrida_id', 'cluster_id'],
    'Validar intento': ['caso_id', 'intento', 'motivo', 'objetivo', 'corrida_id', 'cluster_id'],
    'Cargar caso vigente': ['caso_id', 'corrida_id', 'cluster_id', 'nivel', 'n_reintentos',
      'version_contexto', 'tool_calls', 'presupuesto_agotado', 'expansiones_usadas',
      'intento', 'motivo', 'objetivo'],
    'Seleccionar autores': ['caso_id', 'autores', 'puede_expandir', 'motivo', 'objetivo'],
    'Registrar límite de expansión': ['caso_id', 'autores', 'expandido', 'limitacion'],
    'Expandir para reintento': ['caso_id', 'autores', 'expandido', 'version_contexto', 'rfcs_nuevos'],
    'Crear tareas de revisión': ['caso_id', 'tarea_id', 'tarea_ids', 'version_contexto', 'deadline'],
    'Despachar revisión': [],
    'Barrera reintento': ['caso_id', 'paso', 'completa', 'faltantes', 'vencida'],
    'Revalidar si cambió evidencia': ['caso_id', 'limitaciones', 'evidencia_revalidada'],
    'Retornar al padre': ['caso_id', 'intento', 'reanudar_en', 'limitaciones'],
  }),
  FORENSE_editar_expediente: Object.freeze({
    'Webhook editar': ['headers', 'params', 'query', 'body'],
    'Validar solicitud': ['caso_id', 'modo', 'version_base', 'idempotency_key',
      'instruccion_untrusted', 'seleccion', 'directriz_id'],
    'Cargar versión base': ['caso_id', 'version_actual', 'nivel', 'citas_permitidas',
      'context_hash', 'prompt_hash', 'modelo', 'documento'],
    'Abrir operación editor': ['execution_id', 'editor_operacion_id', 'rol', 'deadline_at', 'corrida_id'],
    'Ejecutar editor': ['salida', 'estado_interno', 'execution_id'],
    'Validar propuesta': ['caso_id', 'modo', 'modo_salida', 'conflicto', 'version_base',
      'mensaje', 'patch', 'diff', 'citas'],
    'Guardar propuesta': ['propuesta_id', 'caso_id', 'version_base', 'creado'],
  }),
  FORENSE_corrida: Object.freeze({
    'Webhook corrida': ['headers', 'params', 'query', 'body'],
    'Validar e idempotencia': ['corrida_id', 'estado', 'idempotency_key', 'corrida_origen_id',
      'investigacion_id', 'dataset', 'reutilizada'],
    'Cargar o clonar snapshot': ['corrida_id', 'estado', 'filas_por_tabla', 'corrida_origen_id'],
    'Verificar integridad': ['corrida_id', 'estado', 'dataset_hash', 'fecha_corte',
      'familias_evaluables', 'causa'],
    'Correr pistas': ['pistas_insertadas'],
    'Armar clusters': ['clusters_armados'],
    'Clusters por score': ['cluster_id', 'corrida_id', 'score', 'estado',
      'investigacion_id', 'idempotency_key'],
    'Despachar hasta 4': ['cluster_id', 'corrida_id', 'investigacion_id', 'idempotency_key',
      'admitidos', 'en_cola', 'cola_restante'],
    'Despachar cluster': [],
    'Esperar y reconciliar': ['corrida_id', 'terminada', 'estado_final', 'completados',
      'en_cola', 'errores'],
    'Métricas': ['metricas'],
    'Cerrar corrida': ['corrida_id', 'estado', 'fin', 'metricas'],
  }),
  FORENSE_inyectar: Object.freeze({
    'Webhook inyectar': ['headers', 'params', 'query', 'body'],
    'Registrar inyección': ['inyeccion_id', 'estado', 'corrida_base_id', 'ingesta_id',
      'idempotency_key', 'prioridad'],
    'Validar filas': ['inyeccion_id', 'validada', 'diagnostico', 'rfcs_afectados',
      'filas_por_tabla', 'fecha_corte_nueva'],
    'Cerrar inyección rechazada': ['inyeccion_id', 'estado', 'diagnostico'],
    'Clonar corrida': ['inyeccion_id', 'corrida_nueva_id', 'dataset_hash', 'estado'],
    'Recalcular pistas y clusters': ['corrida_nueva_id', 'inyeccion_id', 'pistas_insertadas',
      'clusters_armados'],
    'Clusters afectados primero': ['cluster_id', 'corrida_id', 'inyeccion_id',
      'investigacion_id', 'afectado', 'score'],
    'Priorizar afectados': ['cluster_id', 'corrida_id', 'inyeccion_id', 'investigacion_id',
      'afectado', 'idempotency_key', 'afectados_total', 'en_cola'],
    'Despachar afectados': [],
    'Cerrar inyección': ['inyeccion_id', 'estado', 'corrida_nueva_id', 'creado'],
  }),
  FORENSE_notificar_completada: Object.freeze({
    'Webhook investigación completa': ['headers', 'params', 'query', 'body'],
    'Releer evento desde DB': ['evento_id', 'investigacion_id', 'tipo_evento', 'estado',
      'completada_at', 'reporte_hash'],
    'Reclamar evento': ['evento_id', 'reclamado', 'lease_owner', 'motivo'],
    'Resolver destinatario': ['investigacion_id', 'puede_llamar', 'motivo_omision',
      'perfil_id', 'referencia_corta'],
    'Omitir con motivo': ['investigacion_id', 'estado', 'motivo_omision'],
    'Crear intento de llamada': ['llamada_id', 'investigacion_id', 'estado', 'cuerpo_elevenlabs'],
    'POST outbound-call': ['statusCode', 'headers', 'body'],
    'Guardar aceptación': ['llamada_id', 'estado', 'conversation_id', 'call_sid'],
  }),
  FORENSE_resultado_llamada: Object.freeze({
    'Webhook resultado': ['headers', 'params', 'query', 'body'],
    'Verificar HMAC': ['valido', 'tolerancia_s', 'evento'],
    'Deduplicar callback': ['llamada_id', 'duplicado', 'estado_llamada', 'aviso_entregado'],
    'Actualizar llamada': ['llamada_id', 'estado', 'aviso_entregado'],
  }),
  FORENSE_reconciliador: Object.freeze({
    'Cada 10 s': [],
    'Slots vencidos': ['ok', 'clusters', 'tareas', 'ejecuciones', 'slots', 'solicitudes', 'pasos'],
    'Pasos recuperables': ['execution_id', 'caso_id', 'tarea_id', 'corrida_id', 'rol', 'owner'],
    'Redespachar pasos': [],
    'Barreras vencidas': ['caso_id', 'paso', 'cerradas', 'limitaciones'],
    'Outbox pendiente': ['evento_id', 'investigacion_id', 'intentos'],
    'Reenviar outbox': [],
  }),
  FORENSE_errores: Object.freeze({
    'Error Trigger': ['execution', 'workflow', 'trigger'],
    'Resolver por execution.id': ['caso_id', 'corrida_id', 'cluster_id', 'tarea_id', 'agente',
      'lease_owner', 'estado_tarea', 'n8n_execution_id'],
    'Registrar y liberar': ['caso_id', 'tarea_id', 'estado_tarea', 'registrado'],
  }),
});

// Nodos cuya FORMA de salida no puede comprobarse contra el texto de la
// consulta porque llaman a funciones de 004/005 (forense-db) con `SELECT *`:
// las columnas las fija la función, que todavía no existe. Para ellos,
// `CONTRATOS_NODOS` es la ESPECIFICACIÓN que la migración debe cumplir, y esta
// lista es el recordatorio explícito de que no está verificada. El test falla
// si la lista crece o encoge sin actualizarla.
export const FORMA_PENDIENTE = Object.freeze({
  FORENSE_ejecutar_agente: Object.freeze([]),
  FORENSE_errores: Object.freeze([]),
  // 'Paquete auditor final' salió de la lista en H8: ya no es `SELECT *`. Su
  // consulta nombra las diez columnas y adapta la forma de 010 a la que
  // consume `dictaminar()`, así que el texto ES comprobable. Además
  // `n8n/tests/verificar-forma-nodos.mjs` la ejecuta contra Postgres.
  FORENSE_investigar_cluster: Object.freeze([
    'Aplicar resolución', 'Cerrar caso', 'Guardar dictamen',
    'Ronda fin R1', 'Validar citas',
  ]),
  // 'Barrera reintento' salió en H8: dejó de ser `SELECT *` (usaba una
  // función que devuelve jsonb escalar y perdía todas las columnas).
  FORENSE_reintento: Object.freeze([
    'Crear tareas de revisión', 'Expandir para reintento',
    'Revalidar si cambió evidencia', 'Seleccionar autores',
  ]),
  FORENSE_editar_expediente: Object.freeze(['Cargar versión base', 'Guardar propuesta']),
  FORENSE_corrida: Object.freeze([
    'Cargar o clonar snapshot', 'Esperar y reconciliar', 'Validar e idempotencia',
    'Verificar integridad',
  ]),
  FORENSE_inyectar: Object.freeze([
    'Clonar corrida', 'Clusters afectados primero', 'Registrar inyección', 'Validar filas',
  ]),
  FORENSE_notificar_completada: Object.freeze([
    'Crear intento de llamada', 'Guardar aceptación', 'Omitir con motivo', 'Reclamar evento',
    'Releer evento desde DB', 'Resolver destinatario',
  ]),
  FORENSE_resultado_llamada: Object.freeze(['Actualizar llamada', 'Deduplicar callback']),
  FORENSE_reconciliador: Object.freeze(['Barreras vencidas', 'Outbox pendiente']),
});

// ------------------------------------------------------------------ emisión

// Orden de 17 §2 (worker → reintento → editor → investigación → corrida →
// notificador → callback → reconciliador/errores) con FORENSE_inyectar entre
// corrida y notificador, por su dependencia de ambas (21 §3).
export const WORKFLOWS = [
  workerEjecutarAgente, reintento, editarExpediente, investigarCluster, corrida,
  inyectar, notificarCompletada, resultadoLlamada, reconciliador, errores,
];

export function generar({ check = false } = {}) {
  const informe = [];
  for (const construir of WORKFLOWS) {
    const wf = construir();
    const destino = path.join(RAIZ_N8N, 'workflows', `${wf.name}.json`);
    const contenido = `${JSON.stringify(wf, null, 2)}\n`;
    const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : null;
    const igual = actual === contenido;
    if (!check && !igual) {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, contenido);
    }
    informe.push({ destino, igual, escrito: !check && !igual, nodos: wf.nodes.length });
  }
  return informe;
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const check = process.argv.includes('--check');
  const informe = generar({ check });
  for (const r of informe) {
    const etiqueta = r.igual ? 'ok      ' : check ? 'DERIVA  ' : 'escrito ';
    console.log(`${etiqueta} ${path.relative(process.cwd(), r.destino)} (${r.nodos} nodos)`);
  }
  if (check && informe.some((r) => !r.igual)) {
    console.error('Los workflows exportados no coinciden con el generador. Ejecuta node n8n/runtime/generar-workflows.mjs');
    process.exit(1);
  }
}
