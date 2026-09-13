// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

const TMP = mkdtempSync(path.join(tmpdir(), "estates-estructura-"));
const HASH = "b".repeat(64);
const CORRIDA = "00000000-0000-4000-8000-0000000000bb";
const getCorrida = vi.fn();

vi.mock("@/lib/data", () => ({ getDataSource: () => ({ getCorrida }) }));
vi.mock("@/lib/auditoria/runner", () => ({
  esUuid: (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v),
  rutaEstructura: (h: string) => (h === HASH ? path.join(TMP, `${HASH}.structure.json`) : null),
}));

const { GET } = await import("./route");

writeFileSync(
  path.join(TMP, `${HASH}.structure.json`),
  JSON.stringify({
    sha256: HASH,
    structure_report: { status: "identity", summary: "Estate matches estate_schema.sql exactly", tables: { vendors: "vendors" }, disabled_schemes: {} },
    warnings: [],
  }),
);
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let ip = 0;
async function req(corrida: string, cookie = true) {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": `10.1.0.${++ip}` };
  if (cookie) headers.cookie = `${SESSION_COOKIE}=${await signSession({ sub: "auditor", perfil_id: "perfil-test" })}`;
  return new Request(`http://localhost:3000/api/estates/estructura?corrida_id=${corrida}`, { headers });
}

describe("GET /api/estates/estructura", () => {
  it("es privado: sin sesión 401", async () => {
    expect((await GET(await req(CORRIDA, false))).status).toBe(401);
  });

  it("devuelve el resumen y el structure_report del dataset de la corrida", async () => {
    getCorrida.mockResolvedValueOnce({ id: CORRIDA, dataset_hash: HASH });
    const res = await GET(await req(CORRIDA));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.estructura).toMatchObject({ estado: "identity", tablas: [{ canonica: "vendors", origen: "vendors" }] });
    expect(body.structure_report.status).toBe("identity");
  });

  it("corrida sin reporte (cargada antes de la ingesta multi-formato): 404 sin_reporte; id inválido: 422", async () => {
    getCorrida.mockResolvedValueOnce({ id: CORRIDA, dataset_hash: "c".repeat(64) });
    expect((await (await GET(await req(CORRIDA))).json()).error).toBe("sin_reporte");
    expect((await GET(await req("no-es-uuid"))).status).toBe(422);
  });
});
