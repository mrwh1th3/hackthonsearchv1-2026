// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/decidir-paso.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Worker: traduce el checkpoint a la rama de ESTA ejecución (17 §3).

const x = $input.first().json;
const TERMINALES = ['terminado', 'error', 'timeout'];
const cp = x.checkpoint ?? {};
const estado = cp.estado_interno ?? 'preparar_contexto';
const maxReparaciones = Number(x.max_reparaciones ?? 1);
const reparaciones = Number(cp.reparaciones_json ?? 0);
const pendientes = Array.isArray(cp.pending_tool_use_ids) ? cp.pending_tool_use_ids : [];
const ahora = Number(x.ahora_ms ?? Date.parse(x.ahora ?? new Date().toISOString()));
const limite = cp.deadline_at ? Date.parse(cp.deadline_at) : Number.POSITIVE_INFINITY;

const cerrar = (evento, razon) => ({
  accion: 'cerrar', evento, razon, motivo_request: null,
  estado_interno: estado, reparaciones_json: reparaciones,
});
const pedirModelo = (motivo, razon) => ({
  accion: 'solicitar_modelo', evento: null, razon, motivo_request: motivo,
  estado_interno: estado, reparaciones_json: reparaciones,
});

let salida;
if (TERMINALES.indexOf(estado) >= 0) {
  salida = cerrar(null, 'el paso ya estaba en estado terminal');
} else if (ahora >= limite) {
  // El deadline manda sobre cualquier otra rama: no se abre un request nuevo
  // que no cabe en el paso.
  salida = cerrar('deadline', 'deadline del paso alcanzado');
} else if (estado === 'preparar_contexto' || estado === 'solicitar_modelo') {
  salida = pedirModelo('turno', 'turno normal del protocolo');
} else if (estado === 'espera_reintento') {
  salida = pedirModelo('turno', 'reintento de transporte reprogramado por el dispatcher');
} else if (estado === 'reparar_json') {
  salida = reparaciones < maxReparaciones
    ? pedirModelo('reparacion', 'una reparación acotada, sin herramientas')
    : cerrar('sin_reparacion', 'sin presupuesto de reparación: error visible');
} else if (estado === 'ejecutar_herramienta') {
  salida = pendientes.length > 0
    ? {
      accion: 'ejecutar_herramienta', evento: null, motivo_request: null,
      razon: `${pendientes.length} tool_use pendiente(s)`,
      estado_interno: estado, reparaciones_json: reparaciones,
      pending_tool_use_ids: pendientes,
    }
    : cerrar('error_fatal', 'estado ejecutar_herramienta sin tool_use pendientes');
} else if (estado === 'validar_salida') {
  if (cp.salida_valida) salida = cerrar('valida', 'salida válida: el paso cierra');
  else if (reparaciones < maxReparaciones) salida = pedirModelo('reparacion', 'salida inválida con presupuesto de reparación');
  else salida = cerrar('sin_reparacion', 'salida inválida y sin reparación disponible');
} else {
  salida = cerrar('error_fatal', `estado interno no manejado: ${estado}`);
}
return [{ json: salida }];
