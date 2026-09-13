import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvestigationComposer } from "./investigation-composer";
import type { Corrida } from "@/lib/data";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const corrida: Corrida = {
  id: "00000000-0000-4000-8000-000000000001", nombre: "Demo enero 2026", dataset: "fixture-contract-v1", dataset_hash: "a".repeat(64),
  fecha_corte: "2026-01-31T12:00:00Z", corrida_origen_id: null, estado: "completada", version_prompts: "a".repeat(64), version_reglas: "a".repeat(64),
  modo: "fixture", familias_evaluables: ["D", "F", "R", "T", "E"], inicio: "2026-01-01T00:00:00Z", fin: "2026-01-31T23:59:59Z",
};
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("InvestigationComposer — un solo flujo", () => {
  it("muestra contexto opcional y una sola acción para la investigación completa", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<InvestigationComposer corrida={corrida} />);
    expect(screen.getByRole("button", { name: "Investigate" })).toBeEnabled();
    expect(screen.queryByLabelText("Industry")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inspeccionar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /laboratorio|A\/B/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Context Filters" }));
    await userEvent.type(screen.getByLabelText("Context for the investigators"), "Construcción");
    expect(screen.getByRole("button", { name: "Investigate" })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("envía contexto y filtros una vez y continúa dentro del mismo main", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202, json: async () => ({ launch: { run_id: "run-7" } }) }); vi.stubGlobal("fetch", fetchMock);
    render(<InvestigationComposer corrida={corrida} />);
    await userEvent.click(screen.getByRole("button", { name: "Context Filters" }));
    await userEvent.type(screen.getByLabelText("Context for the investigators"), "  Construcción  ");
    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/laboratorio", expect.objectContaining({ method: "POST", body: JSON.stringify({ corrida_id: corrida.id, mensaje: "Construcción", filtros: { desde: "2026-01-01", hasta: "2026-01-31" }, provider: "codex" }) }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/?corrida=${corrida.id}&run=run-7`));
  });
  it("un fallo no navega ni afirma que la investigación comenzó", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 503, json: async () => ({ error: "runtime_no_disponible" }) }));
    render(<InvestigationComposer corrida={corrida} />);
    await userEvent.click(screen.getByRole("button", { name: "Context Filters" }));
    await userEvent.type(screen.getByLabelText("Context for the investigators"), "Farmacéutica");
    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("runtime_no_disponible");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Investigate" })).toBeEnabled();
  });
  it("cambiar dataset no inicia procesos y conserva el alcance real", async () => {
    const onChangeDataset = vi.fn();
    render(<InvestigationComposer corrida={corrida} onChangeDataset={onChangeDataset} />);
    await userEvent.click(screen.getByRole("button", { name: "Context Filters" }));
    expect(screen.getByRole("button", { name: /Available checks/ })).toHaveTextContent("14/14");
    await userEvent.click(screen.getByRole("button", { name: "Change dataset" }));
    expect(onChangeDataset).toHaveBeenCalledTimes(1);
  });

  it("submits the custom calendar end date inclusively without shifting a day", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ status: 202, json: async () => ({ launch: { run_id: "run-calendar" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<InvestigationComposer corrida={corrida} />);
    await user.click(screen.getByRole("button", { name: "Context Filters" }));
    await user.click(screen.getByRole("button", { name: "Open calendar for To" }));
    await user.click(screen.getByRole("button", { name: "January 15, 2026" }));
    expect(screen.getByRole("textbox", { name: "To" })).toHaveValue("2026-01-15");
    await user.click(screen.getByRole("button", { name: "Investigate" }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/laboratorio", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ corrida_id: corrida.id, mensaje: "", filtros: { desde: "2026-01-01", hasta: "2026-01-15" }, provider: "codex" }),
    }));
  });

  it("blocks an invalid or out-of-dataset manual date and restores the full period", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<InvestigationComposer corrida={corrida} />);
    await user.click(screen.getByRole("button", { name: "Context Filters" }));
    const from = screen.getByRole("textbox", { name: "From" });
    for (const date of ["2026-01-32", "2025-12-31"]) {
      await user.clear(from);
      await user.type(from, date);
      expect(from).toHaveValue(date);
      expect(from).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("button", { name: "Investigate" })).toBeDisabled();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Full date range" }));
    expect(from).toHaveValue("2026-01-01");
    expect(from).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "To" })).toHaveValue("2026-01-31");
    expect(screen.getByRole("button", { name: "Investigate" })).toBeEnabled();
  });
});
