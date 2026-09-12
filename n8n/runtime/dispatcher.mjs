// n8n/runtime/dispatcher.mjs — avance de la máquina desde DB (17 §3 y §4).
//
// El dispatcher NO investiga y NO hace red: reclama un paso, ejecuta UN paso
// acotado (la función `ejecutarPaso` inyectada), guarda checkpoint con CAS y
// fencing, y termina. El bucle de reintento y el trabajo del modelo viven en
// loop.mjs; aquí solo está el gobierno del avance.
//
// Contrato de helpers congelado en 17 §4 (nombres SQL, no camelCase):
//   claim_step(execution_id, owner)
//   reserve_request(execution_id, fence, request_id)
//   claim_tool(execution_id, fence, request_id, tool_use_id, args_hash)
//   save_checkpoint(execution_id, fence, revision_expected, patch)
//   finish_step(execution_id, fence, estado, resultado)
//   advance_case_if_ready(caso_id, revision_expected)
//   recover_expired(now)
//
// Orden de locks FIJO: caso → ejecución → cuota/slot (17 §4). La implementación
// en memoria de este archivo lo respeta para que la versión SQL de forense-db
// pueda copiar el mismo orden y no se inventen deadlocks nuevos.
//
// Reglas que el dispatcher hace cumplir:
//  - Un proceso con lease vencido NO puede guardar: el fencing token lo frena.
//  - Cancelación detiene los próximos pasos; un resultado tardío no reabre el
//    caso (17 §3).
//  - Una tarea sin slot queda PENDIENTE, nunca fallida.
//  - Reejecutar un paso ya commiteado no repite la mutación: la idempotencia
//    vive en el ledger (request_id / tool_use_id), no en el dispatcher.

import { esTerminal } from './checkpoint.mjs';

export const ESTADOS_TAREA = Object.freeze(['pendiente', 'ejecutando', 'completada', 'error', 'timeout', 'omitida']);

export const LEASE_MS = 90_000;

/**
 * Implementación en memoria de los helpers de 17 §4. Sustituible por las
 * funciones SQL de forense-db sin tocar el dispatcher: mismos nombres, mismos
 * argumentos, mismas formas de retorno.
 */
