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
import { evaluarFronteraNodo } from '../runtime/nodos/evaluar-frontera.mjs';
import { normalizarInvestigacionNodo } from '../runtime/nodos/normalizar-investigacion.mjs';

import { clasificar } from '../runtime/transporte.mjs';
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
