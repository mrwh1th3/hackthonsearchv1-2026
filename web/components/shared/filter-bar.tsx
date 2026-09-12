"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FilterChip {
  key: string;
  label: string;
}

export interface FilterBarProps {
  /** Controles de filtro (selects, inputs) provistos por el llamador. */
  children?: ReactNode;
  chips: FilterChip[];
  onRemoveChip: (key: string) => void;
  onClearAll: () => void;
  resultCount?: number;
  onSaveView?: () => void;
  className?: string;
}

/**
 * 15 §9: filtros combinables con chips activos, quitar individual, "Limpiar
 * todo", contador de resultados y "Guardar vista". El estado efectivo vive
 * donde el llamador lo persista (URL, típicamente); este componente es
 * puramente de presentación.
 */
export function FilterBar({ children, chips, onRemoveChip, onClearAll, resultCount, onSaveView, className }: FilterBarProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      {(chips.length > 0 || resultCount !== undefined) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-text">
              {chip.label}
              <button type="button" onClick={() => onRemoveChip(chip.key)} aria-label={`Quitar filtro ${chip.label}`} className="text-text-subtle hover:text-text">
                <X size={11} />
              </button>
            </span>
          ))}
          {chips.length > 0 && (
            <button type="button" onClick={onClearAll} className="text-xs text-text-subtle underline-offset-2 hover:underline">
              Limpiar todo
            </button>
          )}
          <span className="flex-1" />
          {resultCount !== undefined && <span className="text-xs text-text-subtle">{resultCount} resultado(s)</span>}
          {onSaveView && (
            <button type="button" onClick={onSaveView} className="h-7 rounded-full border border-border px-2.5 text-xs text-text hover:bg-surface-hover">
              Guardar vista
            </button>
          )}
        </div>
      )}
    </div>
  );
}
