import { createClient } from "@supabase/supabase-js";
import type {
  Argumento,
  Caso,
  ClusterResumen,
  ContrasteCaso,
  Corrida,
  EventoForense,
  Familia,
  GrafoArista,
  GrafoCluster,
  GrafoNodo,
  InyeccionResumen,
  Investigacion,
  MapperPropuesta,
  Nivel,
  Notificacion,
  ParComparacion,
  Perfil,
  Pista,
  Senal,
  Tarea,
  TrayectoriaEvento,
  TrayectoriaPunto,
} from "./types";
import type { AuditorResultado, CasoDetalle, DataSource, EntidadPerfil, EstadisticasCorrida } from "./source";
import mapperFixtureEjemplo from "@contracts/fixtures/valid/mapper.json";

/**
 * Fuente de datos real contra `forense` (Supabase/Postgres) vía el cliente
 * anon + RLS (docs/05 §RLS: SELECT público para el dataset sintético). Cada
 * método mapea filas reales de `db/001_schema.sql` / `db/002_views.sql` al
 * shape que la UI espera (`./source.ts`, `./types.ts`) — nunca al revés: si
 * una columna/vista no existe todavía, el método está en `noDisponibles` y
 * responde `[]`/`null` (nunca lanza, nunca finge). Las funciones `map*`
 * están exportadas y son puras a propósito: son lo que los tests de este
 * corte ejercitan directamente, sin levantar un cliente Supabase real.
 *
 * Nota de honestidad: varias columnas que el contrato v1.2.0 exige no
 * existen todavía en la migración 001-003 aplicada (ver
 * solicitudes_coordinador de este corte: `senales.tarea_id`,
 * `evidencia.referencias`). Se documenta cada compromiso en el mapeo
 * correspondiente; ninguno inventa un valor de negocio, solo rellena con
 * `""`/`[]` lo que la columna no puede dar todavía.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Selector explícito (decisión H3, `lib/data/index.ts`): Supabase (público,
 * anon) solo con `NEXT_PUBLIC_DATA_SOURCE=supabase` Y credenciales
 * presentes. Usado también por `lib/realtime/canal.ts` para decidir si abre
 * un canal — nunca hay realtime en modo fixture, y nunca contra un proyecto
 * distinto del que ya eligió el selector de datos.
 */
export function quiereFuenteSupabase(): boolean {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase" && isSupabaseConfigured();
}

export function createForenseSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase no configurado: falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, anonKey, { db: { schema: "forense" } });
}

// ---------------------------------------------------------------------------
// Tipos de fila cruda (solo las columnas que cada mapper usa; el resto de
// `select("*")` se ignora). `Record<string, unknown>` de base porque no hay
// codegen de tipos Postgres en este corte (ver solicitudes_coordinador:
// pedir `supabase gen types` al integrador con acceso al proyecto).
// ---------------------------------------------------------------------------
type Fila = Record<string, unknown>;

const NIVEL_PRIORIDAD: Nivel[] = ["sin_hallazgos", "anomalia_explicada", "no_concluyente", "presuncion", "presuncion_alta"];

function peorNivel(niveles: Array<Nivel | null | undefined>): Nivel | null {
  let mejorIdx = -1;
  let resultado: Nivel | null = null;
  for (const n of niveles) {
    if (!n) continue;
    const idx = NIVEL_PRIORIDAD.indexOf(n);
    if (idx > mejorIdx) {
      mejorIdx = idx;
      resultado = n;
    }
  }
  return resultado;
}

function aTexto(valor: unknown, porDefecto = "0"): string {
  if (valor === null || valor === undefined) return porDefecto;
  return String(valor);
}

function aArreglo<T = string>(valor: unknown): T[] {
  return Array.isArray(valor) ? (valor as T[]) : [];
}

// ---------------------------------------------------------------------------
// Mappers puros — fila(s) real(es) -> DTO de la UI.
// ---------------------------------------------------------------------------

export function mapCorrida(row: Fila): Corrida {
  return {
    id: String(row.id),
    nombre: String(row.nombre ?? ""),
    dataset: String(row.dataset ?? ""),
    dataset_hash: String(row.dataset_hash ?? ""),
    fecha_corte: String(row.fecha_corte ?? ""),
    corrida_origen_id: (row.corrida_origen_id as string | null) ?? null,
    estado: String(row.estado ?? ""),
    version_prompts: (row.version_prompts as string | null) ?? "",
    version_reglas: (row.version_reglas as string | null) ?? "",
    modo: String(row.modo ?? ""),
    familias_evaluables: aArreglo<Familia>(row.familias_evaluables),
    inicio: String(row.inicio ?? ""),
    fin: (row.fin as string | null) ?? null,
  };
}

