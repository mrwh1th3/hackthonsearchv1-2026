import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText("Sin eventos en la bitácora de esta corrida todavía.")).toBeInTheDocument();
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
});
