import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdministrarDatosModal, TipoDatasetModal } from "./datos-modales";
import type { Corrida } from "@/lib/data";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function corrida(over: Partial<Corrida> = {}): Corrida {
  return {
    ...({} as Corrida),
    id: "00000000-0000-4000-8000-000000000001",
    nombre: "Demo enero 2026",
    dataset: "sintetico_v1",
    estado: "completada",
    fecha_corte: "2026-01-31T00:00:00.000Z",
    inicio: "2026-01-01T00:00:00.000Z",
    fin: "2026-01-31T00:00:00.000Z",
    corrida_origen_id: null,
    familias_evaluables: [],
    ...over,
  } as Corrida;
}

/**
 * Los dos pop-ups del diseño con datos reales. Lo que se prueba es justo lo
 * que el original hacía mal: no hay "Connect database" con credenciales a
 * ninguna parte, no hay tamaños ni "Updated 2h ago" fabricados, y el badge de
 * dinámico es `corrida_origen_id != null`, no un booleano inventado.
 */
describe("Pop-ups de datos del diseño Inspector", () => {
  it("el pop-up de tipo de dataset ofrece estático e inyección en vivo, y ninguna cadena de conexión", () => {
    render(<TipoDatasetModal onClose={vi.fn()} />);
    expect(screen.getByText("Estático")).toBeInTheDocument();
    expect(screen.getByText("Inyección en vivo")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/postgres:\/\//)).not.toBeInTheDocument();
  });

  it("administrar datos lista corridas reales y pone las inyecciones primero", () => {
    render(
      <AdministrarDatosModal
        corridas={[corrida(), corrida({ id: "hija", nombre: "Inyección juez", corrida_origen_id: "00000000-0000-4000-8000-000000000001" })]}
        onClose={vi.fn()}
      />,
    );
    const nombres = screen.getAllByText(/Demo enero 2026|Inyección juez/).map((n) => n.textContent);
    expect(nombres[0]).toBe("Inyección juez");
    expect(screen.queryByText(/KB|MB|GB/)).not.toBeInTheDocument();
  });

  it("«Inspeccionar» abre el preview tipo hoja de cálculo con los datos del estate", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tablas: [{ nombre: "vendors", filas: 2 }, { nombre: "invoices", filas: 0 }],
        tabla: "vendors",
        columnas: ["rfc", "legal_name"],
        filas: [["AAA010101AA1", "Proveedor Uno SA de CV"], ["BBB020202BB2", null]],
        total: 2,
        offset: 0,
        limit: 100,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdministrarDatosModal corridas={[corrida()]} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Inspeccionar" }));
    expect(await screen.findByText("Proveedor Uno SA de CV")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toContain("corrida_id=00000000-0000-4000-8000-000000000001");
    expect(screen.getByRole("columnheader", { name: /A\s*rfc/ })).toBeInTheDocument();
    expect(screen.getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText("Filas 1–2 de 2")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