/** Fila de `forense.v_casos_lista` (columnas de `casos` + razon_social/giro/n_evidencia/n_defensas/cluster_tamano). */
export function mapCaso(row: Fila): Caso {
  return {
    id: String(row.id),
    corrida_id: String(row.corrida_id),
    cluster_id: String(row.cluster_id ?? ""),
    rfc_principal: String(row.rfc_principal ?? ""),
    rfcs_satelite: aArreglo<string>(row.rfcs_satelite),
    estado: String(row.estado ?? ""),
    nivel: (row.nivel as Nivel | null) ?? null,
    tipologia: (row.tipologia as Caso["tipologia"]) ?? null,
    origen: (row.origen as string | null) ?? null,
    origen_valor: (row.origen_valor as string | null) ?? null,
    familias_confirmadas: aArreglo<Familia>(row.familias_confirmadas),
    monto_en_riesgo: aTexto(row.monto_en_riesgo),
    moneda: String(row.moneda ?? "MXN"),
    cobertura_completa: Boolean(row.cobertura_completa),
    n_reintentos: Number(row.n_reintentos ?? 0),
    presupuesto_agotado: Boolean(row.presupuesto_agotado),
    creado: String(row.creado ?? ""),
    terminado: (row.terminado as string | null) ?? null,
  };
}

export function mapTarea(row: Fila): Tarea {
  return {
    id: String(row.id),
    caso_id: String(row.caso_id),
    corrida_id: String(row.corrida_id),
    cluster_id: String(row.cluster_id),
    agente: String(row.agente ?? ""),
    ronda: Number(row.ronda ?? 0),
    intento: Number(row.intento ?? 0),
    version_contexto: Number(row.version_contexto ?? 1),
    estado: String(row.estado ?? ""),
    idempotency_key: String(row.idempotency_key ?? ""),
    iniciado: (row.iniciado as string | null) ?? "",
    terminado: (row.terminado as string | null) ?? null,
  };
}

/**
 * `forense.senales` no tiene columna `tarea_id` todavía (contrato
 * `entities.senal` la exige) — se mapea a `""` hasta 004/005
 * (solicitudes_coordinador). `caso_id` es nullable en la tabla (la señal
 * puede escribirse antes de que exista el caso); se mapea igual a `""`.
 */
export function mapSenal(row: Fila): Senal {
  return {
    id: String(row.id),
    caso_id: (row.caso_id as string | null) ?? "",
    cluster_id: String(row.cluster_id ?? ""),
    tarea_id: "",
    ronda: Number(row.ronda ?? 0),
    intento: Number(row.intento ?? 0),
    version_contexto: Number(row.version_contexto ?? 1),
    familia: row.familia as Familia,
    agente: String(row.agente ?? ""),
    titular: String(row.titular ?? ""),
    detalle: (row.detalle as Record<string, unknown>) ?? {},
    rfcs: aArreglo<string>(row.rfcs),
    ids: aArreglo<string>(row.ids),
    frontera: aArreglo<string>(row.frontera),
    confianza: (row.confianza as Senal["confianza"]) ?? "baja",
    refuta: Boolean(row.refuta),
    creado: (row.creado as string | null) ?? "",
  };
}

/**
 * `evaluacionPistas` es `forense.casos.evaluacion_pistas` (jsonb, llave =
 * `pista.id` en texto): el veredicto de esta pista DENTRO de este caso.
 * Ver `Pista.evaluacion_caso` en types.ts — no es un estado de la pista.
 */
export function mapPista(row: Fila, evaluacionPistas?: Record<string, { estado: string; motivo: string; evidencia_ids: unknown[] }>): Pista {
  const detalle = (row.detalle as Fila) ?? {};
  const evaluacion = evaluacionPistas?.[String(row.id)];
  return {
    id: String(row.id),
    corrida_id: String(row.corrida_id),
    codigo: row.codigo as Pista["codigo"],
    familia: row.familia as Familia,
    rfc: String(row.rfc ?? ""),
    score: Number(row.score ?? 0),
    estado: (row.estado as Pista["estado"]) ?? "disparada",
    resumen: String(detalle.resumen ?? ""),
    referencias: aArreglo<string>(detalle.referencias),
    evaluacion_caso: evaluacion
      ? { estado: evaluacion.estado, motivo: evaluacion.motivo, evidencia_ids: aArreglo<string>(evaluacion.evidencia_ids).map(String) }
      : null,
  };
}

/** `evidencia.referencias` no existe como columna: se toma de `hecho_validado.referencias` si el Validador la dejó ahí, si no, del único `ref_id` de la fila (solicitudes_coordinador). */
export function mapEvidencia(row: Fila): import("./types").EvidenciaValidada {
  const hecho = (row.hecho_validado as Fila) ?? {};
  const referenciasDeHecho = aArreglo<string>(hecho.referencias);
  return {
    id: String(row.id),
    caso_id: String(row.caso_id),
    pista_id: String(row.pista_id ?? ""),
    pista_codigo: (row.pista_codigo as Pista["codigo"]) ?? ("D1" as Pista["codigo"]),
    familia: row.familia as Familia,
    tipo: String(row.tipo ?? ""),
    ref_id: String(row.ref_id ?? ""),
    rfcs_afectados: aArreglo<string>(row.rfcs_afectados),
    referencias: referenciasDeHecho.length > 0 ? referenciasDeHecho : [String(row.ref_id ?? "")].filter((r) => r.length > 0),
    valida_tecnica: Boolean(row.valida_tecnica),
    refutada: Boolean(row.refutada),
    validada: Boolean(row.validada),
    hecho_validado: hecho,
  };
}

