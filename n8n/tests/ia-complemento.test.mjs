// n8n/tests/ia-complemento.test.mjs — regresión del bucle de coste (corrida
// 2b446f04, seed 5005, 2026-09-12) y contrato del complemento IA de db/028.
//
// SIMULADO: sin red, sin n8n, sin DB. El «grafo» se reproduce encadenando las
// funciones puras que se copian a los Code nodes con la misma cola que el JSON
// (preámbulos de generar-code-nodes.mjs) y un merge superficial de checkpoint
// igual al de forense.save_checkpoint. La parte SQL (tope de 5, presupuestos,
// validar_salida_rol, telemetría) se prueba en db/tests/assertions_028.sql.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decidirPaso } from '../runtime/nodos/decidir-paso.mjs';
import { construirCuerpoNodo } from '../runtime/nodos/construir-cuerpo.mjs';
import { interpretarRespuestaNodo } from '../runtime/nodos/interpretar-respuesta.mjs';
import { armarToolResultsNodo } from '../runtime/nodos/armar-tool-results.mjs';
import { catalogoPrompts, HERRAMIENTA_SALIDA } from '../runtime/generar-workflows.mjs';
import { esquemaSalida } from '../runtime/provider/esquemas.mjs';
import { validateContract } from '../../contracts/index.mjs';
import { AHORA, DEADLINE, UUID } from './_ayudas.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ_REPO = path.resolve(RAIZ, '..');
const cargar = (n) => JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', `${n}.json`), 'utf8'));
const catalogo = catalogoPrompts();
const paquete = {
  ...JSON.parse(fs.readFileSync(path.join(RAIZ_REPO, 'contracts', 'fixtures', 'valid', 'contexto-r1.json'), 'utf8')),
  modo: 'complemento_ia',
  mision: 'Busca lo que el determinista no encontró.',
};

// ------------------------------------------------------------ simulador de grafo

/** Un turno del worker. Devuelve el checkpoint persistido y lo que se envió. */
function vuelta(estado, responder, { validar = () => ({ ok: false, errores: ['simulado inválido'] }) } = {}) {
  const ejecucion = { rol: 'relacional', modelo: 'claude-sonnet-5', paquete, checkpoint: estado.cp,
    execution_id: UUID.ejecucion, revision: estado.revision };
  const paso = decidirPaso({ ...ejecucion, ahora_ms: AHORA });
  if (paso.accion === 'cerrar') return { terminal: true, paso };
  if (paso.accion === 'ejecutar_herramienta') {
    const cola = estado.cp.cola_tools;
    const r = armarToolResultsNodo({ ...paso, cola, resultados: cola.map((t) => ({ tool_use_id: t.tool_use_id, resultado: { ok: true } })),
      mensajes_previos: estado.cp.mensajes });
    estado.cp = { ...estado.cp, ...r.checkpoint };
    estado.revision += 1;
    return { terminal: false, herramientas: true };
  }
  // Preámbulo de «Construir cuerpo Messages» (generar-code-nodes.mjs).
  const cuerpo = construirCuerpoNodo({
    ...ejecucion, ...paso,
    mensajes: (estado.cp || {}).mensajes,
    errores_contrato: (estado.cp || {}).errores_contrato ?? [],
    sin_herramientas: paso.motivo_request === 'reparacion',
    forzar_salida: paso.forzar_salida === true,
    max_tokens: 8000, techo_caracteres: catalogo.techos.relacional, catalogo_prompts: catalogo,
  });
  estado.enviados.push(cuerpo);
  const body = responder(cuerpo, estado.enviados.length);
  const interp = interpretarRespuestaNodo({ ...paso, rol: 'relacional', respuesta: { body },
    mensajes_previos: cuerpo.cuerpo.messages });
  let cp = interp.checkpoint;
  if (interp.estado_interno === 'validar_salida') {
    const v = validar(interp.salida);
    cp = { ...cp, salida_valida: v.ok, errores_contrato: v.errores };
  }
  // forense.save_checkpoint: checkpoint_json || patch (merge superficial).
  estado.cp = { ...estado.cp, ...cp };
  estado.revision += 1;
  return { terminal: false, interp };
}

