import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { getDataSource } from "@/lib/data";
import { esUuid, rutaEstructura } from "@/lib/auditoria/runner";
import { resumirEstructura, type StructureReport } from "@/lib/estates/estructura";

export const runtime = "nodejs";

/**
 * `structure_report` del dataset de una corrida (privado: exige sesión, regla 3). Lo escribió
 * `loaders/ingestar_estate.py` al subirlo, junto al estate canónico: `data/forensic/estates/<dataset_hash>.structure.json`.
 * Devuelve el resumen para la UI y el reporte completo tal cual.
 */
export async function GET(req: Request) {
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!(await verifySession(token))) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  const rate = checkRateLimit(`estate-estructura:${clientKeyFromRequest(req)}`, 60, 60_000);
  if (!rate.ok) return NextResponse.json({ error: "demasiadas_solicitudes" }, { status: 429 });

  const corridaId = new URL(req.url).searchParams.get("corrida_id");
  if (!esUuid(corridaId)) return NextResponse.json({ error: "corrida_invalida" }, { status: 422 });
  const corrida = await getDataSource().getCorrida(corridaId);
  if (!corrida) return NextResponse.json({ error: "corrida_no_existe" }, { status: 404 });
  const ruta = rutaEstructura(corrida.dataset_hash);
  if (!ruta) {
    return NextResponse.json(
      { error: "sin_reporte", detalle: "This dataset has no saved structure report." },
      { status: 404 },
    );
  }
  try {
    const cuerpo = JSON.parse(await readFile(ruta, "utf8")) as { structure_report?: StructureReport; warnings?: unknown };
    return NextResponse.json({
      sha256: corrida.dataset_hash,
      estructura: resumirEstructura(cuerpo.structure_report, cuerpo.warnings),
      structure_report: cuerpo.structure_report ?? null,
    });
  } catch {
    return NextResponse.json({ error: "reporte_ilegible" }, { status: 500 });
  }
}
