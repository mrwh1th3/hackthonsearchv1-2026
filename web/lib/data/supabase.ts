import { createClient } from "@supabase/supabase-js";
import type {
  Caso,
  ClusterResumen,
  ContrasteCaso,
  Corrida,
  EventoForense,
  GrafoCluster,
  InyeccionResumen,
  Investigacion,
  MapperPropuesta,
  Notificacion,
  ParComparacion,
  Perfil,
  Senal,
  TrayectoriaPunto,
} from "./types";
import type { CasoDetalle, DataSource, EntidadPerfil, EstadisticasCorrida } from "./source";

/**
 * Esqueleto de fuente de datos real. Solo se activa cuando existen
 * NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY (ver
 * web/lib/data/index.ts). Ningún método está implementado todavía: 05/06
 * definen las vistas (`forense.v_*`) y RPC que esta clase deberá consultar
 * cuando forense-db/forense-runtime las publiquen. Hasta entonces la app usa
 * FixtureDataSource y lo declara visiblemente (regla CLAUDE.md #3: la UI lee
 * datos persistidos, nunca n8n).
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function createForenseSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase no configurado: falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, anonKey, { db: { schema: "forense" } });
}

function notImplemented(metodo: string): never {
  throw new Error(
    `SupabaseDataSource.${metodo}: pendiente de vistas/RPC de forense-db (05/06). ` +
      "No implementado en este corte; usar FixtureDataSource mientras tanto.",
  );
}

export class SupabaseDataSource implements DataSource {
  readonly label = "supabase" as const;
  private readonly client: ReturnType<typeof createForenseSupabaseClient>;

  constructor() {
    this.client = createForenseSupabaseClient();
  }

  async listCorridas(): Promise<Corrida[]> {
    return notImplemented("listCorridas");
  }
  async getCorrida(_id: string): Promise<Corrida | null> {
    return notImplemented("getCorrida");
  }
  async listCasos(_params?: { corridaId?: string }): Promise<Caso[]> {
    return notImplemented("listCasos");
  }
  async getCaso(_id: string): Promise<Caso | null> {
    return notImplemented("getCaso");
  }
  async getCasoDetalle(_id: string): Promise<CasoDetalle | null> {
    return notImplemented("getCasoDetalle");
  }
  async listClusters(_corridaId: string): Promise<ClusterResumen[]> {
    return notImplemented("listClusters");
  }
  async getCluster(_id: string): Promise<ClusterResumen | null> {
    return notImplemented("getCluster");
  }
  async getClusterGrafo(_id: string): Promise<GrafoCluster | null> {
    return notImplemented("getClusterGrafo");
  }
  async listSenalesCluster(_id: string): Promise<Senal[]> {
    return notImplemented("listSenalesCluster");
  }
  async getBitacoraCorrida(_corridaId: string): Promise<EventoForense[]> {
    return notImplemented("getBitacoraCorrida");
  }
  async getBitacoraCaso(_casoId: string): Promise<EventoForense[]> {
    return notImplemented("getBitacoraCaso");
  }
  async getEntidad(_rfc: string): Promise<EntidadPerfil | null> {
    return notImplemented("getEntidad");
  }
  async getTrayectoria(_rfc: string): Promise<TrayectoriaPunto[]> {
    return notImplemented("getTrayectoria");
  }
  async getContraste(_casoId: string): Promise<ContrasteCaso | null> {
    return notImplemented("getContraste");
  }
  async getPares(_rfc: string): Promise<ParComparacion[]> {
    return notImplemented("getPares");
  }
  async getEstadisticas(_corridaId: string): Promise<EstadisticasCorrida | null> {
    return notImplemented("getEstadisticas");
  }
  async listInvestigaciones(): Promise<Investigacion[]> {
    return notImplemented("listInvestigaciones");
  }
  async getInvestigacion(_id: string): Promise<Investigacion | null> {
    return notImplemented("getInvestigacion");
  }
  async listNotificaciones(): Promise<Notificacion[]> {
    return notImplemented("listNotificaciones");
  }
  async getPerfil(): Promise<Perfil> {
    return notImplemented("getPerfil");
  }
  async listInyecciones(): Promise<InyeccionResumen[]> {
    return notImplemented("listInyecciones");
  }
  async getInyeccion(_id: string): Promise<InyeccionResumen | null> {
    return notImplemented("getInyeccion");
  }
  async getMapperEjemplo(): Promise<MapperPropuesta> {
    return notImplemented("getMapperEjemplo");
  }
}
