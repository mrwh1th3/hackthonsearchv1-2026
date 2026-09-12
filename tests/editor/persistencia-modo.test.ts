// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/auth/session";

/**
 * Defecto corregido en este corte (hallazgo 1 del verificador).
 *
 * ANTES: `modoBackend()` devolvía `"webhook"` en cuanto existían
 * `N8N_WEBHOOK_BASE` + `INTERNAL_WEBHOOK_SECRET`, y las cinco operaciones
 * deterministas (aplicar, descartar, revertir, borrador, versiones) escribían
 * en el almacén **en memoria** del proceso mientras respondían
 * `origen: "n8n"`. Eso era mentira por partida doble: ni había n8n de por
 * medio —`MANIFEST.md` §5 nodo 8: «Aplicar es operación determinista del
 * BFF», no hay nodo de webhook para estas operaciones— ni había persistencia.
 *
 * AHORA: la persistencia la decide `SUPABASE_SERVICE_ROLE_KEY`. Con fuente de
 * datos real y sin service role no hay dónde escribir, así que responden 503
 * `backend_no_configurado` y el cliente conserva su borrador. El webhook de
 * n8n solo habilita `/api/reportes/propuestas`.
 *
 * Archivo independiente: `getDataSource()` memoiza, así que el entorno se fija
 * ANTES del primer import.
 */

const CASO = "00000000-0000-4000-8000-000000000100";

let postAplicar: (req: Request) => Promise<Response>;
let postDescartar: (req: Request) => Promise<Response>;
let postRevertir: (req: Request) => Promise<Response>;
let postBorrador: (req: Request) => Promise<Response>;
let postExportar: (req: Request) => Promise<Response>;
let getVersiones: (req: Request) => Promise<Response>;
let modoPropuesta: () => string;
let repositorio: () => unknown;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_DATA_SOURCE", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ejemplo.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "clave-publica-de-prueba");
  // n8n SÍ configurado…
  vi.stubEnv("N8N_WEBHOOK_BASE", "https://n8n.ejemplo.invalid/webhook/forense");
  vi.stubEnv("INTERNAL_WEBHOOK_SECRET", "secreto-de-prueba");
  // …y service role NO.
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("SUPABASE_URL", "");

  postAplicar = (await import("@/app/api/reportes/aplicar/route")).POST;
  postDescartar = (await import("@/app/api/reportes/descartar/route")).POST;
  postRevertir = (await import("@/app/api/reportes/revertir/route")).POST;
  postBorrador = (await import("@/app/api/reportes/borrador/route")).POST;
  postExportar = (await import("@/app/api/reportes/exportar/route")).POST;
  getVersiones = (await import("@/app/api/reportes/versiones/route")).GET;
  const servidor = await import("@/lib/document/servidor");
  modoPropuesta = servidor.modoPropuesta;
  repositorio = servidor.repositorio;
});

async function cabeceras(): Promise<Record<string, string>> {
  const token = await signSession({ sub: "auditor", perfil_id: "00000000-0000-4000-8000-000000000300" });
  return {
    "content-type": "application/json",
    host: "localhost:3000",
    origin: "http://localhost:3000",
    cookie: `forense_session=${token}`,
  };
}

async function post(url: string, body: unknown): Promise<Request> {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: await cabeceras(),
    body: JSON.stringify(body),
  });
}

async function get(url: string): Promise<Request> {
  return new Request(`http://localhost:3000${url}`, { method: "GET", headers: await cabeceras() });
}

describe("n8n configurado pero sin service role: el webhook no es persistencia", () => {
  it("el modo de propuesta es webhook, pero NO hay repositorio", () => {
    expect(modoPropuesta()).toBe("webhook");
    expect(repositorio()).toBeNull();
  });

  it("aplicar responde 503 y no finge una versión nueva", async () => {
    const res = await postAplicar(
      await post(`/api/reportes/aplicar?caso_id=${CASO}`, {
        propuesta_id: "00000000-0000-4000-8000-000000000403",
        version_base: 1,
        idempotency_key: "00000000-0000-4000-8000-000000000430",
      }),
    );
    expect(res.status).toBe(503);
    const cuerpo = await res.json();
    expect(cuerpo.error).toBe("backend_no_configurado");
    expect(cuerpo.origen).toBeUndefined();
  });

  it("descartar, revertir, borrador, exportar y versiones responden 503", async () => {
    const casos: [string, Response][] = [
      [
        "descartar",
        await postDescartar(
          await post("/api/reportes/descartar", {
            caso_id: CASO,
            propuesta_id: "00000000-0000-4000-8000-000000000403",
            idempotency_key: "00000000-0000-4000-8000-000000000431",
          }),
        ),
      ],
      [
        "revertir",
        await postRevertir(
          await post("/api/reportes/revertir", {
            caso_id: CASO,
            accion: "revertir",
            version_objetivo: 1,
            version_base: 2,
            idempotency_key: "00000000-0000-4000-8000-000000000432",
          }),
        ),
      ],
      [
        "borrador",
        await postBorrador(
          await post("/api/reportes/borrador", {
            caso_id: CASO,
            version_base: 1,
            documento: { type: "doc", content: [] },
          }),
        ),
      ],
      [
        "exportar",
        await postExportar(await post("/api/reportes/exportar", { caso_id: CASO, formato: "md" })),
      ],
      ["versiones", await getVersiones(await get(`/api/reportes/versiones?caso_id=${CASO}`))],
    ];
    for (const [nombre, res] of casos) {
      expect(`${nombre}:${res.status}`).toBe(`${nombre}:503`);
      expect((await res.json()).error).toBe("backend_no_configurado");
    }
  });
});
