import { canonico } from "./documento";
import { aMarkdown } from "./markdown";
import { sha256Hex } from "./sha256";
import type { Documento, Propuesta, Reporte } from "./tipos";

/**
 * Almacén de versiones del expediente **de demostración**.
 *
 * QUÉ NO ES: no es persistencia. Vive en memoria del proceso Next.js, es
 * process-local y se reinicia con cada arranque o redespliegue. No escribe en
 * `forense.bitacora` (CLAUDE.md regla 2): por eso ninguna vista alimentada por
 * este almacén puede presentarse como trazabilidad del pipeline, y toda
 * respuesta del BFF que lo use viaja con `origen: "fixture"`.
 *
 * POR QUÉ EXISTE: 07 §4 paso 5 define Aplicar como "operación determinista del
 * BFF" contra la base, no contra n8n. Sin proyecto Supabase disponible (21 §5:
 * bloqueo de proyectos free), las operaciones deterministas —aplicar, descartar,
 * revertir, exportar, autoguardar— necesitan un destino para ser demostrables y
 * probables. Cuando exista la tabla real (`reportes`/`propuestas_edicion` de
 * 05/06), este módulo se sustituye por el repositorio de Supabase conservando la
 * misma interfaz.
 *
 * Reglas que implementa y que las pruebas fijan:
 * - El autoguardado NO crea versión: escribe un borrador por `version_base`.
 * - Solo Aplicar y revertir crean versión.
 * - Aplicar es idempotente por `idempotency_key` **y** por propuesta ya
 *   aplicada: un doble click devuelve la misma versión, nunca dos.
 * - `version_base` distinto del actual es conflicto: no se escribe nada y se
 *   informa la versión vigente (el cliente conserva su borrador).
 * - El editor nunca marca `estado_revision: "validado"`; esa promoción es del
 *   validador del servidor.
 */

export interface Borrador {
  version_base: number;
  documento: Documento;
  markdown: string;
  content_hash: string;
  guardado: string;
}

export interface PropuestaGuardada {
  caso_id: string;
  propuesta: Propuesta;
  previsualizacion: Documento;
  estado: "pendiente" | "aplicada" | "descartada";
  version_creada?: number;
}

interface EstadoCaso {
  versiones: Reporte[];
  propuestas: Map<string, PropuestaGuardada>;
  idempotencia: Map<string, number>;
  borrador: Borrador | null;
}

const casos = new Map<string, EstadoCaso>();

/** Solo para pruebas: deja el almacén vacío. */
export function reiniciarAlmacen(): void {
  casos.clear();
}

function estado(casoId: string): EstadoCaso {
  let actual = casos.get(casoId);
  if (!actual) {
    actual = { versiones: [], propuestas: new Map(), idempotencia: new Map(), borrador: null };
    casos.set(casoId, actual);
  }
  return actual;
}

/** Hash del contenido guardado: JSON canónico + Markdown derivado, en una sola operación (15 §10). */
export function hashContenido(documento: Documento, markdown: string): string {
  return sha256Hex(canonico({ contenido_json: documento, markdown }));
}

function nuevaVersion(
  casoId: string,
  documento: Documento,
  autor: Reporte["autor"],
  estadoRevision: Reporte["estado_revision"] = "borrador",
): Reporte {
  const caso = estado(casoId);
  const markdown = aMarkdown(documento);
  const reporte: Reporte = {
    caso_id: casoId,
    version: caso.versiones.length + 1,
    estado_revision: estadoRevision,
    autor,
    creado: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    contenido_json: documento,
    markdown,
    content_hash: hashContenido(documento, markdown),
  };
  caso.versiones.push(reporte);
  caso.borrador = null; // el borrador vigente quedó incorporado en la versión
  return reporte;
}

/**
 * Siembra la versión 1 desde el documento entregado por el Redactor.
 * Idempotente: si el caso ya tiene versiones, no hace nada.
 */
export function sembrarCaso(casoId: string, documento: Documento): Reporte {
  const caso = estado(casoId);
  if (caso.versiones.length === 0) {
    // La versión 1 es la salida del pipeline (autor `agente`), no una edición.
    return nuevaVersion(casoId, documento, "agente", "validado");
  }
  return caso.versiones[caso.versiones.length - 1];
}

export function versiones(casoId: string): Reporte[] {
  return [...estado(casoId).versiones];
}

export function versionActual(casoId: string): Reporte | null {
  const lista = estado(casoId).versiones;
  return lista.length > 0 ? lista[lista.length - 1] : null;
}

export function obtenerVersion(casoId: string, version: number): Reporte | null {
  return estado(casoId).versiones.find((v) => v.version === version) ?? null;
}

export function borradorActual(casoId: string): Borrador | null {
  return estado(casoId).borrador;
}

