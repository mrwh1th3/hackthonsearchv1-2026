import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FixtureDataSource } from "@/lib/data/fixture";
import { ResumenInvestigacion, type CasoConContexto } from "./investigacion-resumen";

vi.mock("./force-graph", () => ({ ClusterForceGraph: () => <div aria-label="Grafo de relaciones" /> }));

async function datos(): Promise<CasoConContexto[]> {
  const ds = new FixtureDataSource();
  const casos = await ds.listCasos();
  return Promise.all(casos.map(async (caso) => ({
    detalle: (await ds.getCasoDetalle(caso.id))!, cluster: await ds.getCluster(caso.cluster_id), grafo: null,
    bitacora: await ds.getBitacoraCaso(caso.id), contraste: null, trayectoria: [],
    ejecuciones: { ejecuciones: [], tokensTotales: null, costoTotal: null }, auditorResultado: null,
  })));
}

describe("ResumenInvestigacion — lectura y trazabilidad", () => {
  it("el filtro por entidad relacionada encuentra el caso y permite volver al universo completo", async () => {
    const casos = await datos();
    render(<ResumenInvestigacion corrida={null} casos={casos} tokensCorrida={null} />);
    const input = screen.getByRole("textbox", { name: "Search by tax ID or case ID" });
    await userEvent.type(input, "no-existe-en-el-dataset");
    expect(screen.getByText(/No cases match/)).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, casos[0].detalle.caso.rfc_principal);
    expect(screen.getByRole("button", { name: new RegExp(casos[0].detalle.caso.rfc_principal) })).toBeInTheDocument();
    await userEvent.clear(input);
    expect(screen.getByText(new RegExp(`${casos.length} of ${casos.length} cases`))).toBeInTheDocument();
  });
  it("declara ausencia de casos y tokens sin convertirla en una conclusión limpia", () => {
    render(<ResumenInvestigacion corrida={null} casos={[]} tokensCorrida={null} />);
    expect(screen.getByText(/No cases are available yet/)).toBeInTheDocument();
    expect(screen.getByText("No token usage recorded")).toBeInTheDocument();
    expect(screen.queryByText("0 docs")).not.toBeInTheDocument();
  });
  it("no compara importes de monedas distintas en una misma gráfica", async () => {
    const casos = await datos();
    casos[0].detalle = { ...casos[0].detalle, caso: { ...casos[0].detalle.caso, moneda: "USD" } };
    render(<ResumenInvestigacion corrida={null} casos={casos} tokensCorrida={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Metrics" }));
    expect(screen.getByText(/cases use different currencies/)).toBeInTheDocument();
  });
});
