import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { borrarCorridaPrivada } from "@/lib/data/privado";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";

export const runtime = "nodejs";

/**
 * BFF para borrar una corrida (dataset) completa, desde
 * `AdministrarDatosModal` (docs/22). Una corrida no tiene dueño de perfil
 * (es del despliegue, no de una sesión) así que la única condición aquí es
 * sesión válida — la cascada real y el rastro previo en
 * `forense.auditoria_borrados` los hace `forense.eliminar_corrida` (029).
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
  const rate = checkRateLimit(`eliminar-corrida:${clientKeyFromRequest(req)}`, 10, 60_000);
  if (!rate.ok) {
    return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });
  }

  const { id } = await params;
  try {
    const borrada = await borrarCorridaPrivada(id);
    if (!borrada) {
      return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
    }
  } catch (e) {
    return NextResponse.json({ error: "error_al_borrar", detalle: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
