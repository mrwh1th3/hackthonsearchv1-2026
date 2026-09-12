import type { Advertencia } from "@/lib/document/propuesta";
import type { Documento, Propuesta, Reporte, Seleccion } from "@/lib/document/tipos";

/**
 * Cliente del BFF de reportes. La UI nunca habla con n8n (CLAUDE.md regla 3):
 * todo pasa por `/api/reportes/*` con la cookie de sesión.
 */

export interface ErrorBFF {
  error: string;
  detalle?: string;
  version_actual?: number;
  bloques?: string[];
  status: number;
}

export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: ErrorBFF };

async function postear<T>(url: string, cuerpo: unknown): Promise<Resultado<T>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, error: { error: "sin_conexion", status: 0 } };
  }
  let json: unknown = null;
  try {
    json = await respuesta.json();
  } catch {
    json = null;
  }
  if (!respuesta.ok) {
    const cuerpoError = (json ?? {}) as Record<string, unknown>;
    return {
      ok: false,
      error: {
        error: typeof cuerpoError.error === "string" ? cuerpoError.error : "error_desconocido",
        detalle: typeof cuerpoError.detalle === "string" ? cuerpoError.detalle : undefined,
        version_actual: typeof cuerpoError.version_actual === "number" ? cuerpoError.version_actual : undefined,
        bloques: Array.isArray(cuerpoError.bloques) ? (cuerpoError.bloques as string[]) : undefined,
        status: respuesta.status,
      },
    };
  }
  return { ok: true, datos: json as T };
}

export type RespuestaPropuestas =
  | { origen: string; modo: "pregunta"; mensaje: string; version_base: number }
  | { origen: string; modo: "propuesta"; propuesta: Propuesta; advertencias: Advertencia[] };

export function pedirEdicion(cuerpo: {
  caso_id: string;
  version_base: number;
  modo: "pregunta" | "propuesta";
  seleccion?: Seleccion;
  directriz_id?: string;
  mensaje: string;
  evidencia_ids: string[];
  idempotency_key: string;
}): Promise<Resultado<RespuestaPropuestas>> {
  // `editor.solicitud` es additionalProperties:false: se envían solo las claves
  // definidas y se omiten las opcionales vacías.
  const payload: Record<string, unknown> = {
    caso_id: cuerpo.caso_id,
    version_base: cuerpo.version_base,
    modo: cuerpo.modo,
    mensaje: cuerpo.mensaje,
    evidencia_ids: cuerpo.evidencia_ids,
    idempotency_key: cuerpo.idempotency_key,
  };
  if (cuerpo.seleccion) payload.seleccion = cuerpo.seleccion;
  if (cuerpo.directriz_id) payload.directriz_id = cuerpo.directriz_id;
  return postear<RespuestaPropuestas>("/api/reportes/propuestas", payload);
}

export interface RespuestaAplicar {
  origen: string;
  repetido: boolean;
  version: number;
  reporte: Reporte;
  revisar_citas: boolean;
  citas_invalidas: string[];
}

export function aplicarPropuesta(
  casoId: string,
  cuerpo: { propuesta_id: string; version_base: number; idempotency_key: string },
): Promise<Resultado<RespuestaAplicar>> {
  return postear<RespuestaAplicar>(`/api/reportes/aplicar?caso_id=${encodeURIComponent(casoId)}`, cuerpo);
}

export function descartarPropuesta(cuerpo: {
  caso_id: string;
  propuesta_id: string;
  idempotency_key: string;
}): Promise<Resultado<{ origen: string; estado: string; version_actual: number }>> {
  return postear("/api/reportes/descartar", cuerpo);
}

export function revertirVersion(cuerpo: {
  caso_id: string;
  version_objetivo: number;
  version_base: number;
  idempotency_key: string;
}): Promise<Resultado<{ origen: string; version: number; reporte: Reporte; repetido: boolean }>> {
  return postear("/api/reportes/revertir", { ...cuerpo, accion: "revertir" });
}

export interface RespuestaExportar {
  formato: "md" | "json";
  nombre: string;
  mime: string;
  contenido: string;
  citas: string[];
  manifiesto: Record<string, unknown>;
}

export function exportarReporte(cuerpo: {
  caso_id: string;
  version?: number;
  formato: "md" | "json";
}): Promise<Resultado<RespuestaExportar>> {
  return postear<RespuestaExportar>("/api/reportes/exportar", cuerpo);
}

export interface RespuestaBorrador {
  origen: string;
  guardado: string;
  version_base: number;
  content_hash: string;
  revisar_citas: boolean;
  citas_invalidas: string[];
}

export function guardarBorradorRemoto(cuerpo: {
  caso_id: string;
  version_base: number;
  documento: Documento;
}): Promise<Resultado<RespuestaBorrador>> {
  return postear<RespuestaBorrador>("/api/reportes/borrador", cuerpo);
}

/**
 * Historial de versiones. El editor lo pide al montar: si el expediente ya
 * avanzó (otra pestaña, o una recarga después de Aplicar), monta sobre la
 * versión vigente en vez de chocar en 409 con cada escritura.
 */
export async function leerVersiones(casoId: string): Promise<Resultado<{ origen: string; versiones: Reporte[] }>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`/api/reportes/versiones?caso_id=${encodeURIComponent(casoId)}`, {
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, error: { error: "sin_conexion", status: 0 } };
  }
  if (!respuesta.ok) {
    return { ok: false, error: { error: "no_disponible", status: respuesta.status } };
  }
  return { ok: true, datos: (await respuesta.json()) as { origen: string; versiones: Reporte[] } };
}

/** uuid v4 con la API del navegador; el contrato exige uuid en las claves. */
export function uuid(): string {
  return globalThis.crypto.randomUUID();
}
