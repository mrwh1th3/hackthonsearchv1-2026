/**
 * Formato de fechas para mostrar (15 §9), con zona horaria EXPLÍCITA.
 *
 * Por qué existe este módulo: `new Date(x).toLocaleString("es-MX")` sin
 * `timeZone` formatea en la zona del PROCESO. En local eso es
 * America/Mexico_City y todo cuadra; en una Vercel Function el proceso corre
 * en **UTC**, así que el mismo código muestra seis horas más. El caso que lo
 * vuelve grave y no cosmético: `corridas.fecha_corte` vale
 * `2026-01-31 23:59:59-06`, que en UTC es `2026-02-01 05:59:59`, así que el
 * corte del snapshot se enseñaría como **1 de febrero** en la pantalla de un
 * sistema fiscal cuyo propio manifiesto dice 31 de enero. Un juez con dominio
 * del problema lo nota, y con razón.
 *
 * `web/lib/date/range.ts` ya había tomado esta decisión para la aritmética de
 * rangos, con el análisis de por qué `Intl.DateTimeFormat` con `timeZone`
 * explícito no depende del reloj del proceso en ningún entorno. Esto extiende
 * la misma decisión al formato de presentación.
 *
 * La zona por omisión es la del selector de rangos (`America/Monterrey`), no
 * una nueva: dos zonas por omisión distintas en la misma UI serían un error
 * peor que el que este módulo arregla.
 */

/** Misma que el valor por omisión de `DateRangePicker` (15 §9). */
export const ZONA_POR_OMISION = "America/Monterrey";

const LOCALE = "es-MX";

function instante(valor: string | number | Date): Date | null {
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Fecha y hora. Devuelve `"—"` para un valor ausente o no parseable: una
 * fecha inválida nunca debe salir como "Invalid Date" en un expediente.
 */
export function fechaHora(valor: string | number | Date | null | undefined,
                          zona: string = ZONA_POR_OMISION): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const d = instante(valor);
  return d === null ? "—" : d.toLocaleString(LOCALE, { timeZone: zona });
}

/** Sólo la fecha, sin hora. */
export function soloFecha(valor: string | number | Date | null | undefined,
                          zona: string = ZONA_POR_OMISION): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const d = instante(valor);
  return d === null ? "—" : d.toLocaleDateString(LOCALE, { timeZone: zona });
}

/** Sólo la hora. Se usa en las líneas de tiempo, donde el día ya está en el encabezado. */
export function soloHora(valor: string | number | Date | null | undefined,
                         zona: string = ZONA_POR_OMISION): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const d = instante(valor);
  return d === null ? "—" : d.toLocaleTimeString(LOCALE, { timeZone: zona });
}