export type ResultadoEscritura<T> =
  | { ok: true; valor: T }
  | { ok: false; motivo: "conflicto_version"; version_actual: number }
  | {
      ok: false;
      motivo:
        | "propuesta_desconocida"
        | "propuesta_descartada"
        | "version_inexistente"
        /** La fila existe pero su `patch` no es un documento: dato corrupto. */
        | "propuesta_sin_patch";
    };

/** Autoguardado: sobrescribe el borrador de `version_base`. NO crea versión. */
export function guardarBorrador(
  casoId: string,
  args: { version_base: number; documento: Documento },
): ResultadoEscritura<Borrador> {
  const caso = estado(casoId);
  const actual = versionActual(casoId);
  if (!actual) return { ok: false, motivo: "version_inexistente" };
  if (actual.version !== args.version_base) {
    return { ok: false, motivo: "conflicto_version", version_actual: actual.version };
  }
  const markdown = aMarkdown(args.documento);
  const borrador: Borrador = {
    version_base: args.version_base,
    documento: args.documento,
    markdown,
    content_hash: hashContenido(args.documento, markdown),
    guardado: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  caso.borrador = borrador;
  return { ok: true, valor: borrador };
}

export function registrarPropuesta(casoId: string, propuesta: Propuesta, previsualizacion: Documento): void {
  estado(casoId).propuestas.set(propuesta.propuesta_id, {
    caso_id: casoId,
    propuesta,
    previsualizacion,
    estado: "pendiente",
  });
}

export function obtenerPropuesta(casoId: string, propuestaId: string): PropuestaGuardada | null {
  return estado(casoId).propuestas.get(propuestaId) ?? null;
}

/**
 * Aplicar: crea versión nueva a partir de la previsualización guardada.
 * Idempotente por `idempotency_key` y por propuesta ya aplicada.
 */
export function aplicarPropuestaGuardada(
  casoId: string,
  args: { propuesta_id: string; version_base: number; idempotency_key: string },
): ResultadoEscritura<{ reporte: Reporte; repetido: boolean }> {
  const caso = estado(casoId);
  const previo = caso.idempotencia.get(args.idempotency_key);
  if (previo !== undefined) {
    const reporte = obtenerVersion(casoId, previo);
    if (reporte) return { ok: true, valor: { reporte, repetido: true } };
  }

  const guardada = caso.propuestas.get(args.propuesta_id);
  if (!guardada) return { ok: false, motivo: "propuesta_desconocida" };
  if (guardada.estado === "descartada") return { ok: false, motivo: "propuesta_descartada" };
  if (guardada.estado === "aplicada" && guardada.version_creada !== undefined) {
    const reporte = obtenerVersion(casoId, guardada.version_creada);
    if (reporte) {
      caso.idempotencia.set(args.idempotency_key, reporte.version);
      return { ok: true, valor: { reporte, repetido: true } };
    }
  }

  const actual = versionActual(casoId);
  if (!actual) return { ok: false, motivo: "version_inexistente" };
  if (actual.version !== args.version_base || guardada.propuesta.version_base !== args.version_base) {
    return { ok: false, motivo: "conflicto_version", version_actual: actual.version };
  }

  // El contenido viene del agente Editor; el humano decide aplicarlo.
  const reporte = nuevaVersion(casoId, guardada.previsualizacion, "agente");
  guardada.estado = "aplicada";
  guardada.version_creada = reporte.version;
  caso.idempotencia.set(args.idempotency_key, reporte.version);
  return { ok: true, valor: { reporte, repetido: false } };
}

export function descartarPropuestaGuardada(casoId: string, propuestaId: string): ResultadoEscritura<PropuestaGuardada> {
  const guardada = estado(casoId).propuestas.get(propuestaId);
  if (!guardada) return { ok: false, motivo: "propuesta_desconocida" };
  if (guardada.estado === "pendiente") guardada.estado = "descartada";
  return { ok: true, valor: guardada };
}

/** Revertir: copia la versión elegida a una NUEVA versión (07 §4: sin borrado, sin LLM). */
export function revertirAVersion(
  casoId: string,
  args: { version_objetivo: number; version_base: number; idempotency_key: string },
): ResultadoEscritura<{ reporte: Reporte; repetido: boolean }> {
  const caso = estado(casoId);
  const previo = caso.idempotencia.get(args.idempotency_key);
  if (previo !== undefined) {
    const reporte = obtenerVersion(casoId, previo);
    if (reporte) return { ok: true, valor: { reporte, repetido: true } };
  }
  const actual = versionActual(casoId);
  if (!actual) return { ok: false, motivo: "version_inexistente" };
  if (actual.version !== args.version_base) {
    return { ok: false, motivo: "conflicto_version", version_actual: actual.version };
  }
  const objetivo = obtenerVersion(casoId, args.version_objetivo);
  if (!objetivo) return { ok: false, motivo: "version_inexistente" };

  const reporte = nuevaVersion(casoId, objetivo.contenido_json, "humano");
  caso.idempotencia.set(args.idempotency_key, reporte.version);
  return { ok: true, valor: { reporte, repetido: false } };
}
