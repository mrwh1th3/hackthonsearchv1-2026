import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapaLogico } from "./mapa-logico";

describe("MapaLogico — fases del mismo proceso", () => {
  it("muestra cinco fases compactas y conserva los pasos operativos en el desglose", async () => {
    render(<MapaLogico mode="en_curso" senales={[]} fases={[
      { id: "engine", label: "Rule engine", status: "completed", detail: "Base persistida con 12 registros." },
      { id: "load", label: "Leer motor y memoria", status: "completed" },
      { id: "context", label: "Industry context", status: "completed" },
      { id: "sample", label: "Delimitar muestras", status: "completed" },
      { id: "agent_a", label: "A · Challenge", status: "pending" },
      { id: "agent_b", label: "B · Discovery", status: "pending" },
      { id: "handoff", label: "Conectar evidencia incidental", status: "pending" },
      { id: "compiler", label: "Formalizar propuestas", status: "pending" },
      { id: "persist", label: "Guardar para revisión", status: "pending" },
    ]} />);
    const principales = screen.getByRole("list", { name: "Main stages" });
    expect(within(principales).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Explore steps" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Leer motor y memoria")).not.toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Rule checks: Completed/ }));
    expect(screen.getByText("Base persistida con 12 registros.")).toBeInTheDocument();
    expect(screen.getByText("Leer motor y memoria")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide steps" }));
    expect(screen.queryByText("Leer motor y memoria")).not.toBeInTheDocument();
  });

  it("desglosa A y B como dos ramas y mantiene el intercambio incidental", async () => {
    render(<MapaLogico mode="en_curso" senales={[]} fases={[
      { id: "agent_a", label: "A · Challenge", status: "running", detail: "Consulta sus referencias." },
      { id: "agent_b", label: "B · Discovery", status: "pending" },
      { id: "handoff", label: "Conectar evidencia incidental", status: "pending" },
    ]} />);
    await userEvent.click(screen.getByRole("button", { name: /^AI review/ }));
    expect(screen.getByRole("button", { name: /A · Challenge: Running/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /B · Discovery: Pending/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conectar evidencia incidental/ })).toBeInTheDocument();
  });

  it("guardar propuestas no afirma que la revisión humana está completa", async () => {
    render(<MapaLogico mode="historico" senales={[]} fases={[{ id: "persist", label: "Guardar para revisión", status: "completed" }]} />);
    const revision = screen.getByRole("button", { name: /^Human review: Awaiting review/ });
    await userEvent.click(revision);
    expect(screen.getByText("Results saved. Human approval has not been recorded.")).toBeInTheDocument();
  });

  it("sin fases persistidas conserva un vacío honesto y el modo legacy sigue disponible", () => {
    const { rerender } = render(<MapaLogico mode="en_curso" senales={[]} fases={[]} />);
    expect(screen.getByText("Waiting for the first recorded step.")).toBeInTheDocument();
    rerender(<MapaLogico mode="en_curso" senales={[]} />);
    expect(screen.getByText("No steps have been recorded yet.")).toBeInTheDocument();
  });
});
