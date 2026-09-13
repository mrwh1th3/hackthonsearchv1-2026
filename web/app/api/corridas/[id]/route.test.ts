// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DELETE } from "./route";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

const ID = "00000000-0000-4000-8000-000000000001";
const URL = `http://localhost:3000/api/corridas/${ID}`;

async function cookieAutenticada() {
  const token = await signSession({ sub: "auditor", perfil_id: "perfil-test" });
  return `${SESSION_COOKIE}=${token}`;
}

function headers(cookie?: string) {
  const h: Record<string, string> = { host: "localhost:3000", origin: "http://localhost:3000" };
  if (cookie) h.cookie = cookie;
  return h;
}

function params() {
  return { params: Promise.resolve({ id: ID }) };
}

/**
 * Igual contrato que `/api/investigaciones/[id]`: sin
 * `SUPABASE_SERVICE_ROLE_KEY` no hay backend real, así que 503, nunca un 204
 * fingido (CLAUDE.md regla 10).
 */
describe("DELETE /api/corridas/[id]", () => {
  it("sin sesión: 401", async () => {
    const res = await DELETE(new Request(URL, { method: "DELETE", headers: headers() }), params());
    expect(res.status).toBe(401);
  });

  it("origen cruzado: 403", async () => {
    const res = await DELETE(new Request(URL, { method: "DELETE", headers: { ...headers(), origin: "https://otro.invalid" } }), params());
    expect(res.status).toBe(403);
  });

  it("con sesión pero sin SUPABASE_SERVICE_ROLE_KEY: 503 backend_no_configurado", async () => {
    const cookie = await cookieAutenticada();
    const res = await DELETE(new Request(URL, { method: "DELETE", headers: headers(cookie) }), params());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("backend_no_configurado");
  });
});
