import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegratedLabRun } from "./laboratorio";
import type { LabDetail } from "@/lib/laboratorio/types";

const id = "00000000-0000-4000-8000-000000000900";
function result(): LabDetail {
  return {
    launch: { run_id: id, corrida_id: id, corrida_nombre: "Datos de prueba", provider: "codex", giro: "Distribución", data_source: "supabase", status: "completed", phase: "agents", started_at: "2026-09-13T12:00:00Z" },
    summary: { schema_version: 1, run_id: id, status: "completed", provider: "codex", giro: "Distribución", started_at: "2026-09-13T12:00:00Z", counts: { a_reviews: 1, b_findings: 0, proposals: 0 }, stages: [{ id: "agent_a", label: "Challenge", status: "completed" }] },
    engine: { company_rfc: "DEMO010101AAA", period: ["2026-01-01", "2026-03-31"], detector_hits: 1, findings: [{ subject_name: "Proveedor de muestra", narrative: "Factura sin contrato en el snapshot.", peso_amount: 100, exhibits: [{ record_id: "INV-001", source_table: "invoices" }] }], leads: [] },
    brief: null, agent_a: { reviews: [] }, agent_b: { findings: [] }, compiler: null, proposals: [], notes: [], traces: [],
  };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("investigación integrada en el main", () => {
  it("muestra inicio, fin y duración aun cuando quedan observaciones de cobertura", async () => {
    const data = result();
    data.launch = { ...data.launch, status: "partial", completed_at: "2026-09-13T12:01:15Z", total_duration_ms: 75000 };
    data.summary = { ...data.summary!, status: "partial" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    render(<IntegratedLabRun runId={id}/>);
    await screen.findAllByText("Finished");
    expect(screen.queryByText("Cobertura parcial")).not.toBeInTheDocument();
    expect(screen.getAllByText("1 min 15 s").length).toBeGreaterThan(0);
    expect(document.querySelector('time[datetime="2026-09-13T12:00:00Z"]')).toHaveTextContent("06:00:00");
    expect(document.querySelector('time[datetime="2026-09-13T12:01:15Z"]')).toHaveTextContent("06:01:15");
  });
  it("reutiliza un solo recorrido sin formularios ni botones de una pantalla separada", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => result() }));
    render(<IntegratedLabRun runId={id}/>);
    await screen.findByRole("heading", { name: "Investigation" });
    expect(screen.queryByRole("button", { name: /Investigate with Codex/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Company industry")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(screen.getAllByText("Proveedor de muestra").length).toBeGreaterThan(0);
    expect(screen.getByText("Findings & evidence trails")).toBeInTheDocument();
    expect(screen.getByText("Original rule-engine result")).toBeInTheDocument();
  });

  it("no presenta consumo desconocido como cero medido después de un fallo", async () => {
    const data = result(); data.launch.status = "failed";
    data.summary = { ...data.summary!, status: "partial", usage_unknown: true, total_tokens_in: 0, total_tokens_out: 0 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    render(<IntegratedLabRun runId={id}/>);
    await screen.findByText("Interrupted");
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.getAllByText("Usage report incomplete")).toHaveLength(2);
  });

  it("retiene un aviso claro cuando una investigación no pertenece a la sesión", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    render(<IntegratedLabRun runId={id}/>);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not available to your account"));
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("muestra los tokens conocidos como un mínimo cuando el reporte total está incompleto", async () => {
    const data = result();
    data.summary = { ...data.summary!, usage_unknown: false, usage_incomplete: true, total_tokens_in: 123, total_tokens_out: 42 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    render(<IntegratedLabRun runId={id}/>);
    await screen.findByText("≥ 123");
    expect(screen.getByText("≥ 42")).toBeInTheDocument();
    expect(screen.getAllByText("Usage report incomplete")).toHaveLength(2);
  });

  it("distingue la muestra entregada de los contrastes aceptados", async () => {
    const data = result();
    data.summary = { ...data.summary!, counts: { a_reviews: 0 }, coverage: { a_groups_sampled: 3, a_groups_total: 5, residual_sampled: 3, residual_total: 10 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    render(<IntegratedLabRun runId={id}/>);
    await screen.findByText("Pattern groups reviewed by A");
    expect(screen.getByText("Entities sampled by B")).toBeInTheDocument();
    expect(screen.getByText("2 outside the sample")).toBeInTheDocument();
    expect(screen.getByText("7 outside the sample")).toBeInTheDocument();
    expect(screen.queryByText("Grupos revisados por A")).not.toBeInTheDocument();
  });

  it("muestra entidad, motivo de descarte y confianza sin abrir datos técnicos", async () => {
    const data = result();
    data.engine = { ...data.engine, findings: [{ subject_name: "Proveedor validado", scheme_type: "phantom_vendor", confidence: "probable", peso_amount: 125.25, narrative: "Factura sin soporte." }], leads: [{ entity: "RFC:LEGAL010101ABC", signal: "recent_registration", reason: "El contrato CONTRACT-01 y la entrega INV-02 justifican los pagos." }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    render(<IntegratedLabRun runId={id}/>);
    expect(await screen.findByText("El contrato CONTRACT-01 y la entrega INV-02 justifican los pagos.", { selector: "p" })).toBeVisible();
    expect(screen.getByText("RFC:LEGAL010101ABC", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("Phantom vendor · Probable")).toBeVisible();
  });

  it("ofrece los entregables de esta ejecución y distingue el submission del motor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.includes("/entrega?tipo=estado") ? { expediente: true, submission: true, motor: true } : result() })));
    render(<IntegratedLabRun runId={id}/>);
    const complete = await screen.findByRole("link", { name: "Full report" });
    expect(complete).toHaveAttribute("href", `/api/laboratorio/${id}/entrega?tipo=expediente`);
    expect(screen.getByRole("link", { name: "Judge submission" })).toHaveAttribute("href", `/api/laboratorio/${id}/entrega?tipo=submission`);
    expect(screen.queryByRole("button", { name: "Descargar investigación en JSON" })).not.toBeInTheDocument();
  });
  it("reruns a finished investigation with the same dataset and focus", async () => {
    const data = result();
    data.launch.mensaje = "Follow the money";
    data.launch.filtros = { desde: "2026-01-01", hasta: "2026-03-31" };
    const nextId = "00000000-0000-4000-8000-000000000901";
    const request = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === "POST" ? {launch: {...data.launch, run_id: nextId, status: "queued"}} : data }));
    vi.stubGlobal("fetch", request);
    render(<IntegratedLabRun runId={id}/>);
    fireEvent.click(await screen.findByRole("button", {name: "Run again"}));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/laboratorio", expect.objectContaining({method: "POST"})));
    const call = request.mock.calls.find((entry) => entry[1]?.method === "POST")!;
    expect(JSON.parse(call[1].body)).toEqual({corrida_id: id, mensaje: "Follow the money", filtros: data.launch.filtros, provider: "codex"});
    expect(data.launch.run_id).toBe(id);
  });
  it("filters findings by pattern and searches all pages of dismissed leads", async () => {
    const data = result();
    data.engine = {...data.engine, findings: [{subject_name: "Vendor One", scheme_type: "phantom_vendor"}, {subject_name: "Employee Two", scheme_type: "kickback"}], leads: Array.from({length: 23}, (_,i) => ({entity: `ENTITY-${i}`, reason: `Supported by contract ${i}`}))};
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: true, json: async () => data}));
    render(<IntegratedLabRun runId={id}/>);
    fireEvent.click(await screen.findByRole("button", {name: "Employee kickback 1"}));
    expect(screen.queryByText("Vendor One")).not.toBeInTheDocument();
    expect(screen.getByText("Employee Two")).toBeVisible();
    expect(screen.queryByText("ENTITY-22")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Next"}));
    expect(screen.getByText("ENTITY-10", {selector: "strong"})).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", {name: "Search findings and dismissed leads"}), {target: {value: "ENTITY-22"}});
    expect(screen.getByText("ENTITY-22", {selector: "strong"})).toBeVisible();
    expect(screen.queryByText("ENTITY-10")).not.toBeInTheDocument();
  });

});
