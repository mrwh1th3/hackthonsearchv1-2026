import { sha256Hex } from "./sha256";
import {
  MARCAS_SIMPLES,
  TIPOS_CONTENEDOR,
  type Alineacion,
  type Bloque,
  type BloqueContenedor,
  type BloqueTexto,
  type Documento,
  type Marca,
  type NodoTexto,
  type TipoContenedor,
  type TipoMarcaSimple,
} from "./tipos";

/**
 * Documento canónico del expediente (15 §10: "Documento canónico: JSON TipTap
 * versionado y Markdown derivado").
 *
 * Dos cosas que este módulo resuelve y que NO son opcionales:
 *
 * 1. **El JSON que emite TipTap no es `editor.documento`.** El contrato exige
 *    `attrs.id` en todo bloque, cierra el conjunto de nodos (nada de
 *    `codeBlock`/`hardBreak`), prohíbe atributos extra (`colspan`, `rowspan`,
 *    `colwidth` de las celdas) y exige `text` no vacío. `normalizarDocumento`
 *    es la frontera: todo lo que entra al almacén o sale al BFF pasa por aquí.
 *    Las celdas combinadas NO sobreviven (ver solicitudes_coordinador).
 * 2. **El hash tiene que coincidir entre cliente y servidor.** Por eso hay una
 *    sola serialización canónica (claves ordenadas), usada por ambos lados.
 *
 * `before_hash` (hash de un bloque o del documento, para control optimista del
 * patch) y `texto_hash` (hash del texto seleccionado, para detectar que la
 * selección se desplazó) son ambos `common.hash` pero NO son lo mismo.
 */

const LIMITE_BLOQUES_DOC = 300; // editor.documento: content maxItems 300
const LIMITE_HIJOS_BLOQUE = 200; // editor.block: content maxItems 200
const LIMITE_TEXTO = 20000; // editor.text: text maxLength 20000
const LIMITE_ID = 100; // attrs.id maxLength 100
const RE_HREF = /^(https:\/\/|\/(?!\/))/;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Serialización determinista con claves ordenadas: única base de todos los hashes. */
export function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor) ?? "null";
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${canonico(v)}`).join(",")}}`;
}

export function hashBloque(bloque: Bloque): string {
  return sha256Hex(canonico(bloque));
}

export function hashDocumento(documento: Documento): string {
  return sha256Hex(canonico(documento));
}

/** Hash del texto seleccionado (`seleccion.texto_hash` de `editor.solicitud`). */
export function hashTexto(texto: string): string {
  return sha256Hex(texto);
}

function normalizarMarcas(valor: unknown): Marca[] | undefined {
  if (!Array.isArray(valor)) return undefined;
  const marcas: Marca[] = [];
  for (const m of valor) {
    if (!esObjeto(m) || typeof m.type !== "string") continue;
    if ((MARCAS_SIMPLES as readonly string[]).includes(m.type)) {
      marcas.push({ type: m.type as TipoMarcaSimple });
      continue;
    }
    if (m.type === "link" && esObjeto(m.attrs) && typeof m.attrs.href === "string" && RE_HREF.test(m.attrs.href)) {
      marcas.push({ type: "link", attrs: { href: m.attrs.href.slice(0, 2000) } });
    }
    // Cualquier otra marca (highlight, subscript…) se descarta: el contrato la rechaza.
  }
  if (marcas.length === 0) return undefined;
  return marcas.slice(0, 8);
}

/** Aplana contenido inline a nodos `text` válidos: `hardBreak` se vuelve espacio, vacíos se caen. */
function normalizarInline(valor: unknown): NodoTexto[] {
  if (!Array.isArray(valor)) return [];
  const salida: NodoTexto[] = [];
  for (const nodo of valor) {
    if (!esObjeto(nodo)) continue;
    if (nodo.type === "hardBreak") {
      const ultimo = salida[salida.length - 1];
      if (ultimo && !ultimo.text.endsWith(" ")) ultimo.text = `${ultimo.text} `;
      continue;
    }
    if (nodo.type !== "text" || typeof nodo.text !== "string") continue;
    const texto = nodo.text.slice(0, LIMITE_TEXTO);
    if (texto.length === 0) continue;
    const marcas = normalizarMarcas(nodo.marks);
    salida.push(marcas ? { type: "text", text: texto, marks: marcas } : { type: "text", text: texto });
  }
  return salida.slice(0, LIMITE_HIJOS_BLOQUE);
}

const ALINEACIONES: readonly Alineacion[] = ["left", "center", "right", "justify"];

interface ContextoIds {
  usados: Set<string>;
  contador: number;
}

function tomarId(attrs: unknown, ctx: ContextoIds): string {
  const propuesto = esObjeto(attrs) && typeof attrs.id === "string" ? attrs.id.slice(0, LIMITE_ID) : "";
  if (propuesto.length > 0 && !ctx.usados.has(propuesto)) {
    ctx.usados.add(propuesto);
    return propuesto;
  }
  let candidato: string;
  do {
    ctx.contador += 1;
    candidato = `blk-${ctx.contador}`;
  } while (ctx.usados.has(candidato));
  ctx.usados.add(candidato);
  return candidato;
}

