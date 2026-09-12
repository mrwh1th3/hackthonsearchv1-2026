// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "./route";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

const BASE = "http://localhost:3000/api/vistas";

async function cookieAutenticada() {
  const token = await signSession({ sub: "auditor", perfil_id: "perfil-test" });
  return `${SESSION_COOKIE}=${token}`;
}

function headers(cookie?: string) {
  const h: Record<string, string> = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" };
  if (cookie) h.cookie = cookie;
  return h;
}

/**
 * BFF de `forense.vistas_guardadas` (006 §3, RLS sin política de SELECT):
 * sin `SUPABASE_SERVICE_ROLE_KEY` en este entorno de pruebas, el backend
 * responde 503 — igual que `/api/inyecciones` sin `N8N_WEBHOOK_BASE` — y el
 * cliente cae a `localStorage`. Estas pruebas fijan ese contrato de la ruta,
 * no un Supabase real.
 */
describe("GET /api/vistas", () => {
  it("sin sesión: 401, ni siquiera evalúa query params", async () => {
    const res = await GET(new Request(`${BASE}?ruta=/`, { headers: headers() }));
    expect(res.status).toBe(401);
  });

  it("origen cruzado: 403", async () => {
    const cookie = await cookieAutenticada();
    const res = await GET(new Request(`${BASE}?ruta=/`, { headers: { ...headers(cookie), origin: "https://otro.invalid" } }));
    expect(res.status).toBe(403);
  });

  it("sin 'ruta': 400 argumento_invalido", async () => {
    const cookie = await cookieAutenticada();
    const res = await GET(new Request(BASE, { headers: headers(cookie) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("argumento_invalido");
  });

  it("con sesión y 'ruta' válidos pero sin SUPABASE_SERVICE_ROLE_KEY: 503 backend_no_configurado", async () => {
    const cookie = await cookieAutenticada();
    const res = await GET(new Request(`${BASE}?ruta=/`, { headers: headers(cookie) }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("backend_no_configurado");
  });
});

describe("POST /api/vistas", () => {
  it("sin sesión: 401", async () => {
    const res = await POST(new Request(BASE, { method: "POST", headers: headers(), body: JSON.stringify({ nombre: "x", ruta: "/", filtros: {} }) }));
    expect(res.status).toBe(401);
  });

  it("cuerpo no-JSON: 400 cuerpo_invalido", async () => {
    const cookie = await cookieAutenticada();
    const res = await POST(new Request(BASE, { method: "POST", headers: headers(cookie), body: "{no-es-json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("cuerpo_invalido");
  });

  it("sin 'nombre': 400 argumento_invalido, antes de tocar el backend", async () => {
    const cookie = await cookieAutenticada();
    const res = await POST(new Request(BASE, { method: "POST", headers: headers(cookie), body: JSON.stringify({ ruta: "/", filtros: {} }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("argumento_invalido");
  });

  it("'filtros' como arreglo (no objeto): 400 argumento_invalido", async () => {
    const cookie = await cookieAutenticada();
    const res = await POST(new Request(BASE, { method: "POST", headers: headers(cookie), body: JSON.stringify({ nombre: "x", ruta: "/", filtros: [] }) }));
    expect(res.status).toBe(400);
  });

  it("nombre vacío tras trim(): 400 argumento_invalido", async () => {
    const cookie = await cookieAutenticada();
    const res = await POST(new Request(BASE, { method: "POST", headers: headers(cookie), body: JSON.stringify({ nombre: "   ", ruta: "/", filtros: {} }) }));
    expect(res.status).toBe(400);
  });

  it("cuerpo válido pero sin SUPABASE_SERVICE_ROLE_KEY: 503 backend_no_configurado", async () => {
    const cookie = await cookieAutenticada();
    const res = await POST(new Request(BASE, { method: "POST", headers: headers(cookie), body: JSON.stringify({ nombre: "Mi vista", ruta: "/", filtros: { nivel: "presuncion_alta" } }) }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("backend_no_configurado");
  });
});

describe("DELETE /api/vistas", () => {
  it("sin sesión: 401", async () => {
    const res = await DELETE(new Request(`${BASE}?id=v1`, { method: "DELETE", headers: headers() }));
    expect(res.status).toBe(401);
  });

  it("sin 'id': 400 argumento_invalido", async () => {
    const cookie = await cookieAutenticada();
    const res = await DELETE(new Request(BASE, { method: "DELETE", headers: headers(cookie) }));
    expect(res.status).toBe(400);
  });

  it("con sesión e 'id' pero sin SUPABASE_SERVICE_ROLE_KEY: 503 backend_no_configurado", async () => {
    const cookie = await cookieAutenticada();
    const res = await DELETE(new Request(`${BASE}?id=v1`, { method: "DELETE", headers: headers(cookie) }));
    expect(res.status).toBe(503);
  });
});
