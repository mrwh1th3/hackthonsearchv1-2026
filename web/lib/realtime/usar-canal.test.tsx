import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * `useCanalForense` es el único punto donde un componente cliente toca
 * `suscribirCanalForense`: al montar abre, al desmontar cierra — nunca dos
 * canales por un cambio de `onCambio` (eso pasa por ref a propósito), y
 * nunca un socket huérfano si el componente se desmonta (09 §Realtime).
 */
const cerrar = vi.fn();
const suscribirCanalForense = vi.fn().mockReturnValue({ cerrar });

vi.mock("./canal", () => ({ suscribirCanalForense: (...args: unknown[]) => suscribirCanalForense(...args) }));

const { useCanalForense } = await import("./usar-canal");

function Sonda({ onCambio }: { onCambio: () => void }) {
  useCanalForense({ tabla: "casos", filtro: "corrida_id=eq.c1", onCambio });
  return null;
}

describe("useCanalForense", () => {
  it("se suscribe al montar con tabla/filtro, y cierra el canal al desmontar", () => {
    const onCambio = vi.fn();
    const { unmount } = render(<Sonda onCambio={onCambio} />);

    expect(suscribirCanalForense).toHaveBeenCalledTimes(1);
    expect(suscribirCanalForense.mock.calls[0][0]).toMatchObject({ tabla: "casos", filtro: "corrida_id=eq.c1" });
    expect(cerrar).not.toHaveBeenCalled();

    unmount();
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("un onCambio nuevo en cada render no reabre el canal (va por ref, no por dependencia del efecto)", () => {
    suscribirCanalForense.mockClear();
    cerrar.mockClear();
    const { rerender } = render(<Sonda onCambio={() => {}} />);
    expect(suscribirCanalForense).toHaveBeenCalledTimes(1);

    rerender(<Sonda onCambio={() => {}} />);
    expect(suscribirCanalForense).toHaveBeenCalledTimes(1);
    expect(cerrar).not.toHaveBeenCalled();
  });

  it("onCambio llamado desde el canal usa siempre la versión más reciente pasada por el componente", () => {
    let capturado: ((payload: unknown) => void) | undefined;
    suscribirCanalForense.mockImplementation((params: { onCambio: (p: unknown) => void }) => {
      capturado = params.onCambio;
      return { cerrar };
    });

    const primero = vi.fn();
    const segundo = vi.fn();
    const { rerender } = render(<Sonda onCambio={primero} />);
    rerender(<Sonda onCambio={segundo} />);

    capturado?.({ eventType: "INSERT" });
    expect(primero).not.toHaveBeenCalled();
    expect(segundo).toHaveBeenCalledWith({ eventType: "INSERT" });
  });
});
