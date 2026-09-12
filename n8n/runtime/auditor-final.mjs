// n8n/runtime/auditor-final.mjs — Auditor Final determinista (03 «El Auditor Final», 07 «Code node»).
//
// AQUÍ VIVE EL CRITERIO Y CERO LLAMADAS AL MODELO. El LLM no calcula ni decide
// el nivel: los números salen de SQL y el dictamen de este código.
//
// La región entre los marcadores CODE_NODE es la ÚNICA fuente del Code node de
// n8n: `node n8n/runtime/generar-code-nodes.mjs` produce `n8n/code/auditor-final.js`
// desde este texto. No editar el .js a mano; un test compara ambos.
//
// Nota sobre la palabra «definitivo»: aparece SOLO como `hecho_validado.estatus`,
// que es el estatus de la lista 69-B del SAT en el dato de ENTRADA (E1 directo).
// Nunca es un nivel de salida: el máximo que produce esta función es
// `presuncion_alta` (regla 7 de CLAUDE.md).

export const NIVELES = Object.freeze(['sin_hallazgos', 'anomalia_explicada', 'no_concluyente', 'presuncion', 'presuncion_alta']);

export function dictaminar(x) {
  // <<<CODE_NODE_INICIO
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
  const todasRefutadas = pistas.length > 0
    && pistas.every(p => p.estado === 'refutada');
  const e1def = ev.some(e => e.pista_codigo === 'E1' && e.familia === 'E'
    && e.hecho_validado?.estatus === 'definitivo'
    && e.hecho_validado?.saltos === 0);
  let nivel;
  if (!completo) nivel = 'no_concluyente';
  else if (todasRefutadas) nivel = 'anomalia_explicada';
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
    rechazo,
    nivel,
    familias: ordenadas,
    monto_en_riesgo_centavos: monto.toString(),
    regla: `${ordenadas.length} familia(s) sustentadas: ${ordenadas.join(', ')} → ${nivel}`,
    limitaciones: pendientes.map(p => p.motivo),
  };
  // <<<CODE_NODE_FIN
  return salida;
}
