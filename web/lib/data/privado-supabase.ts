import { createClient } from "@supabase/supabase-js";
import type { Investigacion, InyeccionResumen, Notificacion, Perfil, PistaCodigo, Nivel, VistaGuardada } from "./types";

/**
 * Fuente PRIVILEGIADA para perfil/investigaciones/notificaciones/inyecciones
 * (CLAUDE.md regla 3): estas tablas (006/007/008) tienen RLS sin política de
 * SELECT — únicamente `service_role` las lee, y solo el BFF (rutas API /
 * Server Components de páginas privadas, nunca un componente cliente) puede
 * invocar este módulo. `web/lib/data/supabase.ts` (el DataSource público,
 * anon) sigue devolviendo `[]`/`null`/lanzando para estos mismos métodos a
 * propósito: ese cliente JAMÁS debe alcanzar estas tablas, ni aunque las
 * migraciones ya estén aplicadas.
 *
 * Guardia en tiempo de ejecución (no hay paquete `server-only` instalado en
 * este corte y no podemos tocar package.json): si por error este módulo se
 * ejecutara fuera de Node (un bundle real de navegador), truena de
 * inmediato. Se detecta por `process.versions.node` en vez de `typeof
 * window` porque los tests de este repo corren con entorno `jsdom` (definen
 * `window` dentro de un proceso Node real) — `process.versions.node` sigue
 * presente ahí, y en un bundle de navegador de verdad no lo está. Además,
 * `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (sin prefijo `NEXT_PUBLIC_`)
 * nunca los expone webpack al bundle del cliente — quedan `undefined` ahí
 * incluso si alguien importa este archivo por error.
 */
if (typeof process === "undefined" || !process.versions?.node) {
  throw new Error(
    "lib/data/privado-supabase.ts requiere Node.js (servidor): usa SUPABASE_SERVICE_ROLE_KEY, que " +
      "nunca debe alcanzar un bundle de navegador. Si ves este error, algo lo importó desde código de cliente.",
  );
}

