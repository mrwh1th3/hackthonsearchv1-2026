/**
 * Resumen del `structure_report` del agente de estructura (`src/auditor/structure`) para la UI de carga.
 * Solo reordena lo que el reporte trae: si un campo no viene, la lista queda vacía; no se rellena nada.
 * Los ejemplos de valores del reporte no pasan al resumen.
 */

type ColumnaReporte = { source?: string; confidence?: number; method?: string; changed?: number };
type TablaReporte = {
  source?: string | null;
  confidence?: number;
  usable?: boolean;
  rows?: number;
  columns?: Record<string, ColumnaReporte>;
  missing_columns?: string[];
  missing_core?: string[];
  unmapped_source_columns?: string[];
};
type EntradaReporte = {
  table?: string;
  source?: string;
  sheet?: string | null;
  encoding?: string | null;
  delimiter?: string | null;
  header_row?: number | null;
  rows?: number;
  skipped?: string;
};
export type StructureReport = {
  status?: string;
  summary?: string;
  input?: { input_format?: string; tables?: EntradaReporte[] };
  tables?: Record<string, TablaReporte | string>;
  low_confidence?: string[];
  disabled_schemes?: Record<string, string[]>;
  weakened_schemes?: Record<string, string[]>;
  precision_lost?: Record<string, number>;
  id_collisions?: Record<string, number>;
  unmapped_source_tables?: string[];
  missing_tables?: string[];
};

export type ResumenEstructura = {
  estado: string;
  resumen: string;
  formato: string;
  entradas: { tabla: string; origen: string; hoja: string | null; codificacion: string | null; delimitador: string | null; filas: number | null }[];
  tablas: {
    canonica: string;
    origen: string | null;
    filas: number | null;
    usable: boolean;
    confianza: number | null;
    columnas: { canonica: string; origen: string; confianza: number | null; metodo: string | null; cambiadas: number }[];
    faltantes: string[];
    noMapeadas: string[];
  }[];
  bajaConfianza: string[];
  detectoresApagados: { detector: string; faltan: string[] }[];
  evidenciaReducida: { detector: string; faltan: string[] }[];
  precisionPerdida: { campo: string; valores: number }[];
  colisiones: { tabla: string; ids: number }[];
  tablasNoUsadas: string[];
  avisos: string[];
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const pares = (v: unknown) =>
  v && typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => ({ k, x })) : [];

export function resumirEstructura(reporte: StructureReport | null | undefined, avisos: unknown = []): ResumenEstructura {
  const r = reporte ?? {};
  const tablas = pares(r.tables).map(({ k, x }) => {
    if (typeof x === "string") {
      // status "identity": el reporte solo trae {canónica: origen}
      return { canonica: k, origen: x, filas: null, usable: true, confianza: 1, columnas: [], faltantes: [], noMapeadas: [] };
    }
    const t = (x ?? {}) as TablaReporte;
    return {
      canonica: k,
      origen: typeof t.source === "string" ? t.source : null,
      filas: num(t.rows),
      usable: t.usable !== false && typeof t.source === "string",
      confianza: num(t.confidence),
      columnas: pares(t.columns).map(({ k: cc, x: c }) => {
        const col = (c ?? {}) as ColumnaReporte;
        return {
          canonica: cc,
          origen: String(col.source ?? cc),
          confianza: num(col.confidence),
          metodo: typeof col.method === "string" ? col.method : null,
          cambiadas: num(col.changed) ?? 0,
        };
      }),
      faltantes: lista(t.missing_columns),
      noMapeadas: lista(t.unmapped_source_columns),
    };
  });
  return {
    estado: String(r.status ?? "desconocido"),
    resumen: String(r.summary ?? ""),
    formato: String(r.input?.input_format ?? "sqlite"),
    entradas: (r.input?.tables ?? [])
      .filter((e) => typeof e.table === "string")
      .map((e) => ({
        tabla: e.table as string,
        origen: String(e.source ?? ""),
        hoja: e.sheet ?? null,
        codificacion: e.encoding ?? null,
        delimitador: e.delimiter ?? null,
        filas: num(e.rows),
      })),
    tablas,
    bajaConfianza: lista(r.low_confidence),
    detectoresApagados: pares(r.disabled_schemes).map(({ k, x }) => ({ detector: k, faltan: lista(x) })),
    evidenciaReducida: pares(r.weakened_schemes).map(({ k, x }) => ({ detector: k, faltan: lista(x) })),
    precisionPerdida: pares(r.precision_lost).map(({ k, x }) => ({ campo: k, valores: num(x) ?? 0 })),
    colisiones: pares(r.id_collisions).map(({ k, x }) => ({ tabla: k, ids: num(x) ?? 0 })),
    tablasNoUsadas: lista(r.unmapped_source_tables),
    avisos: lista(avisos),
  };
}
