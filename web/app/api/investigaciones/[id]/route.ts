import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { borrarInvestigacionPrivada } from "@/lib/data/privado";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";

export const runtime = "nodejs";

/**
 * BFF para borrar una investigación del perfil de la sesión (CLAUDE.md
 * regla 3): nunca desde el cliente público, y acotado a `session.perfil_id`
 * — `borrarInvestigacionPrivada` verifica dueño antes de llamar a la RPC
 * `forense.eliminar_investigacion` (029), así que el id de la investigación
 * de otro perfil sale 404, no 200.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "origen_no_permitido" }, { status: 403 });
  }
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  }
  const rate = checkRateLimit(`eliminar-investigacion:${clientKeyFromRequest(req)}`, 20, 60_000);
  if (!rate.ok) {
    return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });
  }

  const { id } = await params;
  try {
    const borrada = await borrarInvestigacionPrivada(session.perfil_id, id);
    if (!borrada) {
      return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
    }
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    const noEncontrada = mensaje.includes("no encontrada");
    return NextResponse.json({ error: noEncontrada ? "no_encontrada" : "error_al_borrar", detalle: mensaje }, { status: noEncontrada ? 404 : 500 });
  }
  return new NextResponse(null, { status: 204 });
}
