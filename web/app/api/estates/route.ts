import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/security/origin";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { DIR_ESTATES, ejecutarPython } from "@/lib/auditoria/runner";

export const runtime = "nodejs";

const MAX_BYTES = 200 * 1024 * 1024;
const SQLITE_MAGIC = "SQLite format 3";

/**
 * Sube un estate SQLite en el formato de los jueces y lo carga como corrida `lista`
 * (`loaders/forensic_to_forense.py`: valida tablas y columnas del spec, conserva ids
 * originales, compara conteos y revierte si no cuadran). El archivo queda en
 * `data/forensic/estates/<sha256>.db`, de donde lo lee la auditoría.
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "origen_no_permitido" }, { status: 403 });
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!(await verifySession(token))) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  const rate = checkRateLimit(`estates:${clientKeyFromRequest(req)}`, 10, 60_000);
  if (!rate.ok) return NextResponse.json({ error: "demasiadas_solicitudes" }, { status: 429 });

  let archivo: File | null = null;
  try {
    const f = (await req.formData()).get("estate");
    archivo = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 });
  }
  if (!archivo) return NextResponse.json({ error: "falta_archivo" }, { status: 400 });
  if (archivo.size > MAX_BYTES) return NextResponse.json({ error: "archivo_muy_grande" }, { status: 413 });

  const bytes = Buffer.from(await archivo.arrayBuffer());
  if (!bytes.subarray(0, 15).toString("latin1").startsWith(SQLITE_MAGIC)) {
    return NextResponse.json({ error: "no_es_sqlite", detalle: "El archivo no es una base SQLite." }, { status: 422 });
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  await mkdir(DIR_ESTATES, { recursive: true });
  const destino = path.join(DIR_ESTATES, `${sha}.db`);
  const temporal = `${destino}.${process.pid}.tmp`;
  await writeFile(temporal, bytes);
  await rename(temporal, destino);

  const base = archivo.name.replace(/[^\w.\- ]/g, "").slice(0, 60) || "subido";
  const r = await ejecutarPython(["loaders/forensic_to_forense.py", destino, "--seed", "0", "--nombre", `Estate · ${base}`], 10 * 60_000);
  if (r.code !== 0) {
    const detalle = (r.stderr.match(/FAIL [^:]+: (.*)/)?.[1] ?? r.stderr.trim().split("\n").pop() ?? "").slice(0, 500);
    return NextResponse.json({ error: "estate_invalido", detalle }, { status: 422 });
  }
  return NextResponse.json({ corrida_id: r.stdout.trim().split(/\s+/)[0], sha256: sha }, { status: 201 });
}
