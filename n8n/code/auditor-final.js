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
// La decisión de nivel se aísla aquí porque se aplica DOS veces con la
// misma regla: una al caso y una por cada RFC del cluster con sus
// evidencias y limitaciones filtradas (07 §135: "El mismo criterio se
// aplica por RFC con sus evidencias/limitaciones filtradas"). Duplicar la
// regla a mano sería la forma más fácil de que el nivel del caso y el del
// RFC dejen de concordar sin que ninguna prueba lo note.
const decidirNivel = (hayCobertura, todasDesc, nEv, nPistas, nFamilias, hayE1) => {
  if (!hayCobertura) return 'no_concluyente';
  if (todasDesc) return 'anomalia_explicada';
  if (nEv === 0 && nPistas === 0) return 'sin_hallazgos';
  if (nFamilias >= 3 || (nFamilias >= 2 && hayE1)) return 'presuncion_alta';
  if (nFamilias >= 2) return 'presuncion';
  return 'no_concluyente';
};
const nivel = decidirNivel(completo, todasDescartadas, ev.length, pistas.length,
  familias.size, e1def);

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

// resultado_por_rfc: el nivel POR RFC del cluster. Nadie lo emitía, así que
// `guardar_dictamen` (db/010) persistía `[]` en todos los casos y la
// columna parecía muerta por diseño cuando en realidad estaba huérfana.
// Hace falta para dos cosas normativas: 13 §2:00-2:45 prohíbe atribuir el
// resultado del caso a todos los integrantes del cluster ("cada RFC lleva
// el suyo en resultado_por_rfc"), y el panel Contraste (21 §2, db/018)
// necesita niveles de vecinos para responder "por qué esta sí y aquella no".
const rfcsCluster = (Array.isArray(x.caso.rfcs_cluster) && x.caso.rfcs_cluster.length > 0)
  ? x.caso.rfcs_cluster
  : [x.caso.rfc_principal, ...(x.caso.rfcs_satelite ?? [])];
const resultado_por_rfc = [...new Set(rfcsCluster.filter(Boolean))].sort().map(rfc => {
  const evRfc = ev.filter(e => (e.rfcs_afectados ?? []).includes(rfc));
  const pistasRfc = pistas.filter(p => p.rfc === rfc);
  const famRfc = new Set(evRfc.map(e => e.familia).filter(f => permitidas.has(f)));
  // Una limitación afecta a este RFC si lo nombra; si no nombra a ninguno,
  // es del caso entero y afecta a todos. Conservador a propósito: una
  // limitación sin objetivo no se descarta por RFC.
  const limRfc = pendientes.filter(p => {
    const rfcs = p.objetivo?.rfcs;
    return !Array.isArray(rfcs) || rfcs.length === 0 || rfcs.includes(rfc);
  });
  const evaluablesRfc = pistasRfc.filter(p => p.estado !== 'no_evaluable');
  const todasDescRfc = evaluablesRfc.length > 0
    && evaluablesRfc.every(p => p.evaluacion_caso?.resultado === 'descartada');
  const e1defRfc = evRfc.some(e => e.pista_codigo === 'E1' && e.familia === 'E'
    && e.hecho_validado?.estatus === 'definitivo'
    && e.hecho_validado?.saltos === 0);
  const coberturaRfc = x.cobertura_completa === true && limRfc.length === 0;
  const nivelRfc = decidirNivel(coberturaRfc, todasDescRfc, evRfc.length,
    pistasRfc.length, famRfc.size, e1defRfc);
  return {
    rfc,
    nivel: nivelRfc,
    // La tipología del caso NO se hereda a un RFC que no llegó a
    // presunción: eso sería exactamente la atribución en bloque que 13
    // prohíbe.
    tipologia: (nivelRfc === 'presuncion' || nivelRfc === 'presuncion_alta')
      ? (x.caso.tipologia ?? null) : null,
    evidencia_ids: evRfc.map(e => e.evidencia_id).filter(v => v !== undefined && v !== null),
    cobertura_completa: coberturaRfc,
  };
});
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
  resultado_por_rfc,
};
return [{ json: salida }];
