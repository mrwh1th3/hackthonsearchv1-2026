import { describe, expect, it } from "vitest";
import { SECCIONES_BASE, completarMarkdown, generarDocumentoBase, generarMarkdownBase, seccionCubierta, tieneSeccion, type EntradaDocumentoBase } from "./documento-base";
import { citasDeDocumento, citasDeMarkdown } from "@/lib/document/citas";
import type { CasoDetalle } from "@/lib/data/source";

function detalle(): CasoDetalle {
  return {
    caso: {
      id: "caso-1",
      corrida_id: "corrida-1",
      cluster_id: "cl-1",
      rfc_principal: "RFC000101ABC",
      rfcs_satelite: [],
      estado: "dictaminado",
      nivel: "presuncion_alta",
      tipologia: "efos_sin_sustancia",
      origen: "auditor",
      origen_valor: "phantom_vendor",
      familias_confirmadas: [],
      monto_en_riesgo: "150000",
      moneda: "MXN",
      cobertura_completa: true,
      n_reintentos: 0,
      presupuesto_agotado: false,
      creado: "2026-01-01T00:00:00Z",
      terminado: "2026-01-02T00:00:00Z",
    },
    tareas: [],
    senales: [],
    pistas: [],
    evidencia: [
      {
        id: "ev-1",
        caso_id: "caso-1",
        pista_id: "p-1",
        pista_codigo: "monto_atipico" as never,
        familia: "montos" as never,
        tipo: "invoices",
        ref_id: "CFDI:00000000-0000-4000-8000-000000000901",
        rfcs_afectados: ["RFC000101ABC"],
        referencias: ["CFDI:00000000-0000-4000-8000-000000000901"],
        valida_tecnica: true,
        refutada: false,
        validada: true,
        hecho_validado: {},
      },
    ],
    defensa: [{ trampa_codigo: "t1", pista_objetivo: "p-1", evidencia_objetivo_ids: ["ev-1"], argumento: "el proveedor sí opera", ids: ["ev-1"], resultado: "no_refuta" }],
    replica: null,
    dictamen: { nivel: "presuncion_alta", familias: ["montos" as never], monto_en_riesgo_centavos: "15000000", moneda: "MXN", regla: "regla-1", limitaciones: [] },
    redactor: null,
  };
}

function entrada(overrides: Partial<EntradaDocumentoBase> = {}): EntradaDocumentoBase {
  return {
    detalle: detalle(),
    hallazgo: null,
    leads: [],
    contraste: null,
    trayectoria: [],
    cadena: null,
    agentesBitacora: [],
    ...overrides,
  };
}

describe("generarMarkdownBase", () => {
  it("incluye las nueve secciones mínimas, en orden, con datos reales (no inventados)", () => {
    const md = generarMarkdownBase(entrada());
    for (const s of SECCIONES_BASE) {
      expect(md).toContain(`## ${s}`);
    }
    expect(md).toContain("RFC000101ABC");
    expect(md).toContain("presuncion_alta");
    // regla 7: nunca "definitivo"
    expect(md.toLowerCase()).not.toContain("definitivo");
  });

  it("un caso sin nivel dice 'en curso', nunca inventa un nivel", () => {
    const d = detalle();
    d.caso.nivel = null;
    d.dictamen = null;
    const md = generarMarkdownBase(entrada({ detalle: d }));
    expect(md).toContain("in progress");
  });

  it("cita evidencia con IDs reales que el cita-drawer puede validar", () => {
    const md = generarMarkdownBase(entrada());
    const citas = citasDeMarkdown(md);
    expect(citas).toContain("CFDI:00000000-0000-4000-8000-000000000901");
  });

  it("el documento canónico generado desde el markdown conserva las mismas citas", () => {
    const documento = generarDocumentoBase(entrada());
    const citas = citasDeDocumento(documento);
    expect(citas).toContain("CFDI:00000000-0000-4000-8000-000000000901");
  });

  it("es determinista: mismo input, mismo markdown byte a byte", () => {
    const a = generarMarkdownBase(entrada());
    const b = generarMarkdownBase(entrada());
    expect(a).toBe(b);
  });
});

describe("tieneSeccion / completarMarkdown", () => {
  it("detecta una sección existente sin importar el nivel del heading", () => {
    expect(tieneSeccion("# Título\n\n### Confidence & conclusion\n\ntexto", "Confidence & conclusion")).toBe(true);
    expect(tieneSeccion("# Título\n\ntexto", "Confidence & conclusion")).toBe(false);
  });

  it("anexa solo las secciones faltantes, sin tocar lo existente", () => {
    const existente = "# Redacción\n\n## Summary / hypothesis\n\nEste es el resumen humano original, no se toca.";
    const completo = completarMarkdown(existente, entrada());
    expect(completo.startsWith(existente)).toBe(true);
    expect(completo).toContain("Este es el resumen humano original, no se toca.");
    for (const s of SECCIONES_BASE) {
      expect(completo).toContain(`## ${s}`);
    }
    // no duplica la sección que ya existía
    expect(completo.match(/## Summary \/ hypothesis/g)?.length).toBe(1);
  });

  it("si ya tiene las nueve secciones, devuelve el markdown intacto (mismo string)", () => {
    const completo = generarMarkdownBase(entrada());
    const resultado = completarMarkdown(completo, entrada());
    expect(resultado).toBe(completo);
  });

  it("markdown real de markdown_hallazgo (loaders/auditor_to_investigaciones.py): no duplica Resumen/Dictamen/Evidencia, sólo anexa Contraste y Agentes IA", () => {
    const markdownDelLoader = [
      "# Proveedor fantasma — RFC000101ABC",
      "",
      "**Nivel: presuncion_alta** (confianza del auditor: proven).",
      "",
      "## Resumen",
      "Narrativa real del hallazgo.",
      "",
      "## Contribuyente",
      "RFC:RFC000101ABC · empresa auditada X",
      "",
      "## Hipótesis",
      "**Regla incumplida:** regla-1",
      "",
      "## Evidencia",
      "| Exhibit | Tabla | Registro | Qué prueba |",
      "|---|---|---|---|",
      "",
      "## Análisis del Defensor",
      "- Argumento",
      "",
      "## Dictamen",
      "presuncion_alta",
      "",
      "## Trayectoria",
      "| Paso | De | A | Monto | Fecha | Exhibit |",
      "",
      "## Cadena de explicación",
      "1. Qué disparó",
    ].join("\n");
    const completo = completarMarkdown(markdownDelLoader, entrada());
    expect(completo.startsWith(markdownDelLoader)).toBe(true);
    for (const cubierta of ["Summary / hypothesis", "Confidence & conclusion", "Cited evidence", "Alternative explanations & dismissals", "Timeline", "Evidence chain"] as const) {
      expect(seccionCubierta(markdownDelLoader, cubierta)).toBe(true);
    }
    expect(completo).toContain("## Challenge");
    expect(completo).toContain("## AI investigators");
    expect(completo.match(/## Challenge/g)?.length).toBe(1);
    expect(completo.match(/## AI investigators/g)?.length).toBe(1);
    // nada de lo que ya traía el loader se repite
    expect(completo.match(/## Resumen$/gm)?.length).toBe(1);
    expect(completo.match(/## Dictamen$/gm)?.length).toBe(1);
  });
});
