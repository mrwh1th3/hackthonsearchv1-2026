import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { getDataSource } from "@/lib/data";
import { leerSubmissionEntregable } from "@/lib/auditoria/submission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga directa del `submission.json` de una corrida auditada (docs/23): el JSON que los jueces validan con
 * `spec/forensic-auditor/validate_format.py`. A diferencia del reporte, no pasa por el editor. Mismos bytes en
 * cada descarga mientras el resultado no cambie (`lib/auditoria/submission.ts`, `src/auditor/pipeline.py`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ corridaId: string }> }) {
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!(await verifySession(token))) return NextResponse.redirect(new URL("/login", req.url));
  const { corridaId } = await params;
  const entrega = await leerSubmissionEntregable(corridaId, getDataSource());
  if (!entrega) {
    return new NextResponse("No judge submission is available for this dataset.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse(entrega.texto, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${entrega.nombre}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-forense-origen": entrega.origen,
    },
  });
}
