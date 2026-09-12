/**
 * Tipos de la capa de datos de la webapp.
 *
 * Los tipos marcados "contrato v1.0.0" reflejan la forma de
 * `contracts/schemas/*.schema.json` (ver contracts/release.json) tal como la
 * ejercen los fixtures en `contracts/fixtures/valid/*.json`. No se generan
 * automáticamente del JSON Schema (no hay codegen instalado): se mantienen a
 * mano y deben revisarse si el coordinador publica una nueva versión de
 * contratos.
 *
 * Los tipos marcados "fixture local de UI" NO tienen contrato v1.0.0 (no
 * aparecen en contracts/release.json). Son necesarios para pintar vistas de
 * 09/15/21 (cluster, grafo, estadísticas, trayectoria, contraste, inyección)
 * y viven en web/lib/data/fixtures/*.json, propiedad de forense-webapp. Se
 * solicita al coordinador incorporarlos como contrato v1.1 cuando exista un
 * productor real.
 */

// ---------------------------------------------------------------------------
// common.schema.json
// ---------------------------------------------------------------------------

export type Familia = "D" | "F" | "R" | "T" | "E";

export type PistaCodigo =
  | "D1" | "D2" | "D3" | "D4"
  | "F1" | "F2" | "F3" | "F4"
  | "R1" | "R2" | "R3"
  | "T1" | "T2"
  | "E1";

export type Nivel =
  | "sin_hallazgos"
  | "anomalia_explicada"
  | "no_concluyente"
  | "presuncion"
  | "presuncion_alta";

export type Tipologia =
  | "efos_sin_sustancia"
  | "retorno"
  | "carrusel"
  | "capas"
  | "cluster_prestanombres"
  | "no_concluyente";

export interface Periodo {
  desde: string;
  hasta_exclusivo: string;
  timezone: string;
}

export interface Cobertura {
  completa: boolean;
  periodo: Periodo | null;
  familias_evaluables: Familia[];
  datos_ausentes: string[];
}

export interface ErrorForense {
  codigo:
    | "presupuesto_agotado"
    | "lease_vencido"
    | "contexto_invalido"
    | "argumento_invalido"
    | "no_evaluable"
    | "fallo_transitorio"
    | "conflicto_version"
    | "salida_invalida"
    | "no_autorizado";
  mensaje: string;
  reintentable: boolean;
}

// ---------------------------------------------------------------------------
// entities.schema.json
// ---------------------------------------------------------------------------

export interface Corrida {
  id: string;
  nombre: string;
  dataset: string;
  dataset_hash: string;
  fecha_corte: string;
  corrida_origen_id: string | null;
  estado: string;
  version_prompts: string;
  version_reglas: string;
  modo: string;
  familias_evaluables: Familia[];
  inicio: string;
  fin: string | null;
}

export type EstadoCaso =
  | "en_cola"
  | "ronda_1"
  | "ronda_2"
  | "auditoria"
  | "dictaminado"
  | "reintento"
  | "error";

export interface Caso {
  id: string;
  corrida_id: string;
  cluster_id: string;
  rfc_principal: string;
  rfcs_satelite: string[];
  estado: string;
  // Contrato entities.caso: nivel/tipologia son anyOf[<enum>, null] — un caso
  // en curso (en_cola/ronda1/...) todavía no tiene ninguno de los dos.
  nivel: Nivel | null;
  tipologia: Tipologia | null;
  familias_confirmadas: Familia[];
  monto_en_riesgo: string;
  moneda: string;
  cobertura_completa: boolean;
  n_reintentos: number;
  presupuesto_agotado: boolean;
  creado: string;
  terminado: string | null;
}

export interface Tarea {
  id: string;
  caso_id: string;
  corrida_id: string;
  cluster_id: string;
  agente: string;
  ronda: number;
  intento: number;
  version_contexto: number;
  estado: string;
  idempotency_key: string;
  iniciado: string;
  terminado: string | null;
}

export interface Senal {
  id: string;
  caso_id: string;
  cluster_id: string;
  tarea_id: string;
  ronda: number;
  intento: number;
  version_contexto: number;
  familia: Familia;
  agente: string;
  titular: string;
  detalle: Record<string, unknown>;
  rfcs: string[];
  ids: string[];
  frontera: string[];
  confianza: "baja" | "media" | "alta";
  refuta: boolean;
}

