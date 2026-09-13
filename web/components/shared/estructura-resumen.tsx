"use client";

import type { ResumenEstructura } from "@/lib/estates/estructura";

/**
 * Resumen del agente de estructura tras cargar un dataset: cómo se leyó cada tabla, qué columnas se mapearon
 * desde otros nombres, qué mapeos son de baja confianza, qué detectores quedaron apagados o con evidencia
 * reducida y qué valores se descartaron. Todo sale del `structure_report`; si una lista viene vacía, la
 * sección no se dibuja.
 */
const FORMATOS: Record<string, string> = {
  sqlite: "SQLite",
  csv: "CSV",
  csv_dir: "CSV (one table per file)",
  xlsx: "Excel (one sheet per table)",
  xlsx_dir: "Excel (one sheet per table)",
  zip: "ZIP",
};

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function Seccion({ titulo, tono, items }: { titulo: string; tono: "warn" | "error" | "muted"; items: string[] }) {
  if (items.length === 0) return null;
  const color = tono === "error" ? "text-error" : tono === "warn" ? "text-warn" : "text-text-muted";
  return (
    <section className="flex flex-col gap-1">
      <h4 className={`m-0 text-[12px] font-semibold ${color}`}>{titulo}</h4>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {items.map((t) => (
          <li key={t} className="text-[12px] leading-relaxed text-text-muted">
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EstructuraResumen({ estructura }: { estructura: ResumenEstructura }) {
  const e = estructura;
  const identidad = e.estado === "identity";
  return (
    <div className="flex flex-col gap-3" aria-label="Data structure">
      <div className="flex flex-col gap-1">
        <span className="text-[12px] text-text-subtle">
          Formato: {FORMATOS[e.formato] ?? e.formato}
          {identidad ? " · matches the schema" : " · normalized to the canonical schema"}
        </span>
        {e.resumen && <p className="m-0 text-[12px] leading-relaxed text-text-muted">{e.resumen}</p>}
      </div>

      {e.tablas.length > 0 && (
        <section className="flex flex-col gap-1">
          <h4 className="m-0 text-[12px] font-semibold text-text">Tablas detectadas</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {e.tablas.map((t) => {
              const renombradas = t.columnas.filter((c) => c.origen !== c.canonica || (c.confianza != null && c.confianza < 1));
              return (
                <li key={t.canonica} className="rounded-[var(--radius-control)] border border-[var(--border)] bg-surface-raised px-2.5 py-1.5">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 text-[12.5px] text-text">
                      <span className="font-medium">{t.canonica}</span>
                      <span className="text-text-subtle">
                        {t.origen ? (t.origen === t.canonica ? "mismo nombre" : `← ${t.origen}`) : "no encontrada"}
                      </span>
                      {t.filas != null && <span className="tabular-nums text-text-subtle">{t.filas.toLocaleString("es-MX")} filas</span>}
                      {t.origen && !t.usable && <span className="text-warn">incompleta</span>}
                    </summary>
                    <div className="mt-1 flex flex-col gap-0.5 text-[12px] text-text-muted">
                      {renombradas.length === 0 && t.columnas.length > 0 && <span>All columns use canonical names.</span>}
                      {renombradas.map((c) => (
                        <span key={c.canonica}>
                          {c.canonica} ← {c.origen} <span className="tabular-nums text-text-subtle">({pct(c.confianza)}{c.metodo ? `, ${c.metodo}` : ""})</span>
                        </span>
                      ))}
                      {t.faltantes.length > 0 && <span className="text-warn">Faltan: {t.faltantes.join(", ")}</span>}
                      {t.noMapeadas.length > 0 && <span className="text-text-subtle">Sin usar: {t.noMapeadas.join(", ")}</span>}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Seccion titulo="Mappings to review" tono="warn" items={e.bajaConfianza} />
      <Seccion
        titulo="Detectores apagados"
        tono="error"
        items={e.detectoresApagados.map((d) => `${d.detector}: falta ${d.faltan.join(", ")}`)}
      />
      <Seccion
        titulo="Evidencia reducida"
        tono="warn"
        items={e.evidenciaReducida.map((d) => `${d.detector}: sin ${d.faltan.join(", ")}`)}
      />
      <Seccion
        titulo="Valores descartados"
        tono="warn"
        items={[
          ...e.precisionPerdida.map((p) => `${p.campo}: ${p.valores.toLocaleString("es-MX")} due to precision loss`),
          ...e.colisiones.map((c) => `${c.tabla}: ${c.ids.toLocaleString("es-MX")} ids colisionan al normalizar`),
        ]}
      />
      <Seccion titulo="Unused input tables" tono="muted" items={e.tablasNoUsadas} />
    </div>
  );
}
