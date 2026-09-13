import corridaFixture from "@contracts/fixtures/valid/corrida.json";
import caso0 from "@contracts/fixtures/valid/caso-0.json";
import caso1 from "@contracts/fixtures/valid/caso-1.json";
import caso2 from "@contracts/fixtures/valid/caso-2.json";
import tareaFixture from "@contracts/fixtures/valid/tarea.json";
import senalFixture from "@contracts/fixtures/valid/senal.json";
import pistaFixture from "@contracts/fixtures/valid/pista.json";
import evidenciaValidadaFixture from "@contracts/fixtures/valid/evidencia-validada.json";
import argumentoFixture from "@contracts/fixtures/valid/argumento.json";
import replicaFixture from "@contracts/fixtures/valid/replica.json";
import dictamenFixture from "@contracts/fixtures/valid/dictamen.json";
import redactorFixture from "@contracts/fixtures/valid/redactor.json";
import investigacionFixture from "@contracts/fixtures/valid/investigacion.json";
import perfilFixture from "@contracts/fixtures/valid/perfil.json";
import notificacionFixture from "@contracts/fixtures/valid/notificacion.json";
import mapperFixture from "@contracts/fixtures/valid/mapper.json";

import clustersLocal from "./fixtures/clusters.json";
import grafoLocal from "./fixtures/grafo.json";
import trayectoriaLocal from "./fixtures/trayectoria.json";
import contrasteLocal from "./fixtures/contraste.json";
import paresLocal from "./fixtures/pares.json";
import estadisticasLocal from "./fixtures/estadisticas.json";
import inyeccionesLocal from "./fixtures/inyecciones.json";
import bitacoraLocal from "./fixtures/bitacora.json";
import entidadesLocal from "./fixtures/entidades.json";

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
  Tarea,
  TrayectoriaPunto,
} from "./types";
import type { AuditorResultado, CasoDetalle, DataSource, EntidadPerfil, EstadisticasCorrida } from "./source";

const corrida = corridaFixture as unknown as Corrida;
const casos: Caso[] = [caso0, caso1, caso2] as unknown as Caso[];
const tareasPorCaso: Record<string, Tarea[]> = {
  [caso0.id]: [tareaFixture as unknown as Tarea],
};
const senalesPorCluster: Record<string, Senal[]> = {
  [caso0.cluster_id]: [senalFixture as unknown as Senal],
};
const clustersPorCorrida = clustersLocal as unknown as Record<string, ClusterResumen[]>;
const grafoPorCluster = grafoLocal as unknown as Record<string, GrafoCluster>;
const trayectoriaPorRfc = trayectoriaLocal as unknown as Record<string, TrayectoriaPunto[]>;
const contrastePorCaso = contrasteLocal as unknown as Record<string, ContrasteCaso>;
const paresPorRfc = paresLocal as unknown as Record<string, ParComparacion[]>;
const estadisticasPorCorrida = estadisticasLocal as unknown as Record<string, EstadisticasCorrida>;
const bitacoraPorCorrida = bitacoraLocal as unknown as Record<string, EventoForense[]>;
const entidadesPorRfc = entidadesLocal as unknown as Record<string, EntidadPerfil>;

/**
 * Fuente de datos de demostración. Toda vista alimentada por esta clase debe
 * mostrar el badge "Datos de demostración · contratos v1.0.0" (o, para los
 * shapes locales sin contrato, "fixture local de UI"): ver
 * web/components/shared/fixture-badge.tsx. No hay lógica de investigación
 * aquí, solo lectura de JSON estático versionado.
 */
export class FixtureDataSource implements DataSource {
  readonly label = "fixture" as const;
  readonly noDisponibles: ReadonlySet<string> = new Set();

  async listCorridas(): Promise<Corrida[]> {
    return [corrida];
  }

  async getCorrida(id: string): Promise<Corrida | null> {
    return corrida.id === id ? corrida : null;
  }

  async listCasos(params?: { corridaId?: string }): Promise<Caso[]> {
    if (params?.corridaId) return casos.filter((c) => c.corrida_id === params.corridaId);
    return casos;
  }

  async getCaso(id: string): Promise<Caso | null> {
    return casos.find((c) => c.id === id) ?? null;
  }

