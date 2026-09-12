import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EstadoInyeccionBadge } from "./badges";

/**
 * Corte 3 hallazgo 2: `/inyecciones/[id]` debe mostrar `inyeccion.estado`
 * explícito, y un estado terminal (éxito o fallo) nunca gira el spinner
 * (CLAUDE.md regla 12 — sin evento persistido no hay animación; un estado
 * ya terminado no es "todavía en curso").
 */
describe("EstadoInyeccionBadge", () => {
  it("un estado en curso (p.ej. 'investigando') muestra el spinner", () => {
    render(<EstadoInyeccionBadge estado="investigando" />);
    expect(screen.getByText("Investigando")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });

  it("'completada' (éxito terminal) nunca gira, aunque haya terminado hace un instante", () => {
    render(<EstadoInyeccionBadge estado="completada" />);
    expect(screen.getByText("Completada")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("'rechazada'/'error' (fallo terminal) tampoco giran: no fingen que todavía sigue en curso", () => {
    render(<EstadoInyeccionBadge estado="rechazada" />);
    expect(screen.getByText("Rechazada")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeNull();

    render(<EstadoInyeccionBadge estado="error" />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });
});
