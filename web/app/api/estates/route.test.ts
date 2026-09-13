// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

const TMP = mkdtempSync(path.join(tmpdir(), "estates-route-"));
const ejecutarPython = vi.fn();

vi.mock("@/lib/auditoria/runner", () => ({
  DIR_ESTATES: path.join(TMP, "estates"),
  DIR_UPLOADS: path.join(TMP, "uploads"),
  ejecutarPython: (...args: unknown[]) => ejecutarPython(...args),
}));

const { POST } = await import("./route");

const SQLITE = Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(84)]);
const CSV = Buffer.from("rfc,legal_name\nAAA010101AA1,Uno\n");
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....vendors.csv....")]);
const SHA_DB = "a".repeat(64);
const CORRIDA = "00000000-0000-4000-8000-0000000000aa";

const REPORTE = {
  status: "adapted",
  summary: "1 table(s) and 2 column(s) mapped from other names.",
  input: { input_format: "csv_dir", tables: [{ table: "facturas", source: "facturas.csv", encoding: "utf-8", delimiter: ",", rows: 3 }] },
  tables: {
    invoices: { source: "facturas", confidence: 0.9, usable: true, rows: 3, columns: { issuer_rfc: { source: "RFC Emisor", confidence: 0.71, method: "deterministic" } }, missing_columns: [], unmapped_source_columns: [] },
  },
  low_confidence: ["invoices.issuer_rfc"],
  disabled_schemes: { kickback: ["bank_txns.from_clabe"] },
  weakened_schemes: { phantom_vendor: ["ledger.entry_id"] },
  precision_lost: { "vendors.bank_clabe": 4 },
  id_collisions: {},
  unmapped_source_tables: [],
};

let ip = 0;
async function req(archivos: { nombre: string; bytes: Buffer }[], opciones: { cookie?: boolean; origin?: string; campo?: string } = {}) {
  const form = new FormData();
  for (const a of archivos) form.append(opciones.campo ?? "archivos", new File([new Uint8Array(a.bytes)], a.nombre));
  const headers: Record<string, string> = {
    host: "localhost:3000",
    origin: opciones.origin ?? "http://localhost:3000",
    "x-forwarded-for": `10.0.0.${++ip}`,
  };
  if (opciones.cookie !== false) headers.cookie = `${SESSION_COOKIE}=${await signSession({ sub: "auditor", perfil_id: "perfil-test" })}`;
  return new Request("http://localhost:3000/api/estates", { method: "POST", headers, body: form });
}

function ingestaOk() {
  return {
    code: 0,
    stdout: JSON.stringify({ estate_db: path.join(TMP, "estates", `${SHA_DB}.db`), sha256: SHA_DB, status: "adapted", structure_report: REPORTE, warnings: ["Mapeos de baja confianza: invoices.issuer_rfc"] }) + "\n",
    stderr: "",
  };
}

