// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/construir-cuerpo.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Worker: compone el body de /v1/messages con insumos de DB (17 §5.2).

const x = $input.first().json;
if (!x.modelo) throw new Error('modelo ausente: se resuelve de configuración, nunca del prompt');
if (!Array.isArray(x.system_bloques) || x.system_bloques.length === 0) {
  throw new Error('system ausente: bloque común + rol + contrato son obligatorios');
}
if (!Array.isArray(x.mensajes) || x.mensajes.length === 0) {
  throw new Error('mensajes ausentes: el checkpoint debe traer al menos el paquete de contexto');
}
// Todo tool_use del último assistant debe tener su tool_result en el
// siguiente user: compactar borrando pares rompe el protocolo (17 §7).
const ultimoAssistant = [...x.mensajes].reverse().find((m) => m.role === 'assistant');
if (ultimoAssistant) {
  const usos = (ultimoAssistant.content ?? []).filter((b) => b.type === 'tool_use').map((b) => b.id);
  if (usos.length > 0) {
    const indice = x.mensajes.lastIndexOf(ultimoAssistant);
    const siguiente = x.mensajes[indice + 1];
    const resueltos = ((siguiente && siguiente.content) || [])
      .filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
    const faltantes = usos.filter((id) => resueltos.indexOf(id) < 0);
    if (faltantes.length > 0) throw new Error(`faltan tool_result para: ${faltantes.join(', ')}`);
  }
}
const cuerpo = {
  model: x.modelo,
  max_tokens: Number(x.max_tokens ?? 2000),
  temperature: x.temperatura === undefined || x.temperatura === null ? 0 : Number(x.temperatura),
  system: x.system_bloques,
  messages: x.mensajes,
};
const herramientas = Array.isArray(x.herramientas) ? x.herramientas : [];
// Reparación acotada y roles sin tools (Réplica, Redactor, Editor) no reciben
// la clave `tools` (17 §5.8).
if (x.sin_herramientas !== true && herramientas.length > 0) {
  cuerpo.tools = herramientas;
  cuerpo.tool_choice = { type: 'auto' };
}
const salida = { cuerpo, herramientas_enviadas: cuerpo.tools ? cuerpo.tools.length : 0 };
return [{ json: salida }];
