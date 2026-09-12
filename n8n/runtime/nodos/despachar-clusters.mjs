// n8n/runtime/nodos/despachar-clusters.mjs — fuente de los DOS Code nodes de
// despacho de FORENSE_corrida (17 §2, regla 10).
//
// Hallazgo alto H11: el workflow despachaba hasta MAX_ACTIVOS clusters UNA vez
// y jamás volvía a despachar. Con más clusters que slots, la corrida se quedaba
// dando vueltas en «Esperar y reconciliar» con `cola_restante > 0` para siempre,
// o cerraba con trabajo sin empezar. La cola tiene que drenarse conforme se
// liberan slots, y eso es una DECISIÓN DETERMINISTA sobre dos números que da la
// base (`forense.cola_corrida`): cuántos casos siguen activos y qué clusters
// siguen pendientes. Ni el LLM ni n8n eligen aquí (regla 4).
//
// La MISMA función alimenta el despacho inicial (cola completa, cero casos
// activos) y el redespacho de cada vuelta (cola viva, casos activos reales).
// Dos preámbulos, un solo cuerpo: no hay dos criterios de admisión que puedan
// divergir.
//
// Invariante que sostiene el bucle: la salida NUNCA es vacía. Un Code node que
// devuelve cero ítems detiene su rama en n8n, y con la rama detenida el bucle
// no vuelve al reconciliador y la corrida no cierra nunca. Cuando no hay nada
// que despachar se emite UN ítem con `despachar:false`, y es el IF siguiente
// -no la ausencia de ítems- quien decide si se llama al subworkflow.

export function despacharClustersNodo(x) {
  // <<<CODE_NODE_INICIO
  const entero = (v, porDefecto) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : porDefecto;
  };
  const max = entero(x.max_activos, 0);
  const activos = entero(x.casos_activos, 0);
  const libres = Math.max(0, max - activos);

  // `pendientes` viene del SELECT que replica el predicado de
  // `forense.cola_corrida`: cluster `pendiente` y SIN caso. El orden (score
  // desc, id) lo fija SQL; aquí no se reordena para que la cola despachada y
  // la cola contada sean la misma lista.
  const pendientes = (Array.isArray(x.pendientes) ? x.pendientes : [])
    .filter((p) => p && p.cluster_id);
  const admitidos = pendientes.slice(0, libres);
  const en_cola = pendientes.slice(admitidos.length);

  const base = x.idempotency_base ?? '';
  const comun = {
    corrida_id: x.corrida_id ?? null,
    investigacion_id: x.investigacion_id ?? null,
    max_activos: max,
    casos_activos: activos,
    slots_libres: libres,
    pendientes_totales: pendientes.length,
    admitidos: admitidos.length,
    en_cola: en_cola.length,
    cola_restante: en_cola.map((c) => c.cluster_id),
  };

  const salida = admitidos.length > 0
    ? admitidos.map((c) => Object.assign({}, comun, {
      despachar: true,
      cluster_id: c.cluster_id,
      // Una clave por (corrida, cluster): reintentar la vuelta no duplica casos.
      idempotency_key: `${base}:${c.cluster_id}`,
      motivo: 'slot libre',
    }))
    : [Object.assign({}, comun, {
      despachar: false,
      cluster_id: null,
      idempotency_key: null,
      motivo: pendientes.length === 0 ? 'cola vacia' : 'sin slot libre',
    })];
  // <<<CODE_NODE_FIN
  return salida;
}
