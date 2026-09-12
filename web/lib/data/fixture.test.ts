import { describe, expect, it } from "vitest";
import { FixtureDataSource } from "./fixture";

describe("FixtureDataSource (contracts/fixtures/valid, v1.0.0)", () => {
  const ds = new FixtureDataSource();

  it("se declara a sí misma como 'fixture', nunca como fuente definitiva", () => {
    expect(ds.label).toBe("fixture");
  });

  it("expone los tres casos de contrato con los tres niveles requeridos por el corte", async () => {
    const casos = await ds.listCasos();
    expect(casos).toHaveLength(3);
    const niveles = casos.map((c) => c.nivel).sort();
    expect(niveles).toEqual(["anomalia_explicada", "no_concluyente", "presuncion"]);
  });

  it("nunca usa 'definitivo' como nivel (CLAUDE.md regla 7)", async () => {
    const casos = await ds.listCasos();
    for (const caso of casos) {
      expect(caso.nivel).not.toBe("definitivo");
    }
  });

  it("filtra por corridaId", async () => {
    const corridas = await ds.listCorridas();
    expect(corridas.length).toBeGreaterThan(0);
    const casos = await ds.listCasos({ corridaId: corridas[0].id });
    expect(casos.every((c) => c.corrida_id === corridas[0].id)).toBe(true);
  });

  it("getCasoDetalle del caso de presunción trae pistas, evidencia, defensa y dictamen fixture", async () => {
    const casos = await ds.listCasos();
    const presuncion = casos.find((c) => c.nivel === "presuncion");
    expect(presuncion).toBeTruthy();
    const detalle = await ds.getCasoDetalle(presuncion!.id);
    expect(detalle?.dictamen?.nivel).toBe("presuncion");
    expect(detalle?.pistas.length).toBeGreaterThan(0);
    expect(detalle?.evidencia.length).toBeGreaterThan(0);
  });

  it("getCaso con id inexistente devuelve null (estado 'sin coincidencias', no lanza)", async () => {
    const caso = await ds.getCaso("00000000-0000-4000-8000-999999999999");
    expect(caso).toBeNull();
  });
});
