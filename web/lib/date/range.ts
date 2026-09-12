/**
 * Resolución de rangos de fecha para `DateRangePicker` (15 §9).
 *
 * Dos alcances separados, nunca mezclados:
 * - `ejecucion`: fechas de ejecución (historial), relativas al reloj real.
 * - `dataset`: fechas de operaciones (analítica), ancladas a `fecha_corte`
 *   del snapshot, nunca al reloj real (evita que "Hoy" deje vacío un
 *   dataset histórico).
 *
 * Todo resultado se entrega en UTC con fin exclusivo. La aritmética de días
 * ocurre en el reloj de pared de `timezone` (no en múltiplos de 24 h), así
 * que un día de 23/25 horas por cambio de horario no desplaza el resultado.
 *
 * Por qué no `fromZonedTime`/`toZonedTime` de `date-fns-tz`: esas funciones
 * leen el instante de entrada con los getters LOCALES del proceso
 * (`date.getFullYear()`, no `getUTCFullYear()`), documentado en su propio
 * código fuente ("the input date represented local time in time zone").
 * Eso hace que el resultado dependa de `process.env.TZ`/zona del sistema
 * que ejecuta el proceso — verificado empíricamente en este entorno
 * (America/Mexico_City, UTC-6): al coincidir con el offset objetivo de
 * América/Monterrey, el error se cancelaba y ocultaba el bug en vez de
 * mostrarlo. Aquí se usa `Intl.DateTimeFormat` con `timeZone` explícito,
 * que no depende del reloj/zona del proceso en ningún entorno (dev, CI,
 * Vercel Functions).
 */

export type RangoPreset =
  | "hoy"
  | "ayer"
  | "7d"
  | "30d"
  | "90d"
  | "mes_actual"
  | "mes_anterior"
  | "todo_el_dataset"
  | "personalizado";

export type AlcanceRango = "ejecucion" | "dataset";

export interface RangoResuelto {
  desde: string;
  hasta_exclusivo: string;
  timezone: string;
}

export interface ResolveDateRangeParams {
  preset: RangoPreset;
  timezone: string;
  /** Instante de referencia: reloj real (ejecución) o fecha_corte del snapshot (dataset). */
  referencia: Date;
  /** Límite inferior conocido del dataset, para "todo_el_dataset". */
  datasetDesde?: Date;
  /** Límite superior exclusivo conocido del dataset; por defecto, el día siguiente a `referencia`. */
  datasetHastaExclusivo?: Date;
  /** Solo para preset "personalizado": fechas ya elegidas (wall-clock, en `timezone`). */
  personalizado?: { desde: Date; hastaExclusivo: Date };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addUtcMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

function wallFieldsFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function partsToUtcMs(parts: Intl.DateTimeFormatPart[]): number {
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/**
 * Lee el reloj de pared de `timezone` en el instante `real` y lo devuelve
 * como un Date cuyos getters UTC llevan esos valores (p.ej. mediodía real
 * en Monterrey en junio -> Date con getUTCHours()===6, offset UTC-6).
 */
function wallFieldsAt(real: Date, timezone: string): Date {
  return new Date(partsToUtcMs(wallFieldsFormatter(timezone).formatToParts(real)));
}

/** Offset (ms) tal que `wallFieldsAt(instant, tz).getTime() === instant.getTime() + offset`. */
function offsetMsAt(instant: Date, timezone: string): number {
  return wallFieldsAt(instant, timezone).getTime() - instant.getTime();
}

/**
 * Convierte un instante wall-clock (getters UTC = hora local deseada en
 * `timezone`) al instante UTC real que produce ese reloj de pared. Dos
 * pasadas: la primera estima el offset con el propio valor de pared: basta
 * salvo en el instante exacto de una transición de horario, donde la
 * segunda pasada (con el offset ya corregido) converge.
 */
function wallToUtc(wall: Date, timezone: string): Date {
  const guessMs = wall.getTime();
  const offset1 = offsetMsAt(new Date(guessMs), timezone);
  const t1 = guessMs - offset1;
  const offset2 = offsetMsAt(new Date(t1), timezone);
  const t2 = guessMs - offset2;
  return new Date(t2);
}

export function resolveDateRangePreset(params: ResolveDateRangeParams): RangoResuelto {
  const { preset, timezone, referencia } = params;

  if (preset === "personalizado") {
    if (!params.personalizado) {
      throw new Error("resolveDateRangePreset: preset 'personalizado' requiere { personalizado: { desde, hastaExclusivo } }");
    }
    const { desde, hastaExclusivo } = params.personalizado;
    if (hastaExclusivo.getTime() <= desde.getTime()) {
      throw new Error("resolveDateRangePreset: 'hasta_exclusivo' debe ser posterior a 'desde'");
    }
    return {
      desde: wallToUtc(desde, timezone).toISOString(),
      hasta_exclusivo: wallToUtc(hastaExclusivo, timezone).toISOString(),
      timezone,
    };
  }

  const zonedAhora = wallFieldsAt(referencia, timezone);
  const hoyWall = startOfUtcDay(zonedAhora);

  let desdeWall: Date;
  let hastaWall: Date;

  switch (preset) {
    case "hoy":
      desdeWall = hoyWall;
      hastaWall = addUtcDays(hoyWall, 1);
      break;
    case "ayer":
      desdeWall = addUtcDays(hoyWall, -1);
      hastaWall = hoyWall;
      break;
    case "7d":
      desdeWall = addUtcDays(hoyWall, -6);
      hastaWall = addUtcDays(hoyWall, 1);
      break;
    case "30d":
      desdeWall = addUtcDays(hoyWall, -29);
      hastaWall = addUtcDays(hoyWall, 1);
      break;
    case "90d":
      desdeWall = addUtcDays(hoyWall, -89);
      hastaWall = addUtcDays(hoyWall, 1);
      break;
    case "mes_actual":
      desdeWall = startOfUtcMonth(hoyWall);
      hastaWall = addUtcMonths(desdeWall, 1);
      break;
    case "mes_anterior":
      hastaWall = startOfUtcMonth(hoyWall);
      desdeWall = addUtcMonths(hastaWall, -1);
      break;
    case "todo_el_dataset": {
      const zonedDesde = params.datasetDesde ? wallFieldsAt(params.datasetDesde, timezone) : hoyWall;
      desdeWall = startOfUtcDay(zonedDesde);
      hastaWall = params.datasetHastaExclusivo
        ? startOfUtcDay(wallFieldsAt(params.datasetHastaExclusivo, timezone))
        : addUtcDays(hoyWall, 1);
      break;
    }
    default: {
      const _exhaustive: never = preset;
      throw new Error(`resolveDateRangePreset: preset desconocido ${String(_exhaustive)}`);
    }
  }

  return {
    desde: wallToUtc(desdeWall, timezone).toISOString(),
    hasta_exclusivo: wallToUtc(hastaWall, timezone).toISOString(),
    timezone,
  };
}

export const RANGO_PRESET_LABEL: Record<RangoPreset, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  "7d": "7 días",
  "30d": "30 días",
  "90d": "90 días",
  mes_actual: "Mes actual",
  mes_anterior: "Mes anterior",
  todo_el_dataset: "Todo el dataset",
  personalizado: "Personalizado",
};