export function mapArgumento(row: Fila): Argumento {
  return {
    trampa_codigo: String(row.trampa_codigo ?? ""),
    pista_objetivo: String(row.pista_objetivo ?? ""),
    evidencia_objetivo_ids: aArreglo<number>(row.evidencia_objetivo_ids).map(String),
    argumento: String(row.argumento ?? ""),
    ids: aArreglo<string>(row.ids),
    resultado: (row.resultado as Argumento["resultado"]) ?? "no_refuta",
  };
}

/** No hay tabla de réplica: se deriva de `defensas.aceptado`/`respuesta_investigador` cuando el Auditor Final ya resolvió al menos una. */
export function mapReplicaDesdeDefensas(defensas: Fila[]): import("./types").Replica | null {
  const resueltas = defensas.filter((d) => d.aceptado !== null && d.aceptado !== undefined);
  if (resueltas.length === 0) return null;
  return {
    resoluciones: resueltas.map((d) => ({
      defensa_id: String(d.id),
      decision: d.aceptado ? "acepta" : "rechaza",
      razon: String(d.respuesta_investigador ?? ""),
    })),
  };
}

/** No hay tabla de dictámenes: `forense.casos` ES el dictamen cuando `nivel` ya no es null. `monto_en_riesgo` está en pesos en la fila; se convierte a centavos enteros (el contrato pide centavos, nunca flotantes). */
export function mapDictamenDesdeCaso(row: Fila): import("./types").Dictamen | null {
  if (row.nivel === null || row.nivel === undefined) return null;
  const pesos = Number(row.monto_en_riesgo ?? 0);
  return {
    nivel: row.nivel as Nivel,
    familias: aArreglo<Familia>(row.familias_confirmadas),
    monto_en_riesgo_centavos: String(Math.round(pesos * 100)),
    moneda: String(row.moneda ?? "MXN"),
    regla: "Nivel y monto tomados de forense.casos (código determinista); no hay tabla de dictámenes separada en 001-003.",
    limitaciones: aArreglo<unknown>(row.pendientes),
  };
}

/** Fila de `forense.bitacora`. El payload jsonb es libre por tipo de evento — no todas las filas reales tienen `resumen`/`referencias` (p.ej. `clonar_corrida` solo deja `evento_real`); se usa el mejor sustituto disponible y nunca se inventa contenido. */
export function mapEventoBitacora(row: Fila): EventoForense {
  const payload = (row.payload as Fila) ?? {};
  const resumen = typeof payload.resumen === "string" ? payload.resumen : typeof payload.evento_real === "string" ? payload.evento_real : String(row.tipo_evento ?? "");
  return {
    schema_version: "bitacora.v1",
    id: String(row.id),
    corrida_id: String(row.corrida_id),
    caso_id: (row.caso_id as string | null) ?? null,
    tarea_id: (row.tarea_id as string | null) ?? null,
    seq: (row.seq as number | null) ?? null,
    ts: String(row.ts ?? ""),
    tipo_evento: String(row.tipo_evento ?? ""),
    payload: {
      resumen,
      referencias: aArreglo<string>(payload.referencias),
      operacion_id: (payload.operacion_id as string | null) ?? null,
    },
    tokens_in: (row.tokens_in as number | null) ?? null,
    tokens_out: (row.tokens_out as number | null) ?? null,
    duracion_ms: (row.duracion_ms as number | null) ?? null,
  };
}

/** Resultado jsonb de `forense.v_grafo(p_corrida, p_rfc, p_prof)`. Agrega aristas por par de RFC: sin fecha/ref_id por documento (ver GrafoArista en types.ts). `nivelPorRfc` es un enriquecimiento opcional (consulta aparte a `casos`); sin él, todos los nodos quedan con `nivel: null`. */
export function mapGrafoRpc(json: Fila, rfcSemilla: string, nivelPorRfc?: Map<string, Nivel | null>): GrafoCluster | null {
  if (typeof json.error === "string") return null;
  const nodos: GrafoNodo[] = aArreglo<Fila>(json.nodos).map((n) => ({
    id: String(n.rfc),
    tipo: "contribuyente",
    rfc: String(n.rfc),
    nivel: nivelPorRfc?.get(String(n.rfc)) ?? null,
    es_semilla: n.rfc === rfcSemilla,
    en_lista_sat: Boolean(n.en_69b),
    frontera: Boolean(n.frontera),
    razon_social_untrusted: (n.razon_social_untrusted as string | null) ?? null,
    giro: (n.giro as string | null) ?? null,
  }));
  const aristas: GrafoArista[] = aArreglo<Fila>(json.aristas_cfdi).map((a) => ({
    id: `CFDI-AGREGADO:${a.de}->${a.a}`,
    origen: String(a.de),
    destino: String(a.a),
    tipo: "factura",
    monto: aTexto(a.monto),
    n_registros: Number(a.n_cfdi ?? 0),
  }));
  return { nodos, aristas };
}

