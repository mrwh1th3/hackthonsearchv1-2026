import type { AuditorHallazgo, AuditorLead, CasoDetalle } from "@/lib/data/source";
import type { ContrasteCaso, TrayectoriaPunto } from "@/lib/data/types";
import type { CadenaExplicacion } from "@/lib/analisis/cadena-explicacion";
import { desdeMarkdown } from "@/lib/document/markdown";
import type { Documento } from "@/lib/document/tipos";

/**
 * Documento base determinista del expediente (feedback 2026-09-12: "que
 * toda esta info... esté... dentro de cada caso" también aplica al
 * documento del editor — es "la base mínima para el doc de reporte
 * completo"). Se usa en dos casos:
 *
 * 1. No hay `redactor.markdown` persistido todavía: `generarMarkdownBase`
 *    construye las nueve secciones desde los datos ya persistidos
 *    (`CasoDetalle` + lo que emparejó `lib/analisis/emparejar-auditor.ts`).
 * 2. Sí hay Markdown del Redactor pero le faltan secciones: `completarMarkdown`
 *    anexa solo las que faltan, SIN tocar una letra de lo existente.
 *
 * Módulo puro, sin JSX ni fetch: vive en `lib/expediente/` (no en
 * `lib/document/`, reservado al editor — ownership del corte) a propósito,
 * para no tocar `cargarCasoEditor`/`servidor.ts` ni `app/api/reportes/*`.
 * Sólo IMPORTA de `lib/document` lo público y de sólo lectura (`desdeMarkdown`,
 * los tipos). Hoy se usa para el render de sólo-lectura de `/documentos/[id]`
 * cuando no hay una versión persistida por el editor; que esta base entre
 * también al flujo de `cargarCasoEditor` (para que Guardar/Aplicar la
 * versionen) es un cambio en territorio del editor — pedirlo al coordinador,
 * no aplicarlo aquí. Regla 11 sigue intacta: esto nunca versiona nada, sólo
 * decide qué Markdown se lee cuando no existe una versión editada.
 *
 * CLAUDE.md regla 7: nunca "definitivo" como nivel — un caso sin `nivel`
 * (`en_cola`/`ronda*`) se describe como "investigación en curso", nunca se
 * inventa un nivel. Regla 6: cualquier texto `_untrusted` que se cite aquí
 * se marca explícitamente como tal, nunca se usa para fundamentar un
 * veredicto.
 *
 * Las citas usan el mismo formato que valida el cita-drawer
 * (`lib/document/citas.ts`, `[CFDI|MOV|ATR|LISTA|CICLO|CADENA|PAR:id]`): los
 * exhibits del auditor (`EX-01`) NO son citables tal cual — se traduce al
 * `ref_id` real (`source_table:record_id` en `forense.evidencia`), el mismo
 * que ya validó `detalle.evidencia`.
 */

const PREFIJO_TABLA: Record<string, string> = {
  invoices: "CFDI",
  bank_txns: "MOV",
  vendors: "ATR",
  efos_list: "LISTA",
  ledger: "ATR",
  purchase_orders: "ATR",
  contracts: "ATR",
  employees: "ATR",
};

function referenciaExhibit(sourceTable: string, recordId: string): string {
  const prefijo = PREFIJO_TABLA[sourceTable] ?? "ATR";
  return `${prefijo}:${recordId}`;
}

export const SECCIONES_BASE = [
  "Summary / hypothesis",
  "Confidence & conclusion",
  "Finding & money trail",
  "Cited evidence",
  "Alternative explanations & dismissals",
  "Timeline",
  "Evidence chain",
  "Challenge",
  "AI investigators",
] as const;

export type SeccionBase = (typeof SECCIONES_BASE)[number];

/**
 * `loaders/auditor_to_investigaciones.py::markdown_hallazgo` (única fuente
 * real de Markdown "de fábrica" para un caso `origen='auditor'`) usa sus
 * propios headings — `## Resumen`, `## Contribuyente`, `## Hipótesis`,
 * `## Evidencia`, `## Análisis del Defensor`, `## Dictamen`, `## Trayectoria`
 * (ahí es la tabla del money trail, no el `v_trayectoria_rfc` por periodo) —
 * que no coinciden en texto con las nueve de `SECCIONES_BASE` aunque cubran
 * lo mismo. Sin este alias, `completarMarkdown` anexaría un "Resumen/hipótesis"
 * o un "Nivel y dictamen" duplicado a CADA caso que ya trae su Markdown del
 * loader. `Contraste` y `Agentes IA` no tienen equivalente ahí: si faltan,
 * SÍ deben anexarse — ese es el hueco real.
 */
