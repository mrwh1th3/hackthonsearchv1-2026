import type { Notificacion } from "@/lib/data";

/**
 * Núcleo puro del polling de `/api/notificaciones` (Corte 2 punto 3:
 * "polling acotado y dedupe"). Separado del hook de React a propósito — se
 * prueba sin timers ni DOM (ver polling.test.ts); el hook (`use-polling.ts`)
 * solo llama esto en un `setTimeout` recurrente.
 */

export const INTERVALO_MS = 20_000;
export const INTERVALO_MAX_MS = 120_000;

export interface ResultadoFusion {
  /** Lista completa a mostrar (nuevas primero), ya deduplicada por id. */
  lista: Notificacion[];
  /** Solo las que no se habían visto — para decidir si mostrar un toast. */
  nuevas: Notificacion[];
  /** `creado` más reciente visto, para pedir `?since=` la próxima vez. */
  desde: string;
}

/**
 * Combina la lista actual con una respuesta nueva del servidor. Dedupe por
 * `id` (nunca por posición: dos páginas de polling pueden solaparse). Nunca
 * descarta lo ya mostrado: solo añade lo que el servidor no había mandado.
 */
export function fusionarNotificaciones(actuales: Notificacion[], recibidas: Notificacion[], desdeActual: string): ResultadoFusion {
  const idsVistos = new Set(actuales.map((n) => n.id));
  const nuevas = recibidas.filter((n) => !idsVistos.has(n.id));
  const lista = nuevas.length > 0 ? [...nuevas, ...actuales] : actuales;
  const desde = recibidas.reduce((max, n) => (n.creado > max ? n.creado : max), desdeActual);
  return { lista, nuevas, desde };
}

/** Backoff acotado: se duplica en error/429 hasta `INTERVALO_MAX_MS`, se resetea en éxito. Nunca crece sin límite (evita martillar el BFF ni dejar de sondear del todo). */
export function siguienteIntervalo(actual: number, huboError: boolean): number {
  if (huboError) return Math.min(actual * 2, INTERVALO_MAX_MS);
  return INTERVALO_MS;
}
