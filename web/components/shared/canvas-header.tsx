"use client";

import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useInspectorPanel } from "./app-shell";

/** Shared Inspector header. Wrapping keeps the dataset and actions usable on narrow screens. */
export function CanvasHeader({
  etiqueta,
  enVivo = false,
  acciones,
}: {
  etiqueta: string;
  enVivo?: boolean;
  acciones?: ReactNode;
}) {
  const panel = useInspectorPanel();
  return (
    <header className="relative flex min-h-[48px] flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-border pb-3">
      <button
        type="button"
        onClick={panel.abrir}
        aria-label="Open navigation"
        aria-expanded={panel.abierto}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-control border border-border bg-surface p-0 text-text transition-colors hover:bg-surface-hover"
      >
        <Menu size={22} strokeWidth={1.8} aria-hidden />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span title={etiqueta} className="flex h-[30px] min-w-0 max-w-[260px] items-center gap-1.5 rounded-[var(--radius-pill)] border border-border bg-surface-raised px-3 text-[12.5px] text-text">
          <span
            aria-hidden
            className="h-1.5 w-1.5 flex-none bg-primary"
            style={{ borderRadius: enVivo ? "50%" : "2px" }}
          />
          <span className="truncate">{etiqueta}</span>
        </span>
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{acciones}</div>
    </header>
  );
}

/** Botón oscuro del diseño (`View results`): 32px, radio 10px, `#141413`. */
export function CanvasPrimaryAction({ children, className = "", ...props }: React.ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={`h-9 flex-none rounded-control bg-primary px-3.5 text-[12.5px] font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