const ALIAS_SECCION: Record<SeccionBase, string[]> = {
  "Summary / hypothesis": ["resumen", "hipotesis", "contribuyente"],
  "Confidence & conclusion": ["dictamen", "nivel"],
  "Finding & money trail": ["hallazgo"],
  "Cited evidence": ["evidencia"],
  "Alternative explanations & dismissals": ["defensor", "defensa"],
  Timeline: ["trayectoria"],
  "Evidence chain": ["cadena de explicacion"],
  Challenge: [],
  "AI investigators": [],
};

export interface EntradaDocumentoBase {
  detalle: CasoDetalle;
  hallazgo: AuditorHallazgo | null;
  leads: AuditorLead[];
  contraste: ContrasteCaso | null;
  trayectoria: TrayectoriaPunto[];
  cadena: CadenaExplicacion | null;
  /** Agentes distintos que dejaron rastro en la bitácora de este caso (regla 2: sólo lo persistido). */
  agentesBitacora: string[];
}

function normalizarTitulo(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function seccionResumen({ detalle }: EntradaDocumentoBase): string {
  const c = detalle.caso;
  const tipologia = c.tipologia ? `Pattern: ${c.tipologia}.` : "";
  return [
    `RFC principal ${c.rfc_principal}${(c.rfcs_satelite ?? []).length > 0 ? ` (related entities: ${c.rfcs_satelite.join(", ")})` : ""}.`,
    `Amount at risk: ${c.moneda} ${Number(c.monto_en_riesgo).toLocaleString("es-MX")}. ${tipologia}`.trim(),
  ].join("\n\n");
}

function seccionNivel({ detalle }: EntradaDocumentoBase): string {
  const c = detalle.caso;
  const d = detalle.dictamen;
  // Regla 7: nunca "definitivo". Sin nivel todavía, se dice "en curso", no se rellena con un valor inventado.
  const nivel = c.nivel ?? "in progress (no conclusion yet)";
  const partes = [`Nivel: **${nivel}**.`];
  if (d) partes.push(`Regla aplicada: ${d.regla}.`, `Familias: ${d.familias.join(", ") || "—"}.`);
  if (d && d.limitaciones.length > 0) partes.push(`Limitaciones: ${d.limitaciones.map((l) => JSON.stringify(l)).join("; ")}.`);
  return partes.join("\n\n");
}

function seccionHallazgo({ hallazgo }: EntradaDocumentoBase): string {
  if (!hallazgo) return "No rule-engine finding is linked to this case.";
  const trail = hallazgo.money_trail
    .map((p) => `- ${p.from} → ${p.to}: ${p.amount.toLocaleString("es-MX")} el ${p.date} [${referenciaExhibitDesdeExhibit(hallazgo, p.exhibit_id)}]`)
    .join("\n");
  return [`${hallazgo.rule_broken}`, hallazgo.narrative, trail.length > 0 ? `Ruta del dinero:\n${trail}` : ""].filter(Boolean).join("\n\n");
}

function referenciaExhibitDesdeExhibit(hallazgo: AuditorHallazgo, exhibitId: string): string {
  const x = hallazgo.exhibits.find((e) => e.exhibit_id === exhibitId);
  return x ? referenciaExhibit(x.source_table, x.record_id) : exhibitId;
}

function seccionEvidencia({ detalle, hallazgo }: EntradaDocumentoBase): string {
  const lineas: string[] = [];
  for (const e of detalle.evidencia) {
    for (const ref of e.referencias) lineas.push(`- [${ref}] ${e.tipo} · ${e.validada ? "validada" : "unverified"}`);
  }
  if (hallazgo) {
    for (const x of hallazgo.exhibits) lineas.push(`- [${referenciaExhibit(x.source_table, x.record_id)}] ${x.note}`);
  }
  return lineas.length > 0 ? [...new Set(lineas)].join("\n") : "No citable evidence has been saved for this case yet.";
}

function seccionDefensa({ detalle, hallazgo }: EntradaDocumentoBase): string {
  const lineas: string[] = [];
  for (const a of detalle.defensa) lineas.push(`- (${a.resultado}) ${a.argumento}`);
  if (hallazgo) {
    for (const d of hallazgo.defense) {
      lineas.push(`- (${d.held ? "se sostiene" : "no se sostiene"}) ${d.argument} — ${d.why}`);
    }
  }
  return lineas.length > 0 ? lineas.join("\n") : "No alternative explanations have been saved for this case.";
}

function seccionTrayectoria({ trayectoria }: EntradaDocumentoBase): string {
  if (trayectoria.length === 0) return "No timeline has been saved for this tax ID.";
  return trayectoria
    .map((p) => `- ${p.periodo}: emitido ${p.monto_emitido} · recibido ${p.monto_recibido}${p.eventos.length > 0 ? ` · eventos: ${p.eventos.join(", ")}` : ""}`)
    .join("\n");
}

function seccionCadena({ cadena }: EntradaDocumentoBase): string {
  if (!cadena) return "No evidence chain is available for this case.";
  return cadena.eslabones
    .map((e) => `- (${e.tipo}) ${e.texto}${e.referencias.length > 0 ? ` [${e.referencias.join(", ")}]` : ""}`)
    .join("\n");
}

function seccionContraste({ contraste }: EntradaDocumentoBase): string {
  if (!contraste) return "No comparison with a dismissed case has been saved yet.";
  return [
    `Comparable: ${contraste.rfc_comparable} (giro compartido: ${contraste.giro_compartido}).`,
    `Comparison result: ${contraste.resultado_comparable}. Reason: ${contraste.razon_tipificada}.`,
    contraste.explicacion,
  ].join("\n\n");
}

function seccionAgentes({ agentesBitacora }: EntradaDocumentoBase): string {
  if (agentesBitacora.length === 0) return "No investigator activity has been saved for this case.";
  return agentesBitacora.map((a) => `- ${a}`).join("\n");
}

const CONTENIDO_SECCION: Record<SeccionBase, (input: EntradaDocumentoBase) => string> = {
  "Summary / hypothesis": seccionResumen,
  "Confidence & conclusion": seccionNivel,
  "Finding & money trail": seccionHallazgo,
  "Cited evidence": seccionEvidencia,
  "Alternative explanations & dismissals": seccionDefensa,
  Timeline: seccionTrayectoria,
  "Evidence chain": seccionCadena,
  Challenge: seccionContraste,
  "AI investigators": seccionAgentes,
};

/** Markdown de UNA sección (heading `##` + cuerpo), determinista sobre el mismo `input`. */
export function markdownDeSeccion(titulo: SeccionBase, input: EntradaDocumentoBase): string {
  return `## ${titulo}\n\n${CONTENIDO_SECCION[titulo](input)}`;
}

/** Documento base completo: las nueve secciones, en orden fijo, desde datos persistidos. */
export function generarMarkdownBase(input: EntradaDocumentoBase): string {
  const titulo = `# Expediente ${input.detalle.caso.rfc_principal}`;
  return [titulo, ...SECCIONES_BASE.map((s) => markdownDeSeccion(s, input))].join("\n\n");
}

/** `true` si el Markdown existente ya trae una sección con ese título (heading, cualquier nivel). */
export function tieneSeccion(markdown: string, titulo: string): boolean {
  const objetivo = normalizarTitulo(titulo);
  return markdown
    .split("\n")
    .filter((l) => /^#{1,6}\s+/.test(l.trim()))
    .some((l) => normalizarTitulo(l.replace(/^#{1,6}\s+/, "")).includes(objetivo));
}

/**
 * `true` si el Markdown existente ya cubre esta sección, por título exacto o
 * por alguno de sus alias conocidos (`ALIAS_SECCION`, headings reales que
 * escribe `markdown_hallazgo`). Evita anexar un "Nivel y dictamen" duplicado
 * a un caso que ya trae su propio `## Dictamen`.
 */
export function seccionCubierta(markdown: string, seccion: SeccionBase): boolean {
  if (tieneSeccion(markdown, seccion)) return true;
  return ALIAS_SECCION[seccion].some((alias) => tieneSeccion(markdown, alias));
}

/**
 * Anexa al Markdown existente (el del Redactor) las secciones de la base
 * mínima que le falten, sin tocar ni reordenar lo que ya está. Si no falta
 * ninguna, devuelve el Markdown intacto (mismo string, no una copia distinta).
 */
export function completarMarkdown(markdownExistente: string, input: EntradaDocumentoBase): string {
  const faltantes = SECCIONES_BASE.filter((s) => !seccionCubierta(markdownExistente, s));
  if (faltantes.length === 0) return markdownExistente;
  const anexo = faltantes.map((s) => markdownDeSeccion(s, input)).join("\n\n");
  return `${markdownExistente.trimEnd()}\n\n${anexo}`;
}

/** Markdown final a mostrar: completa el del Redactor si existe, o genera la base desde cero. */
export function markdownParaCaso(input: EntradaDocumentoBase & { markdownExistente?: string | null }): string {
  return input.markdownExistente ? completarMarkdown(input.markdownExistente, input) : generarMarkdownBase(input);
}

/**
 * Documento canónico (para render/editor) a partir del Markdown del Redactor
 * completado con lo que le falte, o de la base generada desde cero cuando no
 * hay Markdown persistido todavía. `markdownExistente` es opcional: sin él,
 * equivale a `generarMarkdownBase` + `desdeMarkdown`.
 */
export function generarDocumentoBase(input: EntradaDocumentoBase & { markdownExistente?: string | null }): Documento {
  return desdeMarkdown(markdownParaCaso(input));
}
