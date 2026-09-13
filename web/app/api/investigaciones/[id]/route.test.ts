// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DELETE } from "./route";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

const ID = "00000000-0000-4000-8000-000000000900";
const URL = `http://localhost:3000/api/investigaciones/${ID}`;

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
 * `borrarInvestigacionPrivada` cae a `false` sin `SUPABASE_SERVICE_ROLE_KEY`
 * (fixture, CLAUDE.md regla 10: no fingir un borrado que no ocurrió) — igual
 * que `/api/vistas` sin backend. Estas pruebas fijan sesión/origen/rate limit
 * antes de tocar el backend, no un Supabase real.
 */
describe("DELETE /api/investigaciones/[id]", () => {
  it("sin sesión: 401", async () => {
    const res = await DELETE(new Request(URL, { method: "DELETE", headers: headers() }), params());
    expect(res.status).toBe(401);
  });

  it("origen cruzado: 403, ni siquiera evalúa sesión", async () => {
    const res = await DELETE(new Request(URL, { method: "DELETE", headers: { ...headers(), origin: "https://otro.invalid" } }), params());
    expect(res.status).toBe(403);
  });

  it("con sesión pero sin SUPABASE_SERVICE_ROLE_KEY: 503 backend_no_configurado, nunca 204 fingido", async () => {
    const cookie = await cookieAutenticada();
    const res = await DELETE(new Request(URL, { method: "DELETE", headers: headers(cookie) }), params());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("backend_no_configurado");
  });
});
