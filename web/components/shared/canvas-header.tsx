"use client";

import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useInspectorPanel } from "./app-shell";

/**
 * Cabecera de las pantallas de lienzo completo del diseño
 * (`design-ref/Agents.dc.html`, bloques `boardOpen` y `resultsOpen`, líneas
 * 200-215 y 232-246). Estructura idéntica: `height:38px`, wordmark a la
 * izquierda que abre el panel (`openLeft`), pill del dataset **centrado en
 * absoluto** (`left:50%; translateX(-50%)`), y las acciones al final tras un
 * `flex:1`.
 *
 * El pill es el mismo del composer: `height:30px`, `border-radius:999px`,
 * borde `--border-strong`, fondo `--surface-raised`, punto de 6px. El punto
 * es redondo cuando la corrida es clonada por inyección en vivo y cuadrado
 * (radio 2px) cuando no, tal cual `selectedDot` del original — aquí con la
 * distinción real `corrida_origen_id != null` (CLAUDE.md regla 12) en vez del
 * booleano inventado `dynamic`.
 */
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
    <div className="relative flex h-[38px] flex-none items-center gap-3">
      <button
        type="button"
        onClick={panel.abrir}
        aria-label="Abrir navegación"
        className="flex h-[26px] w-[26px] flex-none items-center justify-center border-none bg-transparent p-0 text-text"
      >
        <Menu size={22} strokeWidth={1.8} aria-hidden />
      </button>
      <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2.5 sm:flex">
        <span className="flex h-[30px] max-w-[200px] flex-none items-center gap-1.5 truncate rounded-[var(--radius-pill)] border border-border-strong bg-surface-raised px-3 text-[12.5px] text-text">
          <span
            aria-hidden
            className="h-1.5 w-1.5 flex-none bg-primary"
            style={{ borderRadius: enVivo ? "50%" : "2px" }}
          />
          {etiqueta}
        </span>
      </div>
      <div className="flex-1" />
      {acciones}
    </div>
  );
}

/** Botón oscuro del diseño (`View results`): 32px, radio 10px, `#141413`. */
export function CanvasPrimaryAction({ children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      {...props}
      className="h-8 flex-none rounded-[10px] bg-primary px-3.5 text-[12.5px] font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
    >
      {children}
    </button>
  );
}
