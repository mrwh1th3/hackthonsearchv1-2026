// n8n/runtime/nodos/expandir-cola-tools.mjs — fuente del Code node «Expandir
// cola de tools» del worker (17 §5.5).
//
// Una respuesta del modelo puede traer VARIOS bloques `tool_use`. El worker
// procesa TODOS los de esa respuesta en el mismo paso, uno por ítem del grafo y
// en el orden en que llegaron: n8n ejecuta los nodos siguientes una vez por
// ítem, secuencialmente, que es lo que pide 17 §5 («llamadas paralelas
// sugeridas por el modelo se ejecutan secuencialmente dentro de la tarea»).
//
// Este nodo NO llama a ninguna herramienta: solo convierte la cola persistida
// en el checkpoint en ítems, y fija por ítem lo que el backend impone y el
// modelo no puede tocar: `p_operacion` (tarea_id, paso, tool_use_id según 06),
// `p_tarea`, `p_caso` y la allowlist del rol. Nada sale de `$fromAI` (17 §1).

// Allowlist por rol (03 + 06). `forense_leer_senal` solo en ronda informada.
export const TOOLS_POR_ROL = Object.freeze({
  documental: ['forense_perfil', 'forense_facturas', 'forense_pares', 'forense_escribir_senal', 'forense_registrar_evidencia'],
  financiero: ['forense_conciliar', 'forense_seguir_dinero', 'forense_facturas', 'forense_escribir_senal', 'forense_registrar_evidencia'],
  relacional: ['forense_relacionados', 'forense_ciclos', 'forense_facturas', 'forense_escribir_senal', 'forense_registrar_evidencia'],
  temporal: ['forense_perfil', 'forense_facturas', 'forense_pares', 'forense_escribir_senal', 'forense_registrar_evidencia'],
  externo: ['forense_listas', 'forense_relacionados', 'forense_escribir_senal', 'forense_registrar_evidencia'],
  auditor: ['forense_perfil', 'forense_facturas', 'forense_conciliar', 'forense_seguir_dinero', 'forense_relacionados',
    'forense_ciclos', 'forense_pares', 'forense_listas', 'forense_leer_senal', 'forense_registrar_evidencia'],
  defensor: ['forense_perfil', 'forense_facturas', 'forense_conciliar', 'forense_seguir_dinero', 'forense_relacionados',
    'forense_ciclos', 'forense_pares', 'forense_listas', 'forense_leer_senal'],
  replica: [],
  redactor: [],
  editor: [],
});

