// n8n/tests/nodos.test.mjs — cuerpos de los Code nodes generados.
//
// Todo aquí es SIMULADO: no hay red, credenciales ni instancia n8n. Estos
// tests prueban la LÓGICA que se copia al Code node; que n8n importe el JSON y
// lo ejecute es el smoke del coordinador, no esto.
//
// Los nodos inlinean lógica que también vive en n8n/runtime (un Code node no
// puede importar módulos del repo): varios tests comparan ambas
// implementaciones sobre los mismos casos para que no se separen en silencio.

import test from 'node:test';
import assert from 'node:assert/strict';

import { decidirPaso } from '../runtime/nodos/decidir-paso.mjs';
import { construirCuerpoNodo } from '../runtime/nodos/construir-cuerpo.mjs';
import { clasificarTransporteNodo } from '../runtime/nodos/clasificar-transporte.mjs';
import { interpretarRespuestaNodo } from '../runtime/nodos/interpretar-respuesta.mjs';
import { armarToolResultsNodo } from '../runtime/nodos/armar-tool-results.mjs';
import { expandirColaToolsNodo } from '../runtime/nodos/expandir-cola-tools.mjs';
import { evaluarFronteraNodo } from '../runtime/nodos/evaluar-frontera.mjs';
import { normalizarInvestigacionNodo } from '../runtime/nodos/normalizar-investigacion.mjs';
import { toolsPorRol } from '../prompts/ensamblar.mjs';

import { clasificar } from '../runtime/transporte.mjs';
import { ESTADOS_TERMINALES, siguiente } from '../runtime/checkpoint.mjs';
import { parsearRespuesta } from '../runtime/provider/messages.mjs';
import { calcularDespertados, conjuntoRonda2, evaluarFrontera } from '../runtime/despertar.mjs';
import { AHORA, DEADLINE, UUID, mensajeTexto, mensajeToolUse, respuestaOK, salidaEspecialistaValida } from './_ayudas.mjs';

const cp = (extra = {}) => ({ deadline_at: DEADLINE, estado_interno: 'solicitar_modelo', ...extra });

// ---------------------------------------------------------------- decidir-paso

test('[SIMULADO] decidir: el deadline corta antes de abrir otro request', () => {
  const r = decidirPaso({ checkpoint: cp(), ahora_ms: Date.parse(DEADLINE) + 1 });
  assert.equal(r.accion, 'cerrar');
  assert.equal(r.evento, 'deadline');
});

test('[SIMULADO] decidir: preparar_contexto y solicitar_modelo piden turno normal', () => {
  for (const estado of ['preparar_contexto', 'solicitar_modelo']) {
    const r = decidirPaso({ checkpoint: cp({ estado_interno: estado }), ahora_ms: AHORA });
    assert.equal(r.accion, 'solicitar_modelo');
    assert.equal(r.motivo_request, 'turno');
  }
});

test('[SIMULADO] decidir: una sola reparación, después error visible', () => {
  const conSaldo = decidirPaso({ checkpoint: cp({ estado_interno: 'reparar_json', reparaciones_json: 0 }), ahora_ms: AHORA });
  assert.equal(conSaldo.accion, 'solicitar_modelo');
  assert.equal(conSaldo.motivo_request, 'reparacion');
  const agotada = decidirPaso({ checkpoint: cp({ estado_interno: 'reparar_json', reparaciones_json: 1 }), ahora_ms: AHORA });
  assert.equal(agotada.accion, 'cerrar');
  assert.equal(agotada.evento, 'sin_reparacion');
});

test('[SIMULADO] decidir: ejecutar_herramienta exige cola pendiente', () => {
  const conCola = decidirPaso({ checkpoint: cp({ estado_interno: 'ejecutar_herramienta', pending_tool_use_ids: ['toolu_1'] }), ahora_ms: AHORA });
  assert.equal(conCola.accion, 'ejecutar_herramienta');
  const sinCola = decidirPaso({ checkpoint: cp({ estado_interno: 'ejecutar_herramienta', pending_tool_use_ids: [] }), ahora_ms: AHORA });
  assert.equal(sinCola.accion, 'cerrar');
  assert.equal(sinCola.evento, 'error_fatal');
});