function correr(responder, opciones) {
  const estado = { cp: { estado_interno: 'preparar_contexto', deadline_at: DEADLINE }, revision: 1, enviados: [] };
  for (let i = 0; i < 100; i += 1) {
    const r = vuelta(estado, responder, opciones);
    if (r.terminal) return { ...estado, cierre: r.paso };
  }
  throw new Error('el worker simulado no terminó en 100 vueltas: BUCLE');
}

const texto = (t) => ({ id: 'msg', model: 'claude-sonnet-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
  content: [{ type: 'text', text: t }] });
const entrega = (input) => ({ id: 'msg', model: 'claude-sonnet-5', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 },
  content: [{ type: 'tool_use', id: `toolu_s${Math.random()}`, name: HERRAMIENTA_SALIDA, input }] });
let n = 0;
const pideTool = () => ({ id: 'msg', model: 'claude-sonnet-5', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 },
  content: [{ type: 'tool_use', id: `toolu_${(n += 1)}`, name: 'forense_relacionados', input: { p_rfc: 'X' } }] });

// ------------------------------------------------------------- bucle de coste

test('[SIMULADO] regresión: una salida que nunca valida cuesta 2 requests y cierra en error (antes: sin tope)', () => {
  const r = correr(() => texto('{"titular":"x","familia":"R"}'));
  assert.equal(r.enviados.length, 2, 'un turno + UNA reparación');
  assert.equal(r.cierre.estado_interno, 'error');
  assert.equal(r.cp.reparaciones_json, 1, 'el contador de reparaciones queda persistido en el checkpoint');
  assert.equal(r.enviados[1].salida_forzada, true, 'la reparación fuerza la herramienta de salida');
});

test('[SIMULADO] regresión: «no es JSON» es reparable con límite', () => {
  const r = correr((c, i) => (i === 1 ? texto('no tengo JSON') : entrega({ senal_ids: [], resumen: 'ok', limitaciones: [] })),
    { validar: (s) => ({ ok: !!s && typeof s.resumen === 'string', errores: [] }) });
  assert.equal(r.enviados.length, 2);
  assert.equal(r.cierre.estado_interno, 'terminado');
});

test('[SIMULADO] tope de turnos: un modelo que solo pide herramientas no pasa de 8 requests y el último fuerza la entrega', () => {
  const r = correr(() => pideTool());
  assert.equal(r.enviados.length, 8);
  assert.equal(r.enviados[7].salida_forzada, true);
  assert.deepEqual(r.enviados[7].cuerpo.tool_choice, { type: 'tool', name: HERRAMIENTA_SALIDA });
  assert.equal(r.cierre.estado_interno, 'error');
  assert.equal(r.cp.turnos, 8);
});

test('[SIMULADO] entrega válida por herramienta termina en 1 request', () => {
  const r = correr(() => entrega({ senal_ids: [], resumen: 'nada nuevo fuera de los hallazgos', limitaciones: [] }),
    { validar: () => ({ ok: true, errores: [] }) });
  assert.equal(r.enviados.length, 1);
  assert.equal(r.cierre.estado_interno, 'terminado');
});

// ---------------------------------------------------------- salida estructurada

test('[SIMULADO] cuerpo: turno normal lleva las tools del rol + la de salida con tool_choice auto', () => {
  const c = construirCuerpoNodo({ rol: 'financiero', paquete, modelo: 'm', catalogo_prompts: catalogo });
  const nombres = c.cuerpo.tools.map((t) => t.name);
  assert.equal(nombres.at(-1), HERRAMIENTA_SALIDA);
  assert.ok(nombres.includes('forense_escribir_senal'));
  assert.deepEqual(c.cuerpo.tool_choice, { type: 'auto' });
});

