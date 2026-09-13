import { describe, expect, it } from "vitest";
import { costoMostrado, estimarCostoUsd, formatoCostoEstimado } from "./costo";

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
    expect(formatoCostoEstimado(null)).toBe("cost unavailable");
  });
  it("un valor real se etiqueta 'estimado'", () => {
    expect(formatoCostoEstimado(0.5)).toBe("~$0.500 (estimado)");
  });
});

describe("costoMostrado", () => {
  it("prefiere el costo real (migración 028) y no lo etiqueta 'estimado'", () => {
    const r = costoMostrado("modelo-fantasma", null, null, 1.2345);
    expect(r.esReal).toBe(true);
    expect(r.valor).toBe(1.2345);
    expect(r.texto).toBe("$1.2345");
    expect(r.texto).not.toMatch(/estimado/);
  });

  it("sin costo real cae al estimado por tokens, y sí lo etiqueta", () => {
    const r = costoMostrado("claude-sonnet-4", 1_000_000, 1_000_000, null);
    expect(r.esReal).toBe(false);
    expect(r.valor).toBeCloseTo(18, 5);
    expect(r.texto).toMatch(/estimado/);
  });

  it("sin costo real y sin modelo conocido: no disp., nunca $0.00", () => {
    const r = costoMostrado(null, null, null, null);
    expect(r.esReal).toBe(false);
    expect(r.valor).toBeNull();
    expect(r.texto).toBe("cost unavailable");
  });
});