test('[SIMULADO] decidir: un estado terminal no reabre el paso', () => {
  for (const estado of ['terminado', 'error', 'timeout']) {
    const r = decidirPaso({ checkpoint: cp({ estado_interno: estado }), ahora_ms: AHORA });
    assert.equal(r.accion, 'cerrar');
  }
});

// Regresión (hallazgo alto del verificador H3): la rama `cerrar` devolvía el
// estado interno de ORIGEN. El grafo del worker evalúa «¿Estado terminal?»
// DESPUÉS de guardar el checkpoint, leyendo ese mismo campo: con el estado de
// origen, un paso que cierra por `valida` o por `deadline` se guardaba como
// `validar_salida` / `solicitar_modelo`, el IF decía «no terminal» y el worker
// se redespachaba a sí mismo en bucle en vez de finalizar la tarea.
test('[SIMULADO] decidir: al cerrar devuelve el estado interno DESTINO, no el de origen', () => {
  const valida = decidirPaso({ checkpoint: cp({ estado_interno: 'validar_salida', salida_valida: true }), ahora_ms: AHORA });
  assert.equal(valida.accion, 'cerrar');
  assert.equal(valida.evento, 'valida');
  assert.equal(valida.estado_interno, 'terminado', 'salida válida cierra en terminado, no en validar_salida');

  const vencido = decidirPaso({ checkpoint: cp({ estado_interno: 'solicitar_modelo' }), ahora_ms: Date.parse(DEADLINE) + 1 });
  assert.equal(vencido.evento, 'deadline');
  assert.equal(vencido.estado_interno, 'timeout');

  const sinReparacion = decidirPaso({ checkpoint: cp({ estado_interno: 'validar_salida', salida_valida: false, reparaciones_json: 1 }), ahora_ms: AHORA });
  assert.equal(sinReparacion.evento, 'sin_reparacion');
  assert.equal(sinReparacion.estado_interno, 'error');

  const sinCola = decidirPaso({ checkpoint: cp({ estado_interno: 'ejecutar_herramienta', pending_tool_use_ids: [] }), ahora_ms: AHORA });
  assert.equal(sinCola.evento, 'error_fatal');
  assert.equal(sinCola.estado_interno, 'error');

  const desconocido = decidirPaso({ checkpoint: cp({ estado_interno: 'estado_que_no_existe' }), ahora_ms: AHORA });
  assert.equal(desconocido.evento, 'error_fatal');
  assert.equal(desconocido.estado_interno, 'error');
});

test('[SIMULADO] decidir: todo cierre cae en un estado terminal y arrastra estado_tarea', () => {
  const casos = [
    [cp({ estado_interno: 'validar_salida', salida_valida: true }), AHORA, 'completada'],
    [cp({ estado_interno: 'solicitar_modelo' }), Date.parse(DEADLINE) + 1, 'timeout'],
    [cp({ estado_interno: 'reparar_json', reparaciones_json: 1 }), AHORA, 'error'],
    [cp({ estado_interno: 'terminado' }), AHORA, 'completada'],
    [cp({ estado_interno: 'timeout' }), AHORA, 'timeout'],
    [cp({ estado_interno: 'error' }), AHORA, 'error'],
  ];
  for (const [checkpoint, ahora_ms, estadoTarea] of casos) {
    const r = decidirPaso({ checkpoint, ahora_ms });
    assert.equal(r.accion, 'cerrar');
    assert.ok(ESTADOS_TERMINALES.includes(r.estado_interno), `${checkpoint.estado_interno} cerró en ${r.estado_interno}`);
    assert.equal(r.estado_tarea, estadoTarea);
  }
});

