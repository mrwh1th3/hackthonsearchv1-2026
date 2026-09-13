import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CorridaPicker } from "./corrida-picker";
import type { Corrida } from "@/lib/data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

function corrida(overrides: Partial<Corrida> = {}): Corrida {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    nombre: "Demo enero 2026",
    dataset: "fixture-contract-v1",
    dataset_hash: "a".repeat(64),
    fecha_corte: "2026-01-31T12:00:00Z",
    corrida_origen_id: null,
    estado: "completada",
    version_prompts: "a".repeat(64),
    version_reglas: "a".repeat(64),
    modo: "fixture",
    familias_evaluables: ["D", "F", "R", "T", "E"],
    inicio: "2026-01-01T00:00:00Z",
    fin: "2026-01-31T23:59:59Z",
    ...overrides,
  };
}

/**
 * docs/22-frontend-inspector.md, corte 1 punto 3: hero + picker de corridas
 * reales, búsqueda, orden, estado y badge de inyección — nunca el tamaño
 * fabricado (`d.size`) del diseño original, que no tiene fuente real.
 */
describe("CorridaPicker", () => {
  it("estado vacío honesto: sin corridas, no se pinta como 'sin hallazgos'", () => {
    render(<CorridaPicker corridas={[]} onSelect={vi.fn()} />);
    expect(screen.getByText("No datasets yet.")).toBeInTheDocument();
  });

  it("busca por nombre y avisa cuando ninguna corrida coincide", async () => {
    const user = userEvent.setup();
    render(<CorridaPicker corridas={[corrida()]} onSelect={vi.fn()} />);
    await user.type(screen.getByPlaceholderText("Search datasets"), "no existe");
    expect(screen.getByText(/No dataset matches/)).toBeInTheDocument();
  });

  it("selecciona una corrida al hacer click en la fila", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CorridaPicker corridas={[corrida()]} onSelect={onSelect} />);
    await user.click(screen.getByText("Demo enero 2026"));
    expect(onSelect).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });

  it("una corrida clonada por inyección en vivo muestra el badge real, nunca 'Dynamic' fabricado", () => {
    render(
      <CorridaPicker
        corridas={[corrida({ id: "hija", nombre: "Inyección juez", corrida_origen_id: "00000000-0000-4000-8000-000000000001" })]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Live injection")).toBeInTheDocument();
    expect(screen.queryByText("Dynamic")).not.toBeInTheDocument();
  });

  it("no muestra ningún tamaño de dataset (no hay fuente real para eso)", () => {
    render(<CorridaPicker corridas={[corrida()]} onSelect={vi.fn()} />);
    expect(screen.queryByText(/KB|MB|GB/)).not.toBeInTheDocument();
  });
});
