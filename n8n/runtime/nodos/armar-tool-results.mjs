// n8n/runtime/nodos/armar-tool-results.mjs — fuente del Code node «Armar
// tool_results» del worker (17 §5.5).
//
// UN `tool_result` por CADA `tool_use_id`, en el orden de la cola, incluidos
// los errores tipificados, y sin texto ordinario antes. Si falta uno, el nodo
// falla: es preferible un paso en error a una conversación rota que el modelo
// interpretará mal al reanudar.

export function armarToolResultsNodo(x) {
  // <<<CODE_NODE_INICIO
  const cola = Array.isArray(x.cola) ? x.cola : [];
  const resultados = Array.isArray(x.resultados) ? x.resultados : [];
  if (cola.length === 0) throw new Error('cola de tool_use vacía: no hay resultados que enviar');
  const porId = new Map(resultados.map((r) => [r.tool_use_id, r]));
  const faltantes = cola.filter((t) => !porId.has(t.tool_use_id)).map((t) => t.tool_use_id);
  if (faltantes.length > 0) throw new Error(`faltan tool_result para: ${faltantes.join(', ')}`);
  const content = cola.map((t) => {
    const r = porId.get(t.tool_use_id);
    const esError = (r.error !== null && r.error !== undefined) || r.is_error === true;
    const payload = esError
      ? { ok: false, error: r.error ?? { codigo: 'error_herramienta', mensaje: 'error sin detalle', reintentable: false } }
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
  // <<<CODE_NODE_FIN
  return salida;
}
