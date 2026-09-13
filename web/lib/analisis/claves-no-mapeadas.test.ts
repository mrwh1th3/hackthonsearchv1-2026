import { describe, expect, it } from "vitest";
import { clavesNoMapeadas, textoValorGenerico } from "./claves-no-mapeadas";

describe("clavesNoMapeadas", () => {
  it("devuelve solo las claves fuera del catálogo conocido", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(clavesNoMapeadas(obj, ["a", "b"])).toEqual([["c", 3]]);
  });

  it("no revienta con null, arrays o primitivos", () => {
    expect(clavesNoMapeadas(null, ["a"])).toEqual([]);
    expect(clavesNoMapeadas([1, 2], ["a"])).toEqual([]);
    expect(clavesNoMapeadas("texto", ["a"])).toEqual([]);
  });

  it("vacío cuando todas las claves están mapeadas", () => {
    expect(clavesNoMapeadas({ a: 1 }, ["a", "b"])).toEqual([]);
  });
});

describe("textoValorGenerico", () => {
  it("pinta primitivos tal cual", () => {
    expect(textoValorGenerico("hola")).toBe("hola");
    expect(textoValorGenerico(42)).toBe("42");
    expect(textoValorGenerico(true)).toBe("true");
  });

  it("null/undefined es un guion, no la palabra null", () => {
    expect(textoValorGenerico(null)).toBe("—");
    expect(textoValorGenerico(undefined)).toBe("—");
  });

  it("serializa objetos y recorta los muy largos", () => {
    expect(textoValorGenerico({ x: 1 })).toBe('{"x":1}');
    const largo = { s: "a".repeat(600) };
    const texto = textoValorGenerico(largo);
    expect(texto.length).toBeLessThanOrEqual(500);
    expect(texto.endsWith("...")).toBe(true);
  });
});