export interface Pista {
  id: string;
  corrida_id: string;
  codigo: PistaCodigo;
  familia: Familia;
  rfc: string;
  score: number;
  /** Contrato `entities.pista`: solo dos valores. Confirmada/refutada NO es un estado de la pista, ver `evaluacion_caso`. */
  estado: "disparada" | "no_evaluable";
  resumen: string;
  referencias: string[];
  // Campos de presentación añadidos por la UI (no en el contrato):
  motivo_no_evaluable?: string;
  /**
   * `forense.casos.evaluacion_pistas[pista.id]` (jsonb): el veredicto de
   * ESTA pista dentro de ESTE caso — una misma pista disparada puede estar
   * confirmada en un caso y no citada en otro. `estado` aquí es libre
   * ("confirmada" | "confirmada_parcial" | "refutada", visto en datos
   * reales) porque no hay contrato v1 para este overlay todavía.
   */
  evaluacion_caso?: { estado: string; motivo: string; evidencia_ids: string[] } | null;
}

export interface EvidenciaValidada {
  id: string;
  caso_id: string;
  pista_id: string;
  pista_codigo: PistaCodigo;
  familia: Familia;
  tipo: string;
  ref_id: string;
  rfcs_afectados: string[];
  referencias: string[];
  valida_tecnica: boolean;
  refutada: boolean;
  validada: boolean;
  hecho_validado: Record<string, unknown>;
}

export interface Dictamen {
  nivel: Nivel;
  familias: Familia[];
  monto_en_riesgo_centavos: string;
  moneda: string;
  regla: string;
  limitaciones: unknown[];
}

// ---------------------------------------------------------------------------
// agents.schema.json (solo lo que la UI lee y cita, nunca lo que decide)
// ---------------------------------------------------------------------------

export interface Argumento {
  trampa_codigo: string;
  pista_objetivo: string;
  evidencia_objetivo_ids: string[];
  argumento: string;
  ids: string[];
  resultado: "refuta" | "parcial" | "no_refuta";
}

export interface Replica {
  resoluciones: Array<{
    defensa_id: string;
    decision: "acepta" | "rechaza";
    razon: string;
  }>;
}

export interface Redactor {
  markdown: string;
}

// ---------------------------------------------------------------------------
// product.schema.json
// ---------------------------------------------------------------------------

export type EstadoInvestigacion =
  | "en_cola"
  | "investigando"
  | "generando_reporte"
  | "investigacion_completa"
  | "parcial"
  | "error"
  | "cancelada";

export interface ReporteManifestEntry {
  caso_id: string | null;
  reporte_id: string;
  version: number;
  content_hash: string;
}

export interface Investigacion {
  id: string;
  perfil_id: string;
  modo: "caso" | "corrida";
  corrida_id: string;
  caso_ids: string[];
  estado: EstadoInvestigacion;
  investigacion_padre_id: string | null;
  creado: string;
  completada_at: string | null;
  reporte_manifest: ReporteManifestEntry[];
  // Campos de presentación añadidos por la UI (no en el contrato de
  // transporte, derivados en el servidor a partir de datos persistidos):
  titulo?: string;
  directriz_id?: string;
  mensaje?: string;
}

export interface InvestigarPayload {
  mensaje: string;
  directriz_id:
    | "seguir_dinero"
    | "sin_pago"
    | "intentar_refutar"
    | "comparar_pares"
    | "explicar_cadena"
    | "resumen";
  directriz_version: number;
  contexto: {
    corrida_id: string;
    cluster_id?: string;
    rfcs: string[];
    evidencia_ids: string[];
    periodo: Periodo;
  };
  investigacion_padre_id: string | null;
  idempotency_key: string;
}

export interface Perfil {
  id: string;
  nombre: string;
  organizacion: string;
  timezone: string;
  telefono_e164: string | null;
  llamadas_activadas: boolean;
  consentimiento_at: string | null;
  correo?: string;
}

export interface Llamada {
  id: string;
  event_id: string;
  intento: number;
  estado:
    | "pendiente"
    | "solicitando"
    | "aceptada"
    | "en_curso"
    | "finalizada"
    | "fallida"
    | "sin_respuesta"
    | "omitida"
    | "resultado_desconocido";
  destino_enmascarado: string | null;
  conversation_id: string | null;
  aviso_entregado: boolean | null;
  error: ErrorForense | null;
}

export interface Notificacion {
  id: string;
  perfil_id: string;
  event_id: string;
  tipo: "investigacion_completa" | "llamada_resultado" | "error";
  titulo: string;
  recurso: { tipo: "investigacion" | "reporte"; id: string };
  leida_at: string | null;
  creado: string;
}