// El Code node inlinea el destino porque no puede importar checkpoint.mjs. Este
// test compara ambas implementaciones para que no se separen en silencio (mismo
// patrón que clasificar-transporte contra transporte.mjs).
test('[SIMULADO] decidir: el destino inlineado coincide con TRANSICIONES de checkpoint.mjs', () => {
  const pares = [
    ['validar_salida', 'valida', cp({ estado_interno: 'validar_salida', salida_valida: true }), AHORA],
    ['validar_salida', 'sin_reparacion', cp({ estado_interno: 'validar_salida', salida_valida: false, reparaciones_json: 1 }), AHORA],
    ['reparar_json', 'sin_presupuesto', cp({ estado_interno: 'reparar_json', reparaciones_json: 1 }), AHORA],
    ['solicitar_modelo', 'deadline', cp({ estado_interno: 'solicitar_modelo' }), Date.parse(DEADLINE) + 1],
    ['ejecutar_herramienta', 'deadline', cp({ estado_interno: 'ejecutar_herramienta', pending_tool_use_ids: ['toolu_1'] }), Date.parse(DEADLINE) + 1],
    ['ejecutar_herramienta', 'error_fatal', cp({ estado_interno: 'ejecutar_herramienta', pending_tool_use_ids: [] }), AHORA],
  ];
  for (const [origen, eventoEsperado, checkpoint, ahora_ms] of pares) {
    const r = decidirPaso({ checkpoint, ahora_ms });
    // `sin_reparacion` es el vocabulario del nodo; en checkpoint.mjs el mismo
    // corte se llama `sin_reparacion` desde validar_salida y `sin_presupuesto`
    // desde reparar_json: ambos llevan a `error`.
    assert.equal(r.estado_interno, siguiente(origen, eventoEsperado),
      `${origen} --${eventoEsperado}--> esperado ${siguiente(origen, eventoEsperado)}, el nodo dio ${r.estado_interno}`);
  }
});

// ------------------------------------------------------------ construir-cuerpo

const mensajesBase = [{ role: 'user', content: [{ type: 'text', text: 'paquete de contexto' }] }];
const systemBase = [{ type: 'text', text: 'comun' }, { type: 'text', text: 'rol' }];

test('[SIMULADO] cuerpo: sin modelo no se construye nada (el modelo no sale del prompt)', () => {
  assert.throws(() => construirCuerpoNodo({ system_bloques: systemBase, mensajes: mensajesBase }), /modelo ausente/);
});

test('[SIMULADO] cuerpo: temperatura 0 por defecto y tools solo si corresponde', () => {
  const conTools = construirCuerpoNodo({
    modelo: 'modelo-simulado', system_bloques: systemBase, mensajes: mensajesBase,
    herramientas: [{ name: 'forense_perfil', input_schema: { type: 'object' } }],
  });
  assert.equal(conTools.cuerpo.temperature, 0);
  assert.equal(conTools.cuerpo.tools.length, 1);
  assert.deepEqual(conTools.cuerpo.tool_choice, { type: 'auto' });

  const reparacion = construirCuerpoNodo({
    modelo: 'modelo-simulado', system_bloques: systemBase, mensajes: mensajesBase,
    herramientas: [{ name: 'forense_perfil' }], sin_herramientas: true,
  });
  assert.equal('tools' in reparacion.cuerpo, false, 'una reparación no lleva herramientas');
});

test('[SIMULADO] cuerpo: un tool_use sin su tool_result rompe el protocolo antes de enviar', () => {
  const mensajes = [
    ...mensajesBase,
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'forense_perfil', input: {} }] },
  ];
  assert.throws(() => construirCuerpoNodo({ modelo: 'm', system_bloques: systemBase, mensajes }), /faltan tool_result para: toolu_1/);
  const completos = [...mensajes, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' }] }];
  assert.ok(construirCuerpoNodo({ modelo: 'm', system_bloques: systemBase, mensajes: completos }).cuerpo);
});

// -------------------------------------------------------- clasificar-transporte

test('[SIMULADO] transporte: el nodo clasifica igual que n8n/runtime/transporte.mjs', () => {
  const casos = [
    { status: 200 }, { status: 201 }, { status: 400 }, { status: 401 },
    { status: 408 }, { status: 429 }, { status: 500 }, { status: 503 },
    { tipo: 'timeout' }, { tipo: 'conexion_interrumpida' }, {},
  ];
  for (const caso of casos) {
    const esperado = clasificar(caso);
    const obtenido = clasificarTransporteNodo({ ...caso, ahora_ms: AHORA, deadline_at: DEADLINE, aleatorio: 0.5 }).clase;
    assert.equal(obtenido, esperado, `divergencia en ${JSON.stringify(caso)}`);
  }
});

test('[SIMULADO] transporte: Retry-After manda sobre el backoff', () => {
  const r = clasificarTransporteNodo({
    status: 429, headers: { 'retry-after': '3' }, intento: 1,
    ahora_ms: AHORA, deadline_at: DEADLINE, aleatorio: 0.5,
  });
  assert.equal(r.reintentar, true);
  assert.equal(r.espera_ms, 3000);
  assert.equal(r.retry_after_respetado, true);
});

