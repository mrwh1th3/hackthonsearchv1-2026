/**
 * Tipos del documento canónico del expediente.
 *
 * Espejo EXACTO de `contracts/schemas/editor.schema.json` v1.2.0 (`editor.mark`,
 * `editor.text`, `editor.block`, `editor.documento`, `editor.patch`,
 * `editor.propuesta`, `editor.solicitud`, `editor.aplicar`, `editor.reporte`).
 * No se generan por codegen (no hay codegen instalado); si el coordinador
 * publica una versión nueva de contratos, este archivo y `normalizarDocumento`
 * deben revisarse. La verdad sigue siendo el JSON Schema: toda salida del BFF
 * se valida con ajv contra los schemas reales antes de responder.
 */

export type TipoMarcaSimple = "bold" | "italic" | "strike" | "code" | "underline";

export type Marca = { type: TipoMarcaSimple } | { type: "link"; attrs: { href: string } };

export interface NodoTexto {
  type: "text";
  text: string;
  marks?: Marca[];
}

export type Alineacion = "left" | "center" | "right" | "justify";

/** paragraph / heading: contenido inline (solo `text`), atributos id/level/textAlign. */
export interface BloqueTexto {
  type: "paragraph" | "heading";
  attrs: { id: string; level?: number; textAlign?: Alineacion };
  content: NodoTexto[];
}

export type TipoContenedor =
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "blockquote"
  | "table"
  | "tableRow"
  | "tableCell"
  | "tableHeader";

/** Contenedores: solo `attrs.id` y al menos un bloque hijo (minItems 1). */
export interface BloqueContenedor {
  type: TipoContenedor;
  attrs: { id: string };
  content: Bloque[];
}

export interface BloqueRegla {
  type: "horizontalRule";
  attrs: { id: string };
}

export type Bloque = BloqueTexto | BloqueContenedor | BloqueRegla;

export interface Documento {
  type: "doc";
  content: Bloque[];
}

export type Patch =
  | { op: "replace_block"; block_id: string; before_hash: string; after: Bloque }
  | { op: "insert_after"; block_id: string; before_hash: string; after: Bloque }
  | { op: "remove_block"; block_id: string; before_hash: string }
  | { op: "replace_document"; before_hash: string; after: Documento };

export interface Propuesta {
  propuesta_id: string;
  version_base: number;
  mensaje: string;
  patch: Patch[];
  diff: string;
  citas: string[];
}

export interface Seleccion {
  from: number;
  to: number;
  block_ids: string[];
  texto_hash: string;
}

export interface SolicitudEdicion {
  caso_id: string;
  version_base: number;
  modo: "pregunta" | "propuesta";
  seleccion?: Seleccion;
  directriz_id?: string;
  mensaje: string;
  evidencia_ids: string[];
  idempotency_key: string;
}

export interface SolicitudAplicar {
  propuesta_id: string;
  version_base: number;
  idempotency_key: string;
}

export interface Reporte {
  caso_id: string;
  version: number;
  estado_revision: "borrador" | "validado";
  autor: "agente" | "humano";
  creado: string;
  contenido_json: Documento;
  markdown: string;
  content_hash: string;
}

/**
 * Salida del agente Editor (07 §4 paso 2, `agents.editor`): `fragmento`,
 * `documento` o `respuesta`. NO es una propuesta todavía: el BFF la convierte
 * en patch/diff/citas deterministas (`construirPropuesta`).
 */
export interface SalidaEditor {
  modo: "fragmento" | "documento" | "respuesta";
  mensaje: string;
  contenido?: string;
}

export const TIPOS_CONTENEDOR: readonly TipoContenedor[] = [
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
];

export const MARCAS_SIMPLES: readonly TipoMarcaSimple[] = ["bold", "italic", "strike", "code", "underline"];
