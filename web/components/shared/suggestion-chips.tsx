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
  { id: "seguir_dinero", titulo: "Follow the money", descripcion: "Trace incoming payments, outgoing payments and returns.", requiere: ["rfc"] },
  { id: "sin_pago", titulo: "Find unpaid invoices", descripcion: "Reconcile invoices and identify missing records.", requiere: ["rfc"] },
  { id: "intentar_refutar", titulo: "Intentar refutar", descripcion: "Test legitimate explanations for selected signals.", requiere: ["rfc"] },
  { id: "comparar_pares", titulo: "Compare with peers", descripcion: "Use industry, company size and available metrics.", requiere: ["rfc"] },
  { id: "explicar_cadena", titulo: "Explicar esta cadena", descripcion: "Prioritize the selected money trail and supporting records.", requiere: ["evidencia"] },
  { id: "resumen", titulo: "Preparar resumen ejecutivo", descripcion: "Summarize the investigation results.", requiere: ["rfc"] },
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
    <div className={cn("flex gap-2 overflow-x-auto pb-1", className)} role="group" aria-label="Suggested investigations">
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
            title={deshabilitada ? `Requiere ${etiquetaFaltante(faltante!)} in the current context` : s.descripcion}
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
  if (r === "rfc") return "a tax ID";
  if (r === "cluster") return "an investigation";
  return "evidencia";
}
