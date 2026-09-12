// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/auditor-final.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Auditor Final (07). Entrada preparada por backend, nunca JSON de agente sin validar.

const x = $input.first().json;
const pistas = x.pistas ?? [];
const ev = (x.evidencia ?? []).filter(e =>
  e.valida_tecnica === true && e.refutada !== true && e.validada === true);
const permitidas = new Set(['D', 'F', 'R', 'T', 'E']);
const familias = new Set(ev.map(e => e.familia).filter(f => permitidas.has(f)));
const pendientes = x.pendientes ?? [];
const prioridades = ['evidencia_invalida', 'contradiccion',
  'defensa_no_considerada', 'cadena_incompleta', 'evidencia_insuficiente'];
const pendiente = prioridades.map(m => pendientes.find(p =>
  p.motivo === m && p.reparable === true && p.objetivo)).find(Boolean);
const puedeReintentar = Number(x.caso.n_reintentos) < 2
  && x.presupuesto.permite_reintento === true;
const rechazo = pendiente && puedeReintentar
  ? { motivo: pendiente.motivo, objetivo: pendiente.objetivo } : null;
const completo = x.cobertura_completa === true && pendientes.length === 0;
// Capa de descarte de falsos positivos. La defensa NO toca el estado
// global de la pista: `forense.pistas.estado` sólo admite
// 'disparada'|'no_evaluable' (001, y el contrato entities.pista dice el
// mismo par), así que comparar contra 'refutada' era una condición
// imposible y `anomalia_explicada` resultaba inalcanzable. El resultado
// de la defensa vive POR CASO en `casos.evaluacion_pistas`, que el
// paquete expone como `evaluacion_caso` indexado por id de pista (017).
// Una pista `no_evaluable` no se pudo descartar porque nunca sostuvo
// nada: no cuenta ni a favor ni en contra del descarte.
const evaluables = pistas.filter(p => p.estado !== 'no_evaluable');
const todasDescartadas = evaluables.length > 0
  && evaluables.every(p => p.evaluacion_caso?.resultado === 'descartada');
const e1def = ev.some(e => e.pista_codigo === 'E1' && e.familia === 'E'
  && e.hecho_validado?.estatus === 'definitivo'
  && e.hecho_validado?.saltos === 0);
let nivel;
if (!completo) nivel = 'no_concluyente';
else if (todasDescartadas) nivel = 'anomalia_explicada';
else if (ev.length === 0 && pistas.length === 0) nivel = 'sin_hallazgos';
else if (familias.size >= 3 || (familias.size >= 2 && e1def)) nivel = 'presuncion_alta';
else if (familias.size >= 2) nivel = 'presuncion';
else nivel = 'no_concluyente';

// monto_centavos: entero decimal resuelto desde NUMERIC de DB, no del modelo.
// El mismo CFDI citado por varias familias cuenta una vez.
const porFactura = new Map();
for (const e of ev.filter(e => e.tipo === 'cfdi')) {
  const centavos = e.hecho_validado?.monto_centavos;
  if (!/^[0-9]+$/.test(String(centavos ?? ''))) {
    throw new Error(`Monto validado ausente/inválido para ${e.ref_id}`);
  }
  const valor = BigInt(centavos);
  if (porFactura.has(e.ref_id) && porFactura.get(e.ref_id) !== valor) {
    throw new Error(`Monto inconsistente para ${e.ref_id}`);
  }
  porFactura.set(e.ref_id, valor);
}
const monto = [...porFactura.values()].reduce((s, v) => s + v, 0n);
const ordenadas = [...familias].sort();
const salida = {
  // Identidad del caso: el dictamen y el reintento la necesitan y no deben
  // volver a resolverla (misma convención de cableado que el worker).
  caso_id: x.caso_id ?? null,
  cluster_id: x.cluster_id ?? null,
  corrida_id: x.corrida_id ?? null,
  investigacion_id: x.investigacion_id ?? null,
  rechazo,
  nivel,
  familias: ordenadas,
  monto_en_riesgo_centavos: monto.toString(),
  regla: `${ordenadas.length} familia(s) sustentadas: ${ordenadas.join(', ')} → ${nivel}`,
  limitaciones: pendientes.map(p => p.motivo),
};
return [{ json: salida }];
