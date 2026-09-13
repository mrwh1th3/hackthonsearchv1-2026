import type { VistaGuardada } from "./types";

/**
 * "Guardar vista" (15 §9, Corte 2 punto 5). Sin backend de vistas todavía
 * (llega con 006, ver docs/16 §6): se persiste en localStorage, por
 * navegador, nunca compartido entre usuarios ni leído por el servidor. Cada
 * lectura/escritura está envuelta en try/catch (modo privado, cuota llena,
 * SSR sin `window`) y nunca lanza: el llamador recibe `[]`/`false` en vez de
 * romper la página.
 */
const STORAGE_KEY = "forense:vistas-guardadas:v1";

function leerAlmacen(): VistaGuardada[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VistaGuardada[]) : [];
  } catch {
    return [];
  }
}

function escribirAlmacen(vistas: VistaGuardada[]): boolean {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(vistas));
    return true;
  } catch {
    return false;
  }
}

export function leerVistasGuardadas(): VistaGuardada[] {
  return leerAlmacen();
}

export function guardarVista(input: { nombre: string; ruta: string; filtros: Record<string, unknown> }): boolean {
  const actuales = leerAlmacen();
  const nueva: VistaGuardada = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `v${Date.now()}-${Math.random().toString(16).slice(2)}`,
    nombre: input.nombre,
    ruta: input.ruta,
    filtros: input.filtros,
  };
  return escribirAlmacen([...actuales, nueva]);
}

export function borrarVista(id: string): boolean {
  return escribirAlmacen(leerAlmacen().filter((v) => v.id !== id));
}

// ---------------------------------------------------------------------------
// BFF (006 §3, `forense.vistas_guardadas`) con caída a localStorage — mismo
// patrón que el wizard de `/datos` con `product.inyectar`, pero SOLO cuando
// el backend en sí no está configurado (503 `backend_no_configurado`) o no
// hay red (fetch lanza): esos son los dos casos en que "vistas guardadas"
// simplemente no existe en este entorno. Un 400 (`argumento_invalido`), 401
// (`no_autenticado`), 403 (`origen_no_permitido`) o 429
// (`demasiadas_solicitudes`) es un rechazo REAL de la solicitud — caer a
// localStorage ahí escondería el error (p.ej. "guardado" mientras la sesión
// ya expiró, o el nombre no pasó validación) detrás de un éxito falso en el
// navegador. Corte 3 hallazgo 4.
// ---------------------------------------------------------------------------

export type FuenteVistas = "servidor" | "local";

/** Único caso en que el backend no "existe" para este entorno, no que la solicitud fue rechazada. */
function esBackendNoConfigurado(status: number): boolean {
  return status === 503;
}

async function mensajeError(res: Response): Promise<string> {
  let body: { error?: string; retry_after_ms?: number } = {};
  try {
    body = (await res.json()) as { error?: string; retry_after_ms?: number };
  } catch {
    // cuerpo no-JSON o vacío: se sigue con el mensaje genérico de abajo
  }
  if (res.status === 429) {
    const s = typeof body.retry_after_ms === "number" ? Math.ceil(body.retry_after_ms / 1000) : null;
    return s ? `Too many requests. Try again in ${s}s.` : "Too many requests. Try again shortly.";
  }
  if (res.status === 401 || res.status === 403) return "Your session expired. Sign in again.";
  if (res.status === 400) return "The view failed server validation.";
  return body.error ? `${body.error} (${res.status}).` : `Server error (${res.status}).`;
}

export async function listarVistasConFallback(ruta: string): Promise<{ vistas: VistaGuardada[]; fuente: FuenteVistas; error?: string }> {
  try {
    const res = await fetch(`/api/vistas?ruta=${encodeURIComponent(ruta)}`);
    if (res.ok) {
      const body = (await res.json()) as { vistas: VistaGuardada[] };
      return { vistas: body.vistas, fuente: "servidor" };
    }
    if (!esBackendNoConfigurado(res.status)) {
      return { vistas: [], fuente: "servidor", error: await mensajeError(res) };
    }
  } catch {
    // sin red: cae a local, silencioso a propósito (no es un error del usuario)
  }
  return { vistas: leerVistasGuardadas().filter((v) => v.ruta === ruta), fuente: "local" };
}

export async function guardarVistaConFallback(input: { nombre: string; ruta: string; filtros: Record<string, unknown> }): Promise<{ ok: boolean; fuente: FuenteVistas; error?: string }> {
  try {
    const res = await fetch("/api/vistas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (res.ok) return { ok: true, fuente: "servidor" };
    if (!esBackendNoConfigurado(res.status)) {
      return { ok: false, fuente: "servidor", error: await mensajeError(res) };
    }
  } catch {
    // sin red: cae a local
  }
  return { ok: guardarVista(input), fuente: "local" };
}

export async function borrarVistaConFallback(id: string): Promise<{ ok: boolean; fuente: FuenteVistas; error?: string }> {
  try {
    const res = await fetch(`/api/vistas?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) return { ok: true, fuente: "servidor" };
    if (!esBackendNoConfigurado(res.status)) {
      return { ok: false, fuente: "servidor", error: await mensajeError(res) };
    }
  } catch {
    // sin red: cae a local
  }
  return { ok: borrarVista(id), fuente: "local" };
}
