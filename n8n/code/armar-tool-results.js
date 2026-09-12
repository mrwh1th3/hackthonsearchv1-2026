// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/armar-tool-results.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Worker: un tool_result por cada tool_use_id, en orden, sobre TODO el lote (17 §5.5).

const paso = $('Decidir accion').first().json;
const ejecucion = $('Cargar ejecución').first().json;
const x = Object.assign({}, paso, {
  cola: $('Expandir cola de tools').all().map((i) => i.json),
  resultados: $input.all().map((i) => i.json),
  mensajes_previos: (ejecucion.checkpoint || {}).mensajes ?? [],
});
const cola = Array.isArray(x.cola) ? x.cola : [];
const resultados = Array.isArray(x.resultados) ? x.resultados : [];
if (cola.length === 0) throw new Error('cola de tool_use vacía: no hay resultados que enviar');
const porId = new Map(resultados.map((r) => [r.tool_use_id, r]));
const faltantes = cola.filter((t) => !porId.has(t.tool_use_id)).map((t) => t.tool_use_id);
if (faltantes.length > 0) throw new Error(`faltan tool_result para: ${faltantes.join(', ')}`);
const content = cola.map((t) => {
  const r = porId.get(t.tool_use_id);
  // El grafo publica `estado` ('completado'|'error') desde el ledger; el
  // proveedor simulado de los tests usa `error`/`is_error`. Las tres formas
  // cuentan: un 5xx de la RPC tiene que llegar al modelo COMO ERROR tipificado
  // (17 §5.5), no como un tool_result normal.
  const esError = (r.error !== null && r.error !== undefined)
    || r.is_error === true
    || r.estado === 'error';
  const payload = esError
    ? {
      ok: false,
      error: r.error ?? {
        codigo: 'error_herramienta',
        mensaje: r.resultado && r.resultado.message ? String(r.resultado.message) : 'la herramienta devolvió error',
        reintentable: false,
      },
    }
    : r.resultado;
  const bloque = {
    type: 'tool_result',
    tool_use_id: t.tool_use_id,
    content: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
  if (esError) bloque.is_error = true;
  return bloque;
});
// Cerrado el lote, el paso vuelve a `solicitar_modelo`: es la transición
// `resultados_listos` de TRANSICIONES (checkpoint.mjs), inlineada porque un
// Code node no puede importar el módulo.
const mensaje = { role: 'user', content };
const previos = Array.isArray(x.mensajes_previos) ? x.mensajes_previos : [];
const salida = {
  execution_id: x.execution_id ?? null,
  owner: x.owner ?? null,
  fencing_token: x.fencing_token ?? null,
  revision: x.revision ?? null,
  caso_id: x.caso_id ?? null,
  corrida_id: x.corrida_id ?? null,
  tarea_id: x.tarea_id ?? null,
  rol: x.rol ?? null,
  paso: x.paso ?? null,
  paso_pipeline: x.paso_pipeline ?? null,
  request_id: x.request_id ?? null,
  mensaje,
  tool_use_ids: cola.map((t) => t.tool_use_id),
  con_error: content.filter((b) => b.is_error === true).length,
  reentregas: resultados.filter((r) => r.duplicado === true).length,
  estado_interno: 'solicitar_modelo',
  estado_tarea: null,
  checkpoint: {
    estado_interno: 'solicitar_modelo',
    // El transcript crece; nunca se compacta borrando pares
    // tool_use/tool_result (17 §7).
    mensajes: previos.concat([mensaje]),
    pending_tool_use_ids: [],
    cola_tools: [],
    ultimo_evento: 'resultados_listos',
  },
};
return [{ json: salida }];
