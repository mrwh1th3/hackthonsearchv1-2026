// n8n/runtime/checkpoint.mjs — máquina persistida, CAS y fencing (17 §3, §4).
//
// Estados internos de ejecución (contrato `runtime.checkpoint`):
//   preparar_contexto → solicitar_modelo → ejecutar_herramienta →
//   solicitar_modelo → validar_salida → terminado
// Ramas explícitas: reparar_json, espera_reintento, error, timeout.
//
// El DTO `runtime.checkpoint` de contracts v1 tiene 10 campos y NO admite
// extras (`additionalProperties:false`). El loop necesita además contador de
// reparaciones, intentos de transporte y mensajes: viven en el estado INTERNO
// (`ejecuciones_agente.checkpoint_json` / `llm_solicitudes` de 17 §4) y se
// PROYECTAN al DTO con `aDTO()`. Aquí no se edita el contrato.

export const ESTADOS = Object.freeze([
  'preparar_contexto', 'solicitar_modelo', 'ejecutar_herramienta', 'validar_salida',
  'reparar_json', 'espera_reintento', 'terminado', 'error', 'timeout',
]);

export const ESTADOS_TERMINALES = Object.freeze(['terminado', 'error', 'timeout']);

// evento → estado destino, por estado origen.
export const TRANSICIONES = Object.freeze({
  preparar_contexto: Object.freeze({
    contexto_listo: 'solicitar_modelo',
    contexto_invalido: 'error',
    deadline: 'timeout',
  }),
  solicitar_modelo: Object.freeze({
    tool_use: 'ejecutar_herramienta',
    end_turn: 'validar_salida',
    max_tokens: 'reparar_json',
    // 17 §7: la reparación acotada es UNA. Sin presupuesto de reparación,
    // max_tokens termina con error visible; nunca vuelve a reparar_json.
    max_tokens_agotado: 'error',
    refusal: 'error',
    sin_presupuesto: 'error',
    reintentable: 'espera_reintento',
    ambiguo: 'error',
    deadline: 'timeout',
  }),
  ejecutar_herramienta: Object.freeze({
    resultados_listos: 'solicitar_modelo',
    sin_presupuesto: 'validar_salida',
    error_fatal: 'error',
    deadline: 'timeout',
  }),
  validar_salida: Object.freeze({
    valida: 'terminado',
    invalida: 'reparar_json',
    sin_reparacion: 'error',
    deadline: 'timeout',
  }),
  reparar_json: Object.freeze({
    reparacion_preparada: 'solicitar_modelo',
    sin_presupuesto: 'error',
    deadline: 'timeout',
  }),
  espera_reintento: Object.freeze({
    reintentar: 'solicitar_modelo',
    agotado: 'error',
    deadline: 'timeout',
  }),
  terminado: Object.freeze({}),
  error: Object.freeze({}),
  timeout: Object.freeze({}),
});

export function esTerminal(estado) {
  return ESTADOS_TERMINALES.includes(estado);
}

export function transicionValida(estado, evento) {
  return Boolean(TRANSICIONES[estado]?.[evento]);
}

/** Aplica un evento. Devuelve el nuevo estado o lanza si la transición no existe. */
export function siguiente(estado, evento) {
  const destino = TRANSICIONES[estado]?.[evento];
  if (!destino) throw new Error(`transición inválida: ${estado} --${evento}-->`);
  return destino;
}

/** Estado interno inicial de una ejecución. */
export function nuevoEstadoInterno({
  execution_id, caso_id, tarea_id = null, editor_operacion_id = null, rol,
  paso = 0, revision = 1, fencing_token = '1', context_hash, prompt_hash, deadline_at,
  ronda = 1, intento = 0, version_contexto = 1,
}) {
  return {
    execution_id,
    caso_id,
    tarea_id,
    editor_operacion_id,
    rol,
    ronda,
    intento,
    version_contexto,
    paso,
    revision,
    fencing_token: String(fencing_token),
    estado_interno: 'preparar_contexto',
    context_hash,
    prompt_hash,
    deadline_at,
    pending_tool_use_ids: [],
    mensajes_ref: null,
    // privados (no viajan en el DTO de contratos):
    mensajes: [],
    reparaciones_json: 0,
    intentos_transporte: 0,
    request_id_actual: null,
    salida_valida: null,
    diagnostico: null,
  };
}