export function expandirColaToolsNodo(x) {
  // <<<CODE_NODE_INICIO
  const TOOLS_POR_ROL = {
    documental: ['forense_perfil', 'forense_facturas', 'forense_pares', 'forense_escribir_senal', 'forense_registrar_evidencia'],
    financiero: ['forense_conciliar', 'forense_seguir_dinero', 'forense_facturas', 'forense_escribir_senal', 'forense_registrar_evidencia'],
    relacional: ['forense_relacionados', 'forense_ciclos', 'forense_facturas', 'forense_escribir_senal', 'forense_registrar_evidencia'],
    temporal: ['forense_perfil', 'forense_facturas', 'forense_pares', 'forense_escribir_senal', 'forense_registrar_evidencia'],
    externo: ['forense_listas', 'forense_relacionados', 'forense_escribir_senal', 'forense_registrar_evidencia'],
    auditor: ['forense_perfil', 'forense_facturas', 'forense_conciliar', 'forense_seguir_dinero', 'forense_relacionados',
      'forense_ciclos', 'forense_pares', 'forense_listas', 'forense_leer_senal', 'forense_registrar_evidencia'],
    defensor: ['forense_perfil', 'forense_facturas', 'forense_conciliar', 'forense_seguir_dinero', 'forense_relacionados',
      'forense_ciclos', 'forense_pares', 'forense_listas', 'forense_leer_senal'],
    replica: [], redactor: [], editor: [],
  };
  const SOLO_RONDA_INFORMADA = 'forense_leer_senal';
  const ESPECIALISTAS = ['documental', 'financiero', 'relacional', 'temporal', 'externo'];

  const cp = x.checkpoint || {};
  const rol = x.rol;
  const ronda = Number(x.ronda === undefined || x.ronda === null ? (cp.ronda === undefined ? 1 : cp.ronda) : x.ronda);
  const cola = Array.isArray(cp.cola_tools) ? cp.cola_tools : [];
  const pendientes = Array.isArray(x.pending_tool_use_ids) && x.pending_tool_use_ids.length > 0
    ? x.pending_tool_use_ids
    : cola.map((t) => t.tool_use_id);
  if (pendientes.length === 0) throw new Error('rama de herramientas sin tool_use pendientes: el paso no debió entrar aquí');

  // Misma regla que `toolsPorRol` de n8n/prompts/ensamblar.mjs, que es lo que
  // el system le promete al modelo: la base del rol MÁS `forense_leer_senal`
  // cuando un especialista está en ronda informada. Si las dos listas se
  // separan, el prompt autoriza una herramienta que el worker rechaza.
  const permitidas = (TOOLS_POR_ROL[rol] || []).slice();
  if (ESPECIALISTAS.indexOf(rol) >= 0 && ronda >= 2 && permitidas.indexOf(SOLO_RONDA_INFORMADA) < 0) {
    permitidas.push(SOLO_RONDA_INFORMADA);
  }
  const items = [];
  let orden = 0;
  for (const id of pendientes) {
    const entrada = cola.filter((t) => t.tool_use_id === id)[0];
    if (!entrada) throw new Error(`tool_use_id ${id} pendiente sin entrada en la cola del checkpoint`);
    const nombre = entrada.nombre;
    // La allowlist es del backend. Que el modelo pida una herramienta que no
    // tiene es una violación del protocolo, no un resultado: el paso FALLA aquí
    // y no se llama a la RPC. No se puede devolver un tool_result de error solo
    // para esa herramienta sin bifurcar el grafo, y bifurcar rompería el lote
    // (ver MANIFEST §2.1). El backend vuelve a comprobar la ACL en la RPC (06):
    // esto es la primera barrera, no la única.
    const autorizada = permitidas.indexOf(nombre) >= 0;
    if (!autorizada) {
      throw new Error(`herramienta no permitida para ${rol} en ronda ${ronda}: ${nombre}`);
    }
    const argumentosModelo = entrada.argumentos && typeof entrada.argumentos === 'object' ? entrada.argumentos : {};
    // Identidad fijada por backend: el modelo nunca elige caso, tarea ni
    // operación (06 §ACL, 17 §1). p_operacion = (tarea_id, paso, tool_use_id).
    const argumentos_backend = Object.assign({}, argumentosModelo, {
      p_tarea: x.tarea_id || null,
      p_caso: x.caso_id || null,
      p_operacion: `${x.tarea_id || x.execution_id}:${x.paso}:${id}`,
    });
    items.push({
      execution_id: x.execution_id || null,
      owner: x.owner || null,
      fencing_token: x.fencing_token || null,
      revision: x.revision === undefined ? null : x.revision,
      caso_id: x.caso_id || null,
      corrida_id: x.corrida_id || null,
      tarea_id: x.tarea_id || null,
      rol,
      paso: x.paso === undefined ? null : x.paso,
      paso_pipeline: x.paso_pipeline || null,
      request_id: x.request_id || null,
      tool_use_id: id,
      nombre,
      orden,
      autorizada,
      argumentos_backend,
      base_rest: x.base_rest || null,
      total_en_lote: pendientes.length,
    });
    orden += 1;
  }
  const salida = { items, total: items.length };
  // <<<CODE_NODE_FIN
  return salida;
}
