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
