import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  borrarVista,
  borrarVistaConFallback,
  guardarVista,
  guardarVistaConFallback,
  leerVistasGuardadas,
  listarVistasConFallback,
} from "./vistas-guardadas";

/**
 * `listarVistasConFallback`/`guardarVistaConFallback`/`borrarVistaConFallback`
 * intentan `/api/vistas` (006 §3) primero y caen a `localStorage` en
 * cualquier respuesta no-2xx o error de red — mismo patrón que el wizard de
 * `/datos` con `product.inyectar` cuando el backend no está configurado.
 */
beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("localStorage puro (sin backend)", () => {
  it("guardarVista + leerVistasGuardadas: persiste y se puede leer de vuelta", () => {
    expect(guardarVista({ nombre: "Mi vista", ruta: "/", filtros: { nivel: "presuncion_alta" } })).toBe(true);
    const vistas = leerVistasGuardadas();
    expect(vistas).toHaveLength(1);
    expect(vistas[0]).toMatchObject({ nombre: "Mi vista", ruta: "/", filtros: { nivel: "presuncion_alta" } });
  });

  it("borrarVista quita solo la vista indicada", () => {
    guardarVista({ nombre: "A", ruta: "/", filtros: {} });
    guardarVista({ nombre: "B", ruta: "/", filtros: {} });
    const [a] = leerVistasGuardadas();
    expect(borrarVista(a.id)).toBe(true);
    expect(leerVistasGuardadas().map((v) => v.nombre)).toEqual(["B"]);
  });
});

describe("listarVistasConFallback", () => {
  it("con /api/vistas respondiendo 200: usa el servidor, nunca toca localStorage", async () => {
    const vistasServidor = [{ id: "v1", nombre: "Del servidor", ruta: "/", filtros: {} }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ vistas: vistasServidor }) }),
    );
    const resultado = await listarVistasConFallback("/");
    expect(resultado).toEqual({ vistas: vistasServidor, fuente: "servidor" });
  });

  it("con /api/vistas respondiendo 503 (backend no configurado): cae a localStorage, filtrado por ruta", async () => {
    guardarVista({ nombre: "Local", ruta: "/", filtros: {} });
    guardarVista({ nombre: "Otra ruta", ruta: "/otra", filtros: {} });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const resultado = await listarVistasConFallback("/");
    expect(resultado.fuente).toBe("local");
    expect(resultado.vistas.map((v) => v.nombre)).toEqual(["Local"]);
  });

  it("con fetch lanzando (sin red): cae a localStorage sin propagar el error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const resultado = await listarVistasConFallback("/");
    expect(resultado.fuente).toBe("local");
    expect(resultado.vistas).toEqual([]);
  });

  it("con 400 (argumento_invalido): NUNCA cae a localStorage, aunque haya vistas locales guardadas (Corte 3 hallazgo 4)", async () => {
    guardarVista({ nombre: "Local que no debe aparecer", ruta: "/", filtros: {} });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "argumento_invalido" }) }));
    const resultado = await listarVistasConFallback("/");
    expect(resultado.fuente).toBe("servidor");
    expect(resultado.vistas).toEqual([]);
    expect(resultado.error).toBeTruthy();
  });

  it("con 429 (demasiadas_solicitudes): NUNCA cae a localStorage, y el mensaje refleja el rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "demasiadas_solicitudes", retry_after_ms: 5000 }) }));
    const resultado = await listarVistasConFallback("/");
    expect(resultado.fuente).toBe("servidor");
    expect(resultado.error).toMatch(/5s/);
  });
});

describe("guardarVistaConFallback / borrarVistaConFallback", () => {
  it("guardarVistaConFallback: servidor ok -> no escribe en localStorage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const resultado = await guardarVistaConFallback({ nombre: "x", ruta: "/", filtros: {} });
    expect(resultado).toEqual({ ok: true, fuente: "servidor" });
    expect(leerVistasGuardadas()).toEqual([]);
  });

  it("guardarVistaConFallback: 503 -> cae a guardarVista local", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const resultado = await guardarVistaConFallback({ nombre: "x", ruta: "/", filtros: {} });
    expect(resultado).toEqual({ ok: true, fuente: "local" });
    expect(leerVistasGuardadas()).toHaveLength(1);
  });

  it("guardarVistaConFallback: 401 (sesión expirada) -> NUNCA escribe en localStorage como si hubiera tenido éxito", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "no_autenticado" }) }));
    const resultado = await guardarVistaConFallback({ nombre: "x", ruta: "/", filtros: {} });
    expect(resultado.ok).toBe(false);
    expect(resultado.fuente).toBe("servidor");
    expect(resultado.error).toMatch(/sesión/);
    expect(leerVistasGuardadas()).toEqual([]);
  });

  it("guardarVistaConFallback: 429 -> no cae a local, propaga el rechazo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "demasiadas_solicitudes" }) }));
    const resultado = await guardarVistaConFallback({ nombre: "x", ruta: "/", filtros: {} });
    expect(resultado.ok).toBe(false);
    expect(leerVistasGuardadas()).toEqual([]);
  });

  it("borrarVistaConFallback: servidor ok -> no toca localStorage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const resultado = await borrarVistaConFallback("v1");
    expect(resultado).toEqual({ ok: true, fuente: "servidor" });
  });

  it("borrarVistaConFallback: sin red -> cae a borrarVista local", async () => {
    guardarVista({ nombre: "x", ruta: "/", filtros: {} });
    const [v] = leerVistasGuardadas();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const resultado = await borrarVistaConFallback(v.id);
    expect(resultado).toEqual({ ok: true, fuente: "local" });
    expect(leerVistasGuardadas()).toEqual([]);
  });
});
