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
  // Destino de cada evento de cierre. Es la mitad de TRANSICIONES
  // (checkpoint.mjs) que este nodo necesita; un Code node de n8n no puede
  // importar el módulo, así que se inlinea y un test compara ambas tablas.
  // Sin esto el nodo devolvía el estado de ORIGEN y el IF «¿Estado terminal?»
  // del worker —que se evalúa DESPUÉS del checkpoint— redespachaba en bucle.
  const DESTINO_CIERRE = {
    valida: 'terminado',
    deadline: 'timeout',
    sin_reparacion: 'error',
    error_fatal: 'error',
  };
  const ESTADO_TAREA = { terminado: 'completada', error: 'error', timeout: 'timeout' };
  const cp = x.checkpoint ?? {};
  const estado = cp.estado_interno ?? 'preparar_contexto';
  const maxReparaciones = Number(x.max_reparaciones ?? 1);
  const reparaciones = Number(cp.reparaciones_json ?? 0);
  const pendientes = Array.isArray(cp.pending_tool_use_ids) ? cp.pending_tool_use_ids : [];
  const ahora = Number(x.ahora_ms ?? Date.parse(x.ahora ?? new Date().toISOString()));
  const limite = cp.deadline_at ? Date.parse(cp.deadline_at) : Number.POSITIVE_INFINITY;

  // Identidad del claim: viaja por la cadena de nodos para que el checkpoint,
  // el ledger y la barrera no la vuelvan a inventar (17 §4).
  const identidad = {
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
  };

  const cerrar = (evento, razon) => {
    const destino = evento === null ? estado : (DESTINO_CIERRE[evento] ?? 'error');
    return Object.assign({}, identidad, {
      accion: 'cerrar', evento, razon, motivo_request: null,
      estado_interno: destino,
      estado_tarea: ESTADO_TAREA[destino] ?? 'error',
      reparaciones_json: reparaciones,
      pending_tool_use_ids: [],
      // La rama `cerrar` va directo a «Guardar checkpoint»: lleva su propio
      // patch, como las otras dos ramas.
      checkpoint: { estado_interno: destino, ultimo_evento: evento, razon, pending_tool_use_ids: [] },
    });
  };
  const pedirModelo = (motivo, razon) => Object.assign({}, identidad, {
    accion: 'solicitar_modelo', evento: null, razon, motivo_request: motivo,
    estado_interno: estado, estado_tarea: null, reparaciones_json: reparaciones,
    pending_tool_use_ids: [],
    checkpoint: null,
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
      ? Object.assign({}, identidad, {
        accion: 'ejecutar_herramienta', evento: null, motivo_request: null,
        razon: `${pendientes.length} tool_use pendiente(s)`,
        estado_interno: estado, estado_tarea: null, reparaciones_json: reparaciones,
        // TODOS los tool_use de la respuesta, no solo el primero (17 §5.5):
        // el grafo expande esta cola a un ítem por herramienta.
        pending_tool_use_ids: pendientes,
        checkpoint: null,
      })
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
