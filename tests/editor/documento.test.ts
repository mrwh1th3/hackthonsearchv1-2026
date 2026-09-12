// @vitest-environment node
import { describe, expect, it } from "vitest";

import documentoFixture from "@contracts/fixtures/valid/documento.json";
import reporteFixture from "@contracts/fixtures/valid/reporte.json";
import { validateContract } from "@/lib/contracts/validate";
import { canonico, hashBloque, hashDocumento, indexarBloques, normalizarDocumento } from "@/lib/document/documento";
import { sha256Hex } from "@/lib/document/sha256";
import { construirIndice } from "@/lib/document/secciones";
import type { Documento } from "@/lib/document/tipos";

/**
 * El JSON que emite TipTap NO es `editor.documento`: el contrato exige
 * `attrs.id` en cada bloque, cierra el conjunto de nodos y prohíbe atributos
 * extra. Esta prueba fija la frontera: todo lo que sale de `normalizarDocumento`
 * valida contra el schema real de `contracts/`.
 */
describe("documento canónico contra contracts v1.2.0", () => {
  it("sha256 reproduce el vector conocido de la cadena vacía", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("el fixture `documento.json` ya es canónico: normalizar no lo cambia", () => {
    const normalizado = normalizarDocumento(documentoFixture);
    expect(normalizado).toEqual(documentoFixture);
    expect(validateContract("editor.documento", normalizado).ok).toBe(true);
  });

  it("normaliza JSON sucio de TipTap (hardBreak, codeBlock, colspan, textos vacíos, marcas ajenas)", () => {
    const sucio = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Uno" }, { type: "hardBreak" }, { type: "text", text: "dos" }] },
        { type: "codeBlock", attrs: { language: "sql" }, content: [{ type: "text", text: "select 1" }] },
        { type: "paragraph", attrs: { id: "" }, content: [{ type: "text", text: "" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 2, rowspan: 1, colwidth: [120] },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "RFC" }] }],
                },
              ],
            },
          ],
        },
        { type: "bulletList", content: [] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "marcado", marks: [{ type: "highlight" }, { type: "bold" }, { type: "link", attrs: { href: "javascript:alert(1)" } }] },
          ],
        },
        { type: "heading", attrs: { level: 99 }, content: [{ type: "text", text: "Título" }] },
      ],
    };

    const documento = normalizarDocumento(sucio);
    const validacion = validateContract("editor.documento", documento);
    expect(validacion.errors).toEqual([]);
    expect(validacion.ok).toBe(true);

    // hardBreak se convierte en espacio dentro del mismo párrafo.
    expect(JSON.stringify(documento.content[0])).toContain("Uno ");
    // codeBlock (fuera del contrato) conserva el texto como párrafo.
    expect(documento.content[1].type).toBe("paragraph");
    // la lista vacía desaparece (los contenedores exigen minItems 1).
    expect(documento.content.some((b) => b.type === "bulletList")).toBe(false);
    // la celda pierde colspan/rowspan/colwidth: solo queda `id`.
    const tabla = JSON.stringify(documento.content.find((b) => b.type === "table"));
    expect(tabla).not.toContain("colspan");
    // marcas no permitidas y enlaces no https/relativos se caen.
    const marcado = JSON.stringify(documento);
    expect(marcado).not.toContain("highlight");
    expect(marcado).not.toContain("javascript:");
    expect(marcado).toContain('"bold"');
  });

  it("es idempotente y da ids únicos a los bloques sin id", () => {
    const sucio = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph", content: [{ type: "text", text: "b" }] }] };
    const uno = normalizarDocumento(sucio);
    const dos = normalizarDocumento(uno);
    expect(dos).toEqual(uno);
    const ids = uno.content.map((b) => b.attrs.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("un documento vacío produce un párrafo vacío válido, nunca content: []", () => {
    const documento = normalizarDocumento({ type: "doc", content: [] });
    expect(validateContract("editor.documento", documento).ok).toBe(true);
  });

  it("el hash canónico no depende del orden de las claves", () => {
    const a = { type: "paragraph", attrs: { id: "x" }, content: [{ type: "text", text: "hola" }] };
    const b = { content: [{ text: "hola", type: "text" }], attrs: { id: "x" }, type: "paragraph" };
    expect(canonico(a)).toBe(canonico(b));
    expect(hashBloque(a as never)).toBe(hashBloque(b as never));
    expect(hashDocumento(documentoFixture as Documento)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("indexa todos los bloques, incluidos los anidados", () => {
    const documento = normalizarDocumento({
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { id: "lista" },
          content: [{ type: "listItem", attrs: { id: "item" }, content: [{ type: "paragraph", attrs: { id: "parrafo" }, content: [{ type: "text", text: "x" }] }] }],
        },
      ],
    });
    const indice = indexarBloques(documento);
    expect([...indice.keys()].sort()).toEqual(["item", "lista", "parrafo"]);
  });

  it("el índice marca Trayectoria y Cadena de explicación como ausentes en el fixture de 8 secciones", () => {
    const entradas = construirIndice(reporteFixture.contenido_json as Documento);
    const presentes = entradas.filter((e) => e.estado === "presente").map((e) => e.clave);
    expect(presentes).toEqual(["resumen", "contribuyente", "hipotesis", "pistas", "evidencia", "defensor", "dictamen", "anexo"]);
    const ausentes = entradas.filter((e) => e.estado === "ausente").map((e) => e.clave);
    expect(ausentes).toEqual(["trayectoria", "cadena"]);
    // 21 §4: ninguna se inventa; se declara el motivo.
    expect(entradas.find((e) => e.clave === "cadena")?.motivoAusencia).toContain("Redactor");
  });
});
