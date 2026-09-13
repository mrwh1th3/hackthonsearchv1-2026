import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InspectorHome } from "./inspector-home";
import type { Corrida } from "@/lib/data";
import type { LabRun } from "@/lib/laboratorio/types";

const { push, params } = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams("corrida=corrida-1") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => params }));
vi.mock("@/components/editor/investigation-document", () => ({ InvestigationDocument: ({ runId, onBack }: { runId: string; onBack: () => void }) => <section aria-label="Investigación integrada"><p>{runId}</p><button onClick={onBack}>Volver a datos</button></section> }));
vi.mock("./corrida-picker", () => ({ CorridaPicker: () => <div>Selector original</div> }));
const corrida: Corrida = { id: "corrida-1", nombre: "Dataset original", dataset: "engine-v1", dataset_hash: "a".repeat(64), fecha_corte: "2026-01-31T12:00:00Z", corrida_origen_id: null, estado: "lista", version_prompts: "v1", version_reglas: "forensic-auditor-v1", modo: "fixture", familias_evaluables: ["D", "F"], inicio: "2026-01-01T00:00:00Z", fin: null };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); params.delete("run"); });

describe("InspectorHome — investigación integrada", () => {
  it("iniciar cambia al detalle integrado sin abandonar el main ni perder corrida", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 202, json: async () => ({ launch: { run_id: "run-123" } }) }));
    render(<InspectorHome corridas={[corrida]} corridaSeleccionada={corrida} />);

    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(await screen.findByRole("region", { name: "Investigación integrada" })).toHaveTextContent("run-123");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/?corrida=corrida-1&run=run-123"));
    expect(screen.queryByRole("link", { name: /laboratorio/i })).not.toBeInTheDocument();
  });
  it("un enlace directo restaura el detalle y volver mantiene el dataset", async () => {
    params.set("run", "run-historico");
    render(<InspectorHome corridas={[corrida]} corridaSeleccionada={corrida} />);
    expect(screen.getByRole("region", { name: "Investigación integrada" })).toHaveTextContent("run-historico");
    await userEvent.click(screen.getByRole("button", { name: "Volver a datos" }));
    expect(push).toHaveBeenCalledWith("/?corrida=corrida-1");
    expect(screen.getByText("Dataset original")).toBeInTheDocument();
  });
  it("shows the latest investigation's whole timing for the selected dataset and opens that run", async () => {
    const run: LabRun = { launch: { run_id: "latest-run", corrida_id: corrida.id, corrida_nombre: corrida.nombre, data_source: "fixture", giro: "Construction", provider: "mock", status: "completed", started_at: "2026-09-13T12:00:00Z", completed_at: "2026-09-13T12:05:14Z", total_duration_ms: 314000, timing_scope: "through_report" }, summary: null };
    const unrelated = { ...run, launch: { ...run.launch, corrida_id: "other", started_at: "2026-09-13T13:00:00Z", total_duration_ms: 99 } };
    render(<InspectorHome corridas={[corrida]} corridaSeleccionada={corrida} initialRuns={[unrelated, run]} />);
    expect(screen.getByText("5m 14s")).toBeInTheDocument();
    expect(screen.queryByText("0.099s")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open latest investigation" }));
    expect(push).toHaveBeenCalledWith("/?corrida=corrida-1&run=latest-run");
  });
});
