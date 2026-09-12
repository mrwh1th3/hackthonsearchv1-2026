import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CasoChat } from "./caso-chat";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const periodo = { desde: "2026-01-01", hasta_exclusivo: "2026-02-01", timezone: "America/Monterrey" };

afterEach(() => vi.unstubAllGlobals());

/**
 * El chat del diseño contesta con una frase enlatada. Aquí se prueba lo
 * contrario: la pregunta sale como `product.investigar` por el BFF y la única
 * respuesta que aparece es la confirmación del sistema — nunca un hallazgo ni
 * un número que nadie midió (docs/22 trampa 1, reglas 4 y 10).
 */
describe("CasoChat", () => {
  it("manda la pregunta al BFF y no fabrica ninguna respuesta de análisis", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <CasoChat
        corridaId="00000000-0000-4000-8000-000000000001"
        clusterId="00000000-0000-4000-8000-000000000010"
        rfcs={["DEMO:ENTIDAD-0"]}
        periodo={periodo}
        tituloInicial="Caso DEMO:ENTIDAD-0"
        investigaciones={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText(/Pregunta lo que sea/), "¿por qué subió el monto?");
    await user.click(screen.getByRole("button", { name: "Enviar seguimiento" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/investigaciones", expect.objectContaining({ method: "POST" }));
    const enviado = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(enviado.contexto.periodo).toEqual(periodo);
    expect(enviado.mensaje).toBe("¿por qué subió el monto?");

    expect(await screen.findByText(/aceptado y en cola/)).toBeInTheDocument();
    expect(screen.queryByText(/concentr|signals|three weeks/i)).not.toBeInTheDocument();
  });
});
