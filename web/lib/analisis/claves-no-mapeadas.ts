/**
 * Claves de un objeto crudo (`run_log`, un hallazgo, un lead) que la UI
 * tipada NO conoce todavía. CLAUDE.md regla 1 ("H1 objetivo de todas las
 * rutas navegables... no filtrar") + pedido explícito del coordinador: nada
 * de lo que escribe `src/auditor` puede desaparecer solo porque
 * `AuditorHallazgo`/`AuditorLead`/`AuditorResultado` no le pusieron nombre a
 * un campo. Esto es la parte pura (sin JSX) para poder probarla sin DOM; el
 * render vive en `components/shared/auditor-resultado.tsx`.
 */
export function clavesNoMapeadas(obj: unknown, conocidas: readonly string[]): Array<[string, unknown]> {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [];
  const set = new Set(conocidas);
  return Object.entries(obj as Record<string, unknown>).filter(([k]) => !set.has(k));
}

/** Texto corto y estable para pintar un valor desconocido sin reventar con ciclos/objetos grandes. */
export function textoValorGenerico(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const texto = JSON.stringify(v);
    return texto.length > 500 ? `${texto.slice(0, 497)}...` : texto;
  } catch {
    return "[no serializable]";
  }
}
