// @vitest-environment node
import { describe, expect, it } from "vitest";

import { validateContract } from "@/lib/contracts/validate";
import { hashBloque, hashDocumento, indexarBloques } from "@/lib/document/documento";
import { desdeMarkdown, aMarkdown } from "@/lib/document/markdown";
import { aplicarPatch } from "@/lib/document/patch";
import { construirPropuesta, salidaEditorDemostracion } from "@/lib/document/propuesta";
import { hashTexto } from "@/lib/document/documento";
import type { Documento, Seleccion } from "@/lib/document/tipos";

const CITA = "CFDI:00000000-0000-4000-8000-000000000901";
const VALIDADAS = new Set([CITA, "MOV:8821"]);

const MD_BASE = [
  "## 1. Resumen",
  "",
  `Nivel presuncion. El RFC concentra CFDI [${CITA}].`,
  "",
  "## 6. Análisis del Defensor",
  "",
  `Se probó la explicación de margen delgado y falló [${CITA}].`,
  "",
  "## 7. Dictamen",
  "",
  `Nivel presuncion por dos familias [${CITA}].`,
  "",
  "## 10. Cadena de explicación",
  "",
  "1. Disparó la pista F2 [MOV:8821].",
].join("\n");

function base(): Documento {
  return desdeMarkdown(MD_BASE);
}

function seleccionDe(documento: Documento, texto: string, ids: string[]): Seleccion {
  return { from: 1, to: 1 + texto.length, block_ids: ids, texto_hash: hashTexto(texto) };
}

