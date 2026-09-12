// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/armar-tool-results.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Worker: un tool_result por cada tool_use_id, en orden (17 §5.5).

const x = $input.first().json;
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
const salida = {
  mensaje: { role: 'user', content },
  tool_use_ids: cola.map((t) => t.tool_use_id),
  con_error: content.filter((b) => b.is_error === true).length,
};
return [{ json: salida }];
