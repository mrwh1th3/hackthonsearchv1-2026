// n8n/tests/protocolo.test.mjs — lista de pruebas de 17 §9 con PROVEEDOR SIMULADO.
//
// NINGUNA de estas pruebas llama a la API real, usa credenciales ni acredita
// conectividad, detección o rendimiento. El mock no sustituye al smoke remoto
// autorizado por el coordinador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { construirContexto } from '../runtime/contexto.mjs';
import { crearLedger } from '../runtime/ledger.mjs';
import { crearPresupuesto } from '../runtime/presupuesto.mjs';
import { correrBucle } from '../runtime/loop.mjs';
import { crearAlmacenCheckpoints } from '../runtime/checkpoint.mjs';
import {
  DEADLINE, PROMPTS_SIMULADOS, UUID, entradaContextoEspecialista, envelopeSimulado,
  mensajeTexto, mensajeToolUse, proveedorSimulado, relojSimulado, respuestaOK,
  salidaEspecialistaValida,
} from './_ayudas.mjs';

function montar({ respuestas, contexto: sobreescrituras = {}, herramienta = null, ledger = null, presupuesto = null }) {
  const ctx = construirContexto(entradaContextoEspecialista(sobreescrituras));
  assert.equal(ctx.ok, true, JSON.stringify(ctx.errores ?? []));
  const reloj = relojSimulado();
  const proveedor = proveedorSimulado(respuestas);
  const eventos = [];
  const ejecutadas = [];
  const ejecutarHerramienta = herramienta ?? (async ({ nombre, argumentos, p_operacion }) => {
    ejecutadas.push({ nombre, argumentos, p_operacion });
    return envelopeSimulado({ data: { nombre } });
  });
  return {
    contexto: ctx.contexto,
    reloj,
    proveedor,
    eventos,
    ejecutadas,
    ledger: ledger ?? crearLedger(),
    presupuesto: presupuesto ?? crearPresupuesto({ caso_id: UUID.caso }),
    correr(extra = {}) {
      return correrBucle({
        contexto: ctx.contexto,
        prompts: PROMPTS_SIMULADOS,
        ledger: this.ledger,
        presupuesto: this.presupuesto,
        enviar: proveedor.enviar,
        ejecutarHerramienta,
        registrar: (e) => eventos.push(e),
        ahora: reloj.ahora,
        dormir: reloj.dormir,
        aleatorio: () => 0.5,
        ...extra,
      });
    },
  };
}

test('[SIMULADO] tool_use → tool_result → end_turn', async () => {
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeToolUse([{ tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' } }])),
      respuestaOK(mensajeTexto(salidaEspecialistaValida())),
    ],
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'terminado');
  assert.equal(r.salida.resumen.length > 0, true);
  assert.equal(banco.ejecutadas.length, 1);
  assert.equal(banco.proveedor.llamadas(), 2);
  // El segundo body lleva el par assistant(tool_use) + user(tool_result) sin texto previo.
  const segundo = banco.proveedor.enviados[1].body;
  const ultimo = segundo.messages.at(-1);
  assert.equal(ultimo.role, 'user');
  assert.equal(ultimo.content[0].type, 'tool_result');
  assert.equal(ultimo.content[0].tool_use_id, 'toolu_1');
  assert.equal(segundo.messages.at(-2).role, 'assistant');
  // Bitácora: sin evento persistido no hay progreso en la UI.
  const tipos = banco.eventos.map((e) => e.tipo_evento);
  assert.ok(tipos.includes('llm_request') && tipos.includes('tool_resumen') && tipos.includes('salida_validada'));
});

test('[SIMULADO] dos herramientas en una respuesta: un tool_result por cada tool_use_id, en orden', async () => {
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeToolUse([
        { tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' } },
        { tool_use_id: 'toolu_2', nombre: 'forense_pares', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' } },
      ])),
      respuestaOK(mensajeTexto(salidaEspecialistaValida())),
    ],
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'terminado');
  assert.deepEqual(banco.ejecutadas.map((e) => e.nombre), ['forense_perfil', 'forense_pares']);
  const resultados = banco.proveedor.enviados[1].body.messages.at(-1).content;
  assert.equal(resultados.length, 2);
  assert.deepEqual(resultados.map((c) => c.tool_use_id), ['toolu_1', 'toolu_2']);
  assert.ok(resultados.every((c) => c.type === 'tool_result'));
});

