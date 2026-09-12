// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { Node as NodoPM } from "@tiptap/pm/model";

import redactorFixture from "@contracts/fixtures/valid/redactor.json";
import { hashTexto } from "@/lib/document/documento";
import { desdeMarkdown } from "@/lib/document/markdown";
import { rangoDeBloque, tamanoNodo, textoEntre, verificarSeleccion } from "@/lib/document/seleccion";
import type { Documento } from "@/lib/document/tipos";

/**
 * Hallazgo 2 del verificador: `texto_hash` de la selección se contrasta con el
 * contenido del bloque.
 *
 * La prueba fuerte es la primera: `textoEntre()` (reconstrucción del servidor)
 * se compara contra `doc.textBetween(from, to, "\n", " ")` de **ProseMirror
 * real**, con el mismo esquema de TipTap que usa el editor. Si el modelo de
 * posiciones del servidor se desviara del del navegador, el BFF rechazaría
 * selecciones legítimas; esto lo impide.
 *
 * Las demás fijan la regla de diseño: `desplazada` (409) solo cuando se puede
 * PROBAR que el texto ya no está; si la enumeración no es concluyente, la
 * petición sigue con `seleccion_verificada:false`.
 */

const esquema = getSchema([StarterKit, Table, TableRow, TableHeader, TableCell]);

function docPM(documento: Documento) {
  return NodoPM.fromJSON(esquema, documento);
}

const documentoBase = desdeMarkdown(redactorFixture.markdown);

const documentoRico = desdeMarkdown(
  [
    "# Título del expediente",
    "",
    "Primer párrafo con una cita CFDI:00000000-0000-4000-8000-000000000901 incluida.",
    "",
    "- primer elemento de lista",
    "- segundo elemento de lista",
    "",
    "Párrafo final del expediente.",
    "",
    "| RFC | Monto |",
    "| --- | --- |",
    "| AAA010101AAA | 1,200,000 |",
    "| BBB020202BB2 | 980,000 |",
    "",
  ].join("\n"),
);

describe("modelo de posiciones del servidor vs. ProseMirror real", () => {
  it("tamanoNodo coincide con nodeSize de ProseMirror para cada bloque de nivel 1", () => {
    const pm = docPM(documentoRico);
    documentoRico.content.forEach((bloque, i) => {
      expect(`${i}:${tamanoNodo(bloque)}`).toBe(`${i}:${pm.child(i).nodeSize}`);
    });
  });

  it("textoEntre reproduce doc.textBetween(from, to, '\\n', ' ') en TODO rango del documento", () => {
    for (const documento of [documentoBase, documentoRico]) {
      const pm = docPM(documento);
      const fin = pm.content.size;
      let comparaciones = 0;
      for (let from = 0; from <= fin; from += 3) {
        for (let to = from; to <= fin; to += 7) {
          expect(`${from}-${to}:${textoEntre(documento, from, to)}`).toBe(
            `${from}-${to}:${pm.textBetween(from, to, "\n", " ")}`,
          );
          comparaciones += 1;
        }
      }
      expect(comparaciones).toBeGreaterThan(50);
    }
  });

  it("rangoDeBloque devuelve el rango que cubre exactamente el texto del bloque", () => {
    const pm = docPM(documentoRico);
    const idParrafo = documentoRico.content[1].attrs.id;
    const rango = rangoDeBloque(documentoRico, idParrafo);
    expect(rango).not.toBeNull();
    expect(textoEntre(documentoRico, rango!.from, rango!.to)).toBe(pm.child(1).textContent);
  });
});

