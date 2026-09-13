// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({ start: vi.fn(), list: vi.fn(), corrida: vi.fn() }));
vi.mock("@/lib/laboratorio/server", async (load) => {
  const original = await load<typeof import("@/lib/laboratorio/server")>();
  return { ...original, startLab: mocks.start, listLabs: mocks.list };
});
vi.mock("@/lib/data", () => ({ getDataSource: () => ({ label: "supabase", getCorrida: mocks.corrida }) }));

const id = "00000000-0000-4000-8000-000000000900";
let serial = 0;
async function request(body: unknown, options: { auth?: boolean; origin?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", origin: options.origin ?? "http://localhost:3000", "Content-Type": "application/json", "x-forwarded-for": `test-${serial++}` };
  if (options.auth !== false) headers.cookie = `${SESSION_COOKIE}=${await signSession({ sub: "auditor", perfil_id: id })}`;
  return new Request("http://localhost:3000/api/laboratorio", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => { vi.clearAllMocks(); mocks.corrida.mockResolvedValue({ id, nombre: "Dataset validado" }); mocks.start.mockResolvedValue({ launch: { run_id: id, status: "queued" }, summary: null }); mocks.list.mockResolvedValue([]); });

describe("BFF laboratorio", () => {
  it("acepta enfoque sin giro y transmite filtros a los agentes", async () => {
    const filtros = { desde: "2026-01-01", hasta: "2026-01-31" };
    const response = await POST(await request({ corrida_id: id, mensaje: "  Prioriza pagos  ", filtros, provider: "mock" }));
    expect(response.status).toBe(202);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ giro: "", mensaje: "Prioriza pagos", filtros }));
  });
  it.each([
    { desde: "2026-02-30", hasta: "2026-03-01" },
    { desde: "2026-02-01", hasta: "2026-01-01" },
    { desde: "2026-01-01", hasta: "2026-01-02", sql: "ignored" },
  ])("rechaza filtros inválidos sin despachar: %j", async (filtros) => {
    const response = await POST(await request({ corrida_id: id, filtros, provider: "mock" }));
    expect(response.status).toBe(422);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("exige sesión también para listar investigaciones", async () => {
    const result = await GET(new Request("http://localhost:3000/api/laboratorio"));
    expect(result.status).toBe(401); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("rechaza mutaciones de otro origen antes de acceder a datos", async () => {
    const result = await POST(await request({ corrida_id: id, giro: "Comercio", provider: "mock" }, { origin: "https://otro.invalid" }));
    expect(result.status).toBe(403); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("no lanza un proceso sin sesión", async () => {
    const result = await POST(await request({ corrida_id: id, giro: "Comercio", provider: "codex" }, { auth: false }));
    expect(result.status).toBe(401); expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([
    { corrida_id: "../../.env", giro: "Comercio", provider: "mock" },
    { corrida_id: id, giro: "ab", provider: "mock" },
    { corrida_id: id, giro: "Comercio\n--evil", provider: "mock" },
    { corrida_id: id, giro: "Comercio", provider: "shell" },
    { corrida_id: id, giro: "Comercio", provider: "mock", engine_output: "/tmp/private.json" },
    { corrida_id: id, giro: "Comercio", provider: "codex", estate: "../../private.db" },
  ])("rechaza datos de entrada no admitidos: %j", async (body) => {
    expect((await POST(await request(body))).status).toBe(422); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("comprueba que la corrida existe en la fuente autorizada", async () => {
    mocks.corrida.mockResolvedValue(null);
    expect((await POST(await request({ corrida_id: id, giro: "Comercio", provider: "mock" }))).status).toBe(404);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("despacha explícitamente mock o codex con perfil de sesión y responde estado real de cola", async () => {
    const result = await POST(await request({ corrida_id: id, giro: " Comercio ", provider: "mock" }));
    expect(result.status).toBe(202); expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ perfilId: id, giro: "Comercio", provider: "mock", corrida: { id, nombre: "Dataset validado" } }));
    expect((await result.json()).launch.status).toBe("queued");
  });
});