export interface EventoForense {
  schema_version: "bitacora.v1";
  id: string;
  corrida_id: string;
  caso_id: string | null;
  tarea_id: string | null;
  seq: number | null;
  ts: string;
  tipo_evento: string;
  payload: {
    resumen: string;
    referencias: string[];
    operacion_id: string | null;
  };
}

// ---------------------------------------------------------------------------
// ingesta.schema.json
// ---------------------------------------------------------------------------

export interface MapperPropuesta {
  schema_version: string;
  adapter_candidate: string;
  field_mappings: Array<{
    source: string;
    target: string;
    transform: { op: string; [key: string]: unknown };
    confidence: "alta" | "media" | "baja";
    reason: string;
  }>;
  relationships: unknown[];
  ambiguities: string[];
  missing_required_fields: string[];
  proposed_capabilities: unknown[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Fixtures locales de UI — SIN contrato v1.0.0 (ver cabecera del archivo).
// ---------------------------------------------------------------------------

export interface ClusterResumen {
  id: string;
  corrida_id: string;
  n_rfc: number;
  estado: string;
  ronda_actual: number;
  nivel: Nivel | null;
  score: number;
}

export interface GrafoNodo {
  id: string;
  tipo: "contribuyente" | "cuenta";
  rfc: string | null;
  nivel: Nivel | null;
  es_semilla: boolean;
  en_lista_sat: boolean;
  frontera: boolean;
  /** Solo con SupabaseDataSource (forense.v_grafo): texto libre, _untrusted. */
  razon_social_untrusted?: string | null;
  giro?: string | null;
}

export interface GrafoArista {
  id: string;
  origen: string;
  destino: string;
  tipo: "factura" | "movimiento";
  monto: string;
  /**
   * fecha/ref_id son opcionales porque `forense.v_grafo` (real) agrega
   * aristas por par de RFC/cuentas (no arista = 1 documento): no hay una
   * fecha ni un ref_id individual que citar. FixtureDataSource sigue
   * poblando ambos con un CFDI/movimiento concreto. Nunca se inventa un
   * ref_id para una arista agregada (CLAUDE.md regla 6).
   */
  fecha?: string;
  ref_id?: string;
  /** Solo con datos agregados (SupabaseDataSource): cuántos documentos componen la arista. */
  n_registros?: number;
  moneda?: string;
}

export interface GrafoCluster {
  nodos: GrafoNodo[];
  aristas: GrafoArista[];
}

export type TrayectoriaEvento = "alta" | "primer_cfdi" | "pico" | "silencio" | "publicacion_69b";

export interface TrayectoriaPunto {
  periodo: string;
  /**
   * `forense.v_trayectoria_rfc` (real) devuelve `serie[]` y `eventos[]` como
   * arreglos separados y un mes puede llevar más de uno (alta + primer_cfdi
   * coinciden seguido; publicación 69-B también). Arreglo, no escalar: no se
   * descarta ningún evento por mes.
   */
  eventos: TrayectoriaEvento[];
  monto_emitido: string;
  monto_recibido: string;
  n_cfdi: number;
}

export interface ContrasteCaso {
  caso_id: string;
  rfc_comparable: string;
  giro_compartido: string;
  pistas_solapadas: PistaCodigo[];
  resultado_comparable: Nivel;
  razon_tipificada: "defensa_aceptada" | "familia_faltante" | "cobertura_insuficiente";
  explicacion: string;
}

export interface ParComparacion {
  metrica: string;
  unidad: string;
  valor_propio: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface EmbudoEtapa {
  etapa: string;
  cantidad: number;
  denominador: number;
}

export interface InyeccionResumen {
  id: string;
  corrida_base_id: string;
  corrida_nueva_id: string | null;
  origen: "ui" | "api" | "ensayo";
  estado:
    | "recibida"
    | "validada"
    | "rechazada"
    | "snapshot_creado"
    | "pistas_recalculadas"
    | "investigando"
    | "completada"
    | "error";
  rfcs_afectados: string[];
  creado: string;
  terminado: string | null;
  diagnostico: { mensaje: string } | null;
  timeline: Array<{ paso: string; ts: string | null }>;
  diff: Array<{
    rfc: string;
    nivel_anterior: Nivel | null;
    nivel_nuevo: Nivel | null;
    pistas_nuevas: PistaCodigo[];
    caso_id: string | null;
  }>;
}

export interface VistaGuardada {
  id: string;
  nombre: string;
  ruta: string;
  filtros: Record<string, unknown>;
}
