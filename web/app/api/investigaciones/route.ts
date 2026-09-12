import { NextResponse } from "next/server";
import { validateContract } from "@/lib/contracts/validate";
import { getDataSource } from "@/lib/data";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";

// ajv compila código en tiempo de ejecución (Function()): esta ruta debe
// correr en Node.js, nunca en Edge.
export const runtime = "nodejs";

const LIMIT = 20;
const WINDOW_MS = 60_000;

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "origen_no_permitido" }, { status: 403 });
  }

  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  }

  const rate = checkRateLimit(`investigar:${clientKeyFromRequest(req)}`, LIMIT, WINDOW_MS);
  if (!rate.ok) {
    return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 });
  }

  const result = validateContract("product.investigar", body);
  if (!result.ok) {
    return NextResponse.json({ error: "contrato_invalido", detalles: result.errors }, { status: 422 });
  }

  const webhookBase = process.env.N8N_WEBHOOK_BASE;
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!webhookBase || !webhookSecret) {
    // Regla explícita: sin backend configurado no se finge aceptación.
    return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
  }

  // Aún con configuración, este corte no despacha la llamada real (no se
  // gastan APIs/red sin aprobación del coordinador, ver reglas de ejecución).
  // El servidor resolvería propietario/directriz/IDs contra DB y reenviaría
  // al webhook con el secreto en header, devolviendo 202 con los IDs.
  const perfil = await getDataSource().getPerfil();
  void perfil;
  return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
