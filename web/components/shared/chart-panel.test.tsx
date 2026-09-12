import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartPanel } from "./chart-panel";

interface Fila extends Record<string, unknown> {
  rfc: string;
  monto: number;
}

const rows: Fila[] = [
  { rfc: "DEMO:ENTIDAD-0", monto: 12000 },
  { rfc: "DEMO:ENTIDAD-1", monto: 8500 },
];

describe("ChartPanel — vista tabla (15 §8)", () => {
  it("sin children, cae a vista tabla por defecto y renderiza filas y columnas", () => {
    render(
      <ChartPanel
        title="Monto en riesgo por RFC"
        unidad="MXN"
        columns={[
          { key: "rfc", header: "RFC" },
          { key: "monto", header: "Monto", align: "right" },
        ]}
        rows={rows}
        getRowKey={(r) => r.rfc}
      />,
    );

    expect(screen.getByText("Monto en riesgo por RFC")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("DEMO:ENTIDAD-0")).toBeInTheDocument();
    expect(screen.getByText("DEMO:ENTIDAD-1")).toBeInTheDocument();
    expect(screen.getByText("12000")).toBeInTheDocument();
  });

  it("con children (gráfica) expone el botón 'Ver datos' que cambia a tabla", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <ChartPanel
        title="Serie temporal"
        columns={[{ key: "rfc", header: "RFC" }]}
        rows={rows}
        getRowKey={(r) => r.rfc}
      >
        <div data-testid="grafica-fake">gráfica</div>
      </ChartPanel>,
    );

    expect(screen.getByTestId("grafica-fake")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ver datos" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByTestId("grafica-fake")).not.toBeInTheDocument();
  });

  it("estado vacío muestra el mensaje, no una tabla en blanco silenciosa", () => {
    render(
      <ChartPanel
        title="Sin datos"
        columns={[{ key: "rfc", header: "RFC" }]}
        rows={[]}
        getRowKey={(r: Fila) => r.rfc}
        emptyMessage="Sin coincidencias para este filtro."
      />,
    );
    expect(screen.getByText("Sin coincidencias para este filtro.")).toBeInTheDocument();
  });
});