/** Resultado jsonb de `forense.v_trayectoria_rfc`: `serie[]` y `eventos[]` son arreglos separados; un mismo mes puede tener más de un evento (ver TrayectoriaPunto.eventos en types.ts). */
export function mapTrayectoriaRpc(json: Fila): TrayectoriaPunto[] {
  if (typeof json.error === "string") return [];
  const eventosPorMes = new Map<string, TrayectoriaEvento[]>();
  for (const ev of aArreglo<Fila>(json.eventos)) {
    const mes = String(ev.mes ?? "");
    const lista = eventosPorMes.get(mes) ?? [];
    lista.push(ev.tipo as TrayectoriaEvento);
    eventosPorMes.set(mes, lista);
  }
  return aArreglo<Fila>(json.serie).map((p) => ({
    periodo: String(p.mes),
    eventos: eventosPorMes.get(String(p.mes)) ?? [],
    monto_emitido: aTexto(p.emitido),
    monto_recibido: aTexto(p.recibido),
    n_cfdi: Number(p.n_cfdi_emitidos ?? 0) + Number(p.n_cfdi_recibidos ?? 0),
  }));
}

/** Resultado jsonb de `forense.v_metricas_corrida`: pasa a través casi 1:1 (mismo shape, ver EstadisticasCorrida en source.ts) con valores por defecto defensivos si una clave falta. `parcial`/`no_implementado` se muestran, nunca se ocultan (CLAUDE.md regla 10). */
export function mapMetricasRpc(json: Fila): EstadisticasCorrida | null {
  if (typeof json.error === "string") return null;
  const cohorte = (json.cohorte as Fila) ?? {};
  const cobertura = (json.cobertura as Fila) ?? {};
  const operacion = (json.operacion as Fila) ?? {};
  const selectivas = (json.selectivas as Fila) ?? {};
  const fprTrampas = (json.fpr_trampas as Fila) ?? {};
  const extremo = (json.extremo_a_extremo as Fila) ?? {};
  const recallPorTipologia = (json.recall_por_tipologia as Record<string, Fila>) ?? {};
  return {
    corrida_id: String(json.corrida_id ?? ""),
    dataset: String(json.dataset ?? ""),
    dataset_hash: String(json.dataset_hash ?? ""),
    fecha_corte: String(json.fecha_corte ?? ""),
    modo: String(json.modo ?? ""),
    estado_corrida: String(json.estado_corrida ?? ""),
    version_reglas: (json.version_reglas as string | null) ?? null,
    version_prompts: (json.version_prompts as string | null) ?? null,
    corrida_origen_id: (json.corrida_origen_id as string | null) ?? null,
    parcial: Boolean(json.parcial),
    terminal: Boolean(json.terminal),
    no_implementado: aArreglo<string>(json.no_implementado),
    acierto_tipologia: (json.acierto_tipologia as number | null) ?? null,
    cohorte: {
      total_ground_truth: Number(cohorte.total_ground_truth ?? 0),
      total_fraude: Number(cohorte.total_fraude ?? 0),
      total_trampas: Number(cohorte.total_trampas ?? 0),
      sin_conclusion: Number(cohorte.sin_conclusion ?? 0),
    },
    cobertura: {
      ratio: (cobertura.ratio as number | null) ?? null,
      concluyentes: Number(cobertura.concluyentes ?? 0),
      trampas_investigadas: Number(cobertura.trampas_investigadas ?? 0),
    },
    operacion: {
      casos: Number(operacion.casos ?? 0),
      reintentos: Number(operacion.reintentos ?? 0),
      tool_calls: Number(operacion.tool_calls ?? 0),
      tokens_total: Number(operacion.tokens_total ?? 0),
      casos_por_nivel: (operacion.casos_por_nivel as Record<string, number>) ?? {},
      duracion_ms_p50: (operacion.duracion_ms_p50 as number | null) ?? null,
      duracion_ms_p95: (operacion.duracion_ms_p95 as number | null) ?? null,
      presupuesto_agotado: Number(operacion.presupuesto_agotado ?? 0),
    },
    selectivas: {
      tp: Number(selectivas.tp ?? 0),
      fp: Number(selectivas.fp ?? 0),
      tn: Number(selectivas.tn ?? 0),
      fn_selectivo: Number(selectivas.fn_selectivo ?? 0),
      precision: (selectivas.precision as number | null) ?? null,
      recall: (selectivas.recall as number | null) ?? null,
      f1: (selectivas.f1 as number | null) ?? null,
    },
    fpr_trampas: {
      n: Number(fprTrampas.n ?? 0),
      fp: Number(fprTrampas.fp ?? 0),
      texto: String(fprTrampas.texto ?? "0/0"),
      rango_min: Number(fprTrampas.rango_min ?? 0),
      rango_max: Number(fprTrampas.rango_max ?? 0),
      concluyentes: Number(fprTrampas.concluyentes ?? 0),
      sin_conclusion: Number(fprTrampas.sin_conclusion ?? 0),
      fpr_concluyentes: (fprTrampas.fpr_concluyentes as number | null) ?? null,
    },
    extremo_a_extremo: {
      fn_conservador: Number(extremo.fn_conservador ?? 0),
      recall_conservador: (extremo.recall_conservador as number | null) ?? null,
    },
    recall_por_tipologia: Object.fromEntries(
      Object.entries(recallPorTipologia).map(([tipologia, v]) => [
        tipologia,
        { tp: Number(v.tp ?? 0), total: Number(v.total ?? 0), recall: (v.recall as number | null) ?? null },
      ]),
    ),
  };
}

