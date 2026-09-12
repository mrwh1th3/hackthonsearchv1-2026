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
// patrón que el wizard de `/datos` con `product.inyectar`: sin sesión válida
// o sin `SUPABASE_SERVICE_ROLE_KEY` de servidor, `/api/vistas` responde
// 401/503 y aquí se cae a lo de arriba, nunca se rompe la UI por eso.
// ---------------------------------------------------------------------------

export type FuenteVistas = "servidor" | "local";

export async function listarVistasConFallback(ruta: string): Promise<{ vistas: VistaGuardada[]; fuente: FuenteVistas }> {
  try {
    const res = await fetch(`/api/vistas?ruta=${encodeURIComponent(ruta)}`);
    if (res.ok) {
      const body = (await res.json()) as { vistas: VistaGuardada[] };
      return { vistas: body.vistas, fuente: "servidor" };
    }
  } catch {
    // sin red: cae a local, silencioso a propósito (no es un error del usuario)
  }
  return { vistas: leerVistasGuardadas().filter((v) => v.ruta === ruta), fuente: "local" };
}

export async function guardarVistaConFallback(input: { nombre: string; ruta: string; filtros: Record<string, unknown> }): Promise<{ ok: boolean; fuente: FuenteVistas }> {
  try {
    const res = await fetch("/api/vistas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (res.ok) return { ok: true, fuente: "servidor" };
  } catch {
    // sin red: cae a local
  }
  return { ok: guardarVista(input), fuente: "local" };
}

export async function borrarVistaConFallback(id: string): Promise<{ ok: boolean; fuente: FuenteVistas }> {
  try {
    const res = await fetch(`/api/vistas?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) return { ok: true, fuente: "servidor" };
  } catch {
    // sin red: cae a local
  }
  return { ok: borrarVista(id), fuente: "local" };
}
