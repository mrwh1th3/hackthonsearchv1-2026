import type {
  Argumento,
  Caso,
  ClusterResumen,
  ContrasteCaso,
  Corrida,
  Dictamen,
  EventoForense,
  EvidenciaValidada,
  GrafoCluster,
  InyeccionResumen,
  Investigacion,
  MapperPropuesta,
  Notificacion,
  ParComparacion,
  Perfil,
  Pista,
  Redactor,
  Replica,
  Senal,
  Tarea,
  TrayectoriaPunto,
} from "./types";

export interface EntidadPerfil {
  rfc: string;
  razon_social_untrusted: string;
  giro: string;
  en_lista_sat: boolean;
  listas_sat: string[];
  atributos_compartidos: Array<{ atributo: string; valor_untrusted: string; rfcs_que_lo_comparten: string[] }>;
  facturas: Array<{ id: string; direccion: "emitida" | "recibida"; contraparte: string; monto: string; fecha: string }>;
  casos_previos: string[];
}

/**
 * Forma real de `forense.v_metricas_corrida(uuid)` (docs/10, db/002_views.sql
 * §8, "IMPLEMENTACIÓN PARCIAL"). No hay codegen: se mantiene a mano contra el
 * jsonb observado (`psql -c "select forense.v_metricas_corrida(...)"`) igual
 * que el resto de tipos "fixture local de UI" de este archivo — ver
 * types.ts. `parcial: true` es una respuesta válida y esperada, no un error:
 * la UI debe mostrarlo (CLAUDE.md regla 10, corte 2 punto 1), nunca
 * completar con un número inventado lo que la vista declara `no_implementado`.
 */
export interface EstadisticasCorrida {
  corrida_id: string;
  dataset: string;
  dataset_hash: string;
  fecha_corte: string;
  modo: string;
  estado_corrida: string;
  version_reglas: string | null;
  version_prompts: string | null;
  corrida_origen_id: string | null;
  parcial: boolean;
  terminal: boolean;
  no_implementado: string[];
  acierto_tipologia: number | null;
  cohorte: {
    total_ground_truth: number;
    total_fraude: number;
    total_trampas: number;
    sin_conclusion: number;
  };
  cobertura: {
    ratio: number | null;
    concluyentes: number;
    trampas_investigadas: number;
  };
  operacion: {
    casos: number;
    reintentos: number;
    tool_calls: number;
    tokens_total: number;
    casos_por_nivel: Record<string, number>;
    duracion_ms_p50: number | null;
    duracion_ms_p95: number | null;
    presupuesto_agotado: number;
  };
  selectivas: {
    tp: number;
    fp: number;
    tn: number;
    fn_selectivo: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  };
  fpr_trampas: {
    n: number;
    fp: number;
    texto: string;
    rango_min: number;
    rango_max: number;
    concluyentes: number;
    sin_conclusion: number;
    fpr_concluyentes: number | null;
  };
  extremo_a_extremo: { fn_conservador: number; recall_conservador: number | null };
  recall_por_tipologia: Record<string, { tp: number; total: number; recall: number | null }>;
}

/**
 * Resultado del auditor determinista (`src/auditor`, docs/23) guardado en
 * `forense.auditor_resultados`. Es lo mismo que se entrega a los jueces:
 * `submission.json`, `run_log.json` y el expediente HTML. Los montos y la
 * confianza salen de reglas y SQL; la UI solo los pinta.
 */
export interface AuditorPaso { from: string; to: string; amount: number; date: string; exhibit_id: string }
export interface AuditorExhibit { exhibit_id: string; source_table: string; record_id: string; note: string }
export interface AuditorHallazgo {
  scheme_type: string;
  entities: string[];
  subject_name: string;
  rule_broken: string;
  narrative: string;
  peso_amount: number;
  confidence: "proven" | "probable";
  evidence: string[];
  exhibits: AuditorExhibit[];
  money_trail: AuditorPaso[];
  reconciliation: { table: string; items: Array<[string, number]> };
  reconciled_against?: { table: string; sum: number; per_table: Record<string, number> };
  defense: Array<{ argument: string; held: boolean; why: string; by?: string }>;
  signals?: string[];
  tool_calls?: string[];
}
export interface AuditorLead {
  entity: string;
  signal: string;
  signal_detail: string;
  investigated_as: string;
  reason: string;
  tool_calls_made: string[];
  closed_by: "investigator" | "challenger" | "validator";
}
export interface AuditorResultado {
  corrida_id: string;
  seed: number;
  fingerprint: string;
  estate_sha256: string;
  generado_at: string;
  company_rfc: string;
  period: [string, string];
  detector_hits: number;
  leads_investigated: number;
  findings: AuditorHallazgo[];
  leads: AuditorLead[];
  run_metadata: { llm_calls: number; mxn_cost: number; wall_clock_seconds: number; deterministic: boolean; llm_mode?: string };
  /**
   * `run_log` completo tal cual está en `forense.auditor_resultados`, sin
   * recortar a los campos ya tipados arriba (CLAUDE.md regla 1: "no
   * filtrar"). Sirve para el render genérico de claves no mapeadas — cuando
   * el generador (`src/auditor`) añade un campo nuevo a `findings[]`,
   * `leads[]` o al objeto raíz, aparece aquí aunque nadie haya actualizado
   * este archivo. `{}` en fixture (no hay backing real, ver `FixtureDataSource`).
   */
  run_log: Record<string, unknown>;
}

