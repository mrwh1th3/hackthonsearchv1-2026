import { esBloqueTexto, textoDeBloque } from "./documento";
import type { Documento } from "./tipos";

/**
 * Catálogo canónico de secciones del expediente.
 *
 * Ocho secciones fijas del Redactor (08 §Redactor) **más** las dos que 21 §4
 * y `n8n/prompts/redactor.md` hacen obligatorias: "Trayectoria" (9) y "Cadena
 * de explicación" (10). El Editor puede reescribir esas dos, pero no
 * eliminarlas ni alterar sus citas (21 §4), igual que "Análisis del Defensor"
 * (08: "esta sección NO se omite").
 *
 * El índice se DERIVA de los encabezados reales del documento; si una sección
 * del catálogo no está en el documento se muestra como `ausente` (deshabilitada,
 * con el motivo) y NUNCA se inserta vacía: inventar la Trayectoria o la Cadena
 * sería el editor fabricando contenido que no le pertenece. El fixture actual
 * (`contracts/fixtures/valid/documento.json`, `redactor.json`) solo trae las 8
 * primeras: ver `solicitudes_coordinador`.
 */

export interface SeccionCatalogo {
  orden: number;
  clave: string;
  titulo: string;
  /** No puede eliminarse desde el editor (08 §Redactor, 21 §4). */
  protegida: boolean;
  alias: string[];
}

export const CATALOGO_SECCIONES: readonly SeccionCatalogo[] = [
  { orden: 1, clave: "resumen", titulo: "Summary", protegida: false, alias: ["resumen"] },
  { orden: 2, clave: "contribuyente", titulo: "Taxpayer", protegida: false, alias: ["contribuyente"] },
  { orden: 3, clave: "hipotesis", titulo: "Hypothesis", protegida: false, alias: ["hipotesis"] },
  { orden: 4, clave: "pistas", titulo: "Checks", protegida: false, alias: ["pistas"] },
  { orden: 5, clave: "evidencia", titulo: "Evidence", protegida: false, alias: ["evidencia"] },
  {
    orden: 6,
    clave: "defensor",
    titulo: "Alternative explanations",
    protegida: true,
    alias: ["analisis del defensor", "defensor"],
  },
  { orden: 7, clave: "dictamen", titulo: "Conclusion", protegida: false, alias: ["dictamen"] },
  { orden: 8, clave: "anexo", titulo: "Appendix", protegida: false, alias: ["anexo"] },
  { orden: 9, clave: "trayectoria", titulo: "Timeline", protegida: true, alias: ["trayectoria"] },
  {
    orden: 10,
    clave: "cadena",
    titulo: "Evidence chain",
    protegida: true,
    alias: ["cadena de explicacion", "cadena de explicación"],
  },
];

/** Normaliza un encabezado: sin numeración, sin acentos, minúsculas. */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\s*\d+[.)]?\s*/, "")
    .replace(/[*_`#]/g, "")
    .trim()
    .toLowerCase();
}

export interface EntradaIndice {
  clave: string;
  titulo: string;
  /** Título tal como aparece en el documento (si está presente). */
  tituloDocumento?: string;
  blockId?: string;
  nivel: number;
  estado: "presente" | "ausente" | "adicional";
  protegida: boolean;
  motivoAusencia?: string;
}

interface EncabezadoDocumento {
  blockId: string;
  titulo: string;
  nivel: number;
}

function encabezados(documento: Documento): EncabezadoDocumento[] {
  const salida: EncabezadoDocumento[] = [];
  for (const bloque of documento.content) {
    if (bloque.type !== "heading" || !esBloqueTexto(bloque)) continue;
    salida.push({ blockId: bloque.attrs.id, titulo: textoDeBloque(bloque), nivel: bloque.attrs.level ?? 2 });
  }
  return salida;
}

/**
 * Índice plegable del documento (15 §10): las secciones del catálogo en su
 * orden canónico, marcando las ausentes, más los encabezados adicionales que
 * el documento traiga (por ejemplo un título general del expediente).
 */
export function construirIndice(documento: Documento): EntradaIndice[] {
  const cabeceras = encabezados(documento);
  const usados = new Set<string>();
  const entradas: EntradaIndice[] = [];

  for (const seccion of CATALOGO_SECCIONES) {
    const encontrado = cabeceras.find((h) => {
      if (usados.has(h.blockId)) return false;
      const normalizado = normalizarTitulo(h.titulo);
      return [seccion.titulo, ...seccion.alias].some((a) => normalizado === normalizarTitulo(a));
    });
    if (encontrado) {
      usados.add(encontrado.blockId);
      entradas.push({
        clave: seccion.clave,
        titulo: seccion.titulo,
        tituloDocumento: encontrado.titulo,
        blockId: encontrado.blockId,
        nivel: encontrado.nivel,
        estado: "presente",
        protegida: seccion.protegida,
      });
    } else {
      entradas.push({
        clave: seccion.clave,
        titulo: seccion.titulo,
        nivel: 2,
        estado: "ausente",
        protegida: seccion.protegida,
        motivoAusencia: "This section is not included in the loaded report.",
      });
    }
  }

  for (const h of cabeceras) {
    if (usados.has(h.blockId)) continue;
    entradas.push({
      clave: `extra:${h.blockId}`,
      titulo: h.titulo,
      tituloDocumento: h.titulo,
      blockId: h.blockId,
      nivel: h.nivel,
      estado: "adicional",
      protegida: false,
    });
  }

  return entradas;
}

/** Claves de sección protegidas cuyos encabezados el editor no debe borrar. */
export function bloquesProtegidos(documento: Documento): Set<string> {
  const protegidos = new Set<string>();
  for (const entrada of construirIndice(documento)) {
    if (entrada.estado === "presente" && entrada.protegida && entrada.blockId) protegidos.add(entrada.blockId);
  }
  return protegidos;
}
