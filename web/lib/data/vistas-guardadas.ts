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
