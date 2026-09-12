import type {
  Argumento,
  Caso,
  ClusterResumen,
  ContrasteCaso,
  Corrida,
  Dictamen,
  EmbudoEtapa,
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

export interface EstadisticasCorrida {
  embudo: EmbudoEtapa[];
  confusion: Array<{ real: "positivo" | "negativo"; predicho: "positivo" | "negativo"; cantidad: number }>;
  fpr_trampas: { numerador: number; denominador: number };
  por_tipologia: Array<{ tipologia: string; cantidad: number; monto_en_riesgo: string }>;
  costo: { tokens_totales: number; duracion_ms_total: number; llamadas_totales: number; tasa_acierto_cache: number };
  rondas: { pct_ronda_2: number; pct_frontera_expandida: number; pct_reintento: number };
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

  getEntidad(rfc: string): Promise<EntidadPerfil | null>;
  getTrayectoria(rfc: string): Promise<TrayectoriaPunto[]>;
  getContraste(casoId: string): Promise<ContrasteCaso | null>;
  getPares(rfc: string): Promise<ParComparacion[]>;

  getEstadisticas(corridaId: string): Promise<EstadisticasCorrida | null>;

  listInvestigaciones(): Promise<Investigacion[]>;
  getInvestigacion(id: string): Promise<Investigacion | null>;

  listNotificaciones(): Promise<Notificacion[]>;

  getPerfil(): Promise<Perfil>;

  listInyecciones(): Promise<InyeccionResumen[]>;
  getInyeccion(id: string): Promise<InyeccionResumen | null>;

  getMapperEjemplo(): Promise<MapperPropuesta>;
}
