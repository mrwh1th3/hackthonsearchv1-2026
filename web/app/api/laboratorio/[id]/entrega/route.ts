import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { esUuid } from "@/lib/auditoria/runner";
import { inspectDeliveries, isDeliveryKind, readDelivery } from "@/lib/laboratorio/entregas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const session = await verifySession(req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1]);
  if (!session) return NextResponse.json({ error: "no_autenticado" }, { status: 401, headers });
  const { id } = await params;
  if (!esUuid(id)) return NextResponse.json({ error: "id_invalido" }, { status: 422, headers });
  const kind = new URL(req.url).searchParams.get("tipo");
  if (kind === "estado") {
    const available = await inspectDeliveries(id, session.perfil_id);
    return available ? NextResponse.json(available, { headers }) : NextResponse.json({ error: "investigacion_no_disponible" }, { status: 404, headers });
  }
  if (!isDeliveryKind(kind)) return NextResponse.json({ error: "entrega_invalida" }, { status: 422, headers });
  const delivery = await readDelivery(id, session.perfil_id, kind);
  if (!delivery) return NextResponse.json({ error: "entrega_no_disponible" }, { status: 404, headers });
  return new NextResponse(delivery.content, {
    headers: {
      ...headers,
      "Content-Type": delivery.mime,
      "Content-Disposition": `${delivery.inline ? "inline" : "attachment"}; filename="${delivery.filename}"`,
      ...(delivery.inline ? { "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'" } : {}),
    },
  });
}
