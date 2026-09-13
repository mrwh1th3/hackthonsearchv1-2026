import type { Caso, EventoForense, Tarea } from "@/lib/data";
import type { EjecucionAgenteInfo } from "@/lib/data/privado";
import { estimarCostoUsd } from "./costo";

/**
 * Derivación pura del canvas "Análisis en proceso" (feedback 2026-09-12,
 * contenido del bloque `boardOpen` de `design-ref/Agents.dc.html`, que en el
 * original es un lienzo vacío). Todo sale de lo persistido — `casos.estado`,
 * `forense.tareas_agente` y `forense.bitacora` — nunca de n8n (regla 3) y
 * nunca de un reloj simulado: sin evento persistido no hay nodo ni log
 * (reglas 2 y 12). Vive fuera del componente para probarse sin DOM.
 */

/** Estados de `forense.casos.estado` (001_schema) en el orden del pipeline de 03/07. */
const ETAPA_CASO: Record<string, string> = {
  en_cola: "cola",
  ronda1: "ronda 1 · especialistas",
  ronda_1: "ronda 1 · especialistas",
  ronda2: "ronda 2 · especialistas",
  ronda_2: "ronda 2 · especialistas",
  auditando: "auditoría",
  auditoria: "auditoría",
  defendiendo: "defensa",
  replicando: "réplica",
  validando: "validación",
  dictaminando: "dictamen",
  redactando: "redacción",
  dictaminado: "dictamen emitido",
  reintento: "reintento",
  error: "error",
};

export function etapaCaso(estado: string | null | undefined): string {
  if (!estado) return "cola";
  return ETAPA_CASO[estado] ?? estado.replace(/_/g, " ");
}

/** El caso ya no avanza: el canvas deja de animar y ofrece los resultados. */
export function casoTerminado(estado: string | null | undefined): boolean {
  return estado === "dictaminado" || estado === "error";
}

/** Roles fuera de las rondas de especialistas, en orden de ejecución (07 §2). */
const ROLES: Array<{ agente: string; etapa: string }> = [
  { agente: "auditor", etapa: "auditoría" },
  { agente: "defensor", etapa: "defensa" },
  { agente: "auditor_final", etapa: "auditor final" },
  { agente: "redactor", etapa: "redacción" },
];

const NOMBRE_AGENTE: Record<string, string> = {
  documental: "documental",
  financiero: "financiero",
  relacional: "relacional",
  temporal: "temporal",
  externo: "externo",
  auditor: "auditoría",
  defensor: "defensa",
  auditor_final: "auditoría final",
  redactor: "redacción",
  editor: "edición",
};

export function nombreAgente(agente: string): string {
  return NOMBRE_AGENTE[agente] ?? agente.replace(/_/g, " ");
}

export type EstadoNodo = "pendiente" | "ejecutando" | "completada" | "omitida" | "error";

function estadoNodo(estado: string): EstadoNodo {
  if (estado === "ejecutando") return "ejecutando";
  if (estado === "omitida") return "omitida";
  if (estado === "completada") return "completada";
  if (estado === "error" || estado === "timeout") return "error";
  return "pendiente";
}

export interface LogAgente {
  id: string;
  nombre: string;
  /** `null` = el paso sigue en proceso. */
  ts: string | null;
}

export interface NodoAgente {
  /** `agente:ronda` — reintentos del mismo agente en la misma ronda se funden en un nodo, gana el último intento. */
  id: string;
  agente: string;
  etapa: string;
  estado: EstadoNodo;
  intento: number;
  iniciado: string | null;
  terminado: string | null;
  /** Instante en que el reloj del nodo se detiene: `terminado`, o el último evento si falló sin cerrarse; `null` = sigue corriendo. */
  detenido: string | null;
  tokens: number;
  logs: LogAgente[];
  /**
   * Runtime real (`forense.ejecuciones_agente`/`llm_solicitudes`/
   * `tool_ejecuciones`, BFF privado): `null` cuando esta tarea todavía no
   * tiene una ejecución de runtime asociada (p.ej. corridas anteriores a que
   * el runtime instrumentara este paso) — nunca se rellena con ceros.
   */
  runtime: EjecucionAgenteInfo | null;
}

export interface EtapaArbol {
  id: string;
  titulo: string;
  nodos: NodoAgente[];
  /** Etapa del pipeline que todavía no tiene tareas persistidas: se dibuja punteada y sin animación. */
  pendiente: boolean;
}