describe("verificarSeleccion", () => {
  const idParrafo = documentoRico.content[1].attrs.id;
  const rango = rangoDeBloque(documentoRico, idParrafo)!;
  const texto = textoEntre(documentoRico, rango.from, rango.to);

  it("verifica por posiciones cuando el cliente manda from/to exactos", () => {
    const r = verificarSeleccion(documentoRico, {
      from: rango.from,
      to: rango.to,
      block_ids: [idParrafo],
      texto_hash: hashTexto(texto),
    });
    expect(r).toEqual({ estado: "verificada", via: "posiciones" });
  });

  it("verifica por anclas cuando las posiciones se corrieron pero el texto sigue en el bloque", () => {
    const fragmento = texto.slice(6, 24);
    const r = verificarSeleccion(documentoRico, {
      from: rango.from + 999, // posiciones inservibles
      to: rango.to + 999,
      block_ids: [idParrafo],
      texto_hash: hashTexto(fragmento),
    });
    expect(r).toEqual({ estado: "verificada", via: "anclas" });
  });

  it("PRUEBA el desplazamiento: un texto que no está en el bloque es 'desplazada'", () => {
    const r = verificarSeleccion(documentoRico, {
      from: rango.from,
      to: rango.to,
      block_ids: [idParrafo],
      texto_hash: hashTexto("fragmento seleccionado que nunca estuvo en el documento"),
    });
    expect(r).toEqual({ estado: "desplazada" });
  });

  it("selección de varios bloques: se verifica el corte real entre ellos", () => {
    const ids = [documentoRico.content[0].attrs.id, documentoRico.content[1].attrs.id];
    const pm = docPM(documentoRico);
    const desde = 3;
    const hasta = pm.child(0).nodeSize + 8;
    const esperado = pm.textBetween(desde, hasta, "\n", " ");
    expect(
      verificarSeleccion(documentoRico, { from: desde, to: hasta, block_ids: ids, texto_hash: hashTexto(esperado) }),
    ).toEqual({ estado: "verificada", via: "posiciones" });
    // Mismo par de bloques, texto que no corresponde: se prueba el desfase.
    expect(
      verificarSeleccion(documentoRico, {
        from: desde,
        to: hasta,
        block_ids: ids,
        texto_hash: hashTexto("otra cosa\nque no está"),
      }),
    ).toEqual({ estado: "desplazada" });
  });

  /**
   * Antes esto devolvía `indeterminada: contenedores`: una selección sobre la
   * tabla de hallazgos o sobre una lista NUNCA se verificaba. Ahora el texto
   * anclado del bloque se reconstruye con `textoEntre()` sobre su rango, que
   * es el mismo `textBetween` del paso 1, así que contenedores y párrafos se
   * tratan igual.
   */
  for (const tipo of ["bulletList", "table"] as const) {
    it(`selección sobre ${tipo} se verifica aunque las posiciones se hayan desplazado`, () => {
      const contenedor = documentoRico.content.find((b) => b.type === tipo);
      expect(contenedor).toBeDefined();
      const rangoContenedor = rangoDeBloque(documentoRico, contenedor!.attrs.id)!;
      const esperado = docPM(documentoRico).textBetween(rangoContenedor.from, rangoContenedor.to, "\n", " ");
      expect(esperado.length).toBeGreaterThan(0);

      // Con las posiciones correctas: camino directo.
      expect(
        verificarSeleccion(documentoRico, {
          from: rangoContenedor.from,
          to: rangoContenedor.to,
          block_ids: [contenedor!.attrs.id],
          texto_hash: hashTexto(esperado),
        }),
      ).toEqual({ estado: "verificada", via: "posiciones" });

      // Con las posiciones desplazadas (el documento creció por arriba): el
      // texto sigue estando y se demuestra por anclas.
      expect(
        verificarSeleccion(documentoRico, {
          from: 0,
          to: 4,
          block_ids: [contenedor!.attrs.id],
          texto_hash: hashTexto(esperado),
        }),
      ).toEqual({ estado: "verificada", via: "anclas" });
    });
  }

  it("un texto que nunca estuvo en la lista sí se PRUEBA desplazado", () => {
    const lista = documentoRico.content.find((b) => b.type === "bulletList");
    expect(lista).toBeDefined();
    expect(
      verificarSeleccion(documentoRico, {
        from: 0,
        to: 4,
        block_ids: [lista!.attrs.id],
        texto_hash: hashTexto("no coincide"),
      }),
    ).toEqual({ estado: "desplazada" });
  });

  it("un bloque anidado dentro de otro seleccionado no duplica su texto", () => {
    const tabla = documentoRico.content.find((b) => b.type === "table");
    expect(tabla).toBeDefined();
    const rangoTabla = rangoDeBloque(documentoRico, tabla!.attrs.id)!;
    const esperado = docPM(documentoRico).textBetween(rangoTabla.from, rangoTabla.to, "\n", " ");
    // Una celda cualquiera de la tabla, mandada ADEMÁS de la tabla.
    const celda = tabla!.content?.[0]?.content?.[0];
    expect(celda).toBeDefined();
    expect(
      verificarSeleccion(documentoRico, {
        from: 0,
        to: 4,
        block_ids: [tabla!.attrs.id, celda!.attrs.id],
        texto_hash: hashTexto(esperado),
      }),
    ).toEqual({ estado: "verificada", via: "anclas" });
  });

  it("un bloque ausente es indeterminada aquí (el 409 por bloques lo da la ruta antes)", () => {
    const r = verificarSeleccion(documentoRico, {
      from: 0,
      to: 4,
      block_ids: ["blk-que-no-existe"],
      texto_hash: hashTexto("x"),
    });
    expect(r.estado).toBe("indeterminada");
    if (r.estado === "indeterminada") expect(r.motivo).toBe("bloques_ausentes");
  });

  it("un bloque enorme agota el presupuesto y NO se rechaza (falso 409 es peor que no verificar)", () => {
    const largo: Documento = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "blk-largo" },
          content: [{ type: "text", text: "a".repeat(4000) }],
        },
      ],
    };
    const r = verificarSeleccion(largo, {
      from: 99999,
      to: 100999,
      block_ids: ["blk-largo"],
      texto_hash: hashTexto("b".repeat(20)),
    });
    expect(r.estado).toBe("indeterminada");
    if (r.estado === "indeterminada") expect(r.motivo).toBe("presupuesto");
  });
});
