import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PistasScope } from "./pistas-scope";

/**
 * docs/22-frontend-inspector.md "El picker 'Columns' — se lee, no se
 * inventa": de lectura estricta. La prueba que más importa aquí no es que
 * pinte las 14 pistas, es que NO exista ningún control que aparente
 * escribir algo que no escribe.
 */
describe("PistasScope (equivalente de lectura del picker 'Columns')", () => {
  it("muestra las 14 pistas del catálogo y el conteo derivado de familias_evaluables", async () => {
    const user = userEvent.setup();
    render(<PistasScope familiasEvaluables={["D", "R"]} />);

    // D (4) + R (3) = 7 de 14 en alcance.
    expect(screen.getByText("7/14")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Available checks/ }));
    expect(screen.getByText("7 of 14 available for this dataset. This list does not change the investigation scope.")).toBeInTheDocument();

    // Las 14 pistas del catálogo, no una muestra.
    expect(screen.getByText("Shared attributes")).toBeInTheDocument(); // R1, en alcance
    expect(screen.getByText("Tax-authority watchlists")).toBeInTheDocument(); // E1, fuera de alcance
    expect(screen.getAllByText(/^[DFRTE][1-4]$/).length).toBe(14);
  });

  it("no pone ninguna casilla que aparente escribir algo (es de lectura, docs/22)", async () => {
    const user = userEvent.setup();
    render(<PistasScope familiasEvaluables={["D", "F", "R", "T", "E"]} />);
    await user.click(screen.getByRole("button", { name: /Available checks/ }));
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /^[DFRTE][1-4]/ })).toHaveLength(0);
    expect(screen.getByText("14/14")).toBeInTheDocument();
  });

  it("una pista de una familia fuera de alcance explica el motivo derivado, no un texto inventado", async () => {
    const user = userEvent.setup();
    render(<PistasScope familiasEvaluables={["D", "F", "R", "T"]} />);
    await user.click(screen.getByRole("button", { name: /Available checks/ }));
    const e1 = screen.getByText("Tax-authority watchlists");
    expect(e1).toHaveAttribute("title", "Category E outside this dataset's available checks");
  });
});
