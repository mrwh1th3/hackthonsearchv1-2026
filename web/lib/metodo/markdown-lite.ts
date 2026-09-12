/**
 * Renderizador de markdown mínimo para `/metodo` (21 §2: "estática, sin
 * backend"). No se agrega una librería de markdown solo para leer un
 * archivo: soporta encabezados `#`/`##`, tablas con pipes y párrafos, que
 * es exactamente lo que usa `reports/handoff/DECISIONES.md`.
 */
export type BloqueMd =
  | { tipo: "encabezado"; nivel: 1 | 2 | 3; texto: string }
  | { tipo: "tabla"; encabezados: string[]; filas: string[][] }
  | { tipo: "parrafo"; texto: string };

function partirFila(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function esSeparadorTabla(linea: string): boolean {
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(linea.trim());
}

export function parsearMarkdownLite(md: string): BloqueMd[] {
  const lineas = md.replace(/\r\n/g, "\n").split("\n");
  const bloques: BloqueMd[] = [];
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i];

    if (linea.trim() === "") {
      i++;
      continue;
    }

    const encabezado = /^(#{1,3})\s+(.*)$/.exec(linea);
    if (encabezado) {
      bloques.push({ tipo: "encabezado", nivel: encabezado[1].length as 1 | 2 | 3, texto: encabezado[2].trim() });
      i++;
      continue;
    }

    if (linea.trim().startsWith("|") && i + 1 < lineas.length && esSeparadorTabla(lineas[i + 1])) {
      const encabezados = partirFila(linea);
      i += 2;
      const filas: string[][] = [];
      while (i < lineas.length && lineas[i].trim().startsWith("|")) {
        filas.push(partirFila(lineas[i]));
        i++;
      }
      bloques.push({ tipo: "tabla", encabezados, filas });
      continue;
    }

    // Párrafo: junta líneas hasta el siguiente separador en blanco.
    const partes: string[] = [linea];
    i++;
    while (i < lineas.length && lineas[i].trim() !== "" && !/^#{1,3}\s/.test(lineas[i]) && !lineas[i].trim().startsWith("|")) {
      partes.push(lineas[i]);
      i++;
    }
    bloques.push({ tipo: "parrafo", texto: partes.join(" ").trim() });
  }

  return bloques;
}

export interface SegmentoInline {
  texto: string;
  negrita?: boolean;
  codigo?: boolean;
}

/** Formato inline mínimo: `**negrita**` y `` `código` ``. */
export function partirInline(texto: string): SegmentoInline[] {
  const segmentos: SegmentoInline[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let ultimo = 0;
  for (const m of texto.matchAll(re)) {
    const indice = m.index ?? 0;
    if (indice > ultimo) segmentos.push({ texto: texto.slice(ultimo, indice) });
    if (m[1] !== undefined) segmentos.push({ texto: m[1], negrita: true });
    else if (m[2] !== undefined) segmentos.push({ texto: m[2], codigo: true });
    ultimo = indice + m[0].length;
  }
  if (ultimo < texto.length) segmentos.push({ texto: texto.slice(ultimo) });
  return segmentos;
}
