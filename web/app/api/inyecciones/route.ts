import { NextResponse } from "next/server";
import { validateContract } from "@/lib/contracts/validate";
import { obtenerPerfilPrivado } from "@/lib/data/privado";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";
import { leerConfigWebhook, reenviarAWebhook } from "@/lib/security/webhook";

// ajv compila código en tiempo de ejecución (Function()): esta ruta debe
// correr en Node.js, nunca en Edge.
export const runtime = "nodejs";

const LIMIT = 10;
const WINDOW_MS = 60_000;

/**
 * BFF de `product.inyectar` (21 §3.1, contratos 1.2.0). El cuerpo se valida
 * contra el contrato real (`corrida_base_id`, `origen`, `tablas`|`archivos`,
 * `idempotency_key`) — ya no contra el schema zod local del Corte 1, que
 * pedía `ingesta_id`/`prioridad`: esos campos no existen en `product.
 * inyectar` (`additionalProperties: false` los habría rechazado si el
 * validador real llegara a correr). Nunca muta el snapshot base: eso lo
 * decide n8n/DB (clona la corrida), esta ruta solo reenvía y confirma.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "origen_no_permitido" }, { status: 403 });
  }

  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  }

  const rate = checkRateLimit(`inyectar:${clientKeyFromRequest(req)}`, LIMIT, WINDOW_MS);
  if (!rate.ok) {
    return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 });
  }

  const result = validateContract("product.inyectar", body);
  if (!result.ok) {
    return NextResponse.json({ error: "contrato_invalido", detalles: result.errors }, { status: 422 });
  }

  const config = leerConfigWebhook();
  if (!config) {
    return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
  }

  const perfil = await obtenerPerfilPrivado();
  const solicitud = { ...(body as Record<string, unknown>), perfil_id: perfil.id };

  const reenvio = await reenviarAWebhook(config, "inyecciones", solicitud);
  if (!reenvio.ok) {
    return NextResponse.json({ error: reenvio.error }, { status: reenvio.status });
  }
  return NextResponse.json({ idempotency_key: (body as { idempotency_key: string }).idempotency_key, ...reenvio.body }, { status: 202 });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