export interface CasoDetalle {
  caso: Caso;
  tareas: Tarea[];
  senales: Senal[];
  pistas: Pista[];
  evidencia: EvidenciaValidada[];
  defensa: Argumento[];
  replica: Replica | null;
  dictamen: Dictamen | null;
  redactor: Redactor | null;
}

/**
 * Contrato de la capa de datos de la webapp. Toda vista lee de aquí, nunca de
 * n8n directamente (CLAUDE.md regla 3). Una implementación de fixtures y,
 * cuando existan credenciales, una de Supabase satisfacen esta interfaz.
 */
export interface DataSource {
  readonly label: "fixture" | "supabase";
  /**
   * Nombres de métodos de esta instancia que hoy no pueden responder con
   * datos reales (p.ej. una tabla de una migración futura que aún no
   * existe). Vacío en FixtureDataSource. El método correspondiente sigue
   * cumpliendo su firma (devuelve `[]`/`null`), nunca lanza ni finge un
   * resultado — esto es lo que una página lee para distinguir "no hay
   * resultados" de "esta fuente no puede responder esto todavía" y mostrar
   * un estado "no disponible" explícito en vez de una lista vacía muda.
   */
  readonly noDisponibles: ReadonlySet<string>;

  listCorridas(): Promise<Corrida[]>;
  getCorrida(id: string): Promise<Corrida | null>;

  listCasos(params?: { corridaId?: string }): Promise<Caso[]>;
  getCaso(id: string): Promise<Caso | null>;
  getCasoDetalle(id: string): Promise<CasoDetalle | null>;

  listClusters(corridaId: string): Promise<ClusterResumen[]>;
  getCluster(id: string): Promise<ClusterResumen | null>;
  getClusterGrafo(id: string): Promise<GrafoCluster | null>;
  listSenalesCluster(id: string): Promise<Senal[]>;

  getBitacoraCorrida(corridaId: string): Promise<EventoForense[]>;
  getBitacoraCaso(casoId: string): Promise<EventoForense[]>;

  getEntidad(rfc: string, corridaId?: string): Promise<EntidadPerfil | null>;
  getTrayectoria(rfc: string, corridaId?: string): Promise<TrayectoriaPunto[]>;
  getContraste(casoId: string): Promise<ContrasteCaso | null>;
  getPares(rfc: string, corridaId?: string): Promise<ParComparacion[]>;

  getEstadisticas(corridaId: string): Promise<EstadisticasCorrida | null>;

  listInvestigaciones(): Promise<Investigacion[]>;
  getInvestigacion(id: string): Promise<Investigacion | null>;

  listNotificaciones(): Promise<Notificacion[]>;

  getPerfil(): Promise<Perfil>;

  listInyecciones(): Promise<InyeccionResumen[]>;
  getInyeccion(id: string): Promise<InyeccionResumen | null>;

  getMapperEjemplo(): Promise<MapperPropuesta>;

  getAuditorResultado(corridaId: string): Promise<AuditorResultado | null>;
  /** HTML autocontenido del expediente del auditor (sin red). */
  getAuditorExpedienteHtml(corridaId: string): Promise<string | null>;
  /**
   * `submission.json` persistido de la corrida (columna jsonb: el orden de claves no se conserva). La descarga
   * prefiere los bytes del archivo en disco cuando coinciden con esto (`lib/auditoria/submission.ts`).
   */
  getAuditorSubmission(corridaId: string): Promise<Record<string, unknown> | null>;
}
