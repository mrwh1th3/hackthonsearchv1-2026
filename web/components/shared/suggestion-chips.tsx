import { cn } from "@/lib/utils";
import type { InvestigarPayload } from "@/lib/data";

export interface Sugerencia {
  id: InvestigarPayload["directriz_id"];
  titulo: string;
  descripcion: string;
  /** Qué necesita del contexto actual para poder enviarse (15 §6). */
  requiere: Array<"rfc" | "cluster" | "evidencia">;
}

export const SUGERENCIAS: Sugerencia[] = [
  { id: "seguir_dinero", titulo: "Seguir el dinero", descripcion: "Rastrea entradas, salidas y retornos del RFC/cluster seleccionado.", requiere: ["rfc"] },
  { id: "sin_pago", titulo: "Buscar facturas sin pago", descripcion: "Concilia comprobantes del periodo y declara cobertura faltante.", requiere: ["rfc"] },
  { id: "intentar_refutar", titulo: "Intentar refutar", descripcion: "Prueba explicaciones legítimas de las pistas seleccionadas.", requiere: ["rfc"] },
  { id: "comparar_pares", titulo: "Comparar con sus pares", descripcion: "Usa giro/tamaño y métricas disponibles.", requiere: ["rfc"] },
  { id: "explicar_cadena", titulo: "Explicar esta cadena", descripcion: "Prioriza ruta y evidencias de las aristas seleccionadas.", requiere: ["evidencia"] },
  { id: "resumen", titulo: "Preparar resumen ejecutivo", descripcion: "Solicita un resumen del resultado de la investigación.", requiere: ["rfc"] },
];

export interface SuggestionChipsProps {
  seleccionId: InvestigarPayload["directriz_id"] | null;
  onSelect: (s: Sugerencia) => void;
  disponible: { rfc: boolean; cluster: boolean; evidencia: boolean };
  className?: string;
}

/**
 * 15 §6: click selecciona la directriz y añade un chip removible; no envía.
 * Una sugerencia sin contexto necesario aparece deshabilitada con
 * explicación (nunca oculta silenciosamente).
 */
export function SuggestionChips({ seleccionId, onSelect, disponible, className }: SuggestionChipsProps) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto pb-1", className)} role="group" aria-label="Sugerencias de análisis">
      {SUGERENCIAS.map((s) => {
        const faltante = s.requiere.find((r) => !disponible[r]);
        const deshabilitada = Boolean(faltante);
        return (
          <button
            key={s.id}
            type="button"
            disabled={deshabilitada}
            onClick={() => onSelect(s)}
            aria-pressed={seleccionId === s.id}
            title={deshabilitada ? `Requiere ${etiquetaFaltante(faltante!)} en el contexto actual` : s.descripcion}
            className={cn(
              "flex shrink-0 flex-col rounded-[var(--radius-card)] border px-3 py-2 text-left text-xs transition-colors",
              deshabilitada
                ? "cursor-not-allowed border-border bg-surface-muted text-text-subtle opacity-60"
                : seleccionId === s.id
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface text-text hover:bg-surface-hover",
            )}
          >
            <span className="font-medium">{s.titulo}</span>
            <span className={cn("mt-0.5 max-w-[220px] text-[11px]", seleccionId === s.id && !deshabilitada ? "text-white/80" : "text-text-subtle")}>
              {deshabilitada ? `Requiere ${etiquetaFaltante(faltante!)} seleccionado` : s.descripcion}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function etiquetaFaltante(r: "rfc" | "cluster" | "evidencia"): string {
  if (r === "rfc") return "un RFC";
  if (r === "cluster") return "un cluster";
  return "evidencia";
}
