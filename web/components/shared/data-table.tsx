import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
  /** Formatea el valor crudo para CSV cuando `render` produce JSX no serializable en texto plano. */
  csv?: (row: T) => string;
}

export interface DataTableProps<T extends object> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  caption?: string;
  emptyMessage?: string;
  className?: string;
  onRowClick?: (row: T) => void;
}

/**
 * Tabla genérica compartida (15 §13, vista "tabla" de `ChartPanel`,
 * historial, entidades, bitácora, estadísticas). Estados vacío/skeleton se
 * resuelven arriba (el llamador decide cuándo pasar `rows: []`).
 */
export function DataTable<T extends object>({
  columns,
  rows,
  getRowKey,
  caption,
  emptyMessage = "No data matches this filter.",
  className,
  onRowClick,
}: DataTableProps<T>) {
  return (
    <div className={cn("overflow-x-auto rounded-[var(--radius-card)] border border-border", className)}>
      <table className="w-full min-w-[480px] border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border bg-surface-muted text-left text-xs text-text-subtle">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn("px-3 py-2 font-medium", col.align === "right" && "text-right", col.align === "center" && "text-center")}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-text-subtle">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={getRowKey(row, index)}
                className={cn("border-b border-border last:border-0", onRowClick && "cursor-pointer hover:bg-surface-hover")}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn("px-3 py-2 text-text", col.align === "right" && "text-right tabular-nums", col.align === "center" && "text-center")}
                  >
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Serializa filas+columnas a CSV (RFC 4180 básico) para `DownloadMenu`. */
export function dataTableToCsv<T extends object>(columns: Array<DataTableColumn<T>>, rows: T[]): string {
  const escape = (value: string) => {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  const header = columns.map((c) => escape(c.header)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escape(c.csv ? c.csv(row) : String((row as Record<string, unknown>)[c.key] ?? ""))).join(","))
    .join("\n");
  return `${header}\n${body}`;
}
