import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultadosCaso } from "./resultados";
import { FixtureDataSource } from "@/lib/data/fixture";

vi.mock("@/components/shared/force-graph", () => ({ ClusterForceGraph: () => <div aria-label="Grafo de relaciones" /> }));

/**
 * Pantalla de resultados del diseño con datos reales del fixture. Prueba lo
 * que docs/22 trampa 1 exige: ningún número del bloque de lógica del diseño
 * (`48,210 rows`, `4m 58s`, `CSAT 4.1`) aparece, y cada finding lleva su
 * estado de descarte — sostenida o descartada— nunca una fila muda.
 */
describe("ResultadosCaso", () => {
  it("pinta stats derivados del caso y findings con estado de descarte, sin los valores inventados del diseño", async () => {
    const ds = new FixtureDataSource();
    const casos = await ds.listCasos();
    const detalle = await ds.getCasoDetalle(casos[0].id);
    const bitacora = await ds.getBitacoraCaso(casos[0].id);
    const cluster = await ds.getCluster(casos[0].cluster_id);

    render(
      <ResultadosCaso
        detalle={detalle!}
        bitacora={bitacora}
        contraste={await ds.getContraste(casos[0].id)}
        trayectoria={[]}
        razonSocialUntrusted={null}
        cluster={cluster}
        grafo={await ds.getClusterGrafo(casos[0].cluster_id)}
        senales={await ds.listSenalesCluster(casos[0].cluster_id)}
      />,
    );

    expect(screen.getByText("Pistas confirmadas")).toBeInTheDocument();
    expect(screen.getByText("Pruebas confiables")).toBeInTheDocument();
    expect(screen.queryByText("48,210")).not.toBeInTheDocument();
    expect(screen.queryByText(/4m 58s/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/sostenida|descartada/).length).toBeGreaterThan(0);
    expect(screen.getByText("Reporte completo")).toBeInTheDocument();
    // El cluster (rotulado "Investigación" en la UI) se ve dentro del caso,
    // con sus métricas reales.
    expect(screen.getByText("Investigation")).toBeInTheDocument();
    expect(screen.getByText(`${cluster!.n_rfc} contribuyentes relacionados`)).toBeInTheDocument();
    // Sin resultado del auditor no se ofrece una submission que no existe.
    expect(screen.queryByText("submission.json")).not.toBeInTheDocument();
  });

  it("junto a Reporte completo ofrece submission.json como descarga directa, con su ruta en disco", async () => {
    const ds = new FixtureDataSource();
    const casos = await ds.listCasos();
    const detalle = await ds.getCasoDetalle(casos[0].id);
    const ruta = "data/forensic/runs/68e5ecc1-e506-533f-936e-ec53d833076f/submission.json";

    render(
      <ResultadosCaso
        detalle={detalle!}
        bitacora={[]}
        contraste={null}
        trayectoria={[]}
        onAbrirReporte={() => {}}
        descargaSubmission={{ href: "/auditoria/68e5ecc1-e506-533f-936e-ec53d833076f/submission", ruta }}
        soloResumen
      />,
    );

    expect(screen.getByText("Reporte completo")).toBeInTheDocument();
    const enlace = screen.getByRole("link", { name: /submission\.json/ });
    expect(enlace).toHaveAttribute("href", "/auditoria/68e5ecc1-e506-533f-936e-ec53d833076f/submission");
    expect(enlace).toHaveAttribute("download");
    expect(screen.getByText(ruta)).toBeInTheDocument();
  });
});
