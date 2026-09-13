import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Extensiones propias del editor del expediente.
 *
 * Dos problemas que TipTap no resuelve solo y que el contrato obliga a
 * resolver aquí:
 *
 * 1. **`attrs.id` es obligatorio en todo bloque** (`editor.block`). StarterKit
 *    no lo tiene, así que un bloque nuevo nacería sin id y rompería el
 *    `block_id`/`before_hash` de cualquier patch. `AtributosBloque` lo añade
 *    como atributo global y una transacción de apéndice se lo pone a todo
 *    bloque que aparezca, sin cambiar los ids existentes (si cambiaran en cada
 *    tecleo, ningún hash sobreviviría).
 * 2. **Las citas no pueden ser un nodo ni una marca.** El contrato cierra el
 *    conjunto inline a `text`: una marca `cita` haría inválido el documento.
 *    Por eso `CitasDecoradas` las pinta con *decoraciones* de ProseMirror, que
 *    son presentación pura y no tocan el JSON.
 */

const TIPOS_CON_ID = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "horizontalRule",
];

const TIPOS_CON_ALINEACION = ["paragraph", "heading"];

let contador = 0;
function idNuevo(): string {
  contador += 1;
  return `blk-n${Date.now().toString(36)}-${contador}`;
}

export const AtributosBloque = Extension.create({
  name: "atributosBloque",

  addGlobalAttributes() {
    return [
      {
        types: TIPOS_CON_ID,
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-id"),
            renderHTML: (attributes) => (attributes.id ? { "data-id": attributes.id } : {}),
            keepOnSplit: false,
          },
        },
      },
      {
        // `textAlign` del contrato sin añadir @tiptap/extension-text-align
        // (no se instalan dependencias nuevas en este corte).
        types: TIPOS_CON_ALINEACION,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => element.style.textAlign || null,
            renderHTML: (attributes) =>
              attributes.textAlign ? { style: `text-align: ${attributes.textAlign}` } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("idsDeBloque"),
        appendTransaction: (_transacciones, _anterior, estado) => {
          const vistos = new Set<string>();
          const pendientes: Array<{ pos: number; id: string }> = [];
          estado.doc.descendants((nodo, pos) => {
            if (!TIPOS_CON_ID.includes(nodo.type.name)) return;
            const actual = nodo.attrs.id as string | null;
            if (!actual || vistos.has(actual)) {
              pendientes.push({ pos, id: idNuevo() });
            } else {
              vistos.add(actual);
            }
          });
          if (pendientes.length === 0) return null;
          const tr = estado.tr;
          for (const { pos, id } of pendientes) {
            const nodo = tr.doc.nodeAt(pos);
            if (!nodo) continue;
            tr.setNodeMarkup(pos, undefined, { ...nodo.attrs, id });
          }
          return tr.setMeta("addToHistory", false);
        },
      }),
    ];
  },
});

const RE_CITA = /\[((?:CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR):[^\s\]]+)\]/g;

export interface OpcionesCitas {
  referenciasValidadas: ReadonlySet<string>;
  onCitaClick?: (referencia: string) => void;
}

/**
 * Decora cada `[TIPO:id]` como chip clicable y, si el ID no está en evidencia
 * validada, en rojo (09 §8: validación del lado de la UI, independiente del
 * backend). No modifica el documento.
 */
export const CitasDecoradas = Extension.create<OpcionesCitas>({
  name: "citasDecoradas",

  addOptions() {
    return { referenciasValidadas: new Set<string>(), onCitaClick: undefined };
  },

  addProseMirrorPlugins() {
    const opciones = this.options;
    return [
      new Plugin({
        key: new PluginKey("citasDecoradas"),
        props: {
          decorations(estado) {
            const decoraciones: Decoration[] = [];
            estado.doc.descendants((nodo, pos) => {
              if (!nodo.isText || !nodo.text) return;
              for (const match of nodo.text.matchAll(RE_CITA)) {
                const inicio = pos + (match.index ?? 0);
                const fin = inicio + match[0].length;
                const referencia = match[1];
                const valida = opciones.referenciasValidadas.has(referencia);
                decoraciones.push(
                  Decoration.inline(inicio, fin, {
                    class: valida ? "cita" : "cita cita-invalida",
                    "data-referencia": referencia,
                    title: valida
                      ? "Validated citation. Click to open the source record."
                      : "ID not found in this dataset's validated evidence.",
                  }),
                );
              }
            });
            return DecorationSet.create(estado.doc, decoraciones);
          },
          handleClick(_vista, _pos, evento) {
            const objetivo = (evento.target as HTMLElement | null)?.closest("[data-referencia]");
            const referencia = objetivo?.getAttribute("data-referencia");
            if (!referencia || !opciones.onCitaClick) return false;
            opciones.onCitaClick(referencia);
            return true;
          },
        },
      }),
    ];
  },
});
