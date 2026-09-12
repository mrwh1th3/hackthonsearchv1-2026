import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { obtenerNotificacionesPrivadas } from "@/lib/data/privado";

export const runtime = "nodejs";

const LIMIT = 60; // acotado: hasta 1/seg si el cliente sondeara sin backoff, más que suficiente para el polling real
const WINDOW_MS = 60_000;

/**
 * BFF de notificaciones (CLAUDE.md regla 3, Corte 2 punto 3): la única
 * puerta de lectura para notificaciones — nunca se leen con el cliente
 * público, ni siquiera cuando `NEXT_PUBLIC_DATA_SOURCE=supabase` (`forense`
 * no tiene las tablas de 007 todavía; ver `lib/data/privado.ts`). `?since=`
 * (ISO-8601) permite un polling incremental desde el cliente sin repetir
 * lo ya visto; sin el parámetro devuelve todas.
 */
export async function GET(req: Request) {
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  }

  const rate = checkRateLimit(`notificaciones:${clientKeyFromRequest(req)}`, LIMIT, WINDOW_MS);
  if (!rate.ok) {
    return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });
  }

  const desde = new URL(req.url).searchParams.get("since") ?? undefined;
  const notificaciones = await obtenerNotificacionesPrivadas(desde);
  return NextResponse.json({ notificaciones, servidor_ts: new Date().toISOString() });
}