export function crearHelpersEnMemoria({ lease_ms = LEASE_MS, max_slots = 8 } = {}) {
  /** @type {Map<string, object>} ejecuciones_agente */
  const ejecuciones = new Map();
  /** @type {Map<string, object>} casos */
  const casos = new Map();
  /** @type {Map<string, object>} tareas_agente */
  const tareas = new Map();
  /** @type {Map<string, object>} llm_solicitudes */
  const solicitudes = new Map();
  /** @type {Map<string, object>} tool_ejecuciones */
  const herramientas = new Map();
  /** @type {Map<string, object>} pasos_pipeline */
  const pasos = new Map();

  const errorDe = (codigo, mensaje, reintentable = false) => ({ ok: false, error: { codigo, mensaje, reintentable } });

  function sembrarCaso(caso) {
    casos.set(caso.id, { estado: 'investigando', revision: 1, cancelado: false, ...caso });
    return casos.get(caso.id);
  }

  function sembrarEjecucion(ejecucion) {
    const registro = {
      estado_interno: 'preparar_contexto',
      paso: 0,
      revision: 1,
      fencing_token: '0',
      owner: null,
      lease_expires_at: 0,
      checkpoint_json: null,
      ...ejecucion,
    };
    ejecuciones.set(registro.id, registro);
    if (registro.tarea_id) {
      tareas.set(registro.tarea_id, {
        id: registro.tarea_id,
        caso_id: registro.caso_id,
        ronda: registro.ronda ?? 1,
        intento: registro.intento ?? 0,
        estado: 'pendiente',
        ...(tareas.get(registro.tarea_id) ?? {}),
      });
    }
    return registro;
  }

  function registrarBarrera({ caso_id, paso, revision = 1, tareas_esperadas, deadline = null }) {
    const clave = `${caso_id}|${paso}`;
    pasos.set(clave, { caso_id, paso, revision, tareas_esperadas: [...tareas_esperadas], estado: 'esperando', deadline, avanzado: false });
    return pasos.get(clave);
  }

  function slotsOcupados(ahora) {
    return [...ejecuciones.values()].filter((e) => e.owner !== null && e.lease_expires_at > ahora && !esTerminal(e.estado_interno)).length;
  }

  /** claim_step: lock de caso → ejecución → slot, en ese orden. */
  function claim_step({ execution_id, owner, ahora = Date.now() }) {
    const ejecucion = ejecuciones.get(execution_id);
    if (!ejecucion) return errorDe('ejecucion_inexistente', `no existe ${execution_id}`);
    // 1) caso
    const caso = casos.get(ejecucion.caso_id);
    if (caso?.cancelado) return errorDe('caso_cancelado', 'cancelación detiene los próximos pasos');
    // 2) ejecución
    if (esTerminal(ejecucion.estado_interno)) {
      return errorDe('paso_terminal', `el paso ya está en ${ejecucion.estado_interno}`);
    }
    const mismoOwner = ejecucion.owner === owner;
    const leaseVigente = ejecucion.lease_expires_at > ahora;
    if (leaseVigente && !mismoOwner) {
      // Sin slot ≠ fallida: queda pendiente y el reconciliador la retoma.
      return { ...errorDe('slot_ocupado', `lease vigente de ${ejecucion.owner}`, true), pendiente: true };
    }
    // 3) cuota/slot global
    if (!mismoOwner && !leaseVigente && slotsOcupados(ahora) >= max_slots) {
      return { ...errorDe('sin_slot', `límite de ${max_slots} pasos activos`, true), pendiente: true };
    }
    if (!leaseVigente && ejecucion.owner !== null && !mismoOwner) {
      // Reasignación tras lease vencido: el token SUBE y el dueño viejo queda fuera.
      ejecucion.fencing_token = (BigInt(ejecucion.fencing_token) + 1n).toString();
    } else if (ejecucion.owner === null) {
      ejecucion.fencing_token = (BigInt(ejecucion.fencing_token) + 1n).toString();
    }
    ejecucion.owner = owner;
    ejecucion.lease_expires_at = ahora + lease_ms;
    if (ejecucion.tarea_id && tareas.has(ejecucion.tarea_id)) {
      const tarea = tareas.get(ejecucion.tarea_id);
      if (tarea.estado === 'pendiente') tarea.estado = 'ejecutando';
    }
    return {
      ok: true,
      execution_id,
      owner,
      fencing_token: ejecucion.fencing_token,
      revision: ejecucion.revision,
      paso: ejecucion.paso,
      estado_interno: ejecucion.estado_interno,
      checkpoint: ejecucion.checkpoint_json,
      lease_expires_at: ejecucion.lease_expires_at,
    };
  }

  function vigente(ejecucion, fence) {
    return BigInt(fence) >= BigInt(ejecucion.fencing_token);
  }

  function reserve_request({ execution_id, fence, request_id, paso = null }) {
    const ejecucion = ejecuciones.get(execution_id);
    if (!ejecucion) return errorDe('ejecucion_inexistente', execution_id);
    if (!vigente(ejecucion, fence)) return errorDe('fence_vencido', `token ${fence} < ${ejecucion.fencing_token}`);
    const existente = solicitudes.get(request_id);
    if (existente) return { ok: true, nuevo: false, solicitud: existente };
    const solicitud = { request_id, execution_id, paso, estado: 'reservado', intento_transporte: 0 };
    solicitudes.set(request_id, solicitud);
    return { ok: true, nuevo: true, solicitud };
  }

  function claim_tool({ execution_id, fence, request_id, tool_use_id, args_hash }) {
    const ejecucion = ejecuciones.get(execution_id);
    if (!ejecucion) return errorDe('ejecucion_inexistente', execution_id);
    if (!vigente(ejecucion, fence)) return errorDe('fence_vencido', `token ${fence} < ${ejecucion.fencing_token}`);
    const clave = `${request_id} ${tool_use_id}`;
    const existente = herramientas.get(clave);
    // Unicidad (request_id, tool_use_id): la reentrega devuelve lo guardado y
    // NO vuelve a mutar ni a consumir cuota (17 §4 y §6).
    if (existente) return { ok: true, nuevo: false, registro: existente };
    const registro = { execution_id, request_id, tool_use_id, args_hash, estado: 'reservada', resultado: null };
    herramientas.set(clave, registro);
    return { ok: true, nuevo: true, registro };
  }

  function save_checkpoint({ execution_id, fence, revision_expected, patch, ahora = Date.now() }) {
    const ejecucion = ejecuciones.get(execution_id);
    if (!ejecucion) return errorDe('ejecucion_inexistente', execution_id);
    if (BigInt(fence) < BigInt(ejecucion.fencing_token)) {
      return errorDe('fence_vencido', `token ${fence} < ${ejecucion.fencing_token}`);
    }
    if (revision_expected !== ejecucion.revision) {
      return { ...errorDe('conflicto_cas', `revision esperada ${revision_expected}, actual ${ejecucion.revision}`), revision_actual: ejecucion.revision };
    }
    ejecucion.revision += 1;
    ejecucion.paso = patch.paso ?? ejecucion.paso;
    ejecucion.estado_interno = patch.estado_interno ?? ejecucion.estado_interno;
    ejecucion.checkpoint_json = { ...patch, revision: ejecucion.revision };
    ejecucion.lease_expires_at = ahora + lease_ms;
    return { ok: true, revision: ejecucion.revision, checkpoint: ejecucion.checkpoint_json };
  }

  function finish_step({ execution_id, fence, estado, resultado = null, ahora = Date.now() }) {
    const ejecucion = ejecuciones.get(execution_id);
    if (!ejecucion) return errorDe('ejecucion_inexistente', execution_id);
    if (BigInt(fence) < BigInt(ejecucion.fencing_token)) {
      return errorDe('fence_vencido', `token ${fence} < ${ejecucion.fencing_token}`);
    }
    if (!ESTADOS_TAREA.includes(estado)) return errorDe('estado_invalido', estado);
    ejecucion.owner = null;
    ejecucion.lease_expires_at = 0;
    ejecucion.resultado = resultado;
    if (ejecucion.tarea_id && tareas.has(ejecucion.tarea_id)) {
      const tarea = tareas.get(ejecucion.tarea_id);
      // Un resultado tardío no reabre una tarea ya terminal.
      if (!['completada', 'error', 'timeout', 'omitida'].includes(tarea.estado)) {
        tarea.estado = estado;
        tarea.terminado_at = ahora;
      }
    }
    return { ok: true, estado, tarea_id: ejecucion.tarea_id ?? null };
  }

  /** advance_case_if_ready: la barrera es el conjunto exacto, y avanza UNA vez. */
  function advance_case_if_ready({ caso_id, paso, revision_expected = null, ahora = Date.now() }) {
    const clave = `${caso_id}|${paso}`;
    const barrera = pasos.get(clave);
    if (!barrera) return errorDe('barrera_inexistente', clave);
    if (revision_expected !== null && revision_expected !== barrera.revision) {
      return { ...errorDe('conflicto_cas', `revision esperada ${revision_expected}, actual ${barrera.revision}`), revision_actual: barrera.revision };
    }
    const faltantes = barrera.tareas_esperadas.filter((id) => {
      const tarea = tareas.get(id);
      return !tarea || !['completada', 'error', 'timeout', 'omitida'].includes(tarea.estado);
    });
    const vencida = barrera.deadline ? ahora >= Date.parse(barrera.deadline) : false;
    if (faltantes.length > 0 && !vencida) {
      return { ok: true, avanza: false, faltantes, estado: 'esperando' };
    }
    if (barrera.avanzado) return { ok: true, avanza: false, motivo: 'ya_avanzada', faltantes };
    barrera.avanzado = true;
    barrera.revision += 1;
    barrera.estado = vencida && faltantes.length > 0 ? 'vencida' : 'completa';
    return { ok: true, avanza: true, estado: barrera.estado, faltantes, revision: barrera.revision };
  }

  /** recover_expired: candidatos a reconciliación, sin tocarlos todavía. */
  function recover_expired({ ahora = Date.now() } = {}) {
    return [...ejecuciones.values()]
      .filter((e) => e.owner !== null && e.lease_expires_at <= ahora && !esTerminal(e.estado_interno))
      .map((e) => ({
        execution_id: e.id,
        caso_id: e.caso_id,
        tarea_id: e.tarea_id ?? null,
        owner: e.owner,
        fencing_token: e.fencing_token,
        estado_interno: e.estado_interno,
      }));
  }

  function cancelar(caso_id) {
    const caso = casos.get(caso_id);
    if (caso) caso.cancelado = true;
    return caso;
  }

  return {
    claim_step, reserve_request, claim_tool, save_checkpoint, finish_step,
    advance_case_if_ready, recover_expired,
    // superficie de prueba/inspección, no parte del contrato de 17 §4:
    _estado: { ejecuciones, casos, tareas, solicitudes, herramientas, pasos },
    sembrarCaso, sembrarEjecucion, registrarBarrera, cancelar,
  };
}