test('[SIMULADO] transporte: el timeout ambiguo no se reintenta', () => {
  const r = clasificarTransporteNodo({ tipo: 'timeout', intento: 1, ahora_ms: AHORA, deadline_at: DEADLINE });
  assert.equal(r.clase, 'ambiguo');
  assert.equal(r.reintentar, false);
  assert.match(r.motivo, /no se reintenta automáticamente/);
});

test('[SIMULADO] transporte: acepta la forma de n8n (statusCode) además de status', () => {
  const base = { ahora_ms: AHORA, deadline_at: DEADLINE, aleatorio: 0.5, intento: 1 };
  // Ítem tal como lo entrega httpRequest con fullResponse: true.
  const comoN8n = { statusCode: 200, headers: {}, body: { stop_reason: 'end_turn' } };
  const r = clasificarTransporteNodo({ ...base, ...comoN8n });
  assert.equal(r.clase, 'ok', 'un 200 real no puede caer en la rama de error');
  assert.equal(r.ruta, 'continuar');
  assert.equal(clasificarTransporteNodo({ ...base, statusCode: 429, headers: { 'retry-after': '2' } }).ruta, 'reintentar');
});

test('[SIMULADO] transporte: la ruta es excluyente (una respuesta OK no cae también en desconocido)', () => {
  const base = { ahora_ms: AHORA, deadline_at: DEADLINE, aleatorio: 0.5, intento: 1 };
  const rutas = [
    [{ status: 200 }, 'continuar'],
    [{ status: 429, headers: { 'retry-after': '1' } }, 'reintentar'],
    [{ tipo: 'timeout' }, 'desconocido'],
    [{ status: 400 }, 'error'],
    [{ status: 500, intento: 3 }, 'error'],
  ];
  const vistas = new Set();
  for (const [caso, esperada] of rutas) {
    const r = clasificarTransporteNodo({ ...base, ...caso });
    assert.equal(r.ruta, esperada, `ruta incorrecta para ${JSON.stringify(caso)}`);
    vistas.add(r.ruta);
  }
  assert.equal(vistas.size, 4, 'las cuatro rutas del switch deben ser alcanzables');
});

test('[SIMULADO] transporte: dos reintentos como máximo y nunca cruzando el deadline', () => {
  const tercero = clasificarTransporteNodo({ status: 500, intento: 3, ahora_ms: AHORA, deadline_at: DEADLINE, aleatorio: 0.5 });
  assert.equal(tercero.reintentar, false);
  assert.equal(tercero.motivo, 'reintentos_transporte_agotados');
  const sinMargen = clasificarTransporteNodo({
    // 900 s de espera no caben en los 12 min de deadline del paso.
    status: 429, headers: { 'retry-after': '900' }, intento: 1,
    ahora_ms: AHORA, deadline_at: DEADLINE, aleatorio: 0.5,
  });
  assert.equal(sinMargen.reintentar, false);
  assert.equal(sinMargen.motivo, 'deadline_excedido');
});

// ------------------------------------------------------- interpretar-respuesta

