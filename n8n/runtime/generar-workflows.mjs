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
} from '../prompts/ensamblar.mjs';
import { MAX_TOKENS_SALIDA } from './config.mjs';

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
      'WITH ev AS (',
      '  SELECT forense.log(',
      "           p_caso => $1::uuid, p_agente => 'sistema', p_tipo => 'paso_en_cola',",
      '           p_payload => $2::jsonb, p_tarea => $3::uuid, p_corrida => $4::uuid)',
      ')',
      "SELECT $1::uuid AS caso_id, 'paso_en_cola'::text AS tipo_evento, true AS registrado FROM ev",
    ].join('\n'),
    '={{ $json.caso_id }}, ={{ JSON.stringify({ execution_id: $json.execution_id, motivo: $json.motivo }) }}, ={{ $json.tarea_id }}, ={{ $json.corrida_id }}',
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
  ]));
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
    ['Construir cuerpo Messages', 'POST /v1/messages'],
    ['POST /v1/messages', 'Clasificar transporte'],
    ['Clasificar transporte', 'Ruta de transporte'],
    ['Ruta de transporte', 'Interpretar respuesta', 0],
    ['Ruta de transporte', 'Backoff', 1],
    ['Ruta de transporte', 'Marcar desconocido', 2],
    ['Ruta de transporte', 'Marcar error de request', 3],
    ['Backoff', 'POST /v1/messages'],
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
    'SELECT * FROM forense.reclamar_cluster($1::uuid, $2::uuid, $3::text, $4::text, $5::text)',
    '={{ $json.corrida_id }}, ={{ $json.cluster_id }}, ={{ $json.origen }}, ={{ $json.valor_untrusted }}, ={{ $json.idempotency_key }}',
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
    'SELECT * FROM forense.crear_caso($1::uuid, $2::uuid, $3::text, $4::text)',
    '={{ $json.cluster_id }}, ={{ $json.corrida_id }}, ={{ $execution.id }}, ={{ $json.idempotency_key }}',
    'Una sola vez, con n8n_execution_id e intento=0. Emite caso_creado, cluster_armado y pista_cargada en bitacora.',
  ));

  add(sql(
    'Contexto ronda 1',
    'SELECT * FROM forense.preparar_contexto_ronda1($1::uuid)',
    '={{ $json.caso_id }}',
    'Resumen ≤40 RFC y pistas POR FAMILIA. R1 no recibe señales ajenas (17 §7); persiste ronda1 y ronda_inicio.',
  ));

  add(sql(
    'Crear tareas R1',
    'SELECT * FROM forense.crear_tareas_ronda($1::uuid, 1, 0, $2::text[])',
    '={{ $json.caso_id }}, ={{ JSON.stringify($json.roles_evaluables) }}',
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
    "SELECT * FROM forense.estado_barrera($1::uuid, 'ronda1')",
    '={{ $json.caso_id }}',
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
    'SELECT * FROM forense.expandir_y_crear_tareas_r2($1::uuid, $2::text[], $3::jsonb)',
    '={{ $json.caso_id }}, ={{ JSON.stringify($json.despertados) }}, ={{ JSON.stringify($json.frontera) }}',
    'La expansión usa la ÚNICA cuota del cluster e incrementa version_contexto; no vuelve a ronda 1 (07 §2.6–2.8).',
  ));
  add(subworkflow('Despachar R2', 'FORENSE_ejecutar_agente', {
    tarea_id: '={{ $json.tarea_id }}',
    owner: '={{ $execution.id }}',
  }, { esperar: false, modo: 'each' }));
  add(sql(
    'Barrera R2',
    "SELECT * FROM forense.estado_barrera($1::uuid, 'ronda2')",
    '={{ $json.caso_id }}',
    'Dos tareas despertadas NO esperan cinco.',
  ));

  fila = 0; columna = 13;
  add(sql(
    'Auditoría',
    'SELECT * FROM forense.abrir_tarea_cierre($1::uuid, $2::text)',
    "={{ $json.caso_id }}, ={{ 'auditor' }}",
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
      "       (v.resultado->>'descartadas')::int AS descartadas",
      '  FROM (SELECT public.forense_validar_evidencia($1::uuid, $2::uuid) AS resultado) v',
    ].join('\n'),
    '={{ $json.caso_id }}, ={{ $json.tarea_id }}',
    'Pertenencia, valores y soporte resueltos desde DB: un ID existente no demuestra la hipótesis.',
  ));
  add(sql(
    'Defensa',
    'SELECT * FROM forense.abrir_tarea_cierre($1::uuid, $2::text)',
    "={{ $json.caso_id }}, ={{ 'defensor' }}",
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
    'SELECT * FROM forense.paquete_auditor_final($1::uuid)',
    '={{ $json.caso_id }}',
    'Entrada preparada por backend, nunca JSON de agente sin validar (07 §Code node).',
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
    'SELECT * FROM forense.abrir_tarea_cierre($1::uuid, $2::text)',
    "={{ $json.caso_id }}, ={{ 'redactor' }}",
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
    'Registrar en_cola': ['caso_id', 'tipo_evento', 'registrado'],
    'Cargar ejecución': ['execution_id', 'owner', 'fencing_token', 'revision', 'paso', 'estado_interno',
      'rol', 'tarea_id', 'caso_id', 'corrida_id', 'editor_operacion_id', 'checkpoint', 'deadline_at',
      'modelo', 'prompt_hash', 'context_hash', 'paquete', 'ronda', 'intento', 'agente', 'paso_pipeline'],
    'Decidir accion': [...IDENTIDAD_PASO, 'accion', 'evento', 'razon', 'motivo_request',
      'estado_interno', 'estado_tarea', 'reparaciones_json', 'pending_tool_use_ids', 'checkpoint'],
    'Reservar request': ['ok', 'error', 'duplicado', 'request_id', 'bolsa', 'restante', 'intento_transporte'],
    'Construir cuerpo Messages': [...IDENTIDAD_PASO, 'modelo', 'cuerpo', 'system', 'herramientas_enviadas',
      'version_prompts', 'prompt_hash', 'ambito_techo', 'caracteres_system', 'caracteres_paquete'],
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
      'motivo_denegada', 'argumentos_backend', 'base_rest', 'total_en_lote'],
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
    'Validar evidencia propuesta': ['caso_id', 'tarea_id', 'validadas', 'descartadas'],
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
});

// Nodos cuya FORMA de salida no puede comprobarse contra el texto de la
// consulta porque llaman a funciones de 004/005 (forense-db) con `SELECT *`:
// las columnas las fija la función, que todavía no existe. Para ellos,
// `CONTRATOS_NODOS` es la ESPECIFICACIÓN que la migración debe cumplir, y esta
// lista es el recordatorio explícito de que no está verificada. El test falla
// si la lista crece o encoge sin actualizarla.
export const FORMA_PENDIENTE = Object.freeze({
  FORENSE_ejecutar_agente: Object.freeze([]),
  FORENSE_investigar_cluster: Object.freeze([
    'Aplicar resolución', 'Auditoría', 'Barrera R2', 'Cerrar caso', 'Contexto ronda 1',
    'Crear caso', 'Crear tareas R1', 'Defensa', 'Esperar barrera R1',
    'Expandir y crear tareas R2', 'Guardar dictamen', 'Paquete auditor final',
    'Redacción', 'Resolver y reclamar cluster', 'Ronda fin R1', 'Validar citas',
  ]),
});

// ------------------------------------------------------------------ emisión

export const WORKFLOWS = [workerEjecutarAgente, investigarCluster];

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
