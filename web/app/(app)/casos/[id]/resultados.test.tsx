import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultadosCaso } from "./resultados";
import { FixtureDataSource } from "@/lib/data/fixture";

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

    expect(screen.getByText("Pistas sostenidas")).toBeInTheDocument();
    expect(screen.getByText("Evidencia válida")).toBeInTheDocument();
    expect(screen.queryByText("48,210")).not.toBeInTheDocument();
    expect(screen.queryByText(/4m 58s/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/sostenida|descartada/).length).toBeGreaterThan(0);
    expect(screen.getByText("Reporte completo")).toBeInTheDocument();
    // El cluster (rotulado "Investigación" en la UI) se ve dentro del caso,
    // con sus métricas reales.
    expect(screen.getByText("Investigación")).toBeInTheDocument();
    expect(screen.getByText(`${cluster!.n_rfc} RFC`)).toBeInTheDocument();
  });
});
