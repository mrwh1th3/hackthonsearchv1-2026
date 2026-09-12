import { NextResponse } from "next/server";
import { validateContract } from "@/lib/contracts/validate";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";
import { leerConfigWebhook, reenviarAWebhook } from "@/lib/security/webhook";

// ajv compila código en tiempo de ejecución (Function()): esta ruta debe
// correr en Node.js, nunca en Edge.
export const runtime = "nodejs";

const LIMIT = 20;
const WINDOW_MS = 60_000;

/**
 * BFF de `product.investigar` (CLAUDE.md regla 3 / 21 §5): valida sesión,
 * forma (contrato) y origen, resuelve el perfil de la sesión (BFF privado,
 * nunca el cliente público) y reenvía a n8n con el secreto en header. No
 * persiste nada localmente — el estado de la investigación vive donde n8n/
 * la DB lo escriban; esta ruta solo responde 202 con lo que el webhook
 * confirme, o el error correspondiente si no hay backend o no respondió.
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

  const config = leerConfigWebhook();
  if (!config) {
    // Regla explícita: sin backend configurado no se finge aceptación.
    return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
  }

  // `session.perfil_id` ya está verificado arriba: no hace falta una segunda
  // lectura de `lib/data/privado.ts` para saber quién es (Corte 3 hallazgo
  // 1 — ese módulo es para leer datos privados, no para resolver identidad).
  // El webhook de n8n (`FORENSE_investigar_cluster`, path `forense/investigar`) no recibe el
  // contrato de producto: su «Normalizar entrada» exige corrida + (cluster_id | origen+valor) +
  // idempotency_key y rechaza texto de sistema, modelos o niveles. Se traduce aquí; el mensaje y
  // la directriz del usuario no viajan al runtime (reglas 4 y 6).
  const inv = body as { idempotency_key: string; contexto: { corrida_id: string; cluster_id?: string; rfcs: string[] } };
  const solicitud: Record<string, unknown> = {
    corrida_id: inv.contexto.corrida_id,
    idempotency_key: inv.idempotency_key,
    investigacion_id: null,
  };
  if (inv.contexto.cluster_id) {
    solicitud.cluster_id = inv.contexto.cluster_id;
  } else if (inv.contexto.rfcs.length > 0) {
    solicitud.origen = "rfc";
    solicitud.valor = inv.contexto.rfcs[0];
  } else {
    return NextResponse.json({ error: "sin_objetivo", detalle: "Hace falta un cluster o al menos un RFC." }, { status: 422 });
  }

  const reenvio = await reenviarAWebhook(config, "investigar", solicitud);
  if (!reenvio.ok) {
    return NextResponse.json({ error: reenvio.error }, { status: reenvio.status });
  }
  return NextResponse.json({ idempotency_key: (body as { idempotency_key: string }).idempotency_key, ...reenvio.body }, { status: 202 });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
