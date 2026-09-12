import { clonar, esBloqueContenedor, hashBloque, hashDocumento, normalizarDocumento } from "./documento";
import type { Bloque, Documento, Patch } from "./tipos";

/**
 * Aplicación determinista de `editor.patch` sobre el documento canónico.
 *
 * Control optimista a dos niveles (07 §4 paso 3 y 5):
 * - `version_base` lo verifica el BFF antes de llamar aquí;
 * - `before_hash` lo verifica cada operación: si el bloque cambió desde que se
 *   generó la propuesta, NO se aplica nada y se devuelve conflicto. Nunca se
 *   aplica un patch "a medias".
 */

export type MotivoConflicto = "bloque_no_encontrado" | "hash_distinto" | "patch_vacio" | "bloque_protegido";

export type ResultadoPatch =
  | { ok: true; documento: Documento }
  | { ok: false; motivo: MotivoConflicto; block_id?: string };

interface Ubicacion {
  lista: Bloque[];
  indice: number;
}

function ubicar(bloques: Bloque[], blockId: string): Ubicacion | null {
  for (let i = 0; i < bloques.length; i += 1) {
    const bloque = bloques[i];
    if (bloque.attrs.id === blockId) return { lista: bloques, indice: i };
    if (esBloqueContenedor(bloque)) {
      const anidado = ubicar(bloque.content, blockId);
      if (anidado) return anidado;
    }
  }
  return null;
}

export interface OpcionesPatch {
  /** Ids de bloques que no pueden eliminarse (encabezados de secciones protegidas). */
  protegidos?: ReadonlySet<string>;
}

export function aplicarPatch(documento: Documento, patches: Patch[], opciones: OpcionesPatch = {}): ResultadoPatch {
  if (patches.length === 0) return { ok: false, motivo: "patch_vacio" };
  const protegidos = opciones.protegidos ?? new Set<string>();
  let actual = clonar(documento);

  for (const patch of patches) {
    if (patch.op === "replace_document") {
      if (hashDocumento(actual) !== patch.before_hash) return { ok: false, motivo: "hash_distinto" };
      actual = normalizarDocumento(patch.after);
      continue;
    }

    const ubicacion = ubicar(actual.content, patch.block_id);
    if (!ubicacion) return { ok: false, motivo: "bloque_no_encontrado", block_id: patch.block_id };
    const objetivo = ubicacion.lista[ubicacion.indice];
    if (hashBloque(objetivo) !== patch.before_hash) {
      return { ok: false, motivo: "hash_distinto", block_id: patch.block_id };
    }

    if (patch.op === "remove_block") {
      if (protegidos.has(patch.block_id)) return { ok: false, motivo: "bloque_protegido", block_id: patch.block_id };
      ubicacion.lista.splice(ubicacion.indice, 1);
      continue;
    }
    if (patch.op === "replace_block") {
      ubicacion.lista.splice(ubicacion.indice, 1, clonar(patch.after));
      continue;
    }
    // insert_after
    ubicacion.lista.splice(ubicacion.indice + 1, 0, clonar(patch.after));
  }

  // Renormalizar: garantiza ids únicos y forma válida tras insertar bloques nuevos.
  return { ok: true, documento: normalizarDocumento(actual) };
}