beforeEach(() => ejecutarPython.mockReset());
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("POST /api/estates — multi-formato", () => {
  it("sin sesión: 401; origen cruzado: 403; nunca llama a Python", async () => {
    expect((await POST(await req([{ nombre: "e.db", bytes: SQLITE }], { cookie: false }))).status).toBe(401);
    expect((await POST(await req([{ nombre: "e.db", bytes: SQLITE }], { origin: "https://otro.invalid" }))).status).toBe(403);
    expect(ejecutarPython).not.toHaveBeenCalled();
  });

  it("mezcla .db + .csv: 400 mezcla_invalida con mensaje claro", async () => {
    const res = await POST(await req([{ nombre: "e.db", bytes: SQLITE }, { nombre: "vendors.csv", bytes: CSV }]));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("mezcla_invalida");
    expect(body.detalle).toMatch(/cannot be mixed/);
    expect(ejecutarPython).not.toHaveBeenCalled();
  });

  it("un .db que no es SQLite: 400 contenido_no_coincide", async () => {
    const res = await POST(await req([{ nombre: "e.db", bytes: CSV }]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("contenido_no_coincide");
  });

  it("content-length por encima del límite: 413 sin leer el cuerpo", async () => {
    const r = await req([{ nombre: "e.db", bytes: SQLITE }]);
    const grande = new Request(r, { headers: new Headers([...r.headers.entries(), ["content-length", String(600 * 1024 * 1024)]]) });
    expect((await POST(grande)).status).toBe(413);
  });

  it("varios CSV: guarda nombres saneados en uploads/<sha>/input, ingesta el directorio y carga el SQLite canónico", async () => {
    ejecutarPython.mockResolvedValueOnce(ingestaOk()).mockResolvedValueOnce({ code: 0, stdout: `${CORRIDA} seed=0 cfdi=3\n`, stderr: "" });
    const res = await POST(await req([{ nombre: "../../facturas.csv", bytes: CSV }, { nombre: "vendors.csv", bytes: CSV }]));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ corrida_id: CORRIDA, sha256: SHA_DB, formato: "csv_dir", archivos: ["facturas.csv", "vendors.csv"] });
    expect(body.conjunto_sha256).toMatch(/^[0-9a-f]{64}$/);

    const [ingesta] = ejecutarPython.mock.calls[0] as [string[]];
    const dirEntrada = path.join(TMP, "uploads", body.conjunto_sha256, "input");
    expect(ingesta.slice(0, 5)).toEqual(["loaders/ingestar_estate.py", "--input", dirEntrada, "--estates-dir", path.join(TMP, "estates")]);
    expect(readdirSync(dirEntrada).sort()).toEqual(["facturas.csv", "vendors.csv"]);

    const [carga] = ejecutarPython.mock.calls[1] as [string[]];
    expect(carga.slice(0, 4)).toEqual(["loaders/forensic_to_forense.py", path.join(TMP, "estates", `${SHA_DB}.db`), "--seed", "0"]);

    expect(body.estructura.bajaConfianza).toEqual(["invoices.issuer_rfc"]);
    expect(body.estructura.detectoresApagados).toEqual([{ detector: "kickback", faltan: ["bank_txns.from_clabe"] }]);
    expect(body.estructura.evidenciaReducida).toEqual([{ detector: "phantom_vendor", faltan: ["ledger.entry_id"] }]);
    expect(body.estructura.precisionPerdida).toEqual([{ campo: "vendors.bank_clabe", valores: 4 }]);
    expect(body.estructura.tablas[0]).toMatchObject({ canonica: "invoices", origen: "facturas", filas: 3 });
  });

  it("un ZIP se pasa como archivo (no se extrae en el BFF); el campo legado `estate` sigue funcionando", async () => {
    ejecutarPython.mockResolvedValueOnce(ingestaOk()).mockResolvedValueOnce({ code: 0, stdout: `${CORRIDA} ya_cargada\n`, stderr: "" });
    const res = await POST(await req([{ nombre: "datos.zip", bytes: ZIP }], { campo: "estate" }));
    expect(res.status).toBe(201);
    const [ingesta] = ejecutarPython.mock.calls[0] as [string[]];
    expect(ingesta[2]).toBe(path.join(TMP, "uploads", (await res.json()).conjunto_sha256, "input", "datos.zip"));
  });

  it("ingesta con código 2 (estructura del usuario): 422 con el mensaje de estructura, sin cargar", async () => {
    ejecutarPython.mockResolvedValueOnce({
      code: 2,
      stdout: "",
      stderr: "error: estate structure: required fields invoices.total could not be located.\n",
    });
    const res = await POST(await req([{ nombre: "facturas.csv", bytes: CSV }]));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "estructura_invalida", detalle: "required fields invoices.total could not be located." });
    expect(ejecutarPython).toHaveBeenCalledTimes(1);
  });

  it("ingesta con otro código o salida ilegible: 500 sin filtrar stderr", async () => {
    ejecutarPython.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "Traceback: secreto interno" });
    const res = await POST(await req([{ nombre: "e.db", bytes: SQLITE }]));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("ingesta_fallo");
    expect(JSON.stringify(body)).not.toMatch(/secreto/);

    ejecutarPython.mockResolvedValueOnce({ code: 0, stdout: "no json", stderr: "" });
    expect((await POST(await req([{ nombre: "e.db", bytes: SQLITE }]))).status).toBe(500);
  });

  it("el loader a Supabase rechaza el estate: 422 estate_invalido con su FAIL y el resumen de estructura", async () => {
    ejecutarPython
      .mockResolvedValueOnce(ingestaOk())
      .mockResolvedValueOnce({ code: 2, stdout: "", stderr: "FAIL x.db: ledger.entry_id no numérico en 3 fila(s)\n" });
    const res = await POST(await req([{ nombre: "e.db", bytes: SQLITE }]));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("estate_invalido");
    expect(body.detalle).toMatch(/entry_id no numérico/);
    expect(body.estructura.estado).toBe("adapted");
  });
});
