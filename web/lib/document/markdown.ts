import { esBloqueContenedor, esBloqueTexto, normalizarDocumento } from "./documento";
import type { Bloque, Documento, Marca, NodoTexto } from "./tipos";

/**
 * Markdown **derivado** del documento canónico (15 §10).
 *
 * Reglas que respeta este módulo:
 * - El JSON TipTap es la fuente; el Markdown se deriva al guardar y al
 *   exportar. NO hay round-trip continuo por Markdown (perdería tablas,
 *   marcas y anclas de bloque).
 * - `desdeMarkdown` existe para UNA importación: la versión legada que solo
 *   tiene Markdown (hoy, el `redactor.markdown` del fixture). Es determinista
 *   —mismos ids `blk-N` en el mismo orden— para que el documento que pinta la
 *   página y el que siembra el BFF sean byte a byte el mismo y sus hashes
 *   coincidan.
 * - Las citas `[CFDI:…]` se escriben literales en ambos sentidos: no se
 *   escapan corchetes, para que la exportación conserve exactamente las
 *   mismas referencias que el JSON.
 * - `underline` no tiene sintaxis Markdown: se deriva como texto plano (no se
 *   inyecta HTML en un documento que después se exporta).
 */

function marcarTexto(nodo: NodoTexto): string {
  let texto = nodo.text;
  const tipos = new Set((nodo.marks ?? []).map((m: Marca) => m.type));
  if (tipos.has("code")) texto = `\`${texto}\``;
  if (tipos.has("bold")) texto = `**${texto}**`;
  if (tipos.has("italic")) texto = `*${texto}*`;
  if (tipos.has("strike")) texto = `~~${texto}~~`;
  const link = (nodo.marks ?? []).find((m): m is { type: "link"; attrs: { href: string } } => m.type === "link");
  if (link) texto = `[${texto}](${link.attrs.href})`;
  return texto;
}

function inlineAMarkdown(bloque: Bloque): string {
  if (!esBloqueTexto(bloque)) return "";
  return bloque.content.map(marcarTexto).join("");
}

function celdasDeFila(fila: Bloque): string[] {
  if (!esBloqueContenedor(fila)) return [];
  return fila.content.map((celda) =>
    esBloqueContenedor(celda) ? celda.content.map(inlineAMarkdown).join(" ").trim() : inlineAMarkdown(celda).trim(),
  );
}

function tablaAMarkdown(tabla: Bloque): string[] {
  if (!esBloqueContenedor(tabla)) return [];
  const filas = tabla.content.map(celdasDeFila).filter((f) => f.length > 0);
  if (filas.length === 0) return [];
  const ancho = Math.max(...filas.map((f) => f.length));
  const rellenar = (f: string[]) => [...f, ...Array(ancho - f.length).fill("")];
  const lineas = [`| ${rellenar(filas[0]).join(" | ")} |`, `| ${Array(ancho).fill("---").join(" | ")} |`];
  for (const fila of filas.slice(1)) lineas.push(`| ${rellenar(fila).join(" | ")} |`);
  return lineas;
}

function bloqueAMarkdown(bloque: Bloque): string[] {
  switch (bloque.type) {
    case "heading": {
      const nivel = esBloqueTexto(bloque) ? (bloque.attrs.level ?? 2) : 2;
      return [`${"#".repeat(nivel)} ${inlineAMarkdown(bloque)}`];
    }
    case "paragraph":
      return [inlineAMarkdown(bloque)];
    case "horizontalRule":
      return ["---"];
    case "bulletList":
    case "orderedList": {
      if (!esBloqueContenedor(bloque)) return [];
      const lineas: string[] = [];
      bloque.content.forEach((item, i) => {
        const marca = bloque.type === "bulletList" ? "-" : `${i + 1}.`;
        const cuerpo = esBloqueContenedor(item)
          ? item.content.flatMap((hijo) => bloqueAMarkdown(hijo))
          : bloqueAMarkdown(item);
        const [primera, ...resto] = cuerpo.length > 0 ? cuerpo : [""];
        lineas.push(`${marca} ${primera}`);
        for (const l of resto) lineas.push(`  ${l}`);
      });
      return lineas;
    }
    case "blockquote": {
      if (!esBloqueContenedor(bloque)) return [];
      return bloque.content.flatMap((hijo) => bloqueAMarkdown(hijo)).map((l) => `> ${l}`);
    }
    case "table":
      return tablaAMarkdown(bloque);
    default:
      return esBloqueContenedor(bloque) ? bloque.content.flatMap((hijo) => bloqueAMarkdown(hijo)) : [];
  }
}