const TIPO_EVENTO: Record<string, string> = {
  caso_creado: "Caso creado",
  cluster_armado: "Cluster armado",
  pista_cargada: "Pista cargada",
  ronda_inicio: "Inicio de ronda",
  ronda_fin: "Fin de ronda",
  razonamiento: "Razonamiento",
  tool_call: "Consulta a herramienta",
  tool_result: "Resultado de herramienta",
  senal_escrita: "Señal escrita",
  senal_leida: "Señal leída",
  despertar: "Despertar",
  frontera_detectada: "Frontera detectada",
  cluster_expandido: "Cluster expandido",
  auditoria: "Auditoría",
  defensa_inicio: "Inicio de defensa",
  defensa_argumento: "Argumento de defensa",
  replica: "Réplica",
  validacion: "Validación",
  evidencia_descartada: "Evidencia descartada",
  dictamen: "Dictamen",
  rechazo_auditor_final: "Rechazo del auditor final",
  reintento_inicio: "Inicio de reintento",
  redaccion_inicio: "Inicio de redacción",
  redaccion_fin: "Fin de redacción",
  edicion: "Edición",
  error: "Error",
  presupuesto_agotado: "Presupuesto agotado",
  paso_en_cola: "Paso en cola",
  paso_checkpoint: "Checkpoint",
};

export function nombreEvento(e: EventoForense): string {
  const resumen = e.payload.resumen?.trim();
  if (resumen && resumen !== e.tipo_evento) return resumen;
  return TIPO_EVENTO[e.tipo_evento] ?? e.tipo_evento.replace(/_/g, " ");
}

export function tokensDe(eventos: EventoForense[]): number {
  return eventos.reduce((s, e) => s + (e.tokens_in ?? 0) + (e.tokens_out ?? 0), 0);
}

function ordenEventos(a: EventoForense, b: EventoForense): number {
  if (a.seq != null && b.seq != null && a.seq !== b.seq) return a.seq - b.seq;
  return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
}

/**
 * Logs de un nodo: cada evento persistido es un paso terminado con su hora.
 * El único "en proceso" posible es real: un `tool_call` sin `tool_result`
 * posterior (la bitácora escribe la llamada antes de la respuesta), o la
 * tarea marcada `ejecutando`/`pendiente` sin eso — entonces se nombra por su
 * estado, no por un paso inventado.
 */
function logsDe(eventos: EventoForense[], estado: EstadoNodo): LogAgente[] {
  const ordenados = [...eventos].sort(ordenEventos);
  const logs: LogAgente[] = ordenados.map((e) => ({ id: e.id, nombre: nombreEvento(e), ts: e.ts }));
  if (estado !== "ejecutando" && estado !== "pendiente") return logs;
  const ultimo = ordenados[ordenados.length - 1];
  if (ultimo?.tipo_evento === "tool_call") {
    logs[logs.length - 1] = { ...logs[logs.length - 1], ts: null };
  } else {
    logs.push({ id: "en-proceso", nombre: estado === "pendiente" ? "En espera de despacho" : "Paso del agente", ts: null });
  }
  return logs;
}

export interface ArbolAnalisis {
  etapas: EtapaArbol[];
  etapaActual: string;
  tokens: number;
  terminado: boolean;
  /** Suma real de `llm_solicitudes.tokens_in/out` del caso; `null` si el runtime todavía no registró ninguna. */
  tokensRuntime: { in: number; out: number } | null;
  /** No hay columna de costo persistida todavía (ver `EjecucionAgenteInfo.costo`); siempre `null` hoy. */
  costoRuntime: number | null;
  /** Suma de estimados por ejecución (`estimarCostoUsd`, precios públicos): `null` si ninguna ejecución tiene modelo/tokens conocidos. */
  costoEstimadoUsd: number | null;
  /** `desde` = primer `creado`, `hasta` = último `actualizado` (o ahora si alguna ejecución sigue activa); `null` sin ejecuciones. */
  runtimeSpan: { desde: string; hasta: string | null } | null;
}