export class SupabaseDataSource implements DataSource {
  readonly label = "supabase" as const;
  private readonly client: ReturnType<typeof createForenseSupabaseClient>;

  /**
   * `getPerfil` no está aquí: no puede responder `null` (el contrato exige
   * un `Perfil`) y jamás debe adivinar uno ajeno — lanza siempre (ver el
   * método). El resto sí son "esta fuente no tiene esto todavía", nunca un
   * error del cliente.
   */
  readonly noDisponibles: ReadonlySet<string> = new Set([
    "listNotificaciones", // requiere 007 (docs/16 §6) y siempre por BFF privado, nunca anon público
    "listInyecciones", // requiere forense.inyecciones (008, docs/19)
    "getInyeccion", // idem
  ]);

  constructor() {
    this.client = createForenseSupabaseClient();
  }

  private async resolveCorridaId(corridaId?: string): Promise<string | null> {
    if (corridaId) return corridaId;
    const { data } = await this.client.from("corridas").select("id").order("inicio", { ascending: false }).limit(1).maybeSingle();
    return (data as Fila | null)?.id ? String((data as Fila).id) : null;
  }

  async listCorridas(): Promise<Corrida[]> {
    const { data, error } = await this.client.from("corridas").select("*").order("inicio", { ascending: false });
    if (error) throw new Error(`SupabaseDataSource.listCorridas: ${error.message}`);
    return (data ?? []).map((r) => mapCorrida(r as Fila));
  }

