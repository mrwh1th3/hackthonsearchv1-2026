import type { EventoForense } from "@/lib/data";
import { soloHora } from "@/lib/date/formato";

/**
 * Timeline del board (design-ref/Agents.dc.html líneas 278-308), con la
 * bitácora real de la corrida (`getBitacoraCorrida`, CLAUDE.md regla 2: si
 * el paso no está en `forense.bitacora`, no se pinta). Versión condensada
 * de `RawLog` (`/corridas/[id]/raw`, que sigue siendo el "ver TODO"
 * filtrable/exportable) — aquí solo los últimos eventos, en el lenguaje
 * visual de puntos y línea del diseño.
 */
export function BoardTimeline({ eventos, limite = 12 }: { eventos: EventoForense[]; limite?: number }) {
  const ordenados = [...eventos].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0)).slice(0, limite);

  if (ordenados.length === 0) {
    return (
      <p className="rounded-[var(--radius-card-sm)] border border-dashed border-border bg-surface-raised p-4 text-center text-xs text-text-subtle">
        Sin eventos en la bitácora de esta corrida todavía.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {ordenados.map((e, i) => (
        <div key={e.id} className="grid grid-cols-[74px_14px_minmax(0,1fr)] items-start gap-2.5">
          <span className="pt-px text-[11.5px] text-text-subtle">{soloHora(e.ts)}</span>
          <span className="flex h-full flex-col items-center gap-0.5">
            <span aria-hidden className="mt-[3px] h-2 w-2 rounded-full border-[1.5px] border-primary bg-surface" />
            {i < ordenados.length - 1 && <span aria-hidden className="min-h-[14px] w-px flex-1 bg-border" />}
          </span>
          <span className="flex flex-col gap-0.5 pb-3">
            <span className="text-[13px] text-text">{e.tipo_evento}</span>
            <span className="text-[11.5px] text-text-subtle">{e.payload.resumen}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
