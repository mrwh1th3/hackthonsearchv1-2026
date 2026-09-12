// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import validInvestigar from "@contracts/fixtures/valid/investigar.json";

async function authedReq(body: unknown) {
  const token = await signSession({ sub: "auditor", perfil_id: "perfil-test" });
  return new Request("http://localhost:3000/api/investigaciones", {
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

describe("POST /api/investigaciones — validación de body contra contrato product.investigar", () => {
  it("fixture válido (contracts/fixtures/valid/investigar.json) pasa el gate de contrato: nunca 422", async () => {
    const res = await POST(await authedReq(validInvestigar));
    const json = await res.json();
    // Sin N8N_WEBHOOK_BASE/INTERNAL_WEBHOOK_SECRET en este entorno de test:
    // 503 backend_no_configurado (CLAUDE.md regla 3: no fingir aceptación).
    // Lo que prueba este caso es que la validación de contrato NO rechazó el
    // body válido (nunca 422 contrato_invalido).
    expect(res.status).toBe(503);
    expect(json.error).toBe("backend_no_configurado");
  });

  it("body inválido (directriz_id fuera de catálogo): 422 contrato_invalido con detalles de ajv", async () => {
    const invalido = { ...validInvestigar, directriz_id: "no_existe_en_el_catalogo" };
    const res = await POST(await authedReq(invalido));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("contrato_invalido");
    expect(Array.isArray(json.detalles)).toBe(true);
    expect(json.detalles.length).toBeGreaterThan(0);
  });

  it("body inválido (falta mensaje obligatorio): 422 contrato_invalido", async () => {
    const sinMensaje = { ...(validInvestigar as Record<string, unknown>) };
    delete sinMensaje.mensaje;
    const res = await POST(await authedReq(sinMensaje));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("contrato_invalido");
  });

  it("sin sesión: 401 no_autenticado, no evalúa el contrato", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/investigaciones", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
        body: JSON.stringify(validInvestigar),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("cuerpo no-JSON: 400 cuerpo_invalido", async () => {
    const token = await signSession({ sub: "auditor", perfil_id: "perfil-test" });
    const res = await POST(
      new Request("http://localhost:3000/api/investigaciones", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
          origin: "http://localhost:3000",
          cookie: `${SESSION_COOKIE}=${token}`,
        },
        body: "{ esto no es json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
