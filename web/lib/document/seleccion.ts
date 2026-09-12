import { esBloqueTexto, hashTexto, indexarBloques } from "./documento";
import type { Bloque, Documento, NodoTexto } from "./tipos";

/**
 * Verificación de `seleccion.texto_hash` contra el contenido real de los
 * bloques (hallazgo 2 del verificador; 07 §4 nodo 6: «verifica `seleccion.hash`
 * contra `version_base`»).
 *
 * El cliente manda `{from, to, block_ids, texto_hash}` — `editor.solicitud` es
 * `additionalProperties:false`, así que **no** puede mandar el texto ni los
 * hashes de bloque: el servidor tiene que reconstruirlo. Se hace en dos pasos:
 *
 * 1. `textoEntre()` reproduce `doc.textBetween(from, to, "\n", " ")` de
 *    ProseMirror sobre el JSON canónico (el modelo de posiciones de PM:
 *    `nodeSize` = `text.length` para texto, `1` para hoja, `2 + contenido`
 *    para el resto). Una sola función hash y listo, que es el caso normal.
 * 2. Si eso no coincide, se enumeran los candidatos **anclados**: la salida de
 *    `textBetween` siempre tiene la forma `sufijo(primer bloque) + "\n" +
 *    bloques intermedios completos + "\n" + prefijo(último bloque)`, así que
 *    el conjunto es `(|primero|+1) × (|último|+1)`, no todas las subcadenas.
 *
 * **Regla de diseño: solo se afirma el desplazamiento cuando se puede probar.**
 * Un 409 falso bloquea una propuesta legítima —peor que no verificar—, así que
 * si la enumeración no cabe en el presupuesto el resultado es `indeterminada`
 * y la petición **sigue**, declarando `seleccion_verificada: false`. Solo una
 * enumeración completa sin coincidencia produce `desplazada`.
 *
 * Tablas y listas **no** son un caso aparte. El texto de cada bloque anclado
 * se reconstruye con `textoEntre()` sobre su propio rango, que es el mismo
 * `textBetween` que usa el paso 1: un `tableCell` con dos párrafos aporta
 * `"a\nb"`, igual que aportaría dentro del documento. Antes se usaba una
 * concatenación plana que no era equivalente para contenedores y por eso se
 * devolvía `indeterminada: contenedores` —una selección sobre la tabla de
 * hallazgos nunca se verificaba—. El precio es que esos textos son más largos
 * y una tabla grande puede caer ahora en `indeterminada: presupuesto`, que es
 * un límite medido y no un «no se intentó».
 */

export type VerificacionSeleccion =
  | { estado: "verificada"; via: "posiciones" | "anclas" }
  | { estado: "desplazada" }
  | { estado: "indeterminada"; motivo: "presupuesto" | "bloques_ausentes" };

export interface SeleccionEntrada {
  from: number;
  to: number;
  block_ids: string[];
  texto_hash: string;
}

const MAX_CANDIDATOS = 60_000;
const MAX_BYTES = 8_000_000;

// ---------------------------------------------------------------------------
// Modelo de posiciones de ProseMirror sobre el JSON canónico.
// ---------------------------------------------------------------------------

type Nodo = Bloque | NodoTexto;

function esTexto(nodo: Nodo): nodo is NodoTexto {
  return nodo.type === "text";
}

function hijosDe(nodo: Nodo): Nodo[] {
  if (esTexto(nodo) || nodo.type === "horizontalRule") return [];
  return (nodo as { content?: Nodo[] }).content ?? [];
}

/** `nodeSize` de ProseMirror. */
export function tamanoNodo(nodo: Nodo): number {
  if (esTexto(nodo)) return nodo.text.length;
  if (nodo.type === "horizontalRule") return 1;
  return 2 + hijosDe(nodo).reduce((suma, hijo) => suma + tamanoNodo(hijo), 0);
}

interface Acumulador {
  from: number;
  to: number;
  texto: string;
  primero: boolean;
}

function recorrer(hijos: Nodo[], inicio: number, acc: Acumulador): void {
  let pos = inicio;
  for (const hijo of hijos) {
    if (pos >= acc.to) return;
    const fin = pos + tamanoNodo(hijo);
    if (fin > acc.from) {
      if (esTexto(hijo)) {
        acc.texto += hijo.text.slice(Math.max(acc.from, pos) - pos, acc.to - pos);
      } else if (hijo.type === "horizontalRule") {
        // Hoja de bloque con `leafText: " "`: cuenta como bloque para el separador.
        if (acc.primero) acc.primero = false;
        else acc.texto += "\n";
        acc.texto += " ";
      } else {
        if (esBloqueTexto(hijo)) {
          if (acc.primero) acc.primero = false;
          else acc.texto += "\n";
        }
        recorrer(hijosDe(hijo), pos + 1, acc);
      }
    }
    pos = fin;
  }
}

/** Equivalente servidor de `editor.state.doc.textBetween(from, to, "\n", " ")`. */
export function textoEntre(documento: Documento, from: number, to: number): string {
  const acc: Acumulador = { from: Math.max(0, from), to, texto: "", primero: true };
  recorrer(documento.content as Nodo[], 0, acc);
  return acc.texto;
}

