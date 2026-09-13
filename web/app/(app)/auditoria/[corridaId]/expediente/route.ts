import { NextResponse } from "next/server";
import { getDataSource } from "@/lib/data";
import { sesionDesdeCookies } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Sirve el expediente HTML autocontenido del auditor tal como se entrega a los jueces. */
export async function GET(_req: Request, { params }: { params: Promise<{ corridaId: string }> }) {
  const session = await sesionDesdeCookies();
  if (!session) return NextResponse.redirect(new URL("/login", _req.url));
  const { corridaId } = await params;
  const html = await getDataSource().getAuditorExpedienteHtml(corridaId);
  if (!html) return new NextResponse("No audit report is available for this dataset.", { status: 404 });
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    },
  });
}
