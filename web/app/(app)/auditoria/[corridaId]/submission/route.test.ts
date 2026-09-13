// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

const CORRIDA = "0f0f0f0f-0000-4000-8000-000000000001";
const URL = `http://localhost:3000/auditoria/${CORRIDA}/submission`;
const TEXTO = '{\n  "seed": 101,\n  "findings": [],\n  "leads_not_pursued": [],\n  "run_metadata": {\n    "llm_calls": 0,\n    "mxn_cost": 0.0,\n    "wall_clock_seconds": 0.06\n  }\n}';

const fuente = vi.hoisted(() => ({ submission: null as Record<string, unknown> | null }));
vi.mock("@/lib/data", () => ({
  getDataSource: () => ({ getAuditorSubmission: async () => fuente.submission }),
}));

import { GET } from "./route";

function params(corridaId = CORRIDA) {
  return { params: Promise.resolve({ corridaId }) };
}

async function conSesion() {
  const token = await signSession({ sub: "auditor", perfil_id: "perfil-test" });
  return new Request(URL, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

describe("GET /auditoria/[corridaId]/submission", () => {
  let dir: string;
  const previa = process.env.FORENSE_SALIDA_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "forense-submission-"));
    process.env.FORENSE_SALIDA_DIR = dir;
    fuente.submission = null;
  });
  afterEach(async () => {
    if (previa === undefined) delete process.env.FORENSE_SALIDA_DIR;
    else process.env.FORENSE_SALIDA_DIR = previa;
    await rm(dir, { recursive: true, force: true });
  });

  it("sin sesión redirige a /login", async () => {
    const res = await GET(new Request(URL), params());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("corrida sin resultado del auditor: 404", async () => {
    const res = await GET(await conSesion(), params());
    expect(res.status).toBe(404);
  });

  it("descarga directa con los bytes del archivo en disco, igual en cada descarga", async () => {
    await mkdir(path.join(dir, CORRIDA), { recursive: true });
    await writeFile(path.join(dir, CORRIDA, "submission.json"), TEXTO);
    fuente.submission = JSON.parse(TEXTO);

    const res = await GET(await conSesion(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="submission-seed101-0f0f0f0f.json"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-forense-origen")).toBe("disco");
    expect(await res.text()).toBe(TEXTO);
    expect(await (await GET(await conSesion(), params())).text()).toBe(TEXTO);
  });

  it("un id que no es uuid no llega al disco: 404", async () => {
    fuente.submission = JSON.parse(TEXTO);
    const res = await GET(await conSesion(), params("..%2F..%2Fetc"));
    expect(res.status).toBe(404);
  });
});
