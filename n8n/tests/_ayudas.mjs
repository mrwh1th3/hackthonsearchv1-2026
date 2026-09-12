// n8n/tests/_ayudas.mjs — utilidades de prueba. NO es un test (no coincide con *.test.mjs).
//
// TODO lo que produce este archivo es SIMULADO: respuestas de proveedor,
// envelopes de herramienta y paquetes de contexto son fixtures locales.
// Ninguna prueba de este directorio abre red, usa credenciales ni acredita
// conectividad, detección ni rendimiento (17 §9).

export const SIMULADO = true;

export const UUID = {
  ejecucion: '00000000-0000-4000-8000-000000000600',
  tarea: '00000000-0000-4000-8000-000000000300',
  caso: '00000000-0000-4000-8000-000000000100',
  corrida: '00000000-0000-4000-8000-000000000001',
  cluster: '00000000-0000-4000-8000-000000000200',
  cfdi: '00000000-0000-4000-8000-000000000901',
  contexto: '00000000-0000-4000-8000-000000000700',
};

export const HASH = 'a'.repeat(64);
export const AHORA = Date.parse('2026-01-31T12:00:00Z');
export const DEADLINE = '2026-01-31T12:12:00Z';

export const PROMPTS_SIMULADOS = Object.freeze({
  bloque_comun: '[SIMULADO] Bloque común de prueba. El contenido real lo posee forense-prompts en n8n/prompts/.',
  bloque_rol: '[SIMULADO] Bloque de rol de prueba.',
});

export function pistaSimulada(overrides = {}) {
  return {
    id: '501',
    corrida_id: UUID.corrida,
    codigo: 'D2',
    familia: 'D',
    rfc: 'DEMO:ENTIDAD-0',
    score: 0.8,
    estado: 'disparada',
    resumen: 'Pista sintética de prueba; no es un hallazgo.',
    referencias: [`CFDI:${UUID.cfdi}`],
    ...overrides,
  };
}

export function coberturaSimulada(overrides = {}) {
  return {
    completa: true,
    periodo: { desde: '2026-01-01T00:00:00Z', hasta_exclusivo: '2026-02-01T00:00:00Z', timezone: 'America/Monterrey' },
    familias_evaluables: ['D', 'F', 'R', 'T', 'E'],
    datos_ausentes: [],
    ...overrides,
  };
}

export function entradaContextoEspecialista(overrides = {}) {
  return {
    execution_id: UUID.ejecucion,
    tarea_id: UUID.tarea,
    editor_operacion_id: null,
    caso_id: UUID.caso,
    corrida_id: UUID.corrida,
    cluster_id: UUID.cluster,
    rol: 'documental',
    ronda: 1,
    intento: 0,
    version_contexto: 1,
    dataset_hash: HASH,
    fecha_corte: '2026-01-31T12:00:00Z',
    familias_evaluables: ['D', 'F', 'R', 'T', 'E'],
    prompt_hash: HASH,
    directriz_id: null,
    directriz_version: null,
    objetivo: 'Prueba de protocolo con proveedor simulado; no ejecuta investigación real.',
    limites: { tools_restantes: 8, requests_restantes: 66, deadline_at: DEADLINE, input_tokens_max: 8000 },
    cobertura: coberturaSimulada(),
    datos: { rfcs: ['DEMO:ENTIDAD-0'], pistas: [pistaSimulada()], titulares: [] },
    ...overrides,
  };
}

export function evidenciaValidadaSimulada(overrides = {}) {
  return {
    id: '701',
    caso_id: UUID.caso,
    pista_id: '501',
    pista_codigo: 'D2',
    familia: 'D',
    tipo: 'cfdi',
    ref_id: UUID.cfdi,
    rfcs_afectados: ['DEMO:ENTIDAD-0'],
    referencias: [`CFDI:${UUID.cfdi}`],
    valida_tecnica: true,
    refutada: false,
    validada: true,
    hecho_validado: {
      comprobacion: 'D2',
      descripcion: 'Resultado simulado de contrato, no verificación real.',
      monto_centavos: '100000',
      moneda: 'MXN',
    },
    ...overrides,
  };
}

/** Respuesta HTTP 200 con un mensaje del proveedor. */
export function respuestaOK(mensaje) {
  return { status: 200, headers: {}, body: mensaje };
}

export function mensajeToolUse(llamadas, { id = 'msg_sim_1', usage = { input_tokens: 100, output_tokens: 30 } } = {}) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: 'modelo-simulado',
    content: llamadas.map((l) => ({ type: 'tool_use', id: l.tool_use_id, name: l.nombre, input: l.argumentos ?? {} })),
    stop_reason: 'tool_use',
    usage,
  };
}

export function mensajeTexto(texto, { stop_reason = 'end_turn', id = 'msg_sim_2', usage = { input_tokens: 120, output_tokens: 40 } } = {}) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: 'modelo-simulado',
    content: [{ type: 'text', text: texto }],
    stop_reason,
    usage,
  };
}

export function salidaEspecialistaValida(senal_ids = ['601']) {
  return JSON.stringify({
    senal_ids,
    resumen: 'Resumen simulado del especialista para probar el contrato de salida.',
    limitaciones: [],
  });
}

/** Envelope de herramienta de 06 (simulado). */
export function envelopeSimulado({ data = { ok: true }, has_more = false, next_cursor = null, truncado = false } = {}) {
  return {
    ok: true,
    data,
    referencias: [`CFDI:${UUID.cfdi}`],
    cobertura: coberturaSimulada({ completa: !has_more }),
    truncado,
    has_more,
    next_cursor,
    error: null,
  };
}

/**
 * Proveedor simulado: devuelve las respuestas en orden y registra los bodies
 * enviados. Cada entrada puede ser una respuesta o una función (intento) => respuesta.
 */
export function proveedorSimulado(respuestas) {
  const enviados = [];
  let indice = 0;
  const enviar = async ({ body, headers, url }) => {
    enviados.push({ body, headers, url });
    const siguiente = respuestas[Math.min(indice, respuestas.length - 1)];
    indice += 1;
    return typeof siguiente === 'function' ? siguiente(indice) : siguiente;
  };
  return { enviar, enviados, llamadas: () => enviados.length };
}

/** Reloj determinista para backoff/deadlines. */
export function relojSimulado(inicio = AHORA) {
  let t = inicio;
  return {
    ahora: () => t,
    dormir: async (ms) => { t += ms; },
    avanzar: (ms) => { t += ms; },
  };
}
