import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardTimeline } from "./board-timeline";
import type { EventoForense } from "@/lib/data";

function evento(overrides: Partial<EventoForense>): EventoForense {
  return {
    schema_version: "bitacora.v1",
    id: "1",
    corrida_id: "00000000-0000-4000-8000-000000000001",
    caso_id: null,
    tarea_id: null,
    seq: 1,
    ts: "2026-01-31T12:00:00Z",
    tipo_evento: "caso_creado",
    payload: { resumen: "resumen", referencias: [], operacion_id: null },
    ...overrides,
  };
}

/**
 * docs/22, "Lo que el diseño NO tiene y aquí es obligatorio" + CLAUDE.md
 * regla 2: sin eventos persistidos, el Timeline dice explícitamente que no
 * hay bitácora todavía — nunca una lista vacía muda ni una fabricada.
 */
describe("BoardTimeline", () => {
  it("sin eventos, estado vacío honesto", () => {
    render(<BoardTimeline eventos={[]} />);
    expect(screen.getByText("No activity recorded for this dataset yet.")).toBeInTheDocument();
  });

  it("ordena por seq descendente (más reciente primero) y respeta el límite", () => {
    const eventos = [
      evento({ id: "a", seq: 1, tipo_evento: "caso_creado" }),
      evento({ id: "b", seq: 3, tipo_evento: "dictamen" }),
      evento({ id: "c", seq: 2, tipo_evento: "ronda_inicio" }),
    ];
    render(<BoardTimeline eventos={eventos} limite={2} />);
    const filas = screen.getAllByText(/caso_creado|dictamen|ronda_inicio/);
    expect(filas.map((n) => n.textContent)).toEqual(["dictamen", "ronda_inicio"]);
  });

  it("busca fuera del tramo visible y abre las referencias exactas del evento", async () => {
    const eventos = [evento({ id: "primero", seq: 1, payload: { resumen: "Pago contrastado", referencias: ["MOV:original-123"], operacion_id: "operacion-real" } }), evento({ id: "ultimo", seq: 2 })];
    render(<BoardTimeline eventos={eventos} limite={1} />);
    expect(screen.queryByText("Pago contrastado")).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Search activity" }), "MOV:original-123");
    await userEvent.click(screen.getByRole("button", { name: /Pago contrastado/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("MOV:original-123")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByText("Identificadores y origen"));
    expect(within(dialog).getByText("operacion-real")).toBeInTheDocument();
    expect(within(dialog).getByText("primero")).toBeInTheDocument();
  });
});
