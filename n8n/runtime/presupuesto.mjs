// n8n/runtime/presupuesto.mjs — presupuesto por caso con reserva real (03 «Presupuestos», 17 §6, 06 «control de presupuesto»).
//
// Fuente única de números: 03. Este módulo NO inventa límites alternativos.
//  - Por caso: 120 llamadas a herramientas y 100 solicitudes LLM, reintentos incluidos.
//  - Bolsas separadas investigación / cierre. La de cierre solo se libera a su
//    rol; agotar la investigación no toca la reserva.
//  - Reserva de cierre: 27 herramientas (Auditor 12, Defensor 15) y 34 requests
//    (Auditor 13, Defensor 16, Réplica 2, Redactor 3).
//  - Cuotas por rol y ronda: D/F/R 8/4, T 6/3, E 4/2; Auditor 12, Defensor 15.
//  - Un cache hit consume herramienta igual que una consulta nueva.
//  - Una reparación de JSON pertenece a la bolsa del rol que la provocó.
//  - Entrar en reintento forense NO concede 100 requests nuevos.

export const LIMITES_CASO = Object.freeze({ tools: 120, requests: 100 });

export const RESERVA_CIERRE_TOOLS = Object.freeze({ auditor: 12, defensor: 15 });
export const RESERVA_CIERRE_REQUESTS = Object.freeze({ auditor: 13, defensor: 16, replica: 2, redactor: 3 });

export const TOTAL_RESERVA_CIERRE_TOOLS = Object.values(RESERVA_CIERRE_TOOLS).reduce((a, b) => a + b, 0); // 27
export const TOTAL_RESERVA_CIERRE_REQUESTS = Object.values(RESERVA_CIERRE_REQUESTS).reduce((a, b) => a + b, 0); // 34

// Cuota de herramientas por tarea. Clave: rol → ronda → tope.
export const CUOTA_TOOLS_TAREA = Object.freeze({
  documental: Object.freeze({ 1: 8, 2: 4 }),
  financiero: Object.freeze({ 1: 8, 2: 4 }),
  relacional: Object.freeze({ 1: 8, 2: 4 }),
  temporal: Object.freeze({ 1: 6, 2: 3 }),
  externo: Object.freeze({ 1: 4, 2: 2 }),
  auditor: Object.freeze({ 1: 12, 2: 12 }),
  defensor: Object.freeze({ 1: 15, 2: 15 }),
  replica: Object.freeze({ 1: 0, 2: 0 }),
  redactor: Object.freeze({ 1: 0, 2: 0 }),
  editor: Object.freeze({ 1: 0, 2: 0 }),
});

const ROLES_CIERRE_TOOLS = new Set(Object.keys(RESERVA_CIERRE_TOOLS));
const ROLES_CIERRE_REQUESTS = new Set(Object.keys(RESERVA_CIERRE_REQUESTS));

function errorPresupuesto(detalle) {
  return {
    ok: false,
    error: { codigo: 'presupuesto_agotado', mensaje: detalle, reintentable: false },
  };
}

/**
 * Presupuesto de un caso. `consumido` permite rehidratar desde DB tras un
 * reintento: los contadores NO se reinician.
 */