/** Markdown derivado del documento canónico. Conserva todas las citas literales. */
export function aMarkdown(documento: Documento): string {
  const partes: string[] = [];
  for (const bloque of documento.content) {
    const lineas = bloqueAMarkdown(bloque);
    if (lineas.length === 0) continue;
    partes.push(lineas.join("\n"));
  }
  return partes.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// Importación única de Markdown legado
// ---------------------------------------------------------------------------

const RE_LINK = /\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[^\s)]*)\)/;
const RE_CODE = /`([^`]+)`/;
const RE_BOLD = /\*\*([^*]+)\*\*/;
const RE_ITALIC = /\*([^*]+)\*/;
const RE_STRIKE = /~~([^~]+)~~/;

function nodoTexto(texto: string, marcas: Marca[]): NodoTexto {
  return marcas.length > 0 ? { type: "text", text: texto, marks: marcas } : { type: "text", text: texto };
}

/**
 * Parser inline mínimo: negrita, cursiva, tachado, código y enlaces. Una cita
 * `[CFDI:uuid]` no es un enlace (no la sigue `(`), así que queda intacta.
 */
function inlineDesdeMarkdown(texto: string, marcas: Marca[] = []): NodoTexto[] {
  const reglas: Array<{ re: RegExp; marca: Marca }> = [
    { re: RE_CODE, marca: { type: "code" } },
    { re: RE_BOLD, marca: { type: "bold" } },
    { re: RE_STRIKE, marca: { type: "strike" } },
    { re: RE_ITALIC, marca: { type: "italic" } },
  ];

  const link = RE_LINK.exec(texto);
  if (link) {
    const antes = texto.slice(0, link.index);
    const despues = texto.slice(link.index + link[0].length);
    return [
      ...inlineDesdeMarkdown(antes, marcas),
      ...inlineDesdeMarkdown(link[1], [...marcas, { type: "link", attrs: { href: link[2] } }]),
      ...inlineDesdeMarkdown(despues, marcas),
    ];
  }

  for (const { re, marca } of reglas) {
    const m = re.exec(texto);
    if (!m) continue;
    return [
      ...inlineDesdeMarkdown(texto.slice(0, m.index), marcas),
      ...inlineDesdeMarkdown(m[1], [...marcas, marca]),
      ...inlineDesdeMarkdown(texto.slice(m.index + m[0].length), marcas),
    ];
  }

  return texto.length > 0 ? [nodoTexto(texto, marcas)] : [];
}

function celdasDeLinea(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const RE_SEPARADOR_TABLA = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

/**
 * Construye el documento canónico a partir de Markdown. Determinista: los ids
 * son `blk-1..N` en orden de aparición.
 */
export function desdeMarkdown(markdown: string): Documento {
  const lineas = markdown.replace(/\r\n/g, "\n").split("\n");
  const bloques: Bloque[] = [];
  let contador = 0;
  const id = () => {
    contador += 1;
    return `blk-${contador}`;
  };

  let i = 0;
  let parrafo: string[] = [];

  const cerrarParrafo = () => {
    if (parrafo.length === 0) return;
    const texto = parrafo.join(" ").trim();
    parrafo = [];
    if (texto.length === 0) return;
    bloques.push({ type: "paragraph", attrs: { id: id() }, content: inlineDesdeMarkdown(texto) });
  };

  while (i < lineas.length) {
    const linea = lineas[i];
    const limpia = linea.trim();

    if (limpia.length === 0) {
      cerrarParrafo();
      i += 1;
      continue;
    }

    const encabezado = /^(#{1,6})\s+(.*)$/.exec(limpia);
    if (encabezado) {
      cerrarParrafo();
      bloques.push({
        type: "heading",
        attrs: { id: id(), level: encabezado[1].length },
        content: inlineDesdeMarkdown(encabezado[2].trim()),
      });
      i += 1;
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(limpia)) {
      cerrarParrafo();
      bloques.push({ type: "horizontalRule", attrs: { id: id() } });
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(limpia) || /^\d+\.\s+/.test(limpia)) {
      cerrarParrafo();
      const ordenada = /^\d+\.\s+/.test(limpia);
      const items: Bloque[] = [];
      while (i < lineas.length) {
        const actual = lineas[i].trim();
        const coincide = ordenada ? /^\d+\.\s+/.exec(actual) : /^[-*]\s+/.exec(actual);
        if (!coincide) break;
        const cuerpo = actual.slice(coincide[0].length).trim();
        items.push({
          type: "listItem",
          attrs: { id: id() },
          content: [{ type: "paragraph", attrs: { id: id() }, content: inlineDesdeMarkdown(cuerpo) }],
        });
        i += 1;
      }
      if (items.length > 0) {
        bloques.push({ type: ordenada ? "orderedList" : "bulletList", attrs: { id: id() }, content: items });
      }
      continue;
    }

    if (limpia.startsWith(">")) {
      cerrarParrafo();
      const citadas: string[] = [];
      while (i < lineas.length && lineas[i].trim().startsWith(">")) {
        citadas.push(lineas[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      bloques.push({
        type: "blockquote",
        attrs: { id: id() },
        content: [{ type: "paragraph", attrs: { id: id() }, content: inlineDesdeMarkdown(citadas.join(" ").trim()) }],
      });
      continue;
    }

    if (limpia.startsWith("|") && limpia.endsWith("|")) {
      cerrarParrafo();
      const filasCrudas: string[][] = [];
      let encabezados = false;
      while (i < lineas.length) {
        const actual = lineas[i].trim();
        if (!actual.startsWith("|")) break;
        if (RE_SEPARADOR_TABLA.test(actual)) {
          encabezados = filasCrudas.length === 1;
          i += 1;
          continue;
        }
        filasCrudas.push(celdasDeLinea(actual));
        i += 1;
      }
      if (filasCrudas.length > 0) {
        const filas: Bloque[] = filasCrudas.map((celdas, indiceFila) => ({
          type: "tableRow" as const,
          attrs: { id: id() },
          content: celdas.map((celda) => ({
            type: encabezados && indiceFila === 0 ? ("tableHeader" as const) : ("tableCell" as const),
            attrs: { id: id() },
            content: [{ type: "paragraph" as const, attrs: { id: id() }, content: inlineDesdeMarkdown(celda) }],
          })),
        }));
        bloques.push({ type: "table", attrs: { id: id() }, content: filas });
      }
      continue;
    }

    parrafo.push(limpia);
    i += 1;
  }
  cerrarParrafo();

  // normalizarDocumento deja el resultado exactamente dentro de `editor.documento`
  // (ids únicos, contenedores no vacíos, textos no vacíos).
  return normalizarDocumento({ type: "doc", content: bloques });
}

/**
 * Parser inline público: convierte una línea de texto (con marcas Markdown
 * simples) en nodos `text` válidos. Lo usa `construirPropuesta` para
 * reemplazar el contenido de un bloque sin cambiar su tipo ni su id.
 */
export function inlineDesdeTexto(texto: string): NodoTexto[] {
  return inlineDesdeMarkdown(texto);
}
