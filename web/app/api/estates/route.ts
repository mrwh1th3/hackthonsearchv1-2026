import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/security/origin";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { DIR_ESTATES, DIR_UPLOADS, ejecutarPython } from "@/lib/auditoria/runner";
import { ErrorSubida, MAX_BYTES_TOTAL, validarConjunto, type Conjunto } from "@/lib/estates/archivos";
import { resumirEstructura, type StructureReport } from "@/lib/estates/estructura";

export const runtime = "nodejs";

const HOLGURA_MULTIPART = 4 * 1024 * 1024;

/**
 * Sube un dataset y lo carga como corrida `lista`. Acepta lo mismo que el CLI del auditor: un SQLite
 * (.db/.sqlite/.sqlite3), uno o varios CSV (una tabla por archivo), XLSX (hoja por tabla) o un ZIP con
 * CSV/XLSX. Un conjunto de CSV o un ZIP es UN dataset.
 *
 * 1. Valida el conjunto por contenido (`lib/estates/archivos.ts`): 400 si la mezcla o el contenido no valen,
 *    413 si excede límites.
 * 2. Guarda los archivos, con nombres saneados, en `data/forensic/uploads/<sha del conjunto>/input/`.
 * 3. `loaders/ingestar_estate.py` revisa el ZIP sin extraerlo (rutas, zip bomb), corre la ingesta del auditor
 *    y deja `data/forensic/estates/<sha del SQLite canónico>.db` con los ids originales, más su
 *    `.structure.json`. Código 2 → 422 con el mensaje de estructura; otro fallo → 500.
 * 4. `loaders/forensic_to_forense.py` carga ese SQLite a Supabase como antes (preview y auditoría lo leen por
 *    `dataset_hash`, que es el sha de esos bytes).
 */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "origen_no_permitido" }, { status: 403 });
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!(await verifySession(token))) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  const rate = checkRateLimit(`estates:${clientKeyFromRequest(req)}`, 10, 60_000);
  if (!rate.ok) return NextResponse.json({ error: "demasiadas_solicitudes" }, { status: 429 });

  const largo = Number(req.headers.get("content-length") ?? 0);
  if (largo > MAX_BYTES_TOTAL + HOLGURA_MULTIPART) {
    return NextResponse.json({ error: "conjunto_muy_grande", detalle: "The dataset exceeds the size limit." }, { status: 413 });
  }

  let archivos: File[];
  try {
    const form = await req.formData();
    archivos = [...form.getAll("archivos"), ...form.getAll("estate")].filter((f): f is File => f instanceof File);
  } catch {
    return NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 });
  }
  if (archivos.length === 0) return NextResponse.json({ error: "falta_archivo" }, { status: 400 });
  const total = archivos.reduce((s, f) => s + f.size, 0);
  if (total > MAX_BYTES_TOTAL) {
    return NextResponse.json({ error: "conjunto_muy_grande", detalle: "The dataset exceeds the size limit." }, { status: 413 });
  }

  let conjunto: Conjunto;
  try {
    const entradas = await Promise.all(archivos.map(async (f) => ({ nombre: f.name, bytes: Buffer.from(await f.arrayBuffer()) })));
    conjunto = validarConjunto(entradas);
  } catch (e) {
    if (e instanceof ErrorSubida) return NextResponse.json({ error: e.codigo, detalle: e.detalle }, { status: e.status });
    throw e;
  }

  const dirConjunto = path.join(DIR_UPLOADS, conjunto.sha256);
  const dirEntrada = path.join(dirConjunto, "input");
  await guardarEntrada(dirConjunto, dirEntrada, conjunto);
  const unico = conjunto.formato === "sqlite" || conjunto.formato === "zip" || conjunto.formato === "xlsx";
  const entrada = unico ? path.join(dirEntrada, conjunto.archivos[0].nombre) : dirEntrada;

  const ing = await ejecutarPython(
    ["loaders/ingestar_estate.py", "--input", entrada, "--estates-dir", DIR_ESTATES, "--work-dir", path.join(dirConjunto, "work")],
    10 * 60_000,
  );
  if (ing.code === 2) {
    const detalle = (ing.stderr.match(/error: (?:estate structure: )?([\s\S]*)/)?.[1] ?? ing.stderr).trim().slice(0, 1200);
    return NextResponse.json({ error: "estructura_invalida", detalle }, { status: 422 });
  }
  let ingesta: { estate_db: string; sha256: string; status: string; structure_report: unknown; warnings: unknown };
  try {
    if (ing.code !== 0) throw new Error("ingesta");
    ingesta = JSON.parse(ing.stdout.trim().split("\n").pop() ?? "");
    if (typeof ingesta.estate_db !== "string" || !/^[0-9a-f]{64}$/.test(ingesta.sha256)) throw new Error("salida");
  } catch {
    console.error("[estates] ingesta falló", ing.code, ing.stderr.slice(-2000));
    return NextResponse.json({ error: "ingesta_fallo", detalle: "Could not convert the dataset." }, { status: 500 });
  }

  const r = await ejecutarPython(
    ["loaders/forensic_to_forense.py", ingesta.estate_db, "--seed", "0", "--nombre", `Estate · ${nombreVisible(conjunto)}`],
    10 * 60_000,
  );
  const estructura = resumirEstructura(ingesta.structure_report as StructureReport, ingesta.warnings);
  if (r.code !== 0) {
    const detalle = (r.stderr.match(/FAIL [^:]+: (.*)/)?.[1] ?? r.stderr.trim().split("\n").pop() ?? "").slice(0, 500);
    return NextResponse.json({ error: "estate_invalido", detalle, estructura }, { status: 422 });
  }
  return NextResponse.json(
    {
      corrida_id: r.stdout.trim().split(/\s+/)[0],
      sha256: ingesta.sha256,
      conjunto_sha256: conjunto.sha256,
      formato: conjunto.formato,
      archivos: conjunto.archivos.map((a) => a.nombre),
      estructura,
    },
    { status: 201 },
  );
}

/** Escribe el conjunto en un directorio temporal y lo mueve de golpe; si ya existe (mismo sha), se reutiliza. */
async function guardarEntrada(dirConjunto: string, dirEntrada: string, conjunto: Conjunto) {
  await mkdir(dirConjunto, { recursive: true });
  const existentes = await readdir(dirEntrada).catch(() => null);
  if (existentes && existentes.length === conjunto.archivos.length) return;
  const temporal = `${dirEntrada}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(temporal, { recursive: true });
  for (const a of conjunto.archivos) {
    // `a.nombre` ya está saneado (un solo segmento); se comprueba otra vez que no escape del directorio.
    const destino = path.join(temporal, a.nombre);
    if (path.dirname(destino) !== temporal) throw new Error("unsafe filename");
    await writeFile(destino, a.bytes);
  }
  await rm(dirEntrada, { recursive: true, force: true });
  try {
    await rename(temporal, dirEntrada);
  } catch {
    await rm(temporal, { recursive: true, force: true });
  }
}

function nombreVisible(conjunto: Conjunto): string {
  const primero = conjunto.archivos.map((a) => a.nombre).sort()[0] ?? "subido";
  const base = primero.replace(/[^\w.\- ]/g, "").slice(0, 60) || "subido";
  return conjunto.archivos.length > 1 ? `${base} +${conjunto.archivos.length - 1}` : base;
}
