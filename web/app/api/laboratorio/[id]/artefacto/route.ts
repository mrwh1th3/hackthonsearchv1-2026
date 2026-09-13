import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { esUuid } from "@/lib/auditoria/runner";
import { readLabArtifact } from "@/lib/laboratorio/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const session = await verifySession(req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1]);
  if (!session) return NextResponse.json({ error: "no_autenticado" }, { status: 401, headers });
  const { id } = await params;
  if (!esUuid(id)) return NextResponse.json({ error: "id_invalido" }, { status: 422, headers });
  const reference = new URL(req.url).searchParams.get("ref") ?? "";
  const artifact = await readLabArtifact(id, session.perfil_id, reference);
  if (artifact === null) return NextResponse.json({ error: "artefacto_no_disponible" }, { status: 404, headers });
  return NextResponse.json({ reference, data: artifact }, { headers });
}
