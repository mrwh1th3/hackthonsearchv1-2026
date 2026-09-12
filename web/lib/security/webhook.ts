/**
 * Reenvío del BFF a n8n (CLAUDE.md regla 3: la UI nunca lee/escribe n8n
 * directo; las mutaciones pasan por aquí). Un solo lugar para las dos rutas
 * que reenvían (`/api/investigaciones`, `/api/inyecciones`): mismo secreto
 * en header, mismo manejo de "sin backend" / "n8n respondió error" / "n8n
 * inalcanzable", nunca filtra `INTERNAL_WEBHOOK_SECRET` en una respuesta o
 * log de error.
 *
 * Nombre de header y ruta (`${N8N_WEBHOOK_BASE}/<recurso>`,
 * `X-Internal-Webhook-Secret`): decisión de este corte, no hay una
 * especificación previa en 17/20 — solicitudes_coordinador pide que forense-
 * n8n confirme o ajuste ambos antes de conectar el workflow real.
 */
const HEADER_SECRETO = "X-Internal-Webhook-Secret";

export interface ConfigWebhook {
  base: string;
  secreto: string;
}

export function leerConfigWebhook(): ConfigWebhook | null {
  const base = process.env.N8N_WEBHOOK_BASE;
  const secreto = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!base || !secreto) return null;
  return { base, secreto };
}

export type ResultadoReenvio = { ok: true; status: number; body: Record<string, unknown> } | { ok: false; status: number; error: string };

/**
 * POSTea `body` a `${config.base}/${recurso}` con el secreto en header.
 * Nunca lanza: una falla de red o un error HTTP del lado de n8n vuelve como
 * `{ok:false}`, para que la ruta decida el status HTTP a devolver sin
 * filtrar detalles internos (mensaje de red, stack) al cliente.
 */
export async function reenviarAWebhook(config: ConfigWebhook, recurso: string, body: Record<string, unknown>): Promise<ResultadoReenvio> {
  const url = `${config.base.replace(/\/$/, "")}/${recurso}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", [HEADER_SECRETO]: config.secreto },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 502, error: "webhook_no_alcanzable" };
  }

  let cuerpoRespuesta: unknown = null;
  try {
    cuerpoRespuesta = await res.json();
  } catch {
    cuerpoRespuesta = null;
  }

  if (!res.ok) {
    return { ok: false, status: 502, error: "webhook_respondio_error" };
  }

  const cuerpo = cuerpoRespuesta && typeof cuerpoRespuesta === "object" ? (cuerpoRespuesta as Record<string, unknown>) : {};
  return { ok: true, status: res.status, body: cuerpo };
}
