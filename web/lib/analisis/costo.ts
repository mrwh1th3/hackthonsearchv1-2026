/**
 * Estimación de costo por tokens (pedido del coordinador 2026-09-12): no hay
 * columna `costo` en `llm_solicitudes`/`ejecuciones_agente` todavía (ver
 * `EjecucionAgenteInfo.costo`, siempre `null` — dato real ausente). Esto es
 * un ESTIMADO a partir de precios públicos por modelo, y se etiqueta como
 * tal en toda la UI; nunca sustituye al costo real si algún día existe la
 * columna.
 *
 * Precios en USD por millón de tokens (proveedor `messages_api`, docs/21
 * §5). Un `model_id` que no está en la tabla no inventa un precio: devuelve
 * `null` y la UI dice "no disp." en vez de $0.00.
 */
export interface PrecioModelo {
  /** USD por 1M tokens de entrada. */
  in: number;
  /** USD por 1M tokens de salida. */
  out: number;
}

export const PRECIOS_MODELO: Record<string, PrecioModelo> = {
  "claude-opus-4": { in: 15, out: 75 },
  "claude-sonnet-4": { in: 3, out: 15 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4": { in: 0.8, out: 4 },
};

/** Empareja por prefijo: `model_id` real suele traer fecha/sufijo (`claude-sonnet-4-20260101`). */
function precioDe(modelId: string | null): PrecioModelo | null {
  if (!modelId) return null;
  const clave = Object.keys(PRECIOS_MODELO).find((k) => modelId.startsWith(k));
  return clave ? PRECIOS_MODELO[clave] : null;
}

/** `null` = modelo desconocido o tokens no disponibles; nunca un 0 fingido. */
export function estimarCostoUsd(modelId: string | null, tokensIn: number | null, tokensOut: number | null): number | null {
  const precio = precioDe(modelId);
  if (!precio || tokensIn == null || tokensOut == null) return null;
  return (tokensIn / 1_000_000) * precio.in + (tokensOut / 1_000_000) * precio.out;
}

export function formatoCostoEstimado(usd: number | null): string {
  return usd == null ? "costo no disp." : `~$${usd.toFixed(3)} (estimado)`;
}
