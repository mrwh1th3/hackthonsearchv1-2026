import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { getDataSource } from "@/lib/data";
import { ejecutarPython, esUuid, rutaEstate } from "@/lib/auditoria/runner";

export const runtime = "nodejs";

const TABLAS = ["vendors", "invoices", "ledger", "bank_txns", "purchase_orders", "contracts", "employees", "efos_list"];

/**
 * Preview de solo lectura del estate SQLite de una corrida, por páginas, para la tabla tipo
 * hoja de cálculo de "Administrar datos". Lee el archivo guardado en
 * `data/forensic/estates/<dataset_hash>.db` con `loaders/estate_preview.py` (mode=ro); la
 * tabla sale de una lista cerrada y offset/limit se acotan aquí y en el script.
 */
export async function GET(req: Request) {
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!(await verifySession(token))) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  const rate = checkRateLimit(`estate-preview:${clientKeyFromRequest(req)}`, 120, 60_000);
  if (!rate.ok) return NextResponse.json({ error: "demasiadas_solicitudes" }, { status: 429 });

  const url = new URL(req.url);
  const corridaId = url.searchParams.get("corrida_id");
  const tabla = url.searchParams.get("tabla") ?? "vendors";
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset") ?? 0)) || 0);
  const limit = Math.min(500, Math.max(1, Math.floor(Number(url.searchParams.get("limit") ?? 100)) || 100));
  if (!esUuid(corridaId)) return NextResponse.json({ error: "corrida_invalida" }, { status: 422 });
  if (!TABLAS.includes(tabla)) return NextResponse.json({ error: "tabla_invalida" }, { status: 422 });

  const corrida = await getDataSource().getCorrida(corridaId);
  if (!corrida) return NextResponse.json({ error: "corrida_no_existe" }, { status: 404 });
  const estate = rutaEstate(corrida.dataset_hash);
  if (!estate) {
    return NextResponse.json(
      { error: "sin_estate", detalle: "Esta corrida no se cargó desde un estate SQLite; no hay archivo que previsualizar." },
      { status: 409 },
    );
  }

  const r = await ejecutarPython(["loaders/estate_preview.py", estate, tabla, String(offset), String(limit)], 30_000);
  if (r.code !== 0) {
    return NextResponse.json({ error: "preview_fallo", detalle: r.stderr.trim().split("\n").pop()?.slice(0, 300) }, { status: 500 });
  }
  return NextResponse.json(JSON.parse(r.stdout));
}
