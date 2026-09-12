"use client";

import { cn } from "@/lib/utils";

/**
 * `VersionDiff` (15 §13). Pinta un diff unificado —el de una propuesta antes de
 * Aplicar, o el de dos versiones del historial— con el mismo código de color en
 * los dos casos. No decide nada: solo muestra lo que el BFF calculó sobre el
 * Markdown derivado.
 */
export function VersionDiff({
  diff,
  titulo,
  className,
  maxAltura = 320,
}: {
  diff: string;
  titulo?: string;
  className?: string;
  maxAltura?: number;
}) {
  const lineas = diff.split("\n").filter((l) => !l.startsWith("===") && !l.startsWith("Index:"));

  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface", className)}>
      {titulo && (
        <div className="border-b border-border bg-surface-muted px-3 py-1.5 text-xs font-medium text-text-muted">{titulo}</div>
      )}
      <div className="overflow-auto" style={{ maxHeight: maxAltura }}>
        <pre className="m-0 p-0 font-mono text-[11px] leading-[18px]">
          {lineas.map((linea, i) => {
            const tipo = linea.startsWith("+++") || linea.startsWith("---")
              ? "cabecera"
              : linea.startsWith("@@")
                ? "rango"
                : linea.startsWith("+")
                  ? "adicion"
                  : linea.startsWith("-")
                    ? "eliminacion"
                    : "contexto";
            return (
              <div
                key={i}
                data-tipo={tipo}
                className={cn(
                  "whitespace-pre-wrap break-words px-3",
                  tipo === "adicion" && "bg-ok/10 text-ok",
                  tipo === "eliminacion" && "bg-error/10 text-error",
                  tipo === "rango" && "bg-surface-muted text-text-subtle",
                  tipo === "cabecera" && "text-text-subtle",
                  tipo === "contexto" && "text-text-muted",
                )}
              >
                {linea === "" ? " " : linea}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