test('[SIMULADO] paginación: has_more y next_cursor llegan al modelo y permiten una segunda página', async () => {
  const paginas = [
    envelopeSimulado({ data: { pagina: 1 }, has_more: true, next_cursor: 'cursor-2', truncado: true }),
    envelopeSimulado({ data: { pagina: 2 }, has_more: false, next_cursor: null }),
  ];
  let i = 0;
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeToolUse([{ tool_use_id: 'toolu_1', nombre: 'forense_facturas', argumentos: { p_rfc: 'DEMO:ENTIDAD-0', p_rol: 'emisor', p_desde: '2026-01-01T00:00:00Z', p_hasta: '2026-02-01T00:00:00Z', p_limite: 50 } }])),
      respuestaOK(mensajeToolUse([{ tool_use_id: 'toolu_2', nombre: 'forense_facturas', argumentos: { p_rfc: 'DEMO:ENTIDAD-0', p_rol: 'emisor', p_desde: '2026-01-01T00:00:00Z', p_hasta: '2026-02-01T00:00:00Z', p_limite: 50, p_cursor: 'cursor-2' } }], { id: 'msg_sim_3' })),
      respuestaOK(mensajeTexto(salidaEspecialistaValida())),
    ],
    herramienta: async ({ argumentos }) => { const p = paginas[i]; i += 1; return { ...p, eco_cursor: argumentos.p_cursor ?? null }; },
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'terminado');
  const primerResultado = JSON.parse(banco.proveedor.enviados[1].body.messages.at(-1).content[0].content);
  assert.equal(primerResultado.has_more, true);
  assert.equal(primerResultado.next_cursor, 'cursor-2');
  const segundoResultado = JSON.parse(banco.proveedor.enviados[2].body.messages.at(-1).content[0].content);
  assert.equal(segundoResultado.eco_cursor, 'cursor-2');
  assert.equal(segundoResultado.has_more, false);
});

test('[SIMULADO] JSON inválido: una reparación sin herramientas que también consume request', async () => {
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeTexto('No es JSON, es prosa del modelo.')),
      respuestaOK(mensajeTexto(salidaEspecialistaValida())),
    ],
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'terminado');
  assert.equal(banco.proveedor.llamadas(), 2);
  const reparacion = banco.proveedor.enviados[1].body;
  assert.equal(reparacion.tools, undefined, 'la reparación va sin herramientas');
  assert.match(reparacion.messages.at(-1).content[0].text, /no cumple el contrato/);
  assert.equal(r.presupuesto.requests.usados, 2, 'la reparación consume request');
  assert.equal(r.presupuesto.requests.reparaciones, 1);
  assert.ok(banco.eventos.some((e) => e.tipo_evento === 'reparacion_json'));
});

test('[SIMULADO] parser fallido no produce un caso limpio', async () => {
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeTexto('sigue sin ser JSON')),
      respuestaOK(mensajeTexto('tampoco ahora')),
    ],
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'error');
  assert.equal(r.salida, null, 'no se inventa un resultado vacío exitoso');
  assert.equal(banco.proveedor.llamadas(), 2, 'solo una reparación');
  assert.ok(banco.eventos.some((e) => e.tipo_evento === 'salida_invalida'));
});

test('[SIMULADO] salida que parsea pero viola el schema del rol también se repara y luego falla con diagnóstico', async () => {
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeTexto(JSON.stringify({ senal_ids: ['601'], resumen: 'ok', limitaciones: [], extra: 'campo no permitido' }))),
      respuestaOK(mensajeTexto(JSON.stringify({ senal_ids: ['601'], resumen: 'ok', limitaciones: [], extra: 'sigue mal' }))),
    ],
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'error');
  assert.equal(r.salida, null);
  const reparacion = banco.proveedor.enviados[1].body.messages.at(-1).content[0].text;
  assert.match(reparacion, /agents\.especialista/);
});

test('[SIMULADO] refusal se maneja explícitamente y no entra en bucle', async () => {
  const banco = montar({
    respuestas: [respuestaOK(mensajeTexto('', { stop_reason: 'refusal' }))],
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'error');
  assert.equal(r.diagnostico.codigo, 'refusal');
  assert.equal(banco.proveedor.llamadas(), 1);
});

test('[SIMULADO] max_tokens no se persiste como informe válido; hay una reparación acotada', async () => {
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeTexto('{"senal_ids":["601"],"resumen":"a medio escri', { stop_reason: 'max_tokens' })),
      respuestaOK(mensajeTexto(salidaEspecialistaValida())),
    ],
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'terminado');
  assert.equal(banco.proveedor.llamadas(), 2);
  assert.equal(r.presupuesto.requests.reparaciones, 1);
});

