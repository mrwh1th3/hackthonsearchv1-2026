import { describe, expect, it } from "vitest";
import { estimarCostoUsd, formatoCostoEstimado } from "./costo";

describe("estimarCostoUsd", () => {
  it("calcula el estimado con precio conocido y tokens reales", () => {
    const usd = estimarCostoUsd("claude-sonnet-4-20260101", 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(3 + 15, 5);
  });

  it("modelo desconocido: null, nunca un precio inventado", () => {
    expect(estimarCostoUsd("modelo-fantasma", 1000, 1000)).toBeNull();
  });

  it("sin model_id: null", () => {
    expect(estimarCostoUsd(null, 1000, 1000)).toBeNull();
  });

  it("tokens ausentes (null): null, no se estima sobre un supuesto", () => {
    expect(estimarCostoUsd("claude-sonnet-4", null, 100)).toBeNull();
  });
});

describe("formatoCostoEstimado", () => {
  it("null se pinta 'no disp.', nunca $0.00", () => {
    expect(formatoCostoEstimado(null)).toBe("costo no disp.");
  });
  it("un valor real se etiqueta 'estimado'", () => {
    expect(formatoCostoEstimado(0.5)).toBe("~$0.500 (estimado)");
  });
});
