import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { esUuid } from "@/lib/auditoria/runner";
import { publicArtifacts, readLab } from "@/lib/laboratorio/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "no_autenticado" }, { status: 401, headers });
  const { id } = await params;
  if (!esUuid(id)) return NextResponse.json({ error: "id_invalido" }, { status: 422, headers });
  const run = await readLab(id, session.perfil_id, true);
  if (!run) return NextResponse.json({ error: "investigacion_no_disponible" }, { status: 404, headers });
  return NextResponse.json(publicArtifacts(run), { headers });
}