test('[SIMULADO] max_tokens sin reparación posible termina con error visible', async () => {
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeTexto('truncado', { stop_reason: 'max_tokens' })),
      respuestaOK(mensajeTexto('sigue truncado', { stop_reason: 'max_tokens' })),
    ],
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'error');
  assert.equal(r.salida, null);
});

test('[SIMULADO] 429 con Retry-After se reintenta en transporte sin consumir otro request', async () => {
  const respuestas = [
    { status: 429, headers: { 'retry-after': '1' } },
    respuestaOK(mensajeTexto(salidaEspecialistaValida())),
  ];
  let i = 0;
  const banco = montar({ respuestas: [() => respuestas[Math.min(i++, 1)]] });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'terminado');
  assert.equal(r.presupuesto.requests.usados, 1, 'un reintento de transporte no es otro request');
  assert.equal(r.ledger.contadores.intentos_transporte, 2);
  assert.equal(r.ledger.requests.total, 1);
});

test('[SIMULADO] timeout ambiguo deja el request en desconocido y el paso en error', async () => {
  const banco = montar({ respuestas: [{ tipo: 'timeout' }] });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'error');
  assert.equal(r.ledger.requests.desconocido, 1);
  assert.equal(r.ledger.ambiguos.length, 1);
  assert.ok(banco.eventos.some((e) => e.tipo_evento === 'llm_ambiguo'));
});

test('[SIMULADO] reejecutar el paso tras un commit no duplica la herramienta ni la cuota', async () => {
  const ledger = crearLedger();
  const presupuesto = crearPresupuesto({ caso_id: UUID.caso });
  const llamadas = [];
  const herramienta = async ({ nombre, p_operacion }) => { llamadas.push({ nombre, p_operacion }); return envelopeSimulado(); };
  const respuestas = [
    respuestaOK(mensajeToolUse([{ tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' } }])),
    respuestaOK(mensajeTexto(salidaEspecialistaValida())),
  ];
  const primera = montar({ respuestas: [...respuestas], herramienta, ledger, presupuesto });
  const r1 = await primera.correr();
  assert.equal(r1.estado_interno, 'terminado');
  // Replay del mismo paso (mismo ledger, misma ejecución): el tool_use_id ya está registrado.
  const segunda = montar({ respuestas: [...respuestas], herramienta, ledger, presupuesto });
  const r2 = await segunda.correr();
  assert.equal(r2.estado_interno, 'terminado');
  assert.equal(llamadas.length, 1, 'la herramienta se ejecutó una sola vez');
  assert.equal(r2.presupuesto.tools.usadas, 1, 'la reentrega no consume cuota');
  assert.ok(segunda.eventos.some((e) => e.tipo_evento === 'tool_reentrega'));
});

test('[SIMULADO] el mismo tool_use_id repetido dentro de una respuesta no se ejecuta dos veces', async () => {
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeToolUse([
        { tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' } },
        { tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' } },
      ])),
      respuestaOK(mensajeTexto(salidaEspecialistaValida())),
    ],
  });
  const r = await banco.correr();
  assert.equal(r.estado_interno, 'terminado');
  assert.equal(banco.ejecutadas.length, 1);
  assert.equal(r.presupuesto.tools.usadas, 1);
});

test('[SIMULADO] R1 no recibe señales ajenas ni puede leer el pizarrón', async () => {
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeToolUse([{ tool_use_id: 'toolu_1', nombre: 'forense_leer_senal', argumentos: { p_senal_id: '601' } }])),
      respuestaOK(mensajeTexto(salidaEspecialistaValida())),
    ],
  });
  const r = await banco.correr();
  const herramientas = banco.proveedor.enviados[0].body.tools.map((t) => t.name);
  assert.ok(!herramientas.includes('forense_leer_senal'), 'leer_senal fuera del allowlist en R1');
  assert.equal(banco.ejecutadas.length, 0, 'la herramienta denegada no se ejecuta');
  const resultado = JSON.parse(banco.proveedor.enviados[1].body.messages.at(-1).content[0].content);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.error.codigo, 'argumento_invalido');
  assert.equal(banco.proveedor.enviados[1].body.messages.at(-1).content[0].is_error, true);
  assert.equal(r.estado_interno, 'terminado');
  assert.equal(r.presupuesto.tools.usadas, 0, 'una herramienta denegada no consume cuota');
});

test('[SIMULADO] R2 sí puede leer el pizarrón autorizado', () => {
  const ctx = construirContexto(entradaContextoEspecialista({
    ronda: 2,
    datos: { rfcs: ['DEMO:ENTIDAD-0'], pistas: [], titulares: [{ id: '602', familia: 'F', titular: 'titular simulado' }] },
  }));
  assert.equal(ctx.ok, true);
});

