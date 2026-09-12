// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/auth/session";

/**
 * Regla explícita del corte: con una fuente de datos REAL y sin webhook de
 * n8n configurado, el BFF responde 503 `backend_no_configurado`. No se finge
 * una aceptación ni se sirve una propuesta de demostración con datos reales.
 *
 * El archivo es independiente porque `getDataSource()` memoiza la fuente: aquí
 * el entorno se fija ANTES del primer import del módulo de datos.
 */

let postPropuestas: (req: Request) => Promise<Response>;
let postAplicar: (req: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ejemplo.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "clave-publica-de-prueba");
  vi.stubEnv("N8N_WEBHOOK_BASE", "");
  vi.stubEnv("INTERNAL_WEBHOOK_SECRET", "");
  postPropuestas = (await import("@/app/api/reportes/propuestas/route")).POST;
  postAplicar = (await import("@/app/api/reportes/aplicar/route")).POST;
});

async function peticion(url: string, body: unknown): Promise<Request> {
  const token = await signSession({ sub: "auditor", perfil_id: "00000000-0000-4000-8000-000000000300" });
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      cookie: `forense_session=${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("sin backend configurado (fuente real, sin webhook)", () => {
  it("propuestas responde 503 backend_no_configurado", async () => {
    const res = await postPropuestas(
      await peticion("/api/reportes/propuestas", {
        caso_id: "00000000-0000-4000-8000-000000000100",
        version_base: 1,
        modo: "pregunta",
        mensaje: "¿Qué dice el dictamen?",
        evidencia_ids: [],
        idempotency_key: "00000000-0000-4000-8000-000000000420",
      }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("backend_no_configurado");
  });

  it("aplicar responde 503 antes de tocar el almacén", async () => {
    const res = await postAplicar(
      await peticion("/api/reportes/aplicar?caso_id=00000000-0000-4000-8000-000000000100", {
        propuesta_id: "00000000-0000-4000-8000-000000000403",
        version_base: 1,
        idempotency_key: "00000000-0000-4000-8000-000000000421",
      }),
    );
    expect(res.status).toBe(503);
  });
});