test('[SIMULADO] cuerpo: el system del complemento declara familia propia, catálogo y misión', () => {
  const c = construirCuerpoNodo({ rol: 'temporal', paquete, modelo: 'm', catalogo_prompts: catalogo });
  assert.match(c.system, /familia_propia=T/);
  assert.match(c.system, /D=documental, F=financiero, R=relacional, T=temporal, E=externo/);
  assert.match(c.system, /p_familia="T"/);
  assert.match(c.system, /Misión: Busca lo que el determinista no encontró/);
  const normal = construirCuerpoNodo({ rol: 'temporal', paquete: { ...paquete, modo: undefined }, modelo: 'm', catalogo_prompts: catalogo });
  assert.equal(/Directivas del complemento IA/.test(normal.system), false, 'la ruta normal conserva el system del ensamblador');
});

test('[SIMULADO] cuerpo: reparación tras entrega inválida quita el tool_use huérfano y pide corregir', () => {
  const mensajes = [
    { role: 'user', content: [{ type: 'text', text: 'paquete' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_x', name: HERRAMIENTA_SALIDA, input: { titular: 'x' } }] },
  ];
  const c = construirCuerpoNodo({ rol: 'externo', paquete, modelo: 'm', catalogo_prompts: catalogo, mensajes,
    motivo_request: 'reparacion', sin_herramientas: true, forzar_salida: true, errores_contrato: ['campo no permitido: titular'] });
  const ultimo = c.cuerpo.messages.at(-1);
  assert.equal(ultimo.role, 'user');
  assert.match(JSON.stringify(ultimo), /no cumple el contrato/);
  assert.match(JSON.stringify(ultimo), /titular/);
  assert.equal(JSON.stringify(c.cuerpo.messages).includes('toolu_x'), false);
  assert.deepEqual(c.cuerpo.tools.map((t) => t.name), [HERRAMIENTA_SALIDA]);
});

test('[SIMULADO] interpretar: la entrega por herramienta es la salida, no una herramienta a ejecutar', () => {
  const salida = { senal_ids: ['12'], resumen: 'r', limitaciones: [] };
  const i = interpretarRespuestaNodo({ rol: 'documental', respuesta: { body: entrega(salida) }, turnos: 2, reparaciones_json: 0, motivo_request: 'turno' });
  assert.equal(i.tipo, 'salida_estructura_ok');
  assert.equal(i.via, 'herramienta_salida');
  assert.equal(i.estado_interno, 'validar_salida');
  assert.deepEqual(i.checkpoint.pending_tool_use_ids, []);
  assert.equal(i.checkpoint.turnos, 3);
  assert.deepEqual(i.salida, salida);
});

test('catálogo: los 5 especialistas llevan la herramienta de salida con el schema de contracts; los de cierre no', () => {
  for (const rol of ['documental', 'financiero', 'relacional', 'temporal', 'externo']) {
    const t = catalogo.roles[rol].tool_salida;
    assert.equal(t.name, HERRAMIENTA_SALIDA);
    assert.deepEqual(t.input_schema, esquemaSalida('agents.especialista'));
  }
  for (const rol of ['auditor', 'defensor', 'replica', 'redactor', 'editor']) assert.equal(catalogo.roles[rol].tool_salida, null);
  assert.equal(validateContract('agents.especialista', { senal_ids: ['1'], resumen: 'x', limitaciones: [] }).valid ?? true, true);
});

// ------------------------------------------------------------------ grafos

function salientes(wf) {
  const m = new Map();
  for (const [o, s] of Object.entries(wf.connections)) m.set(o, s.main.flat().map((d) => d.node));
  return m;
}
function alcanza(wf, desde, hasta) {
  const sal = salientes(wf); const pila = [desde]; const vistos = new Set([desde]);
  while (pila.length) { const a = pila.pop(); for (const s of sal.get(a) ?? []) { if (s === hasta) return true; if (!vistos.has(s)) { vistos.add(s); pila.push(s); } } }
  return false;
}
const rama = (wf, nodo, i) => (wf.connections[nodo].main[i] ?? []).map((d) => d.node);

test('worker: una reserva negada NUNCA llega al POST del proveedor', () => {
  const wf = cargar('FORENSE_ejecutar_agente');
  assert.deepEqual(rama(wf, 'Reservar request', 0), ['¿Reserva concedida?']);
  assert.deepEqual(rama(wf, '¿Reserva concedida?', 1), ['Cerrar sin presupuesto']);
  assert.equal(alcanza(wf, 'Cerrar sin presupuesto', 'POST /v1/messages'), false);
});

test('worker: un checkpoint rechazado corta la cadena (no redespacha)', () => {
  const wf = cargar('FORENSE_ejecutar_agente');
  assert.deepEqual(rama(wf, 'Guardar checkpoint', 0), ['¿Checkpoint guardado?']);
  assert.deepEqual(rama(wf, '¿Checkpoint guardado?', 1), ['Registrar checkpoint rechazado']);
  assert.equal(alcanza(wf, 'Registrar checkpoint rechazado', 'Redespachar paso'), false);
  assert.equal(alcanza(wf, 'Registrar checkpoint rechazado', 'POST /v1/messages'), false);
});

test('worker: la telemetría del turno y del fin quedan en la cadena', () => {
  const wf = cargar('FORENSE_ejecutar_agente');
  assert.deepEqual(rama(wf, 'Completar request', 0), ['Registrar turno IA']);
  assert.deepEqual(rama(wf, 'Finalizar paso', 0), ['Registrar fin agente']);
});

test('generador: ningún parámetro jsonb puede recibir el texto \'null\' (checkpoint como ARRAY)', () => {
  for (const f of fs.readdirSync(path.join(RAIZ, 'workflows')).filter((x) => x.endsWith('.json'))) {
    const wf = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', f), 'utf8'));
    for (const nodo of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.postgres')) {
      const sinEnvolver = nodo.parameters.query.replace(/nullif\(nullif\(\$\d+::text, 'null'\), ''\)::\w+/g, '');
      assert.equal(/\$\d+::jsonb/.test(sinEnvolver), false, `${f}/${nodo.name}: $N::jsonb sin nulosSeguros`);
    }
  }
});

test('reconciliador: owner único por redespacho, tope en DB y disparo del complemento IA', () => {
  const wf = cargar('FORENSE_reconciliador');
  const pasos = wf.nodes.find((x) => x.name === 'Pasos recuperables');
  assert.match(pasos.parameters.query, /forense\.recuperar_pasos\('reconciliador:' \|\|/);
  assert.equal(/'reconciliador'::text AS owner/.test(pasos.parameters.query), false);
  const lanzar = wf.nodes.find((x) => x.name === 'Lanzar complemento IA');
  assert.equal(lanzar.parameters.workflowId.cachedResultName, 'FORENSE_ia_complemento');
});

test('complemento IA: 5 especialistas despachados UNA vez, solo si el complemento es nuevo, sin roles de cierre', () => {
  const wf = cargar('FORENSE_ia_complemento');
  const despachos = wf.nodes.filter((x) => x.type === 'n8n-nodes-base.executeWorkflow');
  assert.equal(despachos.length, 1);
  assert.equal(despachos[0].parameters.workflowId.cachedResultName, 'FORENSE_ejecutar_agente');
  assert.equal(alcanza(wf, '¿Complemento nuevo?', 'Despachar 5 especialistas'), true);
  assert.deepEqual(rama(wf, '¿Complemento nuevo?', 1), [], 'una reapertura no redespacha');
  const texto = JSON.stringify(wf);
  assert.equal(/abrir_tarea_cierre|crear_tareas_ronda/.test(texto), false, 'sin auditor/defensor/réplica/redactor LLM');
  const si = wf.nodes.find((x) => x.name === '¿Complemento nuevo?');
  assert.match(JSON.stringify(si.parameters), /creado === true/);
  // El owner de cada especialista es único: no comparte lease con otra cadena.
  assert.match(JSON.stringify(despachos[0].parameters), /'ia:' \+ \$execution\.id \+ ':' \+ \$json\.tarea_id/);
});
