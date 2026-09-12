import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `suscribirCanalForense` decide SOLO por `quiereFuenteSupabase()`
 * (NEXT_PUBLIC_DATA_SOURCE=supabase + credenciales públicas) — el mismo
 * selector de `getDataSource()`. En fixture, no-op: nunca abre un socket
 * contra una corrida que no existe. Estas pruebas no tocan la red: mockean
 * `@/lib/data/supabase` con un cliente de canal falso.
 */
const on = vi.fn().mockReturnThis();
const subscribe = vi.fn().mockReturnValue("canal-falso");
const channel = vi.fn(() => ({ on, subscribe }));
const removeChannel = vi.fn();

vi.mock("@/lib/data/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/supabase")>("@/lib/data/supabase");
  return {
    ...actual,
    createForenseSupabaseClient: () => ({ channel, removeChannel }),
  };
});

const { suscribirCanalForense } = await import("./canal");

describe("suscribirCanalForense", () => {
  const originalDataSource = process.env.NEXT_PUBLIC_DATA_SOURCE;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    on.mockClear();
    subscribe.mockClear();
    channel.mockClear();
    removeChannel.mockClear();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = originalDataSource;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnon;
  });

  it("en modo fixture (selector distinto de 'supabase'): no-op, nunca abre canal", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "fixture";
    const suscripcion = suscribirCanalForense({ tabla: "casos", onCambio: vi.fn() });
    expect(channel).not.toHaveBeenCalled();
    expect(() => suscripcion.cerrar()).not.toThrow();
  });

  it("con selector 'supabase' pero sin credenciales: sigue siendo no-op (quiereFuenteSupabase exige ambas)", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "supabase";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    suscribirCanalForense({ tabla: "casos", onCambio: vi.fn() });
    expect(channel).not.toHaveBeenCalled();
  });

  it("con fuente supabase: abre postgres_changes en el esquema forense, con el filtro dado, y se suscribe", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "clave-de-prueba";

    suscribirCanalForense({ tabla: "senales", filtro: "cluster_id=eq.c1", onCambio: vi.fn() });

    expect(channel).toHaveBeenCalledWith("forense:senales:cluster_id=eq.c1");
    expect(on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "forense", table: "senales", filter: "cluster_id=eq.c1" },
      expect.any(Function),
    );
    expect(subscribe).toHaveBeenCalled();
  });

  it("sin filtro: no manda la llave 'filter' (postgrest la rechaza vacía) y nombra el canal 'todos'", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "clave-de-prueba";

    suscribirCanalForense({ tabla: "casos", onCambio: vi.fn() });

    expect(channel).toHaveBeenCalledWith("forense:casos:todos");
    expect(on).toHaveBeenCalledWith("postgres_changes", { event: "*", schema: "forense", table: "casos" }, expect.any(Function));
  });

  it("cerrar() llama removeChannel una sola vez aunque se invoque varias veces (idempotente)", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "clave-de-prueba";

    const suscripcion = suscribirCanalForense({ tabla: "bitacora", onCambio: vi.fn() });
    suscripcion.cerrar();
    suscripcion.cerrar();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith("canal-falso");
  });

  it("onCambio recibe el payload tal cual se lo entrega el canal (INSERT/UPDATE/DELETE de postgres_changes)", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "clave-de-prueba";
    const onCambio = vi.fn();

    suscribirCanalForense({ tabla: "clusters", onCambio });
    const callback = on.mock.calls[0][2];
    const payload = { eventType: "UPDATE", new: { id: "cl-1", score: 0.9 }, old: { id: "cl-1", score: 0.5 } };
    callback(payload);

    expect(onCambio).toHaveBeenCalledWith(payload);
  });
});