test('[SIMULADO] interpretar: tool_use devuelve la cola con sus IDs', () => {
  const respuesta = respuestaOK(mensajeToolUse([
    { tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' } },
    { tool_use_id: 'toolu_2', nombre: 'forense_facturas', argumentos: {} },
  ]));
  const r = interpretarRespuestaNodo({ respuesta, rol: 'documental' });
  assert.equal(r.tipo, 'tool_use');
  assert.deepEqual(r.cola.map((c) => c.tool_use_id), ['toolu_1', 'toolu_2']);
  assert.equal(r.tipo, parsearRespuesta(respuesta, { rol: 'documental' }).tipo, 'divergencia con el adapter');
});

test('[SIMULADO] interpretar: coincide con el adapter en stop_reason y JSON inválido', () => {
  const casos = [
    { respuesta: respuestaOK(mensajeTexto('no es json')), esperado: 'json_invalido' },
    { respuesta: respuestaOK(mensajeTexto('truncado', { stop_reason: 'max_tokens' })), esperado: 'incompleto' },
    { respuesta: respuestaOK(mensajeTexto('', { stop_reason: 'refusal' })), esperado: 'refusal' },
    { respuesta: respuestaOK(mensajeTexto('x', { stop_reason: 'pause_turn' })), esperado: 'stop_desconocido' },
  ];
  for (const caso of casos) {
    assert.equal(interpretarRespuestaNodo({ respuesta: caso.respuesta, rol: 'documental' }).tipo, caso.esperado);
    assert.equal(parsearRespuesta(caso.respuesta, { rol: 'documental' }).tipo, caso.esperado);
  }
});

test('[SIMULADO] interpretar: la estructura OK no se declara válida sin el validador de contratos', () => {
  const r = interpretarRespuestaNodo({ respuesta: respuestaOK(mensajeTexto(salidaEspecialistaValida())), rol: 'documental' });
  assert.equal(r.tipo, 'salida_estructura_ok');
  assert.equal(r.requiere_validacion_contrato, true, 'el Code node no sustituye la validación de contracts');
  assert.equal(r.contrato, 'agents.especialista');
});

test('[SIMULADO] interpretar: campo extra del rol se detecta como schema inválido', () => {
  const texto = JSON.stringify({ senal_ids: ['601'], resumen: 'ok', limitaciones: [], extra: 'no permitido' });
  const r = interpretarRespuestaNodo({ respuesta: respuestaOK(mensajeTexto(texto)), rol: 'documental' });
  assert.equal(r.tipo, 'schema_invalido');
  assert.ok(r.errores.some((e) => e.instancePath === '/extra'));
});

// -------------------------------------------------------- armar-tool-results

test('[SIMULADO] tool_results: uno por cada tool_use_id, en orden y sin texto antes', () => {
  const cola = [{ tool_use_id: 'toolu_1' }, { tool_use_id: 'toolu_2' }];
  const r = armarToolResultsNodo({
    cola,
    resultados: [
      { tool_use_id: 'toolu_2', resultado: { ok: true, data: {} } },
      { tool_use_id: 'toolu_1', error: { codigo: 'argumento_invalido', mensaje: 'x', reintentable: false } },
    ],
  });
  assert.deepEqual(r.mensaje.content.map((b) => b.tool_use_id), ['toolu_1', 'toolu_2']);
  assert.ok(r.mensaje.content.every((b) => b.type === 'tool_result'));
  assert.equal(r.mensaje.content[0].is_error, true);
  assert.equal(r.con_error, 1);
});

test('[SIMULADO] tool_results: un resultado ausente falla el paso en vez de romper la conversación', () => {
  assert.throws(() => armarToolResultsNodo({ cola: [{ tool_use_id: 'toolu_1' }], resultados: [] }), /faltan tool_result/);
});


// Regresión: el nodo recibe del grafo `{tool_use_id, estado, resultado}` —el
// ledger publica `estado`, no `error`/`is_error`—. Antes, un 5xx de la RPC
// quedaba registrado como error en tool_ejecuciones y aun así llegaba al modelo
// como un tool_result normal, que es lo que 17 §5.5 prohíbe.
test('[SIMULADO] tool_results: un estado de error del ledger llega al modelo COMO error', () => {
  const cola = [{ tool_use_id: 'toolu_1' }, { tool_use_id: 'toolu_2' }];
  const r = armarToolResultsNodo({
    cola,
    // Forma real de «Registrar resultado tool».
    resultados: [
      { tool_use_id: 'toolu_1', estado: 'error', resultado: { message: 'rpc 500' }, duplicado: false },
      { tool_use_id: 'toolu_2', estado: 'completado', resultado: { ok: true, data: {} }, duplicado: true },
    ],
  });
  assert.equal(r.mensaje.content[0].is_error, true, 'el 5xx tiene que viajar como error tipificado');
  assert.match(r.mensaje.content[0].content, /rpc 500/);
  assert.equal(r.mensaje.content[1].is_error, undefined);
  assert.equal(r.con_error, 1);
  assert.equal(r.reentregas, 1, 'la reentrega se cuenta, no se oculta');
  assert.equal(r.estado_interno, 'solicitar_modelo');
});

// ------------------------------------------------------- expandir-cola-tools

const colaDeDos = {
  rol: 'documental',
  ronda: 1,
  execution_id: UUID.ejecucion,
  tarea_id: UUID.tarea,
  caso_id: UUID.caso,
  paso: 3,
  base_rest: 'https://ejemplo/rest/v1',
  pending_tool_use_ids: ['toolu_1', 'toolu_2'],
  checkpoint: {
    cola_tools: [
      { tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { rfc: 'AAA010101AAA' } },
      { tool_use_id: 'toolu_2', nombre: 'forense_facturas', argumentos: { rfc: 'AAA010101AAA' } },
    ],
  },
};

test('[SIMULADO] cola: se expanden TODOS los tool_use, en orden y con identidad de backend', () => {
  const r = expandirColaToolsNodo(colaDeDos);
  assert.equal(r.total, 2, 'dos tool_use en una respuesta son dos ítems, no uno');
  assert.deepEqual(r.items.map((i) => i.tool_use_id), ['toolu_1', 'toolu_2']);
  assert.deepEqual(r.items.map((i) => i.orden), [0, 1]);
  for (const item of r.items) {
    // p_tarea / p_caso / p_operacion los fija el backend: el modelo no los elige.
    assert.equal(item.argumentos_backend.p_tarea, UUID.tarea);
    assert.equal(item.argumentos_backend.p_caso, UUID.caso);
    assert.equal(item.argumentos_backend.p_operacion, `${UUID.tarea}:3:${item.tool_use_id}`);
    assert.equal(item.base_rest, 'https://ejemplo/rest/v1');
  }
  // El argumento del modelo se conserva; no se reescribe.
  assert.equal(r.items[0].argumentos_backend.rfc, 'AAA010101AAA');
});

test('[SIMULADO] cola: una herramienta fuera de la allowlist detiene el paso, no se llama', () => {
  const prohibida = {
    ...colaDeDos,
    pending_tool_use_ids: ['toolu_1'],
    checkpoint: { cola_tools: [{ tool_use_id: 'toolu_1', nombre: 'forense_seguir_dinero', argumentos: {} }] },
  };
  assert.throws(() => expandirColaToolsNodo(prohibida), /no permitida para documental/);
  // `leer_senal` solo existe en ronda informada para un especialista (06 ACL).
  const r1 = {
    ...colaDeDos,
    ronda: 1,
    pending_tool_use_ids: ['toolu_1'],
    checkpoint: { cola_tools: [{ tool_use_id: 'toolu_1', nombre: 'forense_leer_senal', argumentos: {} }] },
  };
  assert.throws(() => expandirColaToolsNodo(r1), /no permitida para documental en ronda 1/);
  const r2 = expandirColaToolsNodo({ ...r1, ronda: 2 });
  assert.equal(r2.items[0].nombre, 'forense_leer_senal');
});

test('[SIMULADO] cola: sin pendientes o con un id sin entrada, el nodo falla en vez de inventar', () => {
  assert.throws(
    () => expandirColaToolsNodo({ ...colaDeDos, pending_tool_use_ids: [], checkpoint: { cola_tools: [] } }),
    /sin tool_use pendientes/,
  );
  assert.throws(
    () => expandirColaToolsNodo({ ...colaDeDos, pending_tool_use_ids: ['toolu_9'] }),
    /pendiente sin entrada en la cola/,
  );
});


// La allowlist del nodo y la que el system promete al modelo no pueden
// separarse: un prompt que autoriza una herramienta que el worker rechaza
// gasta un turno y deja al especialista sin su pizarrón en ronda informada.
test('[SIMULADO] cola: la allowlist del nodo es la misma que la del ensamblador de prompts', () => {
  for (const rol of ['documental', 'financiero', 'relacional', 'temporal', 'externo', 'auditor', 'defensor']) {
    for (const ronda of [1, 2]) {
      const delPrompt = [...toolsPorRol(rol, ronda)].sort();
      for (const nombre of delPrompt) {
        const r = expandirColaToolsNodo({
          ...colaDeDos,
          rol,
          ronda,
          pending_tool_use_ids: ['toolu_1'],
          checkpoint: { cola_tools: [{ tool_use_id: 'toolu_1', nombre, argumentos: {} }] },
        });
        assert.equal(r.items[0].nombre, nombre, `${rol}/r${ronda}: el nodo rechaza ${nombre}, que el prompt autoriza`);
      }
    }
  }
});

// ---------------------------------------------------------- evaluar-frontera

const senalesRefuta = [
  { id: '1', familia: 'R' },
  { id: '2', familia: 'T' },
  { id: '3', familia: 'F', refuta: true, refuta_senal_id: '1' },
];

test('[SIMULADO] frontera: el nodo despierta exactamente lo mismo que despertar.mjs', () => {
  const nodo = evaluarFronteraNodo({ senales: senalesRefuta, familias_evaluables: ['D', 'F', 'R', 'T', 'E'] });
  const modulo = calcularDespertados(senalesRefuta, { familias_evaluables: ['D', 'F', 'R', 'T', 'E'] });
  const union = conjuntoRonda2({ despertados: modulo.despertados, por_expansion: [] });
  assert.deepEqual(nodo.despertados, union.roles);
  assert.equal(nodo.saltar_ronda2, union.saltar_ronda2);
});

test('[SIMULADO] frontera: familia no evaluable no despierta a su especialista', () => {
  const r = evaluarFronteraNodo({ senales: [{ id: '1', familia: 'D' }], familias_evaluables: ['D', 'R'] });
  assert.deepEqual(r.despertados, [], 'D dispara a Financiero, que no es evaluable aquí');
  assert.equal(r.saltar_ronda2, true);
});

test('[SIMULADO] frontera: expansión única y misma decisión que evaluarFrontera()', () => {
  const entrada = {
    senales: [{ id: '1', familia: 'R', frontera: ['RFC-X', 'RFC-Y'] }],
    rfcs_cluster: ['RFC-A'],
    metricas_frontera: { 'RFC-X': { relevante: true }, 'RFC-Y': { relevante: true } },
    version_contexto: 1,
  };
  const primera = evaluarFronteraNodo({ ...entrada, expansiones_previas: 0 });
  const esperada = evaluarFrontera({ ...entrada, expansiones_previas: 0 });
  assert.equal(primera.frontera.expandir, esperada.expandir);
  assert.deepEqual(primera.frontera.rfcs_nuevos, esperada.rfcs_nuevos);
  assert.equal(primera.version_contexto, 2, 'la expansión incrementa version_contexto');

  const segunda = evaluarFronteraNodo({ ...entrada, expansiones_previas: 1 });
  assert.equal(segunda.frontera.expandir, false);
  assert.equal(segunda.frontera.motivo, 'cuota_expansion_agotada');
  assert.ok(segunda.frontera.limitaciones.some((l) => l.codigo === 'cobertura_incompleta'));
});

// ------------------------------------------------------ normalizar-investigacion

test('[SIMULADO] normalizar: el payload no puede traer instrucciones ni destinatarios', () => {
  for (const campo of ['system', 'telefono', 'modelo', 'nivel', 'service_role']) {
    assert.throws(
      () => normalizarInvestigacionNodo({ body: { corrida_id: UUID.corrida, cluster_id: UUID.cluster, idempotency_key: 'k', [campo]: 'x' } }),
      /campos no aceptados/,
      `${campo} debería rechazarse`,
    );
  }
});

test('[SIMULADO] normalizar: corrida e idempotencia son obligatorias; el valor libre va marcado', () => {
  assert.throws(() => normalizarInvestigacionNodo({ body: { cluster_id: UUID.cluster, idempotency_key: 'k' } }), /corrida_id obligatorio/);
  assert.throws(() => normalizarInvestigacionNodo({ body: { corrida_id: UUID.corrida, cluster_id: UUID.cluster } }), /idempotency_key obligatoria/);
  const r = normalizarInvestigacionNodo({ body: { corrida_id: UUID.corrida, origen: 'rfc', valor: 'DEMO:ENTIDAD-0', idempotency_key: 'k' } });
  assert.equal(r.valor_untrusted, 'DEMO:ENTIDAD-0');
  assert.equal(r.entrada, 'webhook');
  assert.equal('valor' in r, false, 'el texto libre solo viaja con sufijo _untrusted');
});

test('[SIMULADO] normalizar: sin cluster_id hace falta origen + valor', () => {
  assert.throws(
    () => normalizarInvestigacionNodo({ body: { corrida_id: UUID.corrida, idempotency_key: 'k' } }),
    /se requiere cluster_id/,
  );
});
