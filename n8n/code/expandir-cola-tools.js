// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/expandir-cola-tools.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Worker: un ítem por tool_use de la respuesta, en orden y con p_operacion de backend (17 §5.5).

const paso = $('Decidir accion').first().json;
const ejecucion = $('Cargar ejecución').first().json;
const x = Object.assign({}, ejecucion, paso, {
  checkpoint: ejecucion.checkpoint,
  base_rest: BASE_REST,
});
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

const permitidas = TOOLS_POR_ROL[rol] || [];
const items = [];
let orden = 0;
for (const id of pendientes) {
  const entrada = cola.filter((t) => t.tool_use_id === id)[0];
  if (!entrada) throw new Error(`tool_use_id ${id} pendiente sin entrada en la cola del checkpoint`);
  const nombre = entrada.nombre;
  // La allowlist es del backend: una herramienta fuera de ella NO se llama,
  // se devuelve como tool_result de error tipificado (17 §5.5).
  const autorizada = permitidas.indexOf(nombre) >= 0
    && !(nombre === SOLO_RONDA_INFORMADA && ESPECIALISTAS.indexOf(rol) >= 0 && ronda < 2);
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
    motivo_denegada: autorizada ? null : `herramienta no permitida para ${rol} en ronda ${ronda}`,
    argumentos_backend,
    base_rest: x.base_rest || null,
    total_en_lote: pendientes.length,
  });
  orden += 1;
}
const salida = { items, total: items.length };
return salida.items.map((json) => ({ json }));