/**
 * Dispatcher: avanza la máquina UN paso por invocación.
 *
 * @param {object} p
 * @param {object} p.helpers implementación de 17 §4 (en memoria o SQL)
 * @param {(entrada:object) => Promise<object>} p.ejecutarPaso ejecuta un paso acotado y
 *   devuelve `{checkpoint, estado_interno, estado_tarea?, resultado?}`
 */
export function crearDispatcher({ helpers, ejecutarPaso, ahora = () => Date.now(), registrar = () => {} }) {
  async function avanzar({ execution_id, owner }) {
    const claim = helpers.claim_step({ execution_id, owner, ahora: ahora() });
    if (!claim.ok) {
      registrar({ tipo_evento: 'paso_no_reclamado', payload: { execution_id, owner, error: claim.error } });
      // Sin slot = pendiente, no fallida (17 §3).
      return { avanzo: false, pendiente: claim.pendiente === true, error: claim.error };
    }

    let paso;
    try {
      paso = await ejecutarPaso({
        execution_id,
        owner,
        fencing_token: claim.fencing_token,
        revision: claim.revision,
        checkpoint: claim.checkpoint,
        estado_interno: claim.estado_interno,
        helpers,
      });
    } catch (err) {
      // Una excepción del paso es DATO: se guarda y el caso no queda colgado.
      paso = {
        estado_interno: 'error',
        checkpoint: { ...(claim.checkpoint ?? {}), estado_interno: 'error' },
        estado_tarea: 'error',
        resultado: { codigo: 'fallo_paso', mensaje: err?.message ?? String(err) },
      };
    }

    const guardado = helpers.save_checkpoint({
      execution_id,
      fence: claim.fencing_token,
      revision_expected: claim.revision,
      patch: { ...paso.checkpoint, estado_interno: paso.estado_interno },
      ahora: ahora(),
    });
    if (!guardado.ok) {
      // Fence vencido o CAS perdido: otro proceso mandó. No se reintenta a ciegas.
      registrar({ tipo_evento: 'checkpoint_rechazado', payload: { execution_id, error: guardado.error } });
      return { avanzo: false, pendiente: false, error: guardado.error };
    }
    registrar({ tipo_evento: 'checkpoint_guardado', payload: { execution_id, revision: guardado.revision, estado_interno: paso.estado_interno } });

    if (!esTerminal(paso.estado_interno)) {
      // Dispatcher inmediato: hay más paso que dar, pero en OTRA ejecución.
      return { avanzo: true, terminal: false, revision: guardado.revision, estado_interno: paso.estado_interno, redespachar: true };
    }

    const fin = helpers.finish_step({
      execution_id,
      fence: claim.fencing_token,
      estado: paso.estado_tarea ?? (paso.estado_interno === 'terminado' ? 'completada' : paso.estado_interno),
      resultado: paso.resultado ?? null,
      ahora: ahora(),
    });
    if (!fin.ok) return { avanzo: true, terminal: true, error: fin.error };
    registrar({ tipo_evento: 'paso_finalizado', payload: { execution_id, estado: fin.estado } });

    let barrera = null;
    if (paso.caso_id && paso.paso_pipeline) {
      barrera = helpers.advance_case_if_ready({ caso_id: paso.caso_id, paso: paso.paso_pipeline, ahora: ahora() });
      if (barrera.avanza) registrar({ tipo_evento: 'barrera_avanza', payload: { caso_id: paso.caso_id, paso: paso.paso_pipeline } });
    }
    return { avanzo: true, terminal: true, revision: guardado.revision, estado_interno: paso.estado_interno, barrera, redespachar: false };
  }

  /** Avanza hasta estado terminal o hasta quedarse sin avanzar. Cota dura de vueltas. */
  async function correrHastaTerminal({ execution_id, owner, max_pasos = 32 }) {
    const historia = [];
    for (let i = 0; i < max_pasos; i += 1) {
      const r = await avanzar({ execution_id, owner });
      historia.push(r);
      if (!r.avanzo || r.terminal) return { historia, pasos: historia.length, terminal: r.terminal === true };
    }
    return { historia, pasos: historia.length, terminal: false, motivo: 'max_pasos' };
  }

  /** Reconciliador: recupera leases vencidos (17 §3, cada 10 s en n8n). */
  function reconciliar({ owner = 'reconciliador' } = {}) {
    const expirados = helpers.recover_expired({ ahora: ahora() });
    registrar({ tipo_evento: 'reconciliacion', payload: { expirados: expirados.length } });
    return expirados.map((e) => ({ ...e, redespachar_como: owner }));
  }

  return { avanzar, correrHastaTerminal, reconciliar };
}
