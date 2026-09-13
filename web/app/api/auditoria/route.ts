import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/security/origin";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { getDataSource } from "@/lib/data";
import { esUuid, lanzarAuditoria, rutaEstate } from "@/lib/auditoria/runner";

export const runtime = "nodejs";

/**
 * "Inspeccionar" sobre una corrida cargada desde un estate: lanza la auditoría por fases
 * (`loaders/auditoria_en_vivo.py`) y responde 202 con el caso ancla que dibuja el canvas y
 * la investigación que se abre al terminar. La ronda de agentes queda `omitida`
 * salvo opt-in explícito `FORENSE_LEGACY_N8N=1`; la nueva investigación IA se
 * inicia desde /laboratorio con A/B y Codex.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "origen_no_permitido" }, { status: 403 });
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  const rate = checkRateLimit(`auditoria:${clientKeyFromRequest(req)}`, 10, 60_000);
  if (!rate.ok) return NextResponse.json({ error: "demasiadas_solicitudes" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { corrida_id?: unknown };
  if (!esUuid(body.corrida_id)) return NextResponse.json({ error: "corrida_invalida" }, { status: 422 });
  if (!esUuid(session.perfil_id)) return NextResponse.json({ error: "perfil_invalido" }, { status: 422 });

  const corrida = await getDataSource().getCorrida(body.corrida_id);
  if (!corrida) return NextResponse.json({ error: "corrida_no_existe" }, { status: 404 });
  const estate = rutaEstate(corrida.dataset_hash);
  if (!estate) {
    return NextResponse.json({ error: "sin_estate", detalle: "This dataset was not loaded from a SQLite estate." }, { status: 409 });
  }

  const casoId = randomUUID();
  const investigacionId = randomUUID();
  const seed = Number(corrida.nombre.match(/seed (\d+)/)?.[1] ?? 0);
  const args = [
    "--corrida", corrida.id, "--estate", estate, "--investigacion", investigacionId, "--caso", casoId,
    "--perfil", session.perfil_id, "--seed", String(seed), "--paso-ms", process.env.FORENSE_PASO_MS ?? "600",
  ];
  // El valor heredado FORENSE_AGENTES=n8n no debe reactivar el pipeline anterior.
  if (process.env.FORENSE_LEGACY_N8N === "1") args.push("--agentes", "n8n");
  lanzarAuditoria(args);
  return NextResponse.json({ caso_id: casoId, investigacion_id: investigacionId }, { status: 202 });
}
