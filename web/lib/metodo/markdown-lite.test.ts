import { describe, expect, it } from "vitest";
import { parsearMarkdownLite, partirInline } from "./markdown-lite";

describe("parsearMarkdownLite", () => {
  it("detecta encabezados de nivel 1 y 2", () => {
    const bloques = parsearMarkdownLite("# Título\n\n## Subtítulo\n");
    expect(bloques).toEqual([
      { tipo: "encabezado", nivel: 1, texto: "Título" },
      { tipo: "encabezado", nivel: 2, texto: "Subtítulo" },
    ]);
  });

  it("parsea una tabla con separador de encabezado", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
    const bloques = parsearMarkdownLite(md);
    expect(bloques).toEqual([{ tipo: "tabla", encabezados: ["A", "B"], filas: [["1", "2"], ["3", "4"]] }]);
  });

  it("junta líneas consecutivas de un párrafo", () => {
    const bloques = parsearMarkdownLite("Línea uno\nLínea dos\n\nOtro párrafo");
    expect(bloques).toEqual([
      { tipo: "parrafo", texto: "Línea uno Línea dos" },
      { tipo: "parrafo", texto: "Otro párrafo" },
    ]);
  });

  it("documento real de DECISIONES.md (encabezado + párrafo + tabla) se parsea sin lanzar", () => {
    const md = "# DECISIONES\n\nRegistro cronológico.\n\n| Hora | Decisión |\n|---|---|\n| H0 | Algo |";
    const bloques = parsearMarkdownLite(md);
    expect(bloques[0]).toEqual({ tipo: "encabezado", nivel: 1, texto: "DECISIONES" });
    expect(bloques[1]).toEqual({ tipo: "parrafo", texto: "Registro cronológico." });
    expect(bloques[2].tipo).toBe("tabla");
  });
});

describe("partirInline", () => {
  it("detecta negrita y código inline", () => {
    const segmentos = partirInline("texto **fuerte** y `codigo` normal");
    expect(segmentos).toEqual([
      { texto: "texto " },
      { texto: "fuerte", negrita: true },
      { texto: " y " },
      { texto: "codigo", codigo: true },
      { texto: " normal" },
    ]);
  });
});
