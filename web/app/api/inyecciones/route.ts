import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";

export const runtime = "nodejs";

const LIMIT = 10;
const WINDOW_MS = 60_000;

/**
 * 21 §3.1 especifica el cuerpo de inyección
 * `{corrida_base_id, ingesta_id, idempotency_key, prioridad}`, pero
 * `contracts/release.json` v1.0.0 todavía no tiene un `ingesta.inyeccion`
 * (solo `ingesta.mapper|mapping|transform`). Este schema local con zod es una
 * validación de forma, "sin contrato v1.0.0"; se solicitó al coordinador
 * incorporarlo como contrato formal (ver solicitudes_coordinador del corte).
 */
const InyeccionBodySchema = z.object({
  corrida_base_id: z.string().uuid(),
  ingesta_id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
  prioridad: z.literal("inyectados"),
});

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

  const parsed = InyeccionBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "cuerpo_invalido", detalles: parsed.error.issues, nota: "validación local sin contrato v1.0.0 (ver 21 §3.1)" },
      { status: 422 },
    );
  }

  const webhookBase = process.env.N8N_WEBHOOK_BASE;
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!webhookBase || !webhookSecret) {
    return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
  }

  return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