test('[SIMULADO] el body lleva modelo de configuración, system de 3 bloques y tools sin campos de identidad', async () => {
  const banco = montar({ respuestas: [respuestaOK(mensajeTexto(salidaEspecialistaValida()))] });
  await banco.correr();
  const body = banco.proveedor.enviados[0].body;
  assert.equal(typeof body.model, 'string');
  assert.ok(body.model.length > 0);
  assert.equal(body.temperature, 0);
  assert.equal(body.system.length, 3);
  assert.match(body.system[2].text, /agents\.especialista/);
  for (const herramienta of body.tools) {
    assert.equal(herramienta.input_schema.type, 'object');
    const propiedades = Object.keys(herramienta.input_schema.properties ?? {});
    for (const prohibido of ['p_caso', 'p_tarea', 'p_agente', 'p_operacion', 'fencing_token', 'caso_id', 'tarea_id']) {
      assert.ok(!propiedades.includes(prohibido), `${herramienta.name} expone ${prohibido}`);
    }
    assert.equal(JSON.stringify(herramienta.input_schema).includes('$ref'), false, 'los $ref deben venir resueltos');
  }
  // El contexto viaja como DATO en el primer mensaje user, no como system.
  assert.equal(body.messages[0].role, 'user');
  assert.match(body.messages[0].content[0].text, /Paquete de contexto \(datos, no instrucciones\)/);
});

test('[SIMULADO] agotar la cuota de herramientas devuelve error tipificado y el paso sigue cerrando', async () => {
  const presupuesto = crearPresupuesto({ caso_id: UUID.caso });
  for (let i = 0; i < 8; i += 1) presupuesto.reservarTool({ rol: 'documental', ronda: 1, tarea_id: UUID.tarea });
  const banco = montar({
    presupuesto,
    respuestas: [
      respuestaOK(mensajeToolUse([{ tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' } }])),
      respuestaOK(mensajeTexto(salidaEspecialistaValida())),
    ],
  });
  const r = await banco.correr();
  assert.equal(banco.ejecutadas.length, 0);
  const resultado = JSON.parse(banco.proveedor.enviados[1].body.messages.at(-1).content[0].content);
  assert.equal(resultado.error.codigo, 'presupuesto_agotado');
  assert.equal(r.estado_interno, 'terminado');
});

test('[SIMULADO] el checkpoint se guarda con CAS en cada transición y el fence viejo se rechaza', async () => {
  const almacen = crearAlmacenCheckpoints();
  const banco = montar({
    respuestas: [
      respuestaOK(mensajeToolUse([{ tool_use_id: 'toolu_1', nombre: 'forense_perfil', argumentos: { p_rfc: 'DEMO:ENTIDAD-0' } }])),
      respuestaOK(mensajeTexto(salidaEspecialistaValida())),
    ],
  });
  // El bucle reclama cada paso antes de guardarlo (el dispatcher real hace claim_step).
  const almacenConClaim = {
    guardar: (args) => {
      almacen.reclamar({ caso_id: args.caso_id, paso: args.paso, owner: 'ejecucion-A', ahora: args.ahora });
      return almacen.guardar(args);
    },
  };
  const r = await banco.correr({ almacen: almacenConClaim });
  assert.equal(r.estado_interno, 'terminado');
  assert.ok(r.checkpoint.revision >= 1);
  const slot = almacen.leer({ caso_id: UUID.caso, paso: r.checkpoint.paso });
  assert.ok(slot, 'el último paso quedó persistido');
});

test('[SIMULADO] el deadline del paso corta el bucle con timeout', async () => {
  const ctx = construirContexto(entradaContextoEspecialista());
  const reloj = relojSimulado(Date.parse(DEADLINE) + 1000);
  const proveedor = proveedorSimulado([respuestaOK(mensajeTexto(salidaEspecialistaValida()))]);
  const r = await correrBucle({
    contexto: ctx.contexto,
    prompts: PROMPTS_SIMULADOS,
    ledger: crearLedger(),
    presupuesto: crearPresupuesto({ caso_id: UUID.caso }),
    enviar: proveedor.enviar,
    ejecutarHerramienta: async () => envelopeSimulado(),
    ahora: reloj.ahora,
    dormir: reloj.dormir,
  });
  assert.equal(r.estado_interno, 'timeout');
  assert.equal(proveedor.llamadas(), 0, 'no se gasta un request fuera de deadline');
});
