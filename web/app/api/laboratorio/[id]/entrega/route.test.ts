// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { GET } from "./route";

const mocked = vi.hoisted(() => ({ read: vi.fn(), inspect: vi.fn() }));
vi.mock("@/lib/laboratorio/entregas", async (load) => ({ ...(await load<typeof import("@/lib/laboratorio/entregas")>()), readDelivery: mocked.read, inspectDeliveries: mocked.inspect }));
const id = "00000000-0000-4000-8000-000000000900";
const params = () => ({ params: Promise.resolve({ id }) });
async function request(kind: string, auth = true) {
  const token = auth ? await signSession({ sub: "auditor", perfil_id: id }) : "";
  return new Request(`http://localhost:3000/api/laboratorio/${id}/entrega?tipo=${encodeURIComponent(kind)}`, { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });
}
beforeEach(() => { vi.clearAllMocks(); });

describe("descarga privada de entregables", () => {
  it("exige sesión y solo admite clases de entrega conocidas", async () => {
    expect((await GET(await request("submission", false), params())).status).toBe(401);
    expect((await GET(await request("../../.env"), params())).status).toBe(422);
    expect(mocked.read).not.toHaveBeenCalled();
  });
  it("entrega el JSON exacto, como archivo adjunto y sin envelope de laboratorio", async () => {
    const json = '{"seed":3,"findings":[],"run_metadata":{"mxn_cost":0.0}}\n';
    mocked.read.mockResolvedValue({ content: json, filename: "submission.json", mime: "application/json; charset=utf-8", inline: false });
    const response = await GET(await request("submission"), params());
    expect(await response.text()).toBe(json);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocked.read).toHaveBeenCalledWith(id, id, "submission");
  });
  it("abre el HTML con aislamiento y sin permitir scripts ni recursos externos", async () => {
    mocked.read.mockResolvedValue({ content: "<!doctype html><h1>Expediente</h1>", filename: "case-file.html", mime: "text/html; charset=utf-8", inline: true });
    const response = await GET(await request("expediente"), params());
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox; default-src 'none'");
    expect(response.headers.get("Content-Security-Policy")).not.toContain("allow-scripts");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("no ofrece otra corrida como fallback cuando el archivo o el permiso faltan", async () => {
    mocked.read.mockResolvedValue(null);
    expect((await GET(await request("expediente"), params())).status).toBe(404);
  });
});
