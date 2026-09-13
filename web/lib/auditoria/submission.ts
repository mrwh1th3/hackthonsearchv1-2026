import { readFile } from "node:fs/promises";
import type { DataSource } from "@/lib/data/source";
import { esUuid, rutaSubmission } from "./runner";

export interface SubmissionEntregable {
  /** Cuerpo de la descarga. Con origen `disco`, los bytes exactos que validó `validate_format.py`. */
  texto: string;
  origen: "disco" | "supabase";
  /** Ruta en disco de la que salieron los bytes (solo con origen `disco`). */
  ruta: string | null;
  nombre: string;
}

/** Igualdad de valores JSON: objetos sin importar el orden de claves (jsonb lo reordena), arreglos en orden. */
export function mismoJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => mismoJson(x, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && mismoJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

function parsear(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

/**
 * `submission.json` de una corrida auditada, listo para descargar sin pasar por el editor.
 *
 * `forense.auditor_resultados` decide si la corrida tiene resultado (sin fila → `null`, igual que la página y el
 * expediente). El archivo en disco (`dirSalidas()/<corrida>/submission.json`) aporta los bytes exactos cuando
 * dice lo mismo que lo persistido; si no existe o no coincide, se sirve lo persistido, que es lo que pinta la UI.
 * Si la base no responde, el archivo en disco basta.
 */
export async function leerSubmissionEntregable(
  corridaId: string,
  ds: Pick<DataSource, "getAuditorSubmission">,
): Promise<SubmissionEntregable | null> {
  if (!esUuid(corridaId)) return null;
  const ruta = rutaSubmission(corridaId);
  const [disco, persistida] = await Promise.all([
    ruta ? readFile(ruta, "utf8").catch(() => null) : Promise.resolve(null),
    ds.getAuditorSubmission(corridaId).then(
      (s) => ({ ok: true as const, s }),
      () => ({ ok: false as const, s: null }),
    ),
  ]);
  if (persistida.ok && persistida.s === null) return null;

  const enDisco = disco === null ? undefined : parsear(disco);
  const nombre = (sub: unknown) => {
    const seed = (sub as { seed?: unknown } | undefined)?.seed;
    return `submission-seed${typeof seed === "number" ? seed : 0}-${corridaId.slice(0, 8)}.json`;
  };
  if (disco !== null && enDisco !== undefined && (!persistida.ok || mismoJson(enDisco, persistida.s))) {
    return { texto: disco, origen: "disco", ruta, nombre: nombre(enDisco) };
  }
  if (persistida.ok && persistida.s !== null) {
    return { texto: JSON.stringify(persistida.s, null, 2), origen: "supabase", ruta: null, nombre: nombre(persistida.s) };
  }
  return null;
}