export function crearPresupuesto({ caso_id, consumido = null } = {}) {
  const estado = {
    caso_id: caso_id ?? null,
    tools: {
      investigacion: LIMITES_CASO.tools - TOTAL_RESERVA_CIERRE_TOOLS, // 93
      cierre: { ...RESERVA_CIERRE_TOOLS },
      usadas: 0,
      cache_hits: 0,
    },
    requests: {
      investigacion: LIMITES_CASO.requests - TOTAL_RESERVA_CIERRE_REQUESTS, // 66
      cierre: { ...RESERVA_CIERRE_REQUESTS },
      usados: 0,
      reparaciones: 0,
    },
    por_tarea: new Map(),
    n_reintentos: 0,
  };
  if (consumido) rehidratar(estado, consumido);

  function claveTarea({ tarea_id, rol, ronda, intento = 0, version_contexto = 1 }) {
    return tarea_id ? `T:${tarea_id}` : `R:${rol}|${ronda}|${intento}|${version_contexto}`;
  }

  function usadasTarea(clave) {
    return estado.por_tarea.get(clave) ?? 0;
  }

  /**
   * Reserva una herramienta ANTES de ejecutarla. Un cache hit también reserva.
   * @returns {{ok:true, bolsa:string, restantes_tarea:number, restantes_caso:number}|{ok:false,error:object}}
   */
  function reservarTool({ rol, ronda = 1, tarea_id = null, intento = 0, version_contexto = 1, cache_hit = false }) {
    const topeTarea = CUOTA_TOOLS_TAREA[rol]?.[ronda];
    if (topeTarea === undefined) return errorPresupuesto(`rol/ronda sin cuota definida: ${rol}/${ronda}`);
    if (topeTarea === 0) return errorPresupuesto(`el rol ${rol} no usa herramientas`);
    const clave = claveTarea({ tarea_id, rol, ronda, intento, version_contexto });
    if (usadasTarea(clave) >= topeTarea) {
      return errorPresupuesto(`cuota por tarea agotada para ${rol} ronda ${ronda} (${topeTarea})`);
    }
    if (estado.tools.usadas >= LIMITES_CASO.tools) {
      return errorPresupuesto('tope de 120 herramientas por caso alcanzado');
    }
    let bolsa;
    if (ROLES_CIERRE_TOOLS.has(rol) && estado.tools.cierre[rol] > 0) {
      estado.tools.cierre[rol] -= 1;
      bolsa = `cierre:${rol}`;
    } else if (estado.tools.investigacion > 0) {
      estado.tools.investigacion -= 1;
      bolsa = 'investigacion';
    } else {
      return errorPresupuesto(`sin saldo de herramientas para ${rol}`);
    }
    estado.tools.usadas += 1;
    if (cache_hit) estado.tools.cache_hits += 1;
    estado.por_tarea.set(clave, usadasTarea(clave) + 1);
    return {
      ok: true,
      bolsa,
      restantes_tarea: topeTarea - usadasTarea(clave),
      restantes_caso: LIMITES_CASO.tools - estado.tools.usadas,
    };
  }

  /**
   * Reserva una solicitud LLM. `motivo='reparacion'` consume de la MISMA bolsa
   * del rol (17 §6); no existe una bolsa de reparaciones aparte.
   */
  function reservarRequest({ rol, motivo = 'turno' }) {
    if (estado.requests.usados >= LIMITES_CASO.requests) {
      return errorPresupuesto('tope de 100 solicitudes LLM por caso alcanzado');
    }
    let bolsa;
    if (ROLES_CIERRE_REQUESTS.has(rol) && estado.requests.cierre[rol] > 0) {
      estado.requests.cierre[rol] -= 1;
      bolsa = `cierre:${rol}`;
    } else if (estado.requests.investigacion > 0) {
      estado.requests.investigacion -= 1;
      bolsa = 'investigacion';
    } else {
      return errorPresupuesto(`sin saldo de solicitudes para ${rol}`);
    }
    estado.requests.usados += 1;
    if (motivo === 'reparacion') estado.requests.reparaciones += 1;
    return { ok: true, bolsa, restantes_caso: LIMITES_CASO.requests - estado.requests.usados };
  }

  /** Límites que viajan en `contexto.limites` (17 §7). */
  function limitesPara({ rol, ronda = 1, tarea_id = null, intento = 0, version_contexto = 1 }) {
    const topeTarea = CUOTA_TOOLS_TAREA[rol]?.[ronda] ?? 0;
    const clave = claveTarea({ tarea_id, rol, ronda, intento, version_contexto });
    const disponiblesCaso = ROLES_CIERRE_TOOLS.has(rol)
      ? estado.tools.cierre[rol] + estado.tools.investigacion
      : estado.tools.investigacion;
    const requestsDisponibles = ROLES_CIERRE_REQUESTS.has(rol)
      ? estado.requests.cierre[rol] + estado.requests.investigacion
      : estado.requests.investigacion;
    return {
      tools_restantes: Math.max(0, Math.min(topeTarea - usadasTarea(clave), disponiblesCaso)),
      requests_restantes: Math.max(0, Math.min(requestsDisponibles, LIMITES_CASO.requests - estado.requests.usados)),
    };
  }

  /** Entrar en reintento forense conserva contadores; nunca concede 100 nuevos. */
  function entrarReintento() {
    if (estado.n_reintentos >= 2) {
      return { ok: false, error: { codigo: 'reintentos_agotados', mensaje: 'n_reintentos >= 2', reintentable: false } };
    }
    estado.n_reintentos += 1;
    return { ok: true, intento: estado.n_reintentos, requests_restantes: LIMITES_CASO.requests - estado.requests.usados };
  }

  function permiteReintento() {
    return estado.n_reintentos < 2
      && estado.requests.usados < LIMITES_CASO.requests
      && estado.tools.usadas < LIMITES_CASO.tools;
  }

  function instantanea() {
    return {
      caso_id: estado.caso_id,
      tools: {
        usadas: estado.tools.usadas,
        cache_hits: estado.tools.cache_hits,
        investigacion_restante: estado.tools.investigacion,
        cierre_restante: { ...estado.tools.cierre },
      },
      requests: {
        usados: estado.requests.usados,
        reparaciones: estado.requests.reparaciones,
        investigacion_restante: estado.requests.investigacion,
        cierre_restante: { ...estado.requests.cierre },
      },
      n_reintentos: estado.n_reintentos,
      por_tarea: Object.fromEntries(estado.por_tarea),
      presupuesto_agotado: estado.tools.usadas >= LIMITES_CASO.tools || estado.requests.usados >= LIMITES_CASO.requests,
    };
  }

  return { reservarTool, reservarRequest, limitesPara, entrarReintento, permiteReintento, instantanea };
}

function rehidratar(estado, consumido) {
  estado.tools.usadas = consumido.tools?.usadas ?? 0;
  estado.tools.cache_hits = consumido.tools?.cache_hits ?? 0;
  if (consumido.tools?.investigacion_restante !== undefined) estado.tools.investigacion = consumido.tools.investigacion_restante;
  if (consumido.tools?.cierre_restante) estado.tools.cierre = { ...consumido.tools.cierre_restante };
  estado.requests.usados = consumido.requests?.usados ?? 0;
  estado.requests.reparaciones = consumido.requests?.reparaciones ?? 0;
  if (consumido.requests?.investigacion_restante !== undefined) estado.requests.investigacion = consumido.requests.investigacion_restante;
  if (consumido.requests?.cierre_restante) estado.requests.cierre = { ...consumido.requests.cierre_restante };
  estado.n_reintentos = consumido.n_reintentos ?? 0;
  for (const [k, v] of Object.entries(consumido.por_tarea ?? {})) estado.por_tarea.set(k, v);
}
