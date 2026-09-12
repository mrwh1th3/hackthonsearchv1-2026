"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { EntradaIndice } from "@/lib/document/secciones";
import { cn } from "@/lib/utils";

/**
 * Índice plegable del expediente (15 §10). Diez entradas: las ocho secciones
 * fijas del Redactor más Trayectoria y Cadena de explicación (21 §4).
 *
 * Una sección que el documento no trae se muestra **ausente** y deshabilitada,
 * con el motivo. No se inserta vacía: el editor no fabrica secciones que
 * escribe el Redactor.
 */
export function IndiceSecciones({
  entradas,
  activa,
  onIr,
}: {
  entradas: EntradaIndice[];
  activa?: string;
  onIr: (blockId: string) => void;
}) {
  const [abierto, setAbierto] = useState(true);

  return (
    <nav aria-label="Índice del expediente" className="flex flex-col gap-1 text-sm print:hidden">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex items-center gap-1 rounded-[var(--radius-input)] px-1 py-1 text-xs font-medium text-text-muted hover:bg-surface-hover"
      >
        {abierto ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        Índice
      </button>

      {abierto && (
        <ol className="flex flex-col gap-0.5">
          {entradas.map((entrada) => {
            const ausente = entrada.estado === "ausente";
            return (
              <li key={entrada.clave}>
                <button
                  type="button"
                  disabled={ausente}
                  title={ausente ? entrada.motivoAusencia : entrada.tituloDocumento}
                  data-estado={entrada.estado}
                  onClick={() => entrada.blockId && onIr(entrada.blockId)}
                  className={cn(
                    "w-full truncate rounded-[var(--radius-input)] px-2 py-1 text-left text-[13px] transition-colors",
                    entrada.nivel > 2 && "pl-4",
                    ausente
                      ? "cursor-not-allowed text-text-subtle/60 line-through"
                      : "text-text-muted hover:bg-surface-hover hover:text-text",
                    activa === entrada.blockId && "bg-surface-muted font-medium text-text",
                  )}
                >
                  {entrada.titulo}
                  {entrada.protegida && !ausente && (
                    <span className="ml-1 text-[10px] text-text-subtle" title="Sección que no puede eliminarse (08, 21 §4)">
                      ·fija
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {entradas.some((e) => e.estado === "ausente") && (
        <p className="mt-1 px-2 text-[11px] leading-tight text-text-subtle">
          Las secciones tachadas no vienen en esta versión del expediente; las escribe el Redactor (21 §4).
        </p>
      )}
    </nav>
  );
}
