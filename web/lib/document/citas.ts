import { esBloqueContenedor, esBloqueTexto } from "./documento";
import type { Bloque, Documento } from "./tipos";

/**
 * Citas del expediente.
 *
 * `common.referencia` de los contratos es
 * `^(CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR):[^\s]+$` — siete prefijos, y el ID
 * NO es necesariamente un uuid (`CADENA:paso-3`, `PAR:RFC1|RFC2`). Por eso
 * este parser no reutiliza el de `lib/expediente/citas.ts` (vista de solo
 * lectura de forense-webapp), que solo acepta `[0-9a-fA-F-]+` y perdería
 * silenciosamente las referencias no-uuid.
 *
 * Dentro del texto la cita se delimita con corchetes, así que el ID no puede
 * contener `]` aunque el contrato lo permitiría en abstracto.
 *
 * 09 §8: si un ID citado no existe en `evidencia` VALIDADA se marca en rojo.
 * Es validación del lado de la UI, independiente del backend, y el estado
 * "revisar citas" bloquea la publicación final, nunca el borrador (15 §10).
 */

export const PREFIJOS_REFERENCIA = ["CFDI", "MOV", "ATR", "LISTA", "CICLO", "CADENA", "PAR"] as const;

const RE_CITA = /\[((?:CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR):[^\s\]]+)\]/g;

export interface SegmentoTexto {
  tipo: "texto";
  texto: string;
}

export interface SegmentoCita {
  tipo: "cita";
  referencia: string;
  valida: boolean;
}

export type Segmento = SegmentoTexto | SegmentoCita;

/** Referencias citadas en una cadena, en orden de aparición (con repeticiones). */
export function extraerCitas(texto: string): string[] {
  return [...texto.matchAll(RE_CITA)].map((m) => m[1]);
}

/** Parte un texto en segmentos planos y citas, marcando cada cita contra la evidencia validada. */
export function segmentarCitas(texto: string, validadas: ReadonlySet<string>): Segmento[] {
  const segmentos: Segmento[] = [];
  let cursor = 0;
  for (const match of texto.matchAll(RE_CITA)) {
    const indice = match.index ?? 0;
    if (indice > cursor) segmentos.push({ tipo: "texto", texto: texto.slice(cursor, indice) });
    segmentos.push({ tipo: "cita", referencia: match[1], valida: validadas.has(match[1]) });
    cursor = indice + match[0].length;
  }
  if (cursor < texto.length) segmentos.push({ tipo: "texto", texto: texto.slice(cursor) });
  return segmentos;
}

function citasDeBloque(bloque: Bloque, acumulador: string[]): void {
  if (esBloqueTexto(bloque)) {
    for (const nodo of bloque.content) acumulador.push(...extraerCitas(nodo.text));
    return;
  }
  if (esBloqueContenedor(bloque)) {
    for (const hijo of bloque.content) citasDeBloque(hijo, acumulador);
  }
}

/** Referencias únicas del documento, en orden de aparición. */
export function citasDeDocumento(documento: Documento): string[] {
  const todas: string[] = [];
  for (const bloque of documento.content) citasDeBloque(bloque, todas);
  return [...new Set(todas)];
}

export interface EstadoCitas {
  total: number;
  validas: string[];
  invalidas: string[];
  /** 15 §10 / 09 §8: hay citas sin evidencia validada → bloquea publicación, no el borrador. */
  revisarCitas: boolean;
}

export function estadoCitas(documento: Documento, validadas: ReadonlySet<string>): EstadoCitas {
  const referencias = citasDeDocumento(documento);
  const validas = referencias.filter((r) => validadas.has(r));
  const invalidas = referencias.filter((r) => !validadas.has(r));
  return { total: referencias.length, validas, invalidas, revisarCitas: invalidas.length > 0 };
}

/** Referencias citadas en un Markdown derivado (para comprobar que la exportación las conserva). */
export function citasDeMarkdown(markdown: string): string[] {
  return [...new Set(extraerCitas(markdown))];
}
