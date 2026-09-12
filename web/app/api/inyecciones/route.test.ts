// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import validInyectar from "@contracts/fixtures/valid/inyectar.json";
import inyectarVacio from "@contracts/fixtures/invalid/inyectar-vacio.json";

async function authedReq(body: unknown) {
  const token = await signSession({ sub: "auditor", perfil_id: "perfil-test" });
  return new Request("http://localhost:3000/api/inyecciones", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/inyecciones — validación de body contra el contrato real product.inyectar", () => {
  it("fixture válido (contracts/fixtures/valid/inyectar.json) pasa el gate de contrato: nunca 422", async () => {
    const res = await POST(await authedReq(validInyectar));
    // Sin N8N_WEBHOOK_BASE/INTERNAL_WEBHOOK_SECRET en este entorno: 503, no 422.
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("backend_no_configurado");
  });

  it("body con 'tablas' vacío (fixture invalid/inyectar-vacio.json): 422 contrato_invalido — el anyOf de tablas|archivos lo rechaza", async () => {
    const res = await POST(await authedReq(inyectarVacio));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("contrato_invalido");
    expect(json.detalles.length).toBeGreaterThan(0);
  });

  it("el shape del Corte 1 (ingesta_id/prioridad, sin 'tablas') ya NO es válido: 422, no 503 ni 202", async () => {
    const shapeViejo = { corrida_base_id: "00000000-0000-4000-8000-000000000001", ingesta_id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", idempotency_key: "7c9e6679-7425-40de-944b-e07fc1f90ae7", prioridad: "inyectados" };
    const res = await POST(await authedReq(shapeViejo));
    expect(res.status).toBe(422);
  });

  it("sin sesión: 401 no_autenticado, no evalúa el contrato", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/inyecciones", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
        body: JSON.stringify(validInyectar),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("cuerpo no-JSON: 400 cuerpo_invalido", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/inyecciones", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
          origin: "http://localhost:3000",
          cookie: `${SESSION_COOKIE}=${await signSession({ sub: "auditor", perfil_id: "perfil-test" })}`,
        },
        body: "{ esto no es json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/inyecciones — reenvío a n8n cuando el BFF sí está configurado", () => {
  const ENV_ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    vi.unstubAllGlobals();
  });

  it("reenvía con el secreto en header a <base>/inyecciones y devuelve 202 con el idempotency_key", async () => {
    process.env.N8N_WEBHOOK_BASE = "https://n8n.example.invalid/webhook/forense";
    process.env.INTERNAL_WEBHOOK_SECRET = "secreto-de-prueba-no-real";

    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ inyeccion_id: "iny-1" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(await authedReq(validInyectar));
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({ idempotency_key: (validInyectar as { idempotency_key: string }).idempotency_key, inyeccion_id: "iny-1" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://n8n.example.invalid/webhook/forense/inyecciones");
    expect((init.headers as Record<string, string>)["X-Internal-Webhook-Secret"]).toBe("secreto-de-prueba-no-real");
    expect(JSON.stringify(json)).not.toContain("secreto-de-prueba-no-real");
  });
});
