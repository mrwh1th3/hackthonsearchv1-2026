import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { obtenerHistorialPrivado } from "@/lib/data/privado";

export const runtime = "nodejs";

const LIMIT = 30;
const WINDOW_MS = 60_000;

/**
 * BFF de historial de investigaciones del perfil (CLAUDE.md regla 3, Corte 2
 * punto 3). Mismo motivo que `/api/notificaciones`: nunca se lee con el
 * cliente público. La página `/historial` sigue haciendo el render inicial
 * en el servidor (evita un round-trip extra); esta ruta es el "adaptador
 * listo" para el polling del lado del cliente que pide el corte.
 */
export async function GET(req: Request) {
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  }

  const rate = checkRateLimit(`historial:${clientKeyFromRequest(req)}`, LIMIT, WINDOW_MS);
  if (!rate.ok) {
    return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });
  }

  const investigaciones = await obtenerHistorialPrivado();
  return NextResponse.json({ investigaciones });
}
