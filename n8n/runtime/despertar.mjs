// n8n/runtime/despertar.mjs — disparo dirigido de ronda 2 y evaluación de frontera (03).
//
// Tabla de disparo (03 «Despertar dirigido»), literal:
//   R (cluster de prestanombres) → D y F
//   F (dispersión o retorno)     → D y T
//   D (sin nómina ni compras)    → F
//   T (cadena timbrada en horas) → R
//   E (69-B definitivo cerca)    → especialistas evaluables afectados
//   cualquiera con refuta:true   → el que emitió la señal refutada
//
// Si nadie dispara a nadie, la ronda 2 se salta y el cluster va al Auditor.
// Frontera: se expande UNA sola vez por cluster, con ≥2 RFC nuevos con
// facturación relevante (o una ruta material cortada por un solo RFC), y la
// expansión INCREMENTA `version_contexto`; no reinicia la ronda 1.

import { ROL_POR_FAMILIA } from './config.mjs';

export const TABLA_DISPARO = Object.freeze({
  R: Object.freeze(['documental', 'financiero']),
  F: Object.freeze(['documental', 'temporal']),
  D: Object.freeze(['financiero']),
  T: Object.freeze(['relacional']),
  E: Object.freeze([]), // se resuelve por familias afectadas
});

export const MAX_EXPANSIONES_POR_CLUSTER = 1;

/**
 * @param {Array} senales señales de la ronda 1 (`familia`, `refuta`, `id`,
 *   `refuta_senal_id?`, `familias_afectadas?`)
 * @param {{familias_evaluables:string[]}} opciones
 * @returns {{despertados:string[], motivos:object, saltar_ronda2:boolean}}
 */
export function calcularDespertados(senales = [], { familias_evaluables = ['D', 'F', 'R', 'T', 'E'] } = {}) {
  const evaluables = new Set(familias_evaluables);
  const porId = new Map(senales.map((s) => [String(s.id), s]));
  const motivos = {};

  const agregar = (rol, motivo) => {
    if (!rol) return;
    const familia = Object.entries(ROL_POR_FAMILIA).find(([, r]) => r === rol)?.[0];
    if (!familia || !evaluables.has(familia)) return;
    (motivos[rol] ??= []).push(motivo);
  };

  for (const senal of senales) {
    const familia = senal.familia;
    if (senal.refuta === true) {
      // Despierta al emisor de la señal refutada, no a la tabla general.
      const objetivo = senal.refuta_senal_id !== undefined && porId.has(String(senal.refuta_senal_id))
        ? porId.get(String(senal.refuta_senal_id)).familia
        : senal.familia_refutada ?? null;
      if (objetivo) agregar(ROL_POR_FAMILIA[objetivo], `refuta:${senal.id}`);
      continue;
    }
    if (familia === 'E') {
      const afectadas = senal.familias_afectadas ?? [...evaluables].filter((f) => f !== 'E');
      for (const f of afectadas) agregar(ROL_POR_FAMILIA[f], `E:${senal.id}`);
      continue;
    }
    for (const rol of TABLA_DISPARO[familia] ?? []) agregar(rol, `${familia}:${senal.id}`);
  }

  const despertados = Object.keys(motivos).sort();
  return { despertados, motivos, saltar_ronda2: despertados.length === 0 };
}

/**
 * Evaluación de frontera. `frontera` de cada señal son RFC fuera del cluster.
 * @param {object} p
 * @param {Array} p.senales
 * @param {string[]} p.rfcs_cluster
 * @param {Record<string, {facturacion_centavos?:string, relevante?:boolean}>} p.metricas_frontera
 * @param {number} p.expansiones_previas
 * @param {number} p.version_contexto
 * @param {string[]} p.rutas_materiales_cortadas RFC que cortan una ruta material
 */
export function evaluarFrontera({
  senales = [], rfcs_cluster = [], metricas_frontera = {}, expansiones_previas = 0,
  version_contexto = 1, rutas_materiales_cortadas = [], umbral_facturacion_centavos = '0',
}) {
  const dentro = new Set(rfcs_cluster);
  const candidatos = new Set();
  for (const senal of senales) {
    for (const rfc of senal.frontera ?? []) if (!dentro.has(rfc)) candidatos.add(rfc);
  }
  const relevantes = [...candidatos].filter((rfc) => {
    const m = metricas_frontera[rfc];
    if (!m) return false;
    if (m.relevante === true) return true;
    if (m.facturacion_centavos === undefined) return false;
    return BigInt(m.facturacion_centavos) > BigInt(umbral_facturacion_centavos);
  }).sort();

  const rutaMaterial = rutas_materiales_cortadas.filter((rfc) => !dentro.has(rfc)).sort();
  const cuotaDisponible = expansiones_previas < MAX_EXPANSIONES_POR_CLUSTER;
  const cumpleUmbral = relevantes.length >= 2 || rutaMaterial.length >= 1;

  if (!cumpleUmbral) {
    return {
      expandir: false,
      motivo: 'frontera_no_significativa',
      rfcs_nuevos: [],
      version_contexto_nueva: version_contexto,
      pendientes: [...candidatos].sort(),
      limitaciones: candidatos.size > 0 ? [{
        codigo: 'cobertura_incompleta',
        descripcion: `La cadena continúa hacia ${candidatos.size} RFC no investigados.`,
        referencias: [],
      }] : [],
    };
  }
  if (!cuotaDisponible) {
    return {
      expandir: false,
      motivo: 'cuota_expansion_agotada',
      rfcs_nuevos: [],
      version_contexto_nueva: version_contexto,
      pendientes: relevantes,
      limitaciones: [{
        codigo: 'cobertura_incompleta',
        descripcion: `Ya se usó la única expansión del cluster; la cadena continúa hacia ${relevantes.length} RFC no investigados.`,
        referencias: [],
      }],
    };
  }
  const nuevos = [...new Set([...relevantes, ...rutaMaterial])].sort();
  return {
    expandir: true,
    motivo: relevantes.length >= 2 ? 'frontera_significativa' : 'ruta_material_cortada',
    rfcs_nuevos: nuevos,
    version_contexto_nueva: version_contexto + 1,
    pendientes: [],
    limitaciones: [],
  };
}

/**
 * Une despertados por señales con los especialistas afectados por una
 * expansión, filtrando familias no evaluables. Conjunto vacío → Auditoría.
 */
export function conjuntoRonda2({ despertados = [], por_expansion = [], familias_evaluables = ['D', 'F', 'R', 'T', 'E'] }) {
  const evaluables = new Set(familias_evaluables);
  const permitido = (rol) => {
    const familia = Object.entries(ROL_POR_FAMILIA).find(([, r]) => r === rol)?.[0];
    return familia ? evaluables.has(familia) : false;
  };
  const union = [...new Set([...despertados, ...por_expansion])].filter(permitido).sort();
  return { roles: union, saltar_ronda2: union.length === 0 };
}
