import { describe, expect, it } from "vitest";
import { FixtureDataSource } from "@/lib/data/fixture";
import type { CasoDetalle } from "@/lib/data/source";
import { confianzaAnalisis } from "./confianza";

async function demo(): Promise<CasoDetalle> {
  return (await new FixtureDataSource().getCasoDetalle("00000000-0000-4000-8000-000000000100"))!;
}

describe("confianzaAnalisis — índice transparente, no probabilidad de fraude", () => {
  it("promedia sólo factores con datos reales y los expone", async () => {
    const r = confianzaAnalisis(await demo());
    const nombres = r.factores.map((f) => f.nombre);
    expect(nombres).toEqual(["Pruebas verificadas", "Supported warning signs", "Specialist confidence", "Survived alternative explanations", "Period reviewed"]);
    const esperado = Math.round((r.factores.reduce((a, f) => a + f.valor, 0) / r.factores.length) * 100);
    expect(r.porcentaje).toBe(esperado);
  });

  it("baja cuando la defensa explica la señal y hay pruebas refutadas", async () => {
    const base = await demo();
    const debil: CasoDetalle = {
      ...base,
      defensa: base.defensa.map((d) => ({ ...d, resultado: "refuta" as const })),
      evidencia: base.evidencia.map((e) => ({ ...e, refutada: true })),
    };
    expect(confianzaAnalisis(debil).porcentaje!).toBeLessThan(confianzaAnalisis(base).porcentaje!);
  });

  it("sin pruebas, pistas, señales ni defensa no inventa un porcentaje", async () => {
    const base = await demo();
    const vacio: CasoDetalle = { ...base, evidencia: [], pistas: [], senales: [], defensa: [] };
    expect(confianzaAnalisis(vacio).porcentaje).toBeNull();
  });
});
