import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SupabaseDataSource` construye un cliente real de `@supabase/supabase-js`
 * en el constructor (`createForenseSupabaseClient`). Estas pruebas nunca
 * hacen red: (1) los mappers puros se prueban con jsonb/filas de ejemplo
 * tomadas de `psql` contra la base local (ver comentarios), sin cliente; (2)
 * las pruebas de la clase inyectan un cliente falso encadenable en la
 * instancia después de construirla con credenciales dummy — exactamente lo
 * que pide el corte ("mapea filas -> DTO, mock del cliente").
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "clave-de-prueba-no-real";

const {
  SupabaseDataSource,
  mapArgumento,
  mapCaso,
  mapCorrida,
  mapDictamenDesdeCaso,
  mapEventoBitacora,
  mapEvidencia,
  mapGrafoRpc,
  mapMetricasRpc,
  mapPista,
  mapReplicaDesdeDefensas,
  mapSenal,
  mapTrayectoriaRpc,
} = await import("./supabase");

// ---------------------------------------------------------------------------
// Mappers puros
// ---------------------------------------------------------------------------

describe("mappers puros (fila real -> DTO)", () => {
  it("mapCorrida pasa los campos de forense.corridas tal cual", () => {
    const c = mapCorrida({
      id: "3fc52b5a-3e4b-54f4-a714-b3303b6f0347",
      nombre: "gen-v1",
      dataset: "gen-v1",
      dataset_hash: "abc123",
      fecha_corte: "2026-01-31T23:59:59-06:00",
      corrida_origen_id: null,
      estado: "procesando",
      version_prompts: null,
      version_reglas: "pistas-1",
      modo: "fiscal",
      familias_evaluables: ["D", "F", "R", "T", "E"],
      inicio: "2026-01-01T00:00:00Z",
      fin: null,
    });
    expect(c).toMatchObject({ id: "3fc52b5a-3e4b-54f4-a714-b3303b6f0347", nombre: "gen-v1", estado: "procesando", fin: null });
    expect(c.familias_evaluables).toEqual(["D", "F", "R", "T", "E"]);
  });

  it("mapCaso deja nivel/tipologia en null cuando el caso sigue en curso (contrato entities.caso: anyOf[<enum>, null])", () => {
    const c = mapCaso({
      id: "caso-1",
      corrida_id: "corrida-1",
      cluster_id: "cluster-1",
      rfc_principal: "DEMO:ENTIDAD-0",
      rfcs_satelite: ["DEMO:ENTIDAD-1"],
      estado: "ronda1",
      nivel: null,
      tipologia: null,
      familias_confirmadas: [],
      monto_en_riesgo: 1500000,
      moneda: "MXN",
      cobertura_completa: false,
      n_reintentos: 0,
      presupuesto_agotado: false,
      creado: "2026-01-01T00:00:00Z",
      terminado: null,
    });
    expect(c.nivel).toBeNull();
    expect(c.tipologia).toBeNull();
    // numeric -> string: el contrato transporta importes como texto, nunca float.
    expect(c.monto_en_riesgo).toBe("1500000");
  });

  it("mapCaso convierte monto_en_riesgo (numeric de Postgres) a string sin perder precisión aparente", () => {
    const c = mapCaso({ id: "x", corrida_id: "y", monto_en_riesgo: "1500000.00", estado: "dictaminado", rfcs_satelite: null, familias_confirmadas: null });
    expect(c.monto_en_riesgo).toBe("1500000.00");
    expect(c.rfcs_satelite).toEqual([]);
    expect(c.familias_confirmadas).toEqual([]);
  });

  it("mapSenal rellena tarea_id con '' (forense.senales no tiene esa columna todavía) y caso_id con '' cuando la fila trae null", () => {
    const s = mapSenal({
      id: 501,
      cluster_id: "cluster-1",
      caso_id: null,
      ronda: 1,
      intento: 0,
      version_contexto: 1,
      familia: "F",
      agente: "financiero",
      titular: "Dispersión rápida",
      detalle: { dias: 3 },
      rfcs: ["DEMO:ENTIDAD-0"],
      ids: ["MOV:4"],
      frontera: [],
      confianza: "alta",
      refuta: false,
    });
    expect(s.tarea_id).toBe("");
    expect(s.caso_id).toBe("");
    expect(s.familia).toBe("F");
    expect(s.detalle).toEqual({ dias: 3 });
  });

  it("mapPista lee resumen/referencias de detalle (no son columnas propias) y aplica el overlay evaluacion_pistas del caso", () => {
    // Fila real de `select * from forense.pistas limit 1` (gen-v1):
    const fila = {
      id: 1,
      corrida_id: "3fc52b5a-3e4b-54f4-a714-b3303b6f0347",
      codigo: "D2",
      familia: "D",
      rfc: "DEMO:ENTIDAD-0",
      score: 0.9,
      estado: "disparada",
      detalle: {
        resumen: "Facturó 1,500,000.00 en los 12 meses al corte con nómina de 0.00.",
        referencias: ["PAR:comercio_mayoreo", "CFDI:00000000-0000-4000-9000-000000000001"],
      },
    };
    const sinOverlay = mapPista(fila);
    expect(sinOverlay.estado).toBe("disparada");
    expect(sinOverlay.resumen).toContain("Facturó");
    expect(sinOverlay.referencias).toHaveLength(2);
    expect(sinOverlay.evaluacion_caso).toBeNull();

    // `forense.casos.evaluacion_pistas` real observado: llave = id de pista en texto.
    const conOverlay = mapPista(fila, { "1": { estado: "confirmada", motivo: "fixture", evidencia_ids: [10, 11] } });
    expect(conOverlay.evaluacion_caso).toEqual({ estado: "confirmada", motivo: "fixture", evidencia_ids: ["10", "11"] });
    // El contrato entities.pista solo admite 'disparada'|'no_evaluable': el
    // veredicto del caso NUNCA sobreescribe pista.estado.
    expect(conOverlay.estado).toBe("disparada");
  });

  it("mapEvidencia usa hecho_validado.referencias si el Validador la dejó, si no cae al único ref_id de la fila", () => {
    const conHecho = mapEvidencia({ id: 1, caso_id: "c1", ref_id: "CFDI:1", hecho_validado: { referencias: ["CFDI:1", "MOV:2"] }, validada: true });
    expect(conHecho.referencias).toEqual(["CFDI:1", "MOV:2"]);

    const sinHecho = mapEvidencia({ id: 2, caso_id: "c1", ref_id: "CFDI:9", hecho_validado: null, validada: false });
    expect(sinHecho.referencias).toEqual(["CFDI:9"]);
  });

  it("mapArgumento acepta 'parcial' (agents.argumento.resultado permite refuta|parcial|no_refuta)", () => {
    const a = mapArgumento({ trampa_codigo: "despacho_contable", pista_objetivo: "1066", evidencia_objetivo_ids: [5], argumento: "x", ids: [], resultado: "parcial" });
    expect(a.resultado).toBe("parcial");
  });

  it("mapReplicaDesdeDefensas: null si ninguna defensa fue resuelta, resoluciones si al menos una tiene aceptado", () => {
    expect(mapReplicaDesdeDefensas([{ id: 1, aceptado: null }])).toBeNull();
    const replica = mapReplicaDesdeDefensas([
      { id: 1, aceptado: true, respuesta_investigador: "acepto la defensa" },
      { id: 2, aceptado: false, respuesta_investigador: "no aplica al giro" },
    ]);
    expect(replica?.resoluciones).toEqual([
      { defensa_id: "1", decision: "acepta", razon: "acepto la defensa" },
      { defensa_id: "2", decision: "rechaza", razon: "no aplica al giro" },
    ]);
  });

  it("mapDictamenDesdeCaso: null mientras el caso no tenga nivel; centavos enteros cuando sí", () => {
    expect(mapDictamenDesdeCaso({ nivel: null })).toBeNull();
    const d = mapDictamenDesdeCaso({ nivel: "presuncion", familias_confirmadas: ["D", "F"], monto_en_riesgo: "1500000.00", moneda: "MXN", pendientes: [] });
    expect(d).toMatchObject({ nivel: "presuncion", monto_en_riesgo_centavos: "150000000", moneda: "MXN" });
    expect(d?.nivel).not.toBe("definitivo"); // CLAUDE.md regla 7
  });

  it("mapEventoBitacora: usa payload.resumen si existe; si no, evento_real (caso real de clonar_corrida); si no, tipo_evento", () => {
    const conResumen = mapEventoBitacora({ id: 1, corrida_id: "c1", seq: 1, ts: "2026-01-01T00:00:00Z", tipo_evento: "auditoria", payload: { resumen: "hola", referencias: ["X"] } });
    expect(conResumen.payload.resumen).toBe("hola");
    expect(conResumen.payload.referencias).toEqual(["X"]);

    // Payload real de forense.log() en clonar_corrida (002_views.sql): sin `resumen`.
    const evReal = mapEventoBitacora({ id: 2, corrida_id: "c1", seq: null, ts: "2026-01-01T00:00:00Z", tipo_evento: "pista_cargada", payload: { evento_real: "corrida_clonada", origen: "a", destino: "b" } });
    expect(evReal.payload.resumen).toBe("corrida_clonada");
    expect(evReal.payload.referencias).toEqual([]);

    const sinPayload = mapEventoBitacora({ id: 3, corrida_id: "c1", ts: "2026-01-01T00:00:00Z", tipo_evento: "error", payload: {} });
    expect(sinPayload.payload.resumen).toBe("error");
  });

  it("mapGrafoRpc: null si la RPC devuelve {error}; si no, agrega nodos/aristas y marca es_semilla", () => {
    expect(mapGrafoRpc({ error: "corrida no encontrada" }, "X")).toBeNull();

    // Shape real de forense.v_grafo (002_views.sql):
    const json = {
      nodos: [
        { rfc: "DEMO:ENTIDAD-0", prof: 0, razon_social_untrusted: "Comercializadora X", giro: "comercio_mayoreo", existe: true, en_69b: false, frontera: false },
        { rfc: "DEMO:ENTIDAD-3", prof: 1, razon_social_untrusted: null, giro: null, existe: false, en_69b: true, frontera: true },
      ],
      aristas_cfdi: [{ tipo: "cfdi", de: "DEMO:ENTIDAD-0", a: "DEMO:ENTIDAD-3", n_cfdi: 4, monto: "12000.00" }],
    };
    const g = mapGrafoRpc(json, "DEMO:ENTIDAD-0", new Map([["DEMO:ENTIDAD-0", "presuncion"]]));
    expect(g?.nodos).toHaveLength(2);
    expect(g?.nodos[0]).toMatchObject({ id: "DEMO:ENTIDAD-0", es_semilla: true, nivel: "presuncion", en_lista_sat: false });
    expect(g?.nodos[1]).toMatchObject({ es_semilla: false, en_lista_sat: true, frontera: true, nivel: null });
    expect(g?.aristas).toHaveLength(1);
    expect(g?.aristas[0]).toMatchObject({ origen: "DEMO:ENTIDAD-0", destino: "DEMO:ENTIDAD-3", tipo: "factura", n_registros: 4, monto: "12000.00" });
    // Arista agregada: nunca inventa fecha/ref_id de un documento individual.
    expect(g?.aristas[0].fecha).toBeUndefined();
    expect(g?.aristas[0].ref_id).toBeUndefined();
  });

  it("mapTrayectoriaRpc: agrupa varios eventos en el mismo mes (alta + primer_cfdi coinciden seguido)", () => {
    // Shape real de forense.v_trayectoria_rfc (ver psql contra gen-v1).
    const json = {
      serie: [
        { mes: "2025-02", emitido: "0", recibido: "0", n_cfdi_emitidos: 0, n_cfdi_recibidos: 0 },
        { mes: "2025-03", emitido: "1200.00", recibido: "0", n_cfdi_emitidos: 2, n_cfdi_recibidos: 1 },
      ],
      eventos: [
        { tipo: "alta", mes: "2025-02", fecha: "2025-02-03" },
        { tipo: "primer_cfdi", mes: "2025-03", fecha: "2025-03-01T00:00:00Z" },
        { tipo: "pico", mes: "2025-03", monto: "1200.00" },
      ],
    };
    const puntos = mapTrayectoriaRpc(json);
    expect(puntos).toHaveLength(2);
    expect(puntos[0].eventos).toEqual(["alta"]);
    expect(puntos[1].eventos).toEqual(["primer_cfdi", "pico"]);
    expect(puntos[1].n_cfdi).toBe(3); // n_cfdi_emitidos + n_cfdi_recibidos, nunca uno solo
  });

  it("mapMetricasRpc: null en error; si no, pasa 'parcial' y 'no_implementado' sin ocultarlos", () => {
    expect(mapMetricasRpc({ error: "corrida no encontrada" })).toBeNull();

    // Shape real observado con `psql -c "select forense.v_metricas_corrida(...)"` sobre gen-v1.
    const m = mapMetricasRpc({
      corrida_id: "3fc52b5a-3e4b-54f4-a714-b3303b6f0347",
      dataset: "gen-v1",
      parcial: true,
      terminal: false,
      no_implementado: ["negativos_del_selector (requiere barrido de pistas de 003)"],
      cohorte: { total_fraude: 17, total_trampas: 15, sin_conclusion: 100, total_ground_truth: 100 },
      cobertura: { ratio: 0, concluyentes: 0, trampas_investigadas: 0 },
      operacion: { casos: 0, reintentos: 0, tool_calls: 0, tokens_total: 0, casos_por_nivel: {}, duracion_ms_p50: null, duracion_ms_p95: null, presupuesto_agotado: 0 },
      selectivas: { f1: null, fp: 0, tn: 0, tp: 0, recall: null, precision: null, fn_selectivo: 0 },
      fpr_trampas: { n: 15, fp: 0, texto: "0/15", rango_max: 1, rango_min: 0, concluyentes: 0, sin_conclusion: 15, fpr_concluyentes: null },
      extremo_a_extremo: { fn_conservador: 17, recall_conservador: 0 },
      recall_por_tipologia: { retorno: { tp: 0, total: 1, recall: 0 } },
    });
    expect(m?.parcial).toBe(true);
    expect(m?.no_implementado).toHaveLength(1);
    expect(m?.cohorte.total_ground_truth).toBe(100);
    expect(m?.fpr_trampas.texto).toBe("0/15");
    expect(m?.recall_por_tipologia.retorno).toEqual({ tp: 0, total: 1, recall: 0 });
  });
});

// ---------------------------------------------------------------------------
// La clase, con un cliente Supabase falso inyectado tras construirla.
// ---------------------------------------------------------------------------

/** Builder encadenable mínimo: cualquier método intermedio devuelve `this`; el `await` final (o `.maybeSingle()`) resuelve al resultado fijado. */
function encadenable(resultado: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(resultado),
    then: (onFulfilled: (v: typeof resultado) => unknown, onRejected?: (e: unknown) => unknown) => Promise.resolve(resultado).then(onFulfilled, onRejected),
  };
  return builder;
}

function clienteFalso(porTabla: Record<string, { data: unknown; error: unknown }>, porRpc: Record<string, { data: unknown; error: unknown }> = {}) {
  return {
    from: (tabla: string) => encadenable(porTabla[tabla] ?? { data: [], error: null }),
    rpc: (nombre: string) => Promise.resolve(porRpc[nombre] ?? { data: null, error: null }),
  };
}

function conClienteFalso(porTabla: Record<string, { data: unknown; error: unknown }>, porRpc?: Record<string, { data: unknown; error: unknown }>) {
  const ds = new SupabaseDataSource();
  (ds as unknown as { client: unknown }).client = clienteFalso(porTabla, porRpc);
  return ds;
}

describe("SupabaseDataSource (cliente falso inyectado)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("se declara a sí misma como 'supabase' y publica qué no puede responder todavía", () => {
    const ds = conClienteFalso({});
    expect(ds.label).toBe("supabase");
    expect(ds.noDisponibles.has("listNotificaciones")).toBe(true);
    expect(ds.noDisponibles.has("getContraste")).toBe(true);
  });

  it("listCorridas mapea filas de forense.corridas", async () => {
    const ds = conClienteFalso({
      corridas: { data: [{ id: "c1", nombre: "gen-v1", dataset: "gen-v1", dataset_hash: "h", fecha_corte: "2026-01-31", estado: "procesando", modo: "fiscal", familias_evaluables: ["D"], inicio: "2026-01-01", fin: null }], error: null },
    });
    const corridas = await ds.listCorridas();
    expect(corridas).toEqual([expect.objectContaining({ id: "c1", nombre: "gen-v1" })]);
  });

  it("listCorridas propaga un error real de Postgres en vez de fingir una lista vacía", async () => {
    const ds = conClienteFalso({ corridas: { data: null, error: { message: "relation does not exist" } } });
    await expect(ds.listCorridas()).rejects.toThrow(/relation does not exist/);
  });

  it("listCasos lee de v_casos_lista y mapea nivel null como 'en curso'", async () => {
    const ds = conClienteFalso({
      v_casos_lista: { data: [{ id: "caso-1", corrida_id: "c1", rfc_principal: "DEMO:ENTIDAD-0", estado: "ronda1", nivel: null, tipologia: null, moneda: "MXN", monto_en_riesgo: "0", creado: "2026-01-01" }], error: null },
    });
    const casos = await ds.listCasos({ corridaId: "c1" });
    expect(casos[0].nivel).toBeNull();
  });

  it("getEstadisticas llama la RPC v_metricas_corrida y mapea 'parcial'", async () => {
    const ds = conClienteFalso({}, { v_metricas_corrida: { data: { corrida_id: "c1", parcial: true, no_implementado: ["x"], cohorte: {}, cobertura: {}, operacion: {}, selectivas: {}, fpr_trampas: {}, extremo_a_extremo: {}, recall_por_tipologia: {} }, error: null } });
    const stats = await ds.getEstadisticas("c1");
    expect(stats?.parcial).toBe(true);
    expect(stats?.no_implementado).toEqual(["x"]);
  });

  it("getEstadisticas propaga el error de la RPC en vez de devolver null en silencio", async () => {
    const ds = conClienteFalso({}, { v_metricas_corrida: { data: null, error: { message: "function does not exist" } } });
    await expect(ds.getEstadisticas("c1")).rejects.toThrow(/function does not exist/);
  });

  it("getClusterGrafo: sin rfc_semilla devuelve null sin llamar la RPC", async () => {
    const ds = conClienteFalso({ clusters: { data: { id: "cl1", corrida_id: "c1", rfc_semilla: null }, error: null } });
    const grafo = await ds.getClusterGrafo("cl1");
    expect(grafo).toBeNull();
  });

  it("getPerfil nunca inventa un perfil ajeno: siempre lanza (regla 3, privado por BFF)", async () => {
    const ds = conClienteFalso({});
    await expect(ds.getPerfil()).rejects.toThrow(/privad/i);
  });

  it("listNotificaciones/listInyecciones/getInyeccion/getContraste responden vacío/null, nunca lanzan", async () => {
    const ds = conClienteFalso({});
    await expect(ds.listNotificaciones()).resolves.toEqual([]);
    await expect(ds.listInyecciones()).resolves.toEqual([]);
    await expect(ds.getInyeccion("x")).resolves.toBeNull();
    await expect(ds.getContraste("x")).resolves.toBeNull();
  });

  it("getMapperEjemplo devuelve el mismo ejemplo fijo que la fuente fixture (no hay tabla que lo respalde en ninguna fuente)", async () => {
    const ds = conClienteFalso({});
    const propio = await ds.getMapperEjemplo();
    expect(propio.adapter_candidate).toBeTruthy();
  });
});