describe("aplicarPatch (control optimista por before_hash)", () => {
  it("reemplaza un bloque cuando el hash coincide", () => {
    const documento = base();
    const objetivo = documento.content[1];
    const resultado = aplicarPatch(documento, [
      {
        op: "replace_block",
        block_id: objetivo.attrs.id,
        before_hash: hashBloque(objetivo),
        after: { type: "paragraph", attrs: { id: objetivo.attrs.id }, content: [{ type: "text", text: `Texto nuevo [${CITA}].` }] },
      },
    ]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(aMarkdown(resultado.documento)).toContain("Texto nuevo");
    expect(validateContract("editor.documento", resultado.documento).ok).toBe(true);
  });

  it("rechaza el patch completo si el bloque cambió (hash distinto): no aplica nada", () => {
    const documento = base();
    const objetivo = documento.content[1];
    const resultado = aplicarPatch(documento, [
      { op: "replace_block", block_id: objetivo.attrs.id, before_hash: "0".repeat(64), after: objetivo },
    ]);
    expect(resultado).toEqual({ ok: false, motivo: "hash_distinto", block_id: objetivo.attrs.id });
  });

  it("no elimina un bloque protegido", () => {
    const documento = base();
    const dictamen = documento.content.find((b) => b.type === "heading" && JSON.stringify(b).includes("Dictamen"))!;
    const resultado = aplicarPatch(
      documento,
      [{ op: "remove_block", block_id: dictamen.attrs.id, before_hash: hashBloque(dictamen) }],
      { protegidos: new Set([dictamen.attrs.id]) },
    );
    expect(resultado).toEqual({ ok: false, motivo: "bloque_protegido", block_id: dictamen.attrs.id });
  });

  it("replace_document exige el hash del documento entero", () => {
    const documento = base();
    const otro = desdeMarkdown("## 1. Resumen\n\nOtro documento.");
    expect(aplicarPatch(documento, [{ op: "replace_document", before_hash: "f".repeat(64), after: otro }])).toEqual({
      ok: false,
      motivo: "hash_distinto",
    });
    const ok = aplicarPatch(documento, [{ op: "replace_document", before_hash: hashDocumento(documento), after: otro }]);
    expect(ok.ok).toBe(true);
  });
});

describe("construirPropuesta (07 §4: el patch lo arma el backend, no el modelo)", () => {
  it("una pregunta (`respuesta`) no produce patch ni toca el documento", () => {
    const resultado = construirPropuesta({
      propuestaId: "00000000-0000-4000-8000-000000000403",
      versionBase: 1,
      documento: base(),
      salida: { modo: "respuesta", mensaje: "Puedo explicar esta sección sin modificar el reporte." },
      referenciasValidadas: VALIDADAS,
    });
    expect(resultado.tipo).toBe("respuesta");
  });

  it("un fragmento produce una propuesta válida contra `editor.propuesta` y conserva las citas", () => {
    const documento = base();
    const objetivo = documento.content[1];
    const texto = JSON.stringify(objetivo);
    const resultado = construirPropuesta({
      propuestaId: "00000000-0000-4000-8000-000000000403",
      versionBase: 1,
      documento,
      salida: { modo: "fragmento", mensaje: "Propuesta de claridad.", contenido: `Redacción más clara del resumen [${CITA}].` },
      seleccion: seleccionDe(documento, texto, [objetivo.attrs.id]),
      referenciasValidadas: VALIDADAS,
    });
    expect(resultado.tipo).toBe("propuesta");
    if (resultado.tipo !== "propuesta") return;
    const validacion = validateContract("editor.propuesta", resultado.propuesta);
    expect(validacion.errors).toEqual([]);
    expect(resultado.propuesta.citas).toEqual([CITA]);
    expect(resultado.propuesta.diff).toContain("Redacción más clara");
    expect(aMarkdown(resultado.previsualizacion)).toContain("Redacción más clara");
  });

  it("rechaza una propuesta que introduce una cita sin evidencia validada", () => {
    const documento = base();
    const objetivo = documento.content[1];
    const resultado = construirPropuesta({
      propuestaId: "00000000-0000-4000-8000-000000000403",
      versionBase: 1,
      documento,
      salida: { modo: "fragmento", mensaje: "Mejora", contenido: "Nuevo texto [CFDI:11111111-1111-4111-8111-111111111111]." },
      seleccion: seleccionDe(documento, "x", [objetivo.attrs.id]),
      referenciasValidadas: VALIDADAS,
    });
    expect(resultado).toMatchObject({ tipo: "rechazo", motivo: "citas_no_autorizadas" });
  });

  it("rechaza una propuesta que cambia el nivel del dictamen (regla 4)", () => {
    const documento = base();
    const indice = indexarBloques(documento);
    const dictamenBloque = [...indice.values()].find((b) => JSON.stringify(b).includes("Nivel presuncion por dos familias"))!;
    const resultado = construirPropuesta({
      propuestaId: "00000000-0000-4000-8000-000000000403",
      versionBase: 1,
      documento,
      salida: { modo: "fragmento", mensaje: "Subir nivel", contenido: `Nivel presuncion alta por dos familias [${CITA}].` },
      seleccion: seleccionDe(documento, "x", [dictamenBloque.attrs.id]),
      referenciasValidadas: VALIDADAS,
    });
    expect(resultado).toMatchObject({ tipo: "rechazo", motivo: "cambio_de_nivel" });
  });

  it("rechaza una propuesta de documento que elimina la Cadena de explicación (21 §4)", () => {
    const documento = base();
    const resultado = construirPropuesta({
      propuestaId: "00000000-0000-4000-8000-000000000403",
      versionBase: 1,
      documento,
      salida: { modo: "documento", mensaje: "Reescritura", contenido: `## 1. Resumen\n\nNivel presuncion [${CITA}].\n\n## 7. Dictamen\n\nNivel presuncion por dos familias [${CITA}].` },
      referenciasValidadas: VALIDADAS,
    });
    expect(resultado).toMatchObject({ tipo: "rechazo", motivo: "seccion_protegida" });
  });

  it("avisa (sin bloquear) cuando la propuesta introduce una cifra que no estaba", () => {
    const documento = base();
    const objetivo = documento.content[1];
    const resultado = construirPropuesta({
      propuestaId: "00000000-0000-4000-8000-000000000403",
      versionBase: 1,
      documento,
      salida: { modo: "fragmento", mensaje: "Mejora", contenido: `Nivel presuncion con 3 operaciones [${CITA}].` },
      seleccion: seleccionDe(documento, "x", [objetivo.attrs.id]),
      referenciasValidadas: VALIDADAS,
    });
    expect(resultado.tipo).toBe("propuesta");
    if (resultado.tipo !== "propuesta") return;
    expect(resultado.advertencias.some((a) => a.codigo === "monto_nuevo")).toBe(true);
  });

  it("la salida determinista de demostración conserva las citas del fragmento", () => {
    const documento = base();
    const objetivo = documento.content[1];
    const salida = salidaEditorDemostracion({
      mensajeUsuario: "Make this clearer",
      documento,
      seleccion: seleccionDe(documento, "x", [objetivo.attrs.id]),
    });
    expect(salida.modo).toBe("fragmento");
    expect(salida.contenido).toContain(`[${CITA}]`);
  });

  it("sin selección, la salida de demostración es una respuesta (no edita)", () => {
    expect(salidaEditorDemostracion({ mensajeUsuario: "¿Qué dice el dictamen?", documento: base() }).modo).toBe("respuesta");
  });
});