  async getCasoDetalle(id: string): Promise<CasoDetalle | null> {
    const caso = await this.getCaso(id);
    if (!caso) return null;
    const esCasoFixtureCompleto = caso.id === caso0.id;
    return {
      caso,
      tareas: tareasPorCaso[id] ?? [],
      senales: esCasoFixtureCompleto ? (senalesPorCluster[caso.cluster_id] ?? []) : [],
      pistas: esCasoFixtureCompleto ? [pistaFixture as unknown as import("./types").Pista] : [],
      evidencia: esCasoFixtureCompleto
        ? [evidenciaValidadaFixture as unknown as import("./types").EvidenciaValidada]
        : [],
      defensa: esCasoFixtureCompleto ? [argumentoFixture as unknown as import("./types").Argumento] : [],
      replica: esCasoFixtureCompleto ? (replicaFixture as unknown as import("./types").Replica) : null,
      dictamen: esCasoFixtureCompleto ? (dictamenFixture as unknown as import("./types").Dictamen) : null,
      redactor: esCasoFixtureCompleto ? (redactorFixture as unknown as import("./types").Redactor) : null,
    };
  }

  async listClusters(corridaId: string): Promise<ClusterResumen[]> {
    return clustersPorCorrida[corridaId] ?? [];
  }

  async getCluster(id: string): Promise<ClusterResumen | null> {
    for (const list of Object.values(clustersPorCorrida)) {
      const found = list.find((c) => c.id === id);
      if (found) return found;
    }
    return null;
  }

  async getClusterGrafo(id: string): Promise<GrafoCluster | null> {
    return grafoPorCluster[id] ?? null;
  }

  async listSenalesCluster(id: string): Promise<Senal[]> {
    return senalesPorCluster[id] ?? [];
  }

  async getBitacoraCorrida(corridaId: string): Promise<EventoForense[]> {
    return bitacoraPorCorrida[corridaId] ?? [];
  }

  async getBitacoraCaso(casoId: string): Promise<EventoForense[]> {
    const eventos = bitacoraPorCorrida[corrida.id] ?? [];
    return eventos.filter((e) => e.caso_id === casoId);
  }

  async getEntidad(rfc: string, _corridaId?: string): Promise<EntidadPerfil | null> {
    void _corridaId; // fixture: una sola corrida
    return entidadesPorRfc[rfc] ?? null;
  }

  async getTrayectoria(rfc: string, _corridaId?: string): Promise<TrayectoriaPunto[]> {
    void _corridaId;
    return trayectoriaPorRfc[rfc] ?? [];
  }

  async getContraste(casoId: string): Promise<ContrasteCaso | null> {
    return contrastePorCaso[casoId] ?? null;
  }

  async getPares(rfc: string, _corridaId?: string): Promise<ParComparacion[]> {
    void _corridaId;
    return paresPorRfc[rfc] ?? [];
  }

  async getEstadisticas(corridaId: string): Promise<EstadisticasCorrida | null> {
    return estadisticasPorCorrida[corridaId] ?? null;
  }

  async listInvestigaciones(): Promise<Investigacion[]> {
    return [
      {
        ...(investigacionFixture as unknown as Investigacion),
        titulo: "Seguir el dinero — cluster demo",
        directriz_id: "seguir_dinero",
        mensaje: "Revisa los retornos de este cluster",
      },
    ];
  }

  async getInvestigacion(id: string): Promise<Investigacion | null> {
    const list = await this.listInvestigaciones();
    return list.find((i) => i.id === id) ?? null;
  }

  async listNotificaciones(): Promise<Notificacion[]> {
    return [notificacionFixture as unknown as Notificacion];
  }

  async getPerfil(): Promise<Perfil> {
    return { ...(perfilFixture as unknown as Perfil), correo: "auditor@forense.demo" };
  }

  async listInyecciones(): Promise<InyeccionResumen[]> {
    return inyeccionesLocal as unknown as InyeccionResumen[];
  }

  async getInyeccion(id: string): Promise<InyeccionResumen | null> {
    const list = await this.listInyecciones();
    return list.find((i) => i.id === id) ?? null;
  }

  async getMapperEjemplo(): Promise<MapperPropuesta> {
    return mapperFixture as unknown as MapperPropuesta;
  }

  async getAuditorResultado(_corridaId: string): Promise<AuditorResultado | null> {
    void _corridaId;
    return null;
  }

  async getAuditorExpedienteHtml(_corridaId: string): Promise<string | null> {
    void _corridaId;
    return null;
  }

  async getAuditorSubmission(_corridaId: string): Promise<Record<string, unknown> | null> {
    void _corridaId;
    return null;
  }
}