export function construirArbol(
  caso: Caso | null,
  tareas: Tarea[],
  eventos: EventoForense[],
  runtime: EjecucionAgenteInfo[] = [],
): ArbolAnalisis {
  const runtimePorTarea = new Map<string, EjecucionAgenteInfo>();
  for (const r of runtime) {
    if (r.tarea_id) runtimePorTarea.set(r.tarea_id, r);
  }
  const porNodo = new Map<string, Tarea>();
  for (const t of tareas) {
    const clave = `${t.agente}:${t.ronda}`;
    const previa = porNodo.get(clave);
    if (!previa || t.intento >= previa.intento) porNodo.set(clave, t);
  }

  const tareasDeNodo = new Map<string, Set<string>>();
  for (const t of tareas) {
    const clave = `${t.agente}:${t.ronda}`;
    if (!tareasDeNodo.has(clave)) tareasDeNodo.set(clave, new Set());
    tareasDeNodo.get(clave)!.add(t.id);
  }

  function nodo(clave: string, t: Tarea, etapa: string): NodoAgente {
    const ids = tareasDeNodo.get(clave) ?? new Set<string>();
    const propios = eventos.filter((e) => e.tarea_id != null && ids.has(e.tarea_id));
    const estado = estadoNodo(t.estado);
    const ultimoTs = propios.reduce<string | null>((max, e) => (max === null || e.ts > max ? e.ts : max), null);
    // Una tarea en error/timeout que nunca escribió `terminado` no sigue
    // "ejecutándose": su reloj para en su último rastro persistido.
    const detenido = t.terminado ?? (estado === "error" || estado === "completada" || estado === "omitida" ? (ultimoTs ?? t.iniciado ?? null) : null);
    // Varios intentos de la misma clave `agente:ronda` pueden tener runtime
    // propio; se toma el de la tarea que ganó el nodo (la del último intento).
    const runtimeIds = [...ids].map((idTarea) => runtimePorTarea.get(idTarea)).filter((r): r is EjecucionAgenteInfo => r != null);
    const runtimeNodo = runtimeIds.find((r) => r.tarea_id === t.id) ?? runtimeIds[runtimeIds.length - 1] ?? null;
    return {
      id: clave,
      agente: t.agente,
      etapa,
      estado,
      intento: t.intento,
      iniciado: t.iniciado ?? null,
      terminado: t.terminado ?? null,
      detenido,
      tokens: tokensDe(propios),
      logs: logsDe(propios, estado),
      runtime: runtimeNodo,
    };
  }

  const rolesSet = new Set(ROLES.map((r) => r.agente));
  const especialistas = [...porNodo.entries()].filter(([, t]) => !rolesSet.has(t.agente));
  const rondas = [...new Set(especialistas.map(([, t]) => t.ronda))].sort((a, b) => a - b);

  const etapas: EtapaArbol[] = [];
  const rondasVisibles = rondas.length > 0 ? rondas : [1];
  for (const r of rondasVisibles) {
    const titulo = `Ronda ${r} · especialistas`;
    const nodos = especialistas
      .filter(([, t]) => t.ronda === r)
      .map(([clave, t]) => nodo(clave, t, `ronda ${r}`))
      .sort((a, b) => a.agente.localeCompare(b.agente));
    etapas.push({ id: `ronda-${r}`, titulo, nodos, pendiente: nodos.length === 0 });
  }
  for (const rol of ROLES) {
    const nodos = [...porNodo.entries()].filter(([, t]) => t.agente === rol.agente).map(([clave, t]) => nodo(clave, t, rol.etapa));
    const titulo = rol.etapa.charAt(0).toUpperCase() + rol.etapa.slice(1);
    etapas.push({ id: rol.agente, titulo, nodos, pendiente: nodos.length === 0 });
  }

  const tokensRuntime =
    runtime.length > 0
      ? { in: runtime.reduce((s, r) => s + (r.tokens_in ?? 0), 0), out: runtime.reduce((s, r) => s + (r.tokens_out ?? 0), 0) }
      : null;

  const costos = runtime.map((r) => estimarCostoUsd(r.model_id, r.tokens_in, r.tokens_out)).filter((c): c is number => c != null);
  const costoEstimadoUsd = costos.length > 0 ? costos.reduce((a, b) => a + b, 0) : null;

  const activasRuntime = runtime.filter((r) => r.estado_interno !== "terminado" && r.estado_interno !== "error" && r.estado_interno !== "timeout" && !r.cancelada);
  const runtimeSpan =
    runtime.length > 0
      ? {
          desde: runtime.reduce((min, r) => (r.creado < min ? r.creado : min), runtime[0].creado),
          hasta: activasRuntime.length > 0 ? null : runtime.reduce((max, r) => (r.actualizado > max ? r.actualizado : max), runtime[0].actualizado),
        }
      : null;

  return {
    etapas,
    etapaActual: etapaCaso(caso?.estado),
    tokens: tokensDe(eventos),
    terminado: casoTerminado(caso?.estado),
    tokensRuntime,
    costoRuntime: null,
    costoEstimadoUsd,
    runtimeSpan,
  };
}

/** `1h 02m 09s` / `4m 05s` / `12s`. Negativo o inválido → `0s`. */
export function duracion(desde: string | null | undefined, hasta: number): string {
  if (!desde) return "—";
  const inicio = new Date(desde).getTime();
  if (Number.isNaN(inicio)) return "—";
  const total = Math.max(0, Math.floor((hasta - inicio) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dd = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${dd(m)}m ${dd(s)}s`;
  if (m > 0) return `${m}m ${dd(s)}s`;
  return `${s}s`;
}

export function formatoTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