export function isPrivadoSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function crearClienteSupabasePrivado() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase privado no configurado: falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (servidor).");
  }
  return createClient(url, serviceKey, {
    db: { schema: "forense" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type ClientePrivado = ReturnType<typeof crearClienteSupabasePrivado>;

let clientePrivado: ClientePrivado | null = null;

function clientePrivilegiado(): ClientePrivado {
  if (!clientePrivado) clientePrivado = crearClienteSupabasePrivado();
  return clientePrivado;
}

// ---------------------------------------------------------------------------
// Filas crudas (solo las columnas que cada mapper usa)
// ---------------------------------------------------------------------------

interface FilaPerfil {
  id: string;
  nombre: string;
  organizacion: string | null;
  correo: string | null;
  telefono_e164: string | null;
  timezone: string;
  llamadas_activadas: boolean;
  permiso_aviso_at: string | null;
}

interface FilaInvestigacion {
  id: string;
  perfil_id: string;
  modo: "caso" | "corrida";
  corrida_id: string;
  caso_id: string | null;
  investigacion_padre_id: string | null;
  estado: Investigacion["estado"];
  mensaje: string | null;
  directriz_id: string | null;
  reporte_manifest: Investigacion["reporte_manifest"];
  creado: string;
  completada_at: string | null;
}

interface FilaNotificacion {
  id: string;
  perfil_id: string;
  event_id: string;
  tipo: string;
  recurso: string | null;
  titulo: string;
  leida_at: string | null;
  creado: string;
}

interface FilaInyeccion {
  id: string;
  corrida_base_id: string;
  corrida_nueva_id: string | null;
  origen: InyeccionResumen["origen"];
  estado: InyeccionResumen["estado"];
  rfcs_afectados: string[] | null;
  creado: string;
  terminado: string | null;
  diagnostico: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function mapPerfil(f: FilaPerfil): Perfil {
  return {
    id: f.id,
    nombre: f.nombre,
    organizacion: f.organizacion ?? "",
    timezone: f.timezone,
    telefono_e164: f.telefono_e164,
    llamadas_activadas: f.llamadas_activadas,
    consentimiento_at: f.permiso_aviso_at,
    correo: f.correo ?? undefined,
  };
}

/**
 * `forense.investigaciones.tipo`/eventos de salida usan notación con punto
 * ('investigacion.completa'); el contrato `entities.notificacion` (fixture
 * `notificacion.json`) usa guion bajo. Se normaliza aquí; si el valor
 * normalizado no es uno de los tres conocidos por el contrato, se deja
 * constancia en `solicitudes_coordinador` en vez de inventar un valor —
 * mientras tanto cae a 'error' (el único que no implica un desenlace falso
 * de éxito) para no fingir que una notificación desconocida fue exitosa.
 */
export function normalizarTipoNotificacion(tipo: string): Notificacion["tipo"] {
  const normalizado = tipo.replace(/\./g, "_");
  if (normalizado === "investigacion_completa" || normalizado === "llamada_resultado" || normalizado === "error") {
    return normalizado;
  }
  return "error";
}

/**
 * `recurso` en `forense.notificaciones` es la ruta ya armada por el trigger
 * (p.ej. '/investigaciones/<id>'), no el objeto {tipo,id} del contrato. Se
 * reconstruye el objeto a partir del primer segmento de la ruta; una ruta
 * que no empiece por uno de los dos prefijos conocidos cae a 'investigacion'
 * (compromiso documentado, ver solicitudes_coordinador — no hay tercer tipo
 * de recurso todavía en el esquema).
 */
export function recursoDesdeRuta(ruta: string | null): Notificacion["recurso"] {
  if (!ruta) return { tipo: "investigacion", id: "" };
  const m = ruta.match(/^\/(investigaciones|documentos|casos)\/([^/]+)/);
  if (!m) return { tipo: "investigacion", id: ruta };
  const [, prefijo, id] = m;
  return { tipo: prefijo === "casos" ? "reporte" : "investigacion", id };
}

export function mapNotificacion(f: FilaNotificacion): Notificacion {
  return {
    id: f.id,
    perfil_id: f.perfil_id,
    event_id: f.event_id,
    tipo: normalizarTipoNotificacion(f.tipo),
    titulo: f.titulo,
    recurso: recursoDesdeRuta(f.recurso),
    leida_at: f.leida_at,
    creado: f.creado,
  };
}

export function mapInvestigacion(f: FilaInvestigacion): Investigacion {
  return {
    id: f.id,
    perfil_id: f.perfil_id,
    modo: f.modo,
    corrida_id: f.corrida_id,
    // modo `corrida`: los casos de la investigación son los de su reporte_manifest.
    caso_ids: f.caso_id ? [f.caso_id] : (f.reporte_manifest ?? []).map((m) => m.caso_id).filter((id): id is string => Boolean(id)),
    estado: f.estado,
    investigacion_padre_id: f.investigacion_padre_id,
    creado: f.creado,
    completada_at: f.completada_at,
    reporte_manifest: f.reporte_manifest ?? [],
    directriz_id: f.directriz_id ?? undefined,
    mensaje: f.mensaje ?? undefined,
  };
}

/** Resumen de lista: sin timeline/diff (caros, requieren la RPC + consultas extra) — ver `leerInyeccionPrivada` para el detalle completo. */
export function mapInyeccionResumen(f: FilaInyeccion): InyeccionResumen {
  return {
    id: f.id,
    corrida_base_id: f.corrida_base_id,
    corrida_nueva_id: f.corrida_nueva_id,
    origen: f.origen,
    estado: f.estado,
    rfcs_afectados: f.rfcs_afectados ?? [],
    creado: f.creado,
    terminado: f.terminado,
    diagnostico: mensajeDiagnostico(f.diagnostico),
    timeline: [],
    diff: [],
  };
}

/**
 * `forense.inyecciones.diagnostico` es `{aceptadas,rechazadas,errores[],advertencias[]}`
 * (008 §1); el contrato de UI solo pide un mensaje. Se resume, nunca se pasa
 * texto libre del contribuyente (no lo hay aquí: son conteos y arreglos que
 * escribe el propio pipeline, no `descripcion`/`razon_social`).
 */
export function mensajeDiagnostico(diag: Record<string, unknown> | null): { mensaje: string } | null {
  if (!diag) return null;
  const partes: string[] = [];
  const aceptadas = typeof diag.aceptadas === "number" ? diag.aceptadas : null;
  const rechazadas = typeof diag.rechazadas === "number" ? diag.rechazadas : null;
  if (aceptadas !== null || rechazadas !== null) {
    partes.push(`${aceptadas ?? 0} fila(s) aceptada(s), ${rechazadas ?? 0} rechazada(s)`);
  }
  const errores = Array.isArray(diag.errores) ? diag.errores : [];
  const advertencias = Array.isArray(diag.advertencias) ? diag.advertencias : [];
  if (errores.length > 0) partes.push(`${errores.length} error(es)`);
  if (advertencias.length > 0) partes.push(`${advertencias.length} advertencia(s)`);
  return partes.length > 0 ? { mensaje: partes.join(" · ") } : null;
}

/**
 * `forense.registrar_inyeccion`/`marcar_inyeccion` escriben un único
 * `tipo_evento = 'inyeccion'` en la bitácora con `payload.evento_real`
 * distinguiendo el paso ('inyeccion_recibida', 'inyeccion_validada',
 * 'snapshot_creado', 'estado_<estado>'). No existe un evento para
 * 'clusters_afectados' todavía (`forense.clusters_afectados` es una
 * consulta, no un logger) — ese paso queda sin timestamp a propósito
 * (CLAUDE.md regla 2: sin evento persistido no hay paso, nunca se anima).
 */
const EVENTO_A_PASO: Record<string, string> = {
  inyeccion_recibida: "recibida",
  inyeccion_validada: "validada",
  snapshot_creado: "snapshot_creado",
  estado_pistas_recalculadas: "pistas_recalculadas",
  estado_investigando: "investigacion",
  estado_completada: "dictamen",
};

export function timelineDesdeEventos(eventos: Array<{ ts: string | null; evento: string | null }>): InyeccionResumen["timeline"] {
  const tsPorPaso = new Map<string, string>();
  for (const e of eventos) {
    if (!e.evento || !e.ts) continue;
    const paso = EVENTO_A_PASO[e.evento];
    if (paso && !tsPorPaso.has(paso)) tsPorPaso.set(paso, e.ts);
  }
  return [...tsPorPaso.entries()].map(([paso, ts]) => ({ paso, ts }));
}

// ---------------------------------------------------------------------------
// Diff antes/después por RFC (21 §3.3) — no hay RPC ni vista para esto
// todavía (ver solicitudes_coordinador); se calcula aquí comparando
// `casos`/`pistas` de la corrida base contra la corrida nueva, con el mismo
// cliente de service_role (más simple que razonar permisos anon tabla por
// tabla, y este módulo ya es exclusivamente de servidor).
// ---------------------------------------------------------------------------

interface FilaCasoDiff {
  id: string;
  rfc_principal: string | null;
  rfcs_satelite: string[] | null;
  nivel: Nivel | null;
}
interface FilaPistaDiff {
  rfc: string | null;
  codigo: PistaCodigo | null;
}

export function buscarCasoPorRfc(casos: FilaCasoDiff[], rfc: string): { nivel: Nivel | null; caso_id: string | null } {
  const caso = casos.find((c) => c.rfc_principal === rfc || (c.rfcs_satelite ?? []).includes(rfc));
  return caso ? { nivel: caso.nivel, caso_id: caso.id } : { nivel: null, caso_id: null };
}

export function codigosPorRfc(pistas: FilaPistaDiff[], rfc: string): Set<PistaCodigo> {
  return new Set(pistas.filter((p) => p.rfc === rfc && p.codigo).map((p) => p.codigo as PistaCodigo));
}

async function construirDiff(
  client: ClientePrivado,
  corridaBaseId: string,
  corridaNuevaId: string | null,
  rfcs: string[],
): Promise<InyeccionResumen["diff"]> {
  if (!corridaNuevaId || rfcs.length === 0) return [];

  const [casosBase, casosNueva, pistasBase, pistasNueva] = await Promise.all([
    client.from("casos").select("id,rfc_principal,rfcs_satelite,nivel").eq("corrida_id", corridaBaseId),
    client.from("casos").select("id,rfc_principal,rfcs_satelite,nivel").eq("corrida_id", corridaNuevaId),
    client.from("pistas").select("rfc,codigo").eq("corrida_id", corridaBaseId).in("rfc", rfcs),
    client.from("pistas").select("rfc,codigo").eq("corrida_id", corridaNuevaId).in("rfc", rfcs),
  ]);
  if (casosBase.error) throw new Error(`construirDiff: casos base: ${casosBase.error.message}`);
  if (casosNueva.error) throw new Error(`construirDiff: casos nueva: ${casosNueva.error.message}`);
  if (pistasBase.error) throw new Error(`construirDiff: pistas base: ${pistasBase.error.message}`);
  if (pistasNueva.error) throw new Error(`construirDiff: pistas nueva: ${pistasNueva.error.message}`);

  const filasCasosBase = (casosBase.data ?? []) as FilaCasoDiff[];
  const filasCasosNueva = (casosNueva.data ?? []) as FilaCasoDiff[];
  const filasPistasBase = (pistasBase.data ?? []) as FilaPistaDiff[];
  const filasPistasNueva = (pistasNueva.data ?? []) as FilaPistaDiff[];

  return rfcs.map((rfc) => {
    const anterior = buscarCasoPorRfc(filasCasosBase, rfc);
    const nueva = buscarCasoPorRfc(filasCasosNueva, rfc);
    const antes = codigosPorRfc(filasPistasBase, rfc);
    const despues = codigosPorRfc(filasPistasNueva, rfc);
    const pistasNuevas = [...despues].filter((c) => !antes.has(c));
    return {
      rfc,
      nivel_anterior: anterior.nivel,
      nivel_nuevo: nueva.nivel,
      pistas_nuevas: pistasNuevas,
      caso_id: nueva.caso_id,
    };
  });
}

// ---------------------------------------------------------------------------
// API pública del módulo — consumida únicamente por `./privado.ts`
// ---------------------------------------------------------------------------

/**
 * Sin `perfilId`: bootstrap de login (`/api/session`, único punto que
 * todavía no tiene un `perfil_id` de sesión — es lo que la crea). El
 * workspace demo tiene UN solo perfil compartido ('auditor' es la única
 * credencial y `forense.perfiles` no tiene columna de usuario todavía). En
 * vez de tomar "la primera fila" en silencio (CLAUDE.md regla 3 — Corte 3
 * hallazgo 1), se exige explícitamente esa invariante: si algún día hay más
 * de un perfil, esto falla alto en vez de autenticar contra el equivocado.
 *
 * Con `perfilId`: todas las demás lecturas (ya con sesión) filtran por id,
 * nunca por "la primera fila".
 */
export async function leerPerfilPrivado(perfilId?: string): Promise<Perfil> {
  const client = clientePrivilegiado();
  if (perfilId) {
    const { data, error } = await client.from("perfiles").select("*").eq("id", perfilId).maybeSingle();
    if (error) throw new Error(`leerPerfilPrivado: ${error.message}`);
    if (!data) throw new Error(`leerPerfilPrivado: no existe el perfil ${perfilId}.`);
    return mapPerfil(data as FilaPerfil);
  }
  const { data, error } = await client.from("perfiles").select("*").limit(2);
  if (error) throw new Error(`leerPerfilPrivado: ${error.message}`);
  const filas = (data ?? []) as FilaPerfil[];
  if (filas.length === 0) {
    throw new Error("leerPerfilPrivado: forense.perfiles está vacío (falta correr db/seeds/seed_producto.sql).");
  }
  if (filas.length > 1) {
    throw new Error(
      "leerPerfilPrivado: hay más de un perfil en forense.perfiles y el login demo ('auditor') todavía no sabe " +
        "elegir entre ellos (CLAUDE.md regla 3 — nunca 'la primera fila'); falta una columna de usuario o resolver " +
        "esto explícitamente antes de sumar un segundo perfil.",
    );
  }
  return mapPerfil(filas[0]);
}

export async function leerInvestigacionesPrivadas(perfilId: string): Promise<Investigacion[]> {
  const client = clientePrivilegiado();
  const { data, error } = await client.from("investigaciones").select("*").eq("perfil_id", perfilId).order("creado", { ascending: false });
  if (error) throw new Error(`leerInvestigacionesPrivadas: ${error.message}`);
  return (data ?? []).map((f) => mapInvestigacion(f as FilaInvestigacion));
}

export async function leerInvestigacionPrivada(id: string, perfilId: string): Promise<Investigacion | null> {
  const client = clientePrivilegiado();
  // `.eq("perfil_id", perfilId)` además de `.eq("id", id)`: una investigación
  // de otro perfil con ese id nunca debe resolver a datos ajenos, aunque se
  // conozca (o se adivine) el id — 404 legítimo, igual que un id inexistente.
  const { data, error } = await client.from("investigaciones").select("*").eq("id", id).eq("perfil_id", perfilId).maybeSingle();
  if (error) throw new Error(`leerInvestigacionPrivada: ${error.message}`);
  return data ? mapInvestigacion(data as FilaInvestigacion) : null;
}

export async function leerNotificacionesPrivadas(perfilId: string): Promise<Notificacion[]> {
  const client = clientePrivilegiado();
  const { data, error } = await client.from("notificaciones").select("*").eq("perfil_id", perfilId).order("creado", { ascending: false });
  if (error) throw new Error(`leerNotificacionesPrivadas: ${error.message}`);
  return (data ?? []).map((f) => mapNotificacion(f as FilaNotificacion));
}

export async function leerInyeccionesPrivadas(perfilId: string): Promise<InyeccionResumen[]> {
  const client = clientePrivilegiado();
  const { data, error } = await client.from("inyecciones").select("*").eq("perfil_id", perfilId).order("creado", { ascending: false });
  if (error) throw new Error(`leerInyeccionesPrivadas: ${error.message}`);
  return (data ?? []).map((f) => mapInyeccionResumen(f as FilaInyeccion));
}

export async function leerInyeccionPrivada(id: string, perfilId: string): Promise<InyeccionResumen | null> {
  const client = clientePrivilegiado();
  const { data, error } = await client.rpc("estado_inyeccion", { p_inyeccion: id });
  if (error) throw new Error(`leerInyeccionPrivada: ${error.message}`);
  if (!data) return null;
  const estado = data as {
    id: string;
    perfil_id?: string | null;
    corrida_base_id: string;
    corrida_nueva_id: string | null;
    origen: InyeccionResumen["origen"];
    estado: InyeccionResumen["estado"];
    rfcs_afectados: string[];
    creado: string;
    terminado: string | null;
    diagnostico: Record<string, unknown> | null;
    timeline: Array<{ ts: string | null; evento: string | null }>;
  };
  // `estado_inyeccion` (008) no acepta un filtro de perfil — sí devuelve
  // `perfil_id` (el dueño real, escrito por `/api/inyecciones` al recibir la
  // inyección). Una fila con dueño distinto es 404 legítimo aunque se
  // conozca el id; una fila sin dueño (perfil_id null: origen 'ensayo' o
  // pipeline sin sesión) no es DE OTRO perfil, sigue siendo visible.
  if (estado.perfil_id && estado.perfil_id !== perfilId) return null;
  const diff = await construirDiff(client, estado.corrida_base_id, estado.corrida_nueva_id, estado.rfcs_afectados ?? []);
  return {
    id: estado.id,
    corrida_base_id: estado.corrida_base_id,
    corrida_nueva_id: estado.corrida_nueva_id,
    origen: estado.origen,
    estado: estado.estado,
    rfcs_afectados: estado.rfcs_afectados ?? [],
    creado: estado.creado,
    terminado: estado.terminado,
    diagnostico: mensajeDiagnostico(estado.diagnostico),
    timeline: timelineDesdeEventos(estado.timeline ?? []),
    diff,
  };
}

// ---------------------------------------------------------------------------
// Vistas guardadas (15 §9, `forense.vistas_guardadas` — 006 §3). Únicas del
// perfil (unique(perfil_id, nombre)): guardar dos veces el mismo nombre
// actualiza la vista existente, nunca duplica. Siempre acotadas a
// `perfilId` explícito (el que resolvió la sesión en la ruta API, nunca uno
// que mande el cliente) porque service_role bypasea RLS por completo.
// ---------------------------------------------------------------------------

interface FilaVista {
  id: string;
  nombre: string;
  ruta: string;
  filtros: Record<string, unknown> | null;
}

export function mapVista(f: FilaVista): VistaGuardada {
  return { id: f.id, nombre: f.nombre, ruta: f.ruta, filtros: f.filtros ?? {} };
}

export async function leerVistasGuardadasPrivadas(perfilId: string, ruta: string): Promise<VistaGuardada[]> {
  const client = clientePrivilegiado();
  const { data, error } = await client
    .from("vistas_guardadas")
    .select("id,nombre,ruta,filtros")
    .eq("perfil_id", perfilId)
    .eq("ruta", ruta)
    .order("creado", { ascending: true });
  if (error) throw new Error(`leerVistasGuardadasPrivadas: ${error.message}`);
  return (data ?? []).map((f) => mapVista(f as FilaVista));
}

export async function guardarVistaPrivada(input: { perfilId: string; nombre: string; ruta: string; filtros: Record<string, unknown> }): Promise<VistaGuardada> {
  const client = clientePrivilegiado();
  const { data, error } = await client
    .from("vistas_guardadas")
    .upsert(
      { perfil_id: input.perfilId, nombre: input.nombre, ruta: input.ruta, filtros: input.filtros, actualizado: new Date().toISOString() },
      { onConflict: "perfil_id,nombre" },
    )
    .select("id,nombre,ruta,filtros")
    .single();
  if (error) throw new Error(`guardarVistaPrivada: ${error.message}`);
  return mapVista(data as FilaVista);
}

export async function borrarVistaPrivada(perfilId: string, id: string): Promise<void> {
  const client = clientePrivilegiado();
  // `.eq("perfil_id", perfilId)` es lo que impide borrar la vista de otro
  // perfil: service_role no tiene RLS que lo haga por nosotros.
  const { error } = await client.from("vistas_guardadas").delete().eq("id", id).eq("perfil_id", perfilId);
  if (error) throw new Error(`borrarVistaPrivada: ${error.message}`);
}

/** Solo para tests: fuerza a recrear el cliente cacheado tras cambiar env vars. */
export function _resetClientePrivadoParaTests(): void {
  clientePrivado = null;
}

/** Solo para tests: inyecta un cliente falso encadenable en vez de crear uno real (sin red, sin credenciales). */
export function _inyectarClienteParaTests(clienteFalso: ClientePrivado): void {
  clientePrivado = clienteFalso;
}
