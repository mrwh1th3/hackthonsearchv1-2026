// n8n/runtime/nodos/decidir-paso.mjs — fuente del Code node «Decidir accion»
// del worker FORENSE_ejecutar_agente (17 §3 y §5).
//
// La región CODE_NODE es la ÚNICA fuente del archivo generado
// n8n/code/decidir-paso.js. No editar el .js a mano: `node
// n8n/runtime/generar-code-nodes.mjs --check` falla si hay deriva.
//
// El nodo NO decide nada del dominio: traduce el estado interno persistido en
// el checkpoint a la rama que debe tomar ESTA ejecución. Una ejecución hace un
// request de modelo O un lote de herramientas, nunca las dos cosas.

export const ACCIONES = Object.freeze(['solicitar_modelo', 'ejecutar_herramienta', 'cerrar']);

export function decidirPaso(x) {
  // <<<CODE_NODE_INICIO
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
  // <<<CODE_NODE_FIN
  return salida;
}
