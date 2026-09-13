import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { getDataSource } from "@/lib/data";
import { esUuid } from "@/lib/auditoria/runner";
import { isSameOriginRequest } from "@/lib/security/origin";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { LabError, listLabs, publicArtifacts, startLab } from "@/lib/laboratorio/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store" };

function session(req: Request) {
  return verifySession(req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1]);
}

export async function GET(req: Request) {
  const auth = await session(req);
  if (!auth) return NextResponse.json({ error: "no_autenticado" }, { status: 401, headers: PRIVATE });
  const runs = await listLabs(auth.perfil_id);
  return NextResponse.json({ runs: publicArtifacts(runs) }, { headers: PRIVATE });
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "origen_no_permitido" }, { status: 403 });
  const auth = await session(req);
  if (!auth) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  const rate = checkRateLimit(`laboratorio:${auth.perfil_id}:${clientKeyFromRequest(req)}`, 4, 60_000);
  if (!rate.ok) return NextResponse.json({ error: "demasiadas_solicitudes", detalle: "Wait a minute before starting another investigation." }, { status: 429 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !esUuid(body.corrida_id) || (body.giro !== undefined && (typeof body.giro !== "string" || body.giro.trim().length < 3 || body.giro.length > 120 || /[\u0000-\u001f]/.test(body.giro))) || !["codex", "mock"].includes(String(body.provider))) {
    return NextResponse.json({ error: "solicitud_invalida", detalle: "Select a dataset and a valid provider." }, { status: 422 });
  }
  if (Object.keys(body).some((key) => !["corrida_id", "giro", "provider", "mensaje", "filtros"].includes(key))) {
    return NextResponse.json({ error: "campos_no_permitidos" }, { status: 422 });
  }
  const focus = body.mensaje ?? "";
  const filters = body.filtros as Record<string, unknown> | undefined;
  const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (typeof focus !== "string" || focus.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(focus) ||
      (filters !== undefined && (!filters || typeof filters !== "object" || Array.isArray(filters) || Object.keys(filters).some(key => !["desde", "hasta"].includes(key)) || !validDate(filters.desde) || !validDate(filters.hasta) || filters.desde > filters.hasta))) {
    return NextResponse.json({ error: "enfoque_invalido", detalle: "Check the context and date range." }, { status: 422 });
  }
  try {
    const source = getDataSource();
    const corrida = await source.getCorrida(body.corrida_id);
    if (!corrida) return NextResponse.json({ error: "corrida_no_existe" }, { status: 404 });
    const run = await startLab({ corrida, giro: typeof body.giro === "string" ? body.giro.trim() : "", mensaje: focus.trim(), filtros: filters as { desde: string; hasta: string } | undefined, provider: body.provider as "codex" | "mock", perfilId: auth.perfil_id, source });
    return NextResponse.json(publicArtifacts(run), { status: 202, headers: PRIVATE });
  } catch (error) {
    if (error instanceof LabError) return NextResponse.json({ error: error.code, detalle: error.message }, { status: error.status });
    return NextResponse.json({ error: "laboratorio_no_disponible", detalle: "Could not prepare the investigation. Check the rule engine and data source." }, { status: 503 });
  }
}