function normalizarBloque(valor: unknown, ctx: ContextoIds): Bloque[] {
  if (!esObjeto(valor) || typeof valor.type !== "string") return [];
  const tipo = valor.type;

  if (tipo === "horizontalRule") {
    return [{ type: "horizontalRule", attrs: { id: tomarId(valor.attrs, ctx) } }];
  }

  if (tipo === "paragraph" || tipo === "heading" || tipo === "codeBlock") {
    const attrsEntrada = esObjeto(valor.attrs) ? valor.attrs : {};
    const attrs: BloqueTexto["attrs"] = { id: tomarId(attrsEntrada, ctx) };
    if (tipo === "heading") {
      const nivel = Number(attrsEntrada.level);
      attrs.level = Number.isInteger(nivel) && nivel >= 1 && nivel <= 6 ? nivel : 2;
    }
    const align = attrsEntrada.textAlign;
    if (typeof align === "string" && (ALINEACIONES as readonly string[]).includes(align)) {
      attrs.textAlign = align as Alineacion;
    }
    // `codeBlock` no existe en el contrato: se conserva el texto como párrafo.
    return [{ type: tipo === "codeBlock" ? "paragraph" : tipo, attrs, content: normalizarInline(valor.content) }];
  }

  if ((TIPOS_CONTENEDOR as readonly string[]).includes(tipo)) {
    const id = tomarId(valor.attrs, ctx);
    const hijos: Bloque[] = [];
    if (Array.isArray(valor.content)) {
      for (const hijo of valor.content) hijos.push(...normalizarBloque(hijo, ctx));
    }
    if (hijos.length === 0) return []; // contenedores exigen minItems 1
    const bloque: BloqueContenedor = {
      type: tipo as TipoContenedor,
      attrs: { id },
      content: hijos.slice(0, LIMITE_HIJOS_BLOQUE),
    };
    return [bloque];
  }

  // Nodo desconocido con hijos de bloque (p.ej. una extensión no prevista):
  // se conserva el contenido, nunca se inventa un tipo nuevo.
  if (Array.isArray(valor.content)) {
    const hijos: Bloque[] = [];
    for (const hijo of valor.content) hijos.push(...normalizarBloque(hijo, ctx));
    if (hijos.length > 0) return hijos;
    const inline = normalizarInline(valor.content);
    if (inline.length > 0) return [{ type: "paragraph", attrs: { id: tomarId(valor.attrs, ctx) }, content: inline }];
  }
  return [];
}

/**
 * Convierte cualquier JSON de TipTap (o de una versión previa) en un documento
 * que valida contra `editor.documento`. Idempotente: normalizar dos veces
 * produce el mismo JSON y, por tanto, el mismo hash.
 */
export function normalizarDocumento(valor: unknown): Documento {
  const ctx: ContextoIds = { usados: new Set(), contador: 0 };
  const entrada = esObjeto(valor) && Array.isArray(valor.content) ? valor.content : [];
  const bloques: Bloque[] = [];
  for (const nodo of entrada) {
    bloques.push(...normalizarBloque(nodo, ctx));
    if (bloques.length >= LIMITE_BLOQUES_DOC) break;
  }
  const content = bloques.slice(0, LIMITE_BLOQUES_DOC);
  if (content.length === 0) {
    // `editor.documento` exige minItems 1: un documento vacío se representa con
    // un párrafo vacío, no con `content: []`.
    content.push({ type: "paragraph", attrs: { id: "blk-1" }, content: [] });
  }
  return { type: "doc", content };
}

export function esBloqueTexto(bloque: Bloque): bloque is BloqueTexto {
  return bloque.type === "paragraph" || bloque.type === "heading";
}

export function esBloqueContenedor(bloque: Bloque): bloque is BloqueContenedor {
  return (TIPOS_CONTENEDOR as readonly string[]).includes(bloque.type);
}

/** Texto plano de un bloque (recursivo), para hashes de selección y búsqueda. */
export function textoDeBloque(bloque: Bloque): string {
  if (esBloqueTexto(bloque)) return bloque.content.map((t) => t.text).join("");
  if (esBloqueContenedor(bloque)) return bloque.content.map(textoDeBloque).join(" ");
  return "";
}

export function textoDeDocumento(documento: Documento): string {
  return documento.content.map(textoDeBloque).join("\n");
}

/** Índice plano id → bloque (incluye bloques anidados en listas/tablas). */
export function indexarBloques(documento: Documento): Map<string, Bloque> {
  const indice = new Map<string, Bloque>();
  const visitar = (bloques: Bloque[]) => {
    for (const b of bloques) {
      indice.set(b.attrs.id, b);
      if (esBloqueContenedor(b)) visitar(b.content);
    }
  };
  visitar(documento.content);
  return indice;
}

/** Copia profunda barata (los documentos son JSON puro). */
export function clonar<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}
