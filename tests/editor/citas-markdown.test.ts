// @vitest-environment node
import { describe, expect, it } from "vitest";

import redactorFixture from "@contracts/fixtures/valid/redactor.json";
import documentoFixture from "@contracts/fixtures/valid/documento.json";
import { validateContract } from "@/lib/contracts/validate";
import { citasDeDocumento, citasDeMarkdown, estadoCitas, extraerCitas, segmentarCitas } from "@/lib/document/citas";
import { aMarkdown, desdeMarkdown } from "@/lib/document/markdown";
import type { Documento } from "@/lib/document/tipos";

const CITA_CFDI = "CFDI:00000000-0000-4000-8000-000000000901";

describe("citas (common.referencia: 7 prefijos, IDs no necesariamente uuid)", () => {
  it("extrae los siete prefijos, incluidos IDs que no son uuid", () => {
    const texto =
      "Ver [CFDI:aaaaaaaa-0000-4000-8000-000000000001], [MOV:8821], [ATR:AAA010101AAA/representante], " +
      "[LISTA:AAA010101AAA], [CICLO:c-7], [CADENA:paso-3] y [PAR:AAA010101AAA|BBB020202BBB].";
    expect(extraerCitas(texto)).toEqual([
      "CFDI:aaaaaaaa-0000-4000-8000-000000000001",
      "MOV:8821",
      "ATR:AAA010101AAA/representante",
      "LISTA:AAA010101AAA",
      "CICLO:c-7",
      "CADENA:paso-3",
      "PAR:AAA010101AAA|BBB020202BBB",
    ]);
  });

  it("marca en rojo la cita sin evidencia validada (09 §8), incluida una no-uuid", () => {
    const validadas = new Set([CITA_CFDI]);
    const segmentos = segmentarCitas(`Sustento [${CITA_CFDI}] y [CADENA:paso-3].`, validadas);
    const citas = segmentos.filter((s) => s.tipo === "cita");
    expect(citas).toEqual([
      { tipo: "cita", referencia: CITA_CFDI, valida: true },
      { tipo: "cita", referencia: "CADENA:paso-3", valida: false },
    ]);
  });

  it("estadoCitas bloquea publicación (revisarCitas) sin invalidar el borrador", () => {
    const documento = desdeMarkdown(`## 1. Resumen\n\nHecho [${CITA_CFDI}] y [MOV:999].`);
    const estado = estadoCitas(documento, new Set([CITA_CFDI]));
    expect(estado.total).toBe(2);
    expect(estado.invalidas).toEqual(["MOV:999"]);
    expect(estado.revisarCitas).toBe(true);
  });
});

describe("markdown derivado (15 §10: JSON canónico es la fuente)", () => {
  it("importa el markdown legado del Redactor a un documento que valida contra el contrato", () => {
    const documento = desdeMarkdown(redactorFixture.markdown);
    const validacion = validateContract("editor.documento", documento);
    expect(validacion.errors).toEqual([]);
    expect(validacion.ok).toBe(true);
    expect(documento.content.filter((b) => b.type === "heading")).toHaveLength(8);
  });

  it("la importación es determinista: mismos ids, mismo JSON", () => {
    expect(desdeMarkdown(redactorFixture.markdown)).toEqual(desdeMarkdown(redactorFixture.markdown));
  });

  it("exportar a Markdown conserva EXACTAMENTE el mismo conjunto de citas que el JSON", () => {
    const documento = documentoFixture as Documento;
    const markdown = aMarkdown(documento);
    expect(new Set(citasDeMarkdown(markdown))).toEqual(new Set(citasDeDocumento(documento)));
  });

  it("conserva citas al ida y vuelta markdown → documento → markdown", () => {
    const original = `## 9. Trayectoria\n\nAlta en 2025-03 [MOV:8821]; pico en 2025-07 [CFDI:aaaaaaaa-0000-4000-8000-000000000001].\n\n## 10. Cadena de explicación\n\n1. Disparó F2 [CADENA:paso-1].\n2. Seis movimientos [MOV:8834].`;
    const documento = desdeMarkdown(original);
    const derivado = aMarkdown(documento);
    expect(new Set(citasDeMarkdown(derivado))).toEqual(new Set(citasDeMarkdown(original)));
    expect(derivado).toContain("## 9. Trayectoria");
    expect(derivado).toContain("1. Disparó F2 [CADENA:paso-1].");
  });

  it("soporta listas, cita en bloque, regla y tablas con encabezado", () => {
    const md = [
      "## 5. Evidencia",
      "",
      "- Punto uno [MOV:1]",
      "- Punto dos",
      "",
      "> Nota del auditor",
      "",
      "---",
      "",
      "| RFC | Monto |",
      "| --- | --- |",
      "| AAA010101AAA | 1,200 |",
    ].join("\n");
    const documento = desdeMarkdown(md);
    expect(validateContract("editor.documento", documento).ok).toBe(true);
    const tipos = documento.content.map((b) => b.type);
    expect(tipos).toEqual(["heading", "bulletList", "blockquote", "horizontalRule", "table"]);
    const derivado = aMarkdown(documento);
    expect(derivado).toContain("- Punto uno [MOV:1]");
    expect(derivado).toContain("> Nota del auditor");
    expect(derivado).toContain("| RFC | Monto |");
  });

  it("marcas inline sobreviven la derivación (negrita, cursiva, código, enlace)", () => {
    const documento = desdeMarkdown("Texto **fuerte**, *suave*, `codigo` y [enlace](https://sat.gob.mx).");
    expect(validateContract("editor.documento", documento).ok).toBe(true);
    expect(aMarkdown(documento)).toBe("Texto **fuerte**, *suave*, `codigo` y [enlace](https://sat.gob.mx).");
  });
});