  async getCorrida(id: string): Promise<Corrida | null> {
    const { data, error } = await this.client.from("corridas").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`SupabaseDataSource.getCorrida: ${error.message}`);
    return data ? mapCorrida(data as Fila) : null;
  }

  async listCasos(params?: { corridaId?: string }): Promise<Caso[]> {
    let q = this.client.from("v_casos_lista").select("*");
    if (params?.corridaId) q = q.eq("corrida_id", params.corridaId);
    const { data, error } = await q;
    if (error) throw new Error(`SupabaseDataSource.listCasos: ${error.message}`);
    return (data ?? []).map((r) => mapCaso(r as Fila));
  }

  private async getCasoRaw(id: string): Promise<Fila | null> {
    const { data, error } = await this.client.from("v_casos_lista").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`SupabaseDataSource.getCaso: ${error.message}`);
    return (data as Fila | null) ?? null;
  }

  async getCaso(id: string): Promise<Caso | null> {
    const raw = await this.getCasoRaw(id);
    return raw ? mapCaso(raw) : null;
  }

  async getCasoDetalle(id: string): Promise<CasoDetalle | null> {
    const raw = await this.getCasoRaw(id);
    if (!raw) return null;
    const caso = mapCaso(raw);
    const rfcs = [caso.rfc_principal, ...caso.rfcs_satelite].filter(Boolean);

    const [{ data: tareas }, { data: senales }, { data: pistas }, { data: evidencia }, { data: defensas }, { data: expedientes }] = await Promise.all([
      this.client.from("tareas_agente").select("*").eq("caso_id", id).order("ronda", { ascending: true }),
      caso.cluster_id ? this.client.from("senales").select("*").eq("cluster_id", caso.cluster_id).order("ronda", { ascending: true }) : Promise.resolve({ data: [] as Fila[] }),
      rfcs.length > 0 ? this.client.from("pistas").select("*").eq("corrida_id", caso.corrida_id).in("rfc", rfcs) : Promise.resolve({ data: [] as Fila[] }),
      this.client.from("evidencia").select("*").eq("caso_id", id).order("id", { ascending: true }),
      this.client.from("defensas").select("*").eq("caso_id", id).order("id", { ascending: true }),
      this.client.from("expedientes").select("*").eq("caso_id", id).order("version", { ascending: false }).limit(1),
    ]);

    const evaluacionPistas = (raw.evaluacion_pistas as Record<string, { estado: string; motivo: string; evidencia_ids: unknown[] }>) ?? {};
    const defensasRows = (defensas ?? []) as Fila[];

    return {
      caso,
      tareas: (tareas ?? []).map((t) => mapTarea(t as Fila)),
      senales: (senales ?? []).map((s) => mapSenal(s as Fila)),
      pistas: (pistas ?? []).map((p) => mapPista(p as Fila, evaluacionPistas)),
      evidencia: (evidencia ?? []).map((e) => mapEvidencia(e as Fila)),
      defensa: defensasRows.map(mapArgumento),
      replica: mapReplicaDesdeDefensas(defensasRows),
      dictamen: mapDictamenDesdeCaso(raw),
      redactor: (expedientes ?? [])[0] ? { markdown: String((expedientes as Fila[])[0].markdown ?? "") } : null,
    };
  }

  private async enriquecerClusters(rows: Fila[]): Promise<ClusterResumen[]> {
    const ids = rows.map((r) => String(r.id));
    if (ids.length === 0) return [];
    const [{ data: senales }, { data: casosDeCluster }] = await Promise.all([
      this.client.from("senales").select("cluster_id, ronda").in("cluster_id", ids),
      this.client.from("casos").select("cluster_id, nivel").in("cluster_id", ids),
    ]);
    const rondaPorCluster = new Map<string, number>();
    for (const s of (senales ?? []) as Fila[]) {
      const cid = String(s.cluster_id);
      const actual = rondaPorCluster.get(cid) ?? 0;
      const ronda = Number(s.ronda ?? 0);
      if (ronda > actual) rondaPorCluster.set(cid, ronda);
    }
    const nivelesPorCluster = new Map<string, Array<Nivel | null>>();
    for (const c of (casosDeCluster ?? []) as Fila[]) {
      const cid = String(c.cluster_id);
      const lista = nivelesPorCluster.get(cid) ?? [];
      lista.push((c.nivel as Nivel | null) ?? null);
      nivelesPorCluster.set(cid, lista);
    }
    return rows.map((r) => ({
      id: String(r.id),
      corrida_id: String(r.corrida_id),
      n_rfc: Number(r.n_rfcs ?? 0),
      estado: String(r.estado ?? ""),
      ronda_actual: rondaPorCluster.get(String(r.id)) ?? 0,
      nivel: peorNivel(nivelesPorCluster.get(String(r.id)) ?? []),
      score: Number(r.score ?? 0),
    }));
  }

  async listClusters(corridaId: string): Promise<ClusterResumen[]> {
    const { data, error } = await this.client.from("clusters").select("*").eq("corrida_id", corridaId).order("score", { ascending: false });
    if (error) throw new Error(`SupabaseDataSource.listClusters: ${error.message}`);
    return this.enriquecerClusters((data ?? []) as Fila[]);
  }

  private async getClusterRaw(id: string): Promise<Fila | null> {
    const { data, error } = await this.client.from("clusters").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`SupabaseDataSource.getCluster: ${error.message}`);
    return (data as Fila | null) ?? null;
  }

  async getCluster(id: string): Promise<ClusterResumen | null> {
    const raw = await this.getClusterRaw(id);
    if (!raw) return null;
    const [enriquecido] = await this.enriquecerClusters([raw]);
    return enriquecido ?? null;
  }

  async getClusterGrafo(id: string): Promise<GrafoCluster | null> {
    const cluster = await this.getClusterRaw(id);
    if (!cluster || !cluster.rfc_semilla) return null;
    const { data, error } = await this.client.rpc("v_grafo", { p_corrida: cluster.corrida_id, p_rfc: cluster.rfc_semilla, p_prof: 2 });
    if (error) throw new Error(`SupabaseDataSource.getClusterGrafo: ${error.message}`);
    const json = (data ?? {}) as Fila;
    const rfcs = aArreglo<Fila>(json.nodos).map((n) => String(n.rfc));
    let nivelPorRfc: Map<string, Nivel | null> | undefined;
    if (rfcs.length > 0) {
      const { data: casosDelGrafo } = await this.client.from("casos").select("rfc_principal, nivel").eq("corrida_id", cluster.corrida_id).in("rfc_principal", rfcs);
      nivelPorRfc = new Map(((casosDelGrafo ?? []) as Fila[]).map((c) => [String(c.rfc_principal), (c.nivel as Nivel | null) ?? null]));
    }
    return mapGrafoRpc(json, String(cluster.rfc_semilla), nivelPorRfc);
  }

  async listSenalesCluster(id: string): Promise<Senal[]> {
    const { data, error } = await this.client.from("senales").select("*").eq("cluster_id", id).order("ronda", { ascending: true });
    if (error) throw new Error(`SupabaseDataSource.listSenalesCluster: ${error.message}`);
    return (data ?? []).map((s) => mapSenal(s as Fila));
  }

  async getBitacoraCorrida(corridaId: string): Promise<EventoForense[]> {
    const { data, error } = await this.client.from("bitacora").select("*").eq("corrida_id", corridaId).order("id", { ascending: true });
    if (error) throw new Error(`SupabaseDataSource.getBitacoraCorrida: ${error.message}`);
    return (data ?? []).map((r) => mapEventoBitacora(r as Fila));
  }

  async getBitacoraCaso(casoId: string): Promise<EventoForense[]> {
    const { data, error } = await this.client.from("bitacora").select("*").eq("caso_id", casoId).order("seq", { ascending: true });
    if (error) throw new Error(`SupabaseDataSource.getBitacoraCaso: ${error.message}`);
    return (data ?? []).map((r) => mapEventoBitacora(r as Fila));
  }

  async getEntidad(rfc: string, corridaId?: string): Promise<EntidadPerfil | null> {
    const cid = await this.resolveCorridaId(corridaId);
    if (!cid) return null;

    const [{ data: contrib }, { data: listas }, { data: todosAtributos }, { data: cfdis }, { data: casosPrevios }] = await Promise.all([
      this.client.from("contribuyentes").select("*").eq("corrida_id", cid).eq("rfc", rfc).maybeSingle(),
      this.client.from("listas_sat").select("lista").eq("corrida_id", cid).eq("rfc", rfc),
      this.client.from("atributos_entidad").select("rfc, atributo, valor").eq("corrida_id", cid),
      this.client
        .from("cfdi")
        .select("uuid, emisor_rfc, receptor_rfc, total, fecha")
        .eq("corrida_id", cid)
        .or(`emisor_rfc.eq.${rfc},receptor_rfc.eq.${rfc}`)
        .order("fecha", { ascending: false })
        .limit(50),
      this.client.from("casos").select("id").eq("corrida_id", cid).or(`rfc_principal.eq.${rfc},rfcs_satelite.cs.{${rfc}}`),
    ]);

    const todos = (todosAtributos ?? []) as Fila[];
    const misAtributos = todos.filter((a) => a.rfc === rfc);
    const atributosCompartidos = misAtributos
      .map((a) => {
        const compartidoPor = [...new Set(todos.filter((o) => o.atributo === a.atributo && o.valor === a.valor && o.rfc !== rfc).map((o) => String(o.rfc)))];
        return compartidoPor.length > 0 ? { atributo: String(a.atributo), valor_untrusted: String(a.valor), rfcs_que_lo_comparten: compartidoPor } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const facturas = ((cfdis ?? []) as Fila[]).map((f) => ({
      id: String(f.uuid),
      direccion: (f.emisor_rfc === rfc ? "emitida" : "recibida") as "emitida" | "recibida",
      contraparte: String(f.emisor_rfc === rfc ? f.receptor_rfc : f.emisor_rfc),
      monto: aTexto(f.total),
      fecha: String(f.fecha ?? ""),
    }));

    const listasNombres = [...new Set(((listas ?? []) as Fila[]).map((l) => String(l.lista)))];

    if (!contrib && listasNombres.length === 0 && facturas.length === 0) return null;

    return {
      rfc,
      razon_social_untrusted: String((contrib as Fila | null)?.razon_social ?? ""),
      giro: String((contrib as Fila | null)?.giro ?? ""),
      en_lista_sat: listasNombres.length > 0,
      listas_sat: listasNombres,
      atributos_compartidos: atributosCompartidos,
      facturas,
      casos_previos: ((casosPrevios ?? []) as Fila[]).map((c) => String(c.id)),
    };
  }

  async getTrayectoria(rfc: string, corridaId?: string): Promise<TrayectoriaPunto[]> {
    const cid = await this.resolveCorridaId(corridaId);
    if (!cid) return [];
    const { data, error } = await this.client.rpc("v_trayectoria_rfc", { p_corrida: cid, p_rfc: rfc });
    if (error) throw new Error(`SupabaseDataSource.getTrayectoria: ${error.message}`);
    return mapTrayectoriaRpc((data ?? {}) as Fila);
  }

  async getContraste(casoId: string): Promise<ContrasteCaso | null> {
    // `forense.v_contraste_caso` (db/018) decide el comparable y la razón en
    // SQL. La webapp no deriva ni completa nada: cero filas significa "este
    // caso no tiene contraste en su corrida" y se devuelve `null`. Fabricar
    // una fila aquí sería la webapp opinando sobre el veredicto (regla 4).
    const { data, error } = await this.client.rpc("v_contraste_caso", { p_caso: casoId });
    if (error) throw new Error(`SupabaseDataSource.getContraste: ${error.message}`);
    const filas = (data ?? []) as ContrasteCaso[];
    return filas[0] ?? null;
  }

  /**
   * Solo expone "Facturación 12 meses": es la única métrica con p10/p50/p90
   * completos en `forense.v_pares_giro` (nómina no tiene p90, compras no
   * tiene p50/p90, cancelación solo p90, clientes solo p50) — ver
   * solicitudes_coordinador para pedir los percentiles que faltan antes de
   * mostrar una comparación con un extremo inventado.
   */
  async getPares(rfc: string, corridaId?: string): Promise<ParComparacion[]> {
    const cid = await this.resolveCorridaId(corridaId);
    if (!cid) return [];
    const { data: propio } = await this.client.from("v_agregado_rfc").select("giro, facturacion_12m").eq("corrida_id", cid).eq("rfc", rfc).maybeSingle();
    const fila = propio as Fila | null;
    if (!fila) return [];
    const { data: giro } = await this.client.from("v_pares_giro").select("fact_p10, fact_p50, fact_p90").eq("corrida_id", cid).eq("giro", fila.giro).maybeSingle();
    const percentiles = giro as Fila | null;
    if (!percentiles) return [];
    return [
      {
        metrica: "12-month invoicing",
        unidad: "MXN",
        valor_propio: Number(fila.facturacion_12m ?? 0),
        p10: Number(percentiles.fact_p10 ?? 0),
        p50: Number(percentiles.fact_p50 ?? 0),
        p90: Number(percentiles.fact_p90 ?? 0),
      },
    ];
  }

  async getEstadisticas(corridaId: string): Promise<EstadisticasCorrida | null> {
    const { data, error } = await this.client.rpc("v_metricas_corrida", { p_corrida: corridaId });
    if (error) throw new Error(`SupabaseDataSource.getEstadisticas: ${error.message}`);
    return mapMetricasRpc((data ?? {}) as Fila);
  }

  async listInvestigaciones(): Promise<Investigacion[]> {
    // product.investigacion vive en el flujo de n8n/outbox (16), no en
    // 001-003. La UI nunca lee n8n directo (CLAUDE.md regla 3); esto queda
    // servido por el BFF (`web/lib/data/privado.ts`) hasta esa migración.
    return [];
  }

  async getInvestigacion(_id: string): Promise<Investigacion | null> {
    void _id;
    return null;
  }

  async listNotificaciones(): Promise<Notificacion[]> {
    return [];
  }

  async getPerfil(): Promise<Perfil> {
    throw new Error(
      "SupabaseDataSource.getPerfil: perfil/teléfono son privados (CLAUDE.md regla 3). " +
        "Nunca se leen con el cliente público; usar la ruta BFF con sesión (web/lib/data/privado.ts).",
    );
  }

  async listInyecciones(): Promise<InyeccionResumen[]> {
    return [];
  }

  async getInyeccion(_id: string): Promise<InyeccionResumen | null> {
    void _id;
    return null;
  }

  async getMapperEjemplo(): Promise<MapperPropuesta> {
    // No hay tabla que respalde esto en ninguna fuente: es el ejemplo fijo
    // del mapper de ingesta (19) que el asistente de /datos muestra antes de
    // que exista un mapper real corriendo. Mismo fixture con fixture o con
    // supabase — no es un "no disponible", es lo único que existe.
    return mapperFixtureEjemplo as unknown as MapperPropuesta;
  }

  async getAuditorResultado(corridaId: string): Promise<AuditorResultado | null> {
    const { data, error } = await this.client
      .from("auditor_resultados")
      .select("corrida_id, seed, fingerprint, estate_sha256, generado_at, run_log")
      .eq("corrida_id", corridaId)
      .maybeSingle();
    if (error) throw new Error(`SupabaseDataSource.getAuditorResultado: ${error.message}`);
    if (!data) return null;
    const log = (data.run_log ?? {}) as Record<string, unknown>;
    return {
      corrida_id: String(data.corrida_id),
      seed: Number(data.seed),
      fingerprint: String(data.fingerprint),
      estate_sha256: String(data.estate_sha256),
      generado_at: String(data.generado_at),
      company_rfc: String(log.company_rfc ?? ""),
      period: aArreglo<string>(log.period) as [string, string],
      detector_hits: Number(log.detector_hits ?? 0),
      leads_investigated: Number(log.leads_investigated ?? 0),
      findings: aArreglo(log.findings),
      leads: aArreglo(log.leads),
      run_metadata: (log.run_metadata ?? { llm_calls: 0, mxn_cost: 0, wall_clock_seconds: 0, deterministic: true }) as AuditorResultado["run_metadata"],
      run_log: log,
    };
  }

  async getAuditorExpedienteHtml(corridaId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("auditor_resultados")
      .select("case_file_html")
      .eq("corrida_id", corridaId)
      .maybeSingle();
    if (error) throw new Error(`SupabaseDataSource.getAuditorExpedienteHtml: ${error.message}`);
    return data ? String(data.case_file_html) : null;
  }

  async getAuditorSubmission(corridaId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client
      .from("auditor_resultados")
      .select("submission")
      .eq("corrida_id", corridaId)
      .maybeSingle();
    if (error) throw new Error(`SupabaseDataSource.getAuditorSubmission: ${error.message}`);
    const submission = data?.submission;
    return submission && typeof submission === "object" && !Array.isArray(submission) ? (submission as Record<string, unknown>) : null;
  }
}