/** Proyección al contrato `runtime.checkpoint` (10 campos exactos). */
export function aDTO(interno) {
  return {
    execution_id: interno.execution_id,
    revision: interno.revision,
    paso: interno.paso,
    fencing_token: String(interno.fencing_token),
    estado_interno: interno.estado_interno,
    context_hash: interno.context_hash,
    prompt_hash: interno.prompt_hash,
    deadline_at: interno.deadline_at,
    pending_tool_use_ids: [...interno.pending_tool_use_ids],
    mensajes_ref: interno.mensajes_ref ?? null,
  };
}

/** Avanza el estado interno con un evento, incrementando `paso`. */
export function avanzar(interno, evento) {
  const estado_interno = siguiente(interno.estado_interno, evento);
  return { ...interno, estado_interno, paso: interno.paso + 1 };
}

/** Comparación de fencing tokens: son BIGINT serializados, nunca strings léxicos. */
export function fenceVigente(tokenPresentado, tokenActual) {
  return BigInt(tokenPresentado) >= BigInt(tokenActual);
}

/**
 * Almacén con CAS por (caso_id, paso, revision) y fencing por slot.
 * Implementación en memoria con las firmas de 17 §4; la SQL la entrega
 * forense-db (`claim_step`, `save_checkpoint`, `recover_expired`).
 */
export function crearAlmacenCheckpoints({ lease_ms = 90_000 } = {}) {
  /** @type {Map<string,object>} */
  const slots = new Map();

  const clave = (caso_id, paso) => `${caso_id}|${paso}`;

  /** claim_step(execution_id, owner): reclama el slot y devuelve fencing token. */
  function reclamar({ caso_id, paso, owner, ahora = Date.now() }) {
    const k = clave(caso_id, paso);
    const actual = slots.get(k);
    if (!actual) {
      const slot = {
        caso_id, paso, owner, fencing_token: '1', revision: 1,
        lease_expires_at: ahora + lease_ms, checkpoint: null,
      };
      slots.set(k, slot);
      return { ok: true, fencing_token: slot.fencing_token, revision: slot.revision, owner };
    }
    if (actual.owner === owner && actual.lease_expires_at > ahora) {
      actual.lease_expires_at = ahora + lease_ms; // renovación
      return { ok: true, fencing_token: actual.fencing_token, revision: actual.revision, owner };
    }
    if (actual.lease_expires_at > ahora) {
      return { ok: false, error: { codigo: 'slot_ocupado', mensaje: `lease vigente de ${actual.owner}`, reintentable: true } };
    }
    // Lease vencido: reasignar incrementando el token (17 §4).
    actual.owner = owner;
    actual.fencing_token = (BigInt(actual.fencing_token) + 1n).toString();
    actual.lease_expires_at = ahora + lease_ms;
    return { ok: true, fencing_token: actual.fencing_token, revision: actual.revision, owner, reasignado: true };
  }

  /** save_checkpoint(execution_id, fence, revision_expected, patch). */
  function guardar({ caso_id, paso, fencing_token, revision_esperada, checkpoint, ahora = Date.now() }) {
    const actual = slots.get(clave(caso_id, paso));
    if (!actual) return { ok: false, error: { codigo: 'slot_inexistente', mensaje: 'no hay claim previo', reintentable: false } };
    if (BigInt(fencing_token) < BigInt(actual.fencing_token)) {
      return { ok: false, error: { codigo: 'fence_vencido', mensaje: `token ${fencing_token} < ${actual.fencing_token}`, reintentable: false } };
    }
    if (revision_esperada !== actual.revision) {
      return {
        ok: false,
        error: { codigo: 'conflicto_cas', mensaje: `revision esperada ${revision_esperada}, actual ${actual.revision}`, reintentable: false },
        revision_actual: actual.revision,
      };
    }
    actual.revision += 1;
    actual.checkpoint = { ...checkpoint, revision: actual.revision };
    actual.lease_expires_at = ahora + lease_ms;
    return { ok: true, revision: actual.revision, checkpoint: actual.checkpoint };
  }

  function leer({ caso_id, paso }) {
    return slots.get(clave(caso_id, paso)) ?? null;
  }

  /** recover_expired(now): slots con lease vencido, candidatos a reconciliación. */
  function expirados(ahora = Date.now()) {
    return [...slots.values()]
      .filter((s) => s.lease_expires_at <= ahora)
      .map((s) => ({ caso_id: s.caso_id, paso: s.paso, owner: s.owner, fencing_token: s.fencing_token }));
  }

  return { reclamar, guardar, leer, expirados };
}