/** Rango de posiciones PM que cubre el texto completo de un bloque. */
export function rangoDeBloque(documento: Documento, blockId: string): { from: number; to: number } | null {
  let resultado: { from: number; to: number } | null = null;
  function buscar(hijos: Nodo[], inicio: number): void {
    let pos = inicio;
    for (const hijo of hijos) {
      const tamano = tamanoNodo(hijo);
      if (!esTexto(hijo) && (hijo as Bloque).attrs?.id === blockId && !resultado) {
        resultado = { from: pos + 1, to: pos + tamano - 1 };
      }
      if (!esTexto(hijo)) buscar(hijosDe(hijo), pos + 1);
      pos += tamano;
    }
  }
  buscar(documento.content as Nodo[], 0);
  return resultado;
}

// ---------------------------------------------------------------------------
// Verificación.
// ---------------------------------------------------------------------------

interface BloqueAnclado {
  bloque: Bloque;
  from: number;
  to: number;
}

/**
 * Bloques referenciados con su rango, en orden de documento (no en el del
 * cliente) y **sin anidados**: si el cliente manda una tabla y además una de
 * sus celdas, la celda ya está dentro del rango de la tabla y contarla otra
 * vez duplicaría su texto en la reconstrucción.
 */
function bloquesEnOrden(documento: Documento, ids: string[]): BloqueAnclado[] {
  const buscados = new Set(ids);
  const encontrados: BloqueAnclado[] = [];
  function caminar(hijos: Nodo[], inicio: number): void {
    let pos = inicio;
    for (const hijo of hijos) {
      const tamano = tamanoNodo(hijo);
      if (!esTexto(hijo)) {
        if (buscados.has(hijo.attrs.id)) {
          // Hoja de bloque (`horizontalRule`): rango vacío, texto `" "`.
          encontrados.push({ bloque: hijo, from: pos + 1, to: pos + Math.max(tamano - 1, 1) });
        } else {
          caminar(hijosDe(hijo), pos + 1);
        }
      }
      pos += tamano;
    }
  }
  caminar(documento.content as Nodo[], 0);
  return encontrados;
}

/**
 * Texto que un bloque aporta a `textBetween` cuando está entero dentro de la
 * selección. Para un bloque de texto es su texto; para un contenedor, sus
 * bloques de texto unidos por `"\n"`; para `horizontalRule`, su `leafText`.
 */
function textoAnclado(documento: Documento, anclado: BloqueAnclado): string {
  if (anclado.bloque.type === "horizontalRule") return " ";
  return textoEntre(documento, anclado.from, anclado.to);
}

export function verificarSeleccion(documento: Documento, seleccion: SeleccionEntrada): VerificacionSeleccion {
  const indice = indexarBloques(documento);
  if (seleccion.block_ids.some((id) => !indice.has(id))) {
    return { estado: "indeterminada", motivo: "bloques_ausentes" };
  }

  // 1. Camino normal: una sola reconstrucción con las posiciones del cliente.
  if (hashTexto(textoEntre(documento, seleccion.from, seleccion.to)) === seleccion.texto_hash) {
    return { estado: "verificada", via: "posiciones" };
  }

  // 2. Enumeración anclada: la salida de `textBetween` siempre es
  //    `sufijo(primero) + "\n" + intermedios + "\n" + prefijo(último)`, y cada
  //    bloque aporta su texto con la MISMA semántica, contenedores incluidos.
  const bloques = bloquesEnOrden(documento, seleccion.block_ids);
  if (bloques.length === 0) return { estado: "indeterminada", motivo: "bloques_ausentes" };

  const textos = bloques.map((b) => textoAnclado(documento, b));
  const primero = textos[0];
  const ultimo = textos[textos.length - 1];

  if (textos.length === 1) {
    const n = primero.length;
    const candidatos = ((n + 1) * (n + 2)) / 2;
    if (candidatos > MAX_CANDIDATOS || (candidatos * n) / 3 > MAX_BYTES) {
      return { estado: "indeterminada", motivo: "presupuesto" };
    }
    for (let i = 0; i <= n; i++) {
      for (let j = i; j <= n; j++) {
        if (hashTexto(primero.slice(i, j)) === seleccion.texto_hash) return { estado: "verificada", via: "anclas" };
      }
    }
    return { estado: "desplazada" };
  }

  const medio = textos.slice(1, -1).join("\n");
  const candidatos = (primero.length + 1) * (ultimo.length + 1);
  const bytes = candidatos * (primero.length + medio.length + ultimo.length + 2);
  if (candidatos > MAX_CANDIDATOS || bytes > MAX_BYTES) {
    return { estado: "indeterminada", motivo: "presupuesto" };
  }
  const centro = medio.length > 0 ? `\n${medio}\n` : "\n";
  for (let i = 0; i <= primero.length; i++) {
    const cabeza = primero.slice(i) + centro;
    for (let j = 0; j <= ultimo.length; j++) {
      if (hashTexto(cabeza + ultimo.slice(0, j)) === seleccion.texto_hash) return { estado: "verificada", via: "anclas" };
    }
  }
  return { estado: "desplazada" };
}
