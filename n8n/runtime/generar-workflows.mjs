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
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_N8N = path.resolve(AQUI, '..');

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

// ---------------------------------------------------------------- constructores

let columna = 0;
let fila = 0;
const posicion = () => [columna * 220, fila * 140];

function nodo(name, type, parameters, extras = {}) {
  const typeVersion = TIPOS_PERMITIDOS[type];
  if (typeVersion === undefined) throw new Error(`tipo no permitido: ${type}`);
  return { parameters, type, typeVersion, position: posicion(), name, ...extras };
}

const code = (name, archivo) => nodo(name, 'n8n-nodes-base.code', { jsCode: cuerpoCodeNode(archivo) });

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

export function workerEjecutarAgente() {
  columna = 0; fila = 0;
  const nodes = [];
  const add = (n) => { nodes.push(n); columna += 1; return n.name; };

  add(nodo('Paso entrante', 'n8n-nodes-base.executeWorkflowTrigger', { inputSource: 'passthrough' }));

  add(sql(
    'Reclamar paso',
    'SELECT * FROM forense.claim_step($1::uuid, $2::text)',
    '={{ $json.execution_id }}, ={{ $json.owner }}',
    '17 §4: claim_step devuelve {ok, fencing_token, revision, lease_expires_at}',
  ));

  add(si('¿Claim vigente?', '={{ $json.ok }}'));

  fila = 1; columna = 3;
  add(codeInline('Paso no reclamable', [
    '// El slot es de otro owner con lease vigente. Una tarea sin slot queda',
    '// PENDIENTE, nunca fallida (17 §3). El reconciliador la retomará.',
    'const x = $input.first().json;',
    "return [{ json: { estado: 'en_cola', motivo: x.error ?? 'slot ocupado' } }];",
  ].join('\n')));
  // Regla 2 de CLAUDE.md: si no escribió en bitacora, el paso no existió. La UI
  // necesita este evento para mostrar «en cola» sin inventar animación.
  add(sql(
    'Registrar en_cola',
    "SELECT forense.registrar_evento($1::uuid, 'paso_en_cola', $2::jsonb)",
    '={{ $json.caso_id }}, ={{ JSON.stringify({ execution_id: $json.execution_id, motivo: $json.motivo }) }}',
    'Sin evento persistido no hay progreso visible (regla 2; 21 §3.3).',
  ));

  fila = 0; columna = 3;
  add(sql(
    'Cargar ejecución',
    [
      'SELECT e.*, a.contenido AS contexto, t.caso_id, t.agente, t.ronda, t.intento',
      '  FROM forense.ejecuciones_agente e',
      '  JOIN forense.artefactos_contexto a ON a.hash = e.context_hash',
      '  LEFT JOIN forense.tareas_agente t ON t.id = e.tarea_id',
      ' WHERE e.id = $1::uuid',
    ].join('\n'),
    '={{ $json.execution_id }}',
    'DEPENDE de forense-db (17 §4). Confirmar el nombre de la columna de enlace contexto↔ejecución.',
  ));

  add(code('Decidir accion', 'decidir-paso'));
  add(ruta('Ruta del paso', '={{ $json.accion }}', ['solicitar_modelo', 'ejecutar_herramienta', 'cerrar']));

  // --- rama modelo
  fila = 0; columna = 6;
  add(sql(
    'Reservar request',
    'SELECT * FROM forense.reserve_request($1::uuid, $2::bigint, $3::uuid)',
    '={{ $json.execution_id }}, ={{ $json.fencing_token }}, ={{ $json.request_id }}',
    '17 §5.3: la reserva ocurre ANTES del HTTP; un request enviado sin reserva no existe para el presupuesto.',
  ));
  add(code('Construir cuerpo Messages', 'construir-cuerpo'));
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
      jsonBody: '={{ JSON.stringify($json.cuerpo) }}',
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
      "   SET estado = 'desconocido', error = $2::jsonb",
      ' WHERE request_id = $1::uuid',
    ].join('\n'),
    '={{ $json.request_id }}, ={{ JSON.stringify({ codigo: "timeout_ambiguo", motivo: $json.motivo }) }}',
    '17 §6: timeout ambiguo. Puede haber coste externo sin respuesta; no se afirma exactly-once.',
  ));

  fila = 4; columna = 10;
  add(sql(
    'Marcar error de request',
    [
      'UPDATE forense.llm_solicitudes',
      "   SET estado = 'error', error = $2::jsonb",
      ' WHERE request_id = $1::uuid',
    ].join('\n'),
    '={{ $json.request_id }}, ={{ JSON.stringify({ codigo: $json.clase, motivo: $json.motivo }) }}',
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
    'SELECT * FROM forense.validar_salida_rol($1::uuid, $2::text, $3::jsonb)',
    '={{ $json.execution_id }}, ={{ $json.rol }}, ={{ JSON.stringify($json.salida) }}',
    'DEPENDE de forense-db: validación de contrato + IDs + unidades. Un ID existente no prueba una frase (17 §8).',
  ));
  add(sql(
    'Completar request',
    [
      'UPDATE forense.llm_solicitudes',
      "   SET estado = 'completado', provider_request_id = $2::text,",
      '       usage = $3::jsonb, modelo = $4::text',
      ' WHERE request_id = $1::uuid',
    ].join('\n'),
    '={{ $json.request_id }}, ={{ $json.provider_request_id }}, ={{ JSON.stringify($json.usage) }}, ={{ $json.modelo }}',
  ));

  // --- rama herramientas
  fila = 1; columna = 6;
  add(sql(
    'Reclamar tool',
    'SELECT * FROM forense.claim_tool($1::uuid, $2::bigint, $3::uuid, $4::text, $5::text)',
    '={{ $json.execution_id }}, ={{ $json.fencing_token }}, ={{ $json.request_id }}, ={{ $json.tool_use_id }}, ={{ $json.args_hash }}',
    '17 §4: unicidad (request_id, tool_use_id). La reentrega devuelve el registro previo, sin mutación nueva.',
  ));
  add(si('¿Tool nueva?', '={{ $json.nuevo }}'));

  fila = 2; columna = 8;
  add(codeInline('Reentrega registrada', [
    '// Mismo tool_use_id ya ejecutado: se devuelve el resultado guardado.',
    '// No consume cuota ni repite la mutación SQL (17 §6).',
    'const x = $input.first().json;',
    'return [{ json: { tool_use_id: x.tool_use_id, resultado: x.resultado, error: x.error ?? null, reentrega: true } }];',
  ].join('\n')));

  fila = 1; columna = 8;
  add(nodo(
    'Llamar RPC forense',
    'n8n-nodes-base.httpRequest',
    {
      method: 'POST',
      url: '={{ $json.base_rest }}/rpc/{{ $json.nombre }}',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      specifyBody: 'json',
      // p_operacion / p_tarea / p_caso los fija el backend: nunca $fromAI (17 §1).
      jsonBody: '={{ JSON.stringify($json.argumentos_backend) }}',
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
      'UPDATE forense.tool_ejecuciones',
      '   SET estado = $1::text, resultado = $2::jsonb, duracion_ms = $3::int',
      ' WHERE request_id = $4::uuid AND tool_use_id = $5::text',
    ].join('\n'),
    '={{ $json.estado }}, ={{ JSON.stringify($json.envelope) }}, ={{ $json.duracion_ms }}, ={{ $json.request_id }}, ={{ $json.tool_use_id }}',
    'La RPC de 06 ya escribió evidencia y bitácora una sola vez; aquí solo se cierra el ledger.',
  ));
  add(code('Armar tool_results', 'armar-tool-results'));

  // --- cierre
  fila = 0; columna = 14;
  add(sql(
    'Guardar checkpoint',
    'SELECT * FROM forense.save_checkpoint($1::uuid, $2::bigint, $3::int, $4::jsonb)',
    '={{ $json.execution_id }}, ={{ $json.fencing_token }}, ={{ $json.revision }}, ={{ JSON.stringify($json.checkpoint) }}',
    '17 §3: CAS sobre (caso_id, paso, revision) + fencing. Un lease vencido no puede escribir.',
  ));
  add(si('¿Estado terminal?', '={{ ["terminado","error","timeout"].includes($json.estado_interno) }}'));

  fila = 1; columna = 16;
  add(subworkflow('Redespachar paso', 'FORENSE_ejecutar_agente', {
    tarea_id: '={{ $json.tarea_id }}',
    execution_id: '={{ $json.execution_id }}',
    owner: '={{ $json.owner }}',
  }, { esperar: false }));

  fila = 0; columna = 16;
  add(sql(
    'Finalizar paso',
    'SELECT * FROM forense.finish_step($1::uuid, $2::bigint, $3::text, $4::jsonb)',
    '={{ $json.execution_id }}, ={{ $json.fencing_token }}, ={{ $json.estado_tarea }}, ={{ JSON.stringify($json.resultado) }}',
    'completada | error | timeout | omitida. Libera slot y lease y escribe bitácora.',
  ));
  add(sql(
    'Avanzar caso si listo',
    'SELECT * FROM forense.advance_case_if_ready($1::uuid, $2::int)',
    '={{ $json.caso_id }}, ={{ $json.revision_esperada }}',
    'La barrera la cierra esta función sobre el conjunto exacto de tarea_id, no un Merge de cinco ramas.',
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
    'Inactivo. Credenciales por nombre, sin IDs ni secretos.',
    'Los workflowId PENDIENTE_* se resuelven después de importar (17 §2).',
  ].join('\n'), 260, 420));

  const connections = conectar([
    ['Paso entrante', 'Reclamar paso'],
    ['Reclamar paso', '¿Claim vigente?'],
    ['¿Claim vigente?', 'Cargar ejecución', 0],
    ['¿Claim vigente?', 'Paso no reclamable', 1],
    ['Paso no reclamable', 'Registrar en_cola'],
    ['Cargar ejecución', 'Decidir accion'],
    ['Decidir accion', 'Ruta del paso'],
    ['Ruta del paso', 'Reservar request', 0],
    ['Ruta del paso', 'Reclamar tool', 1],
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
    ['Reclamar tool', '¿Tool nueva?'],
    ['¿Tool nueva?', 'Llamar RPC forense', 0],
    ['¿Tool nueva?', 'Reentrega registrada', 1],
    ['Llamar RPC forense', 'Registrar resultado tool'],
    ['Registrar resultado tool', 'Armar tool_results'],
    ['Reentrega registrada', 'Armar tool_results'],
    ['Armar tool_results', 'Guardar checkpoint'],
    ['Guardar checkpoint', '¿Estado terminal?'],
    ['¿Estado terminal?', 'Finalizar paso', 0],
    ['¿Estado terminal?', 'Redespachar paso', 1],
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
      "VALUES ($1::uuid, 'ronda1', 1, $2::uuid[], $3::jsonb, 'esperando', $4::timestamptz)",
      'RETURNING *',
    ].join('\n'),
    '={{ $json.caso_id }}, ={{ JSON.stringify($json.tarea_ids) }}, ={{ JSON.stringify($json.snapshot_senales) }}, ={{ $json.deadline }}',
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
    "SELECT forense.registrar_evento($1::uuid, 'ronda_fin', $2::jsonb)",
    '={{ $json.caso_id }}, ={{ JSON.stringify({ ronda: 1, resultados: $json.resultados, limitaciones: $json.limitaciones }) }}',
    'Cero señales también exige resultado explícito y tarea completada (07 §2.5).',
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
    'SELECT public.forense_validar_evidencia($1::uuid, $2::uuid)',
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
      'RETURNING n_reintentos',
    ].join('\n'),
    '={{ $json.caso_id }}',
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
