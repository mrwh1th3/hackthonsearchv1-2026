"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DataTable, dataTableToCsv, type DataTableColumn } from "./data-table";
import { DownloadMenu } from "./download-menu";

export interface ChartPanelProps<T extends object> {
  title: string;
  unidad?: string;
  /** Texto ya formado de alcance/periodo, p.ej. "Corrida demo-1 · 2026-01" (15 §8). */
  alcance?: string;
  ultimaActualizacion?: string;
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  /** Vista de gráfica (Recharts u otra); si se omite, la vista "gráfica" cae a tabla. */
  children?: ReactNode;
  defaultView?: "grafica" | "tabla";
  emptyMessage?: string;
  csvFilename?: string;
  className?: string;
}

/**
 * Componente único que comparten todas las gráficas (15 §8): título, unidad,
 * alcance, selector de vista, CSV y última actualización. La vista "tabla"
 * usa `DataTable`; la vista "gráfica" renderiza `children` (el llamador trae
 * Recharts/grafo/lo que aplique a esa métrica).
 */
export function ChartPanel<T extends object>({
  title,
  unidad,
  alcance,
  ultimaActualizacion,
  columns,
  rows,
  getRowKey,
  children,
  defaultView = "grafica",
  emptyMessage,
  csvFilename,
  className,
}: ChartPanelProps<T>) {
  const [vista, setVista] = useState<"grafica" | "tabla">(children ? defaultView : "tabla");

  return (
    <section className={cn("rounded-[var(--radius-card)] border border-border bg-surface p-4", className)} data-testid="chart-panel">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-medium text-text">{title}</h3>
          <p className="text-xs text-text-subtle">
            {[unidad, alcance].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {children && (
            <div role="group" aria-label="Vista" className="flex overflow-hidden rounded-[var(--radius-input)] border border-border">
              <button
                type="button"
                aria-pressed={vista === "grafica"}
                onClick={() => setVista("grafica")}
                className={cn("h-8 px-2.5 text-xs", vista === "grafica" ? "bg-primary text-white" : "bg-surface text-text hover:bg-surface-hover")}
              >
                Chart
              </button>
              <button
                type="button"
                aria-pressed={vista === "tabla"}
                onClick={() => setVista("tabla")}
                className={cn("h-8 px-2.5 text-xs", vista === "tabla" ? "bg-primary text-white" : "bg-surface text-text hover:bg-surface-hover")}
              >
                Ver datos
              </button>
            </div>
          )}
          <DownloadMenu
            options={[
              {
                label: "CSV",
                build: () => ({
                  content: dataTableToCsv(columns, rows),
                  filename: `${csvFilename ?? title.toLowerCase().replace(/\s+/g, "-")}.csv`,
                  mime: "text/csv;charset=utf-8",
                }),
              },
            ]}
          />
        </div>
      </header>

      {vista === "grafica" && children ? children : <DataTable columns={columns} rows={rows} getRowKey={getRowKey} emptyMessage={emptyMessage} />}

      {ultimaActualizacion && <p className="mt-2 text-right text-[11px] text-text-subtle">Last updated: {ultimaActualizacion}</p>}
    </section>
  );
}
