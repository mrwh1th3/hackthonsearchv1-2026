import fs from "node:fs";
import path from "node:path";
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

  it("bloque de código ``` conserva saltos de línea e indentación (nunca los une en un párrafo)", () => {
    const md = "```bash\ncd web\nnpm test\n```";
    const bloques = parsearMarkdownLite(md);
    expect(bloques).toEqual([{ tipo: "codigo", lenguaje: "bash", texto: "cd web\nnpm test" }]);
  });

  it("una línea de comentario de shell ('# ...') dentro de un bloque de código NO se confunde con un encabezado", () => {
    // Antes del hallazgo 6: la rama de párrafo cortaba en cualquier línea
    // que empezara con '# ', partiendo el bloque de RUNBOOK.md a la mitad.
    const md = "```bash\n# esto es un comentario, no un encabezado\necho hola\n```";
    const bloques = parsearMarkdownLite(md);
    expect(bloques).toEqual([{ tipo: "codigo", lenguaje: "bash", texto: "# esto es un comentario, no un encabezado\necho hola" }]);
  });

  it("un bloque de código sin lenguaje declarado usa lenguaje vacío, no lanza", () => {
    const bloques = parsearMarkdownLite("```\nplano\n```");
    expect(bloques).toEqual([{ tipo: "codigo", lenguaje: "", texto: "plano" }]);
  });

  it("texto antes y después de un bloque de código se parsean como párrafos separados", () => {
    const md = "Antes\n\n```\ncodigo\n```\n\nDespués";
    const bloques = parsearMarkdownLite(md);
    expect(bloques).toEqual([
      { tipo: "parrafo", texto: "Antes" },
      { tipo: "codigo", lenguaje: "", texto: "codigo" },
      { tipo: "parrafo", texto: "Después" },
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

describe("RUNBOOK.md real (Corte 3 hallazgo 6: /metodo lo renderiza, tiene ~40 bloques ``` )", () => {
  const ruta = path.resolve(__dirname, "../../../RUNBOOK.md");

  it("se parsea sin lanzar y cada bloque ``` sale como 'codigo', nunca aplastado en un párrafo", () => {
    if (!fs.existsSync(ruta)) return; // entorno sin el repo completo (p.ej. build de un solo paquete)
    const contenido = fs.readFileSync(ruta, "utf8");
    // Algunas cercas vienen indentadas (listas anidadas): se cuentan igual
    // que el parser, que las detecta por `linea.trim()`, no por columna 0.
    const nFencesEnElArchivo = (contenido.match(/^\s*```/gm) ?? []).length / 2;
    const bloques = parsearMarkdownLite(contenido);
    const bloquesCodigo = bloques.filter((b) => b.tipo === "codigo");
    expect(bloquesCodigo.length).toBe(nFencesEnElArchivo);
    // Ningún bloque de código quedó vacío por un cierre mal detectado, y
    // ninguno contiene un '```' sin cerrar filtrándose como texto literal.
    for (const b of bloquesCodigo) {
      expect(b.texto).not.toContain("```");
    }
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
