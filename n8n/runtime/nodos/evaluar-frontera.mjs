// n8n/runtime/nodos/evaluar-frontera.mjs — fuente del Code node «Evaluar
// frontera y despertar» de FORENSE_investigar_cluster (03, 07 §2.6–2.8).
//
// Tabla de disparo de 03 inlineada (un Code node no importa módulos):
//   R → D y F ; F → D y T ; D → F ; T → R ;
//   E → especialistas de las familias afectadas ;
//   señal con refuta:true → el emisor de la señal refutada.
// Conjunto vacío = se salta la ronda 2 y el cluster pasa a Auditoría.
// La expansión de frontera se usa UNA vez por cluster e incrementa
// version_contexto; nunca reinicia la ronda 1.

export function evaluarFronteraNodo(x) {
  // <<<CODE_NODE_INICIO
  const TABLA_DISPARO = {
    R: ['documental', 'financiero'],
    F: ['documental', 'temporal'],
    D: ['financiero'],
    T: ['relacional'],
    E: [],
  };
  const ROL_POR_FAMILIA = { D: 'documental', F: 'financiero', R: 'relacional', T: 'temporal', E: 'externo' };
  const FAMILIA_POR_ROL = { documental: 'D', financiero: 'F', relacional: 'R', temporal: 'T', externo: 'E' };
  const MAX_EXPANSIONES_POR_CLUSTER = 1;

  const senales = Array.isArray(x.senales) ? x.senales : [];
  const evaluables = new Set(x.familias_evaluables ?? ['D', 'F', 'R', 'T', 'E']);
  const porId = new Map(senales.map((s) => [String(s.id), s]));
  const motivos = {};
  const agregar = (rol, motivo) => {
    if (!rol) return;
    const familia = FAMILIA_POR_ROL[rol];
    if (!familia || !evaluables.has(familia)) return;
    if (!motivos[rol]) motivos[rol] = [];
    motivos[rol].push(motivo);
  };
  for (const senal of senales) {
    if (senal.refuta === true) {
      const objetivo = (senal.refuta_senal_id !== undefined && porId.has(String(senal.refuta_senal_id)))
        ? porId.get(String(senal.refuta_senal_id)).familia
        : (senal.familia_refutada ?? null);
      if (objetivo) agregar(ROL_POR_FAMILIA[objetivo], `refuta:${senal.id}`);
      continue;
    }
    if (senal.familia === 'E') {
      const afectadas = senal.familias_afectadas ?? [...evaluables].filter((f) => f !== 'E');
      for (const f of afectadas) agregar(ROL_POR_FAMILIA[f], `E:${senal.id}`);
      continue;
    }
    for (const rol of (TABLA_DISPARO[senal.familia] ?? [])) agregar(rol, `${senal.familia}:${senal.id}`);
  }
  const despertados = Object.keys(motivos).sort();

  // Frontera material.
  const dentro = new Set(x.rfcs_cluster ?? []);
  const metricas = x.metricas_frontera ?? {};
  const umbral = String(x.umbral_facturacion_centavos ?? '0');
  const candidatos = new Set();
  for (const senal of senales) for (const rfc of (senal.frontera ?? [])) if (!dentro.has(rfc)) candidatos.add(rfc);
  const relevantes = [...candidatos].filter((rfc) => {
    const m = metricas[rfc];
    if (!m) return false;
    if (m.relevante === true) return true;
    if (m.facturacion_centavos === undefined) return false;
    return BigInt(m.facturacion_centavos) > BigInt(umbral);
  }).sort();
  const rutaMaterial = (x.rutas_materiales_cortadas ?? []).filter((rfc) => !dentro.has(rfc)).sort();
  const version_contexto = Number(x.version_contexto ?? 1);
  const cuotaDisponible = Number(x.expansiones_previas ?? 0) < MAX_EXPANSIONES_POR_CLUSTER;
  const cumpleUmbral = relevantes.length >= 2 || rutaMaterial.length >= 1;

  let frontera;
  if (!cumpleUmbral) {
    frontera = {
      expandir: false, motivo: 'frontera_no_significativa', rfcs_nuevos: [],
      version_contexto_nueva: version_contexto, pendientes: [...candidatos].sort(),
      limitaciones: candidatos.size > 0 ? [{
        codigo: 'cobertura_incompleta',
        descripcion: `La cadena continúa hacia ${candidatos.size} RFC no investigados.`,
        referencias: [],
      }] : [],
    };
  } else if (!cuotaDisponible) {
    frontera = {
      expandir: false, motivo: 'cuota_expansion_agotada', rfcs_nuevos: [],
      version_contexto_nueva: version_contexto, pendientes: relevantes,
      limitaciones: [{
        codigo: 'cobertura_incompleta',
        descripcion: `Ya se usó la única expansión del cluster; la cadena continúa hacia ${relevantes.length} RFC no investigados.`,
        referencias: [],
      }],
    };
  } else {
    const nuevos = [...new Set([...relevantes, ...rutaMaterial])].sort();
    frontera = {
      expandir: true,
      motivo: relevantes.length >= 2 ? 'frontera_significativa' : 'ruta_material_cortada',
      rfcs_nuevos: nuevos, version_contexto_nueva: version_contexto + 1,
      pendientes: [], limitaciones: [],
    };
  }

  const porExpansion = frontera.expandir ? (x.roles_por_expansion ?? []) : [];
  const conjunto = [...new Set([...despertados, ...porExpansion])]
    .filter((rol) => evaluables.has(FAMILIA_POR_ROL[rol]))
    .sort();
  const salida = {
    // Identidad del caso: el nodo siguiente crea tareas con ella y no debe
    // volver a resolverla (misma convención que el worker).
    caso_id: x.caso_id ?? null,
    corrida_id: x.corrida_id ?? null,
    cluster_id: x.cluster_id ?? null,
    investigacion_id: x.investigacion_id ?? null,
    despertados: conjunto,
    motivos,
    frontera,
    saltar_ronda2: conjunto.length === 0,
    version_contexto: frontera.version_contexto_nueva,
  };
  // <<<CODE_NODE_FIN
  return salida;
}
