// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/despachar-clusters.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Corrida: redespacho por vuelta — llena los slots que se liberaron mientras quede cola (hallazgo alto H11).

const corrida = $('Validar e idempotencia').first().json;
const cola = $input.first().json;
const x = {
  corrida_id: corrida.corrida_id,
  investigacion_id: corrida.investigacion_id ?? null,
  idempotency_base: corrida.idempotency_key,
  max_activos: MAX_ACTIVOS,
  casos_activos: cola.casos_activos,
  pendientes: cola.pendientes ?? [],
};
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
return salida.map((json) => ({ json }));
