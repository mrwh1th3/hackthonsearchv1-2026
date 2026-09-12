/**
 * 09 §8: cada cita `[CFDI:uuid]` del expediente se marca en rojo si el ID
 * citado no existe en evidencia VALIDADA — validación del lado de la UI,
 * independiente del backend. Esta capa es de lectura (render de solo
 * lectura del documento fixture, propiedad de forense-webapp); el modelo
 * de documento TipTap editable vive en `web/lib/document` (forense-editor).
 */

export interface SegmentoTexto {
  tipo: "texto";
  texto: string;
}
export interface SegmentoCita {
  tipo: "cita";
  cruda: string; // p.ej. "CFDI:00000000-..."
  valida: boolean;
}
export type Segmento = SegmentoTexto | SegmentoCita;

const CITA_RE = /\[([A-Z]+:[0-9a-fA-F-]+)\]/g;

/** Parte un bloque de texto en segmentos de texto plano y citas `[TIPO:uuid]`. */
export function partirEnCitas(texto: string, referenciasValidadas: ReadonlySet<string>): Segmento[] {
  const segmentos: Segmento[] = [];
  let ultimoIndice = 0;
  for (const match of texto.matchAll(CITA_RE)) {
    const [cruda_completa, cruda] = match;
    const indice = match.index ?? 0;
    if (indice > ultimoIndice) segmentos.push({ tipo: "texto", texto: texto.slice(ultimoIndice, indice) });
    segmentos.push({ tipo: "cita", cruda, valida: referenciasValidadas.has(cruda) });
    ultimoIndice = indice + cruda_completa.length;
  }
  if (ultimoIndice < texto.length) segmentos.push({ tipo: "texto", texto: texto.slice(ultimoIndice) });
  return segmentos;
}

export interface SeccionDocumento {
  titulo: string;
  cuerpo: string;
}

/** Divide el markdown fixture en sus secciones `## N. Título` (documento de 8 secciones fijas, 09 §8). */
export function dividirEnSecciones(markdown: string): SeccionDocumento[] {
  const partes = markdown.split(/^##\s+/m).filter(Boolean);
  return partes.map((parte) => {
    const salto = parte.indexOf("\n");
    if (salto === -1) return { titulo: parte.trim(), cuerpo: "" };
    return { titulo: parte.slice(0, salto).trim(), cuerpo: parte.slice(salto + 1).trim() };
  });
}
