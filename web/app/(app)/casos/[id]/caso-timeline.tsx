"use client";

import { useEffect, useMemo, useState } from "react";
import { TraceDrawer } from "@/components/shared/trace-drawer";
import type { EventoForense } from "@/lib/data";
import { mapEventoBitacora } from "@/lib/data/supabase";
import { useCanalForense } from "@/lib/realtime/usar-canal";

/**
 * 09 §3, izquierda: timeline de bitácora agrupado por ronda. No hay campo
 * de ronda directo en `EventoForense` (DTO resumido): se infiere de
 * `ronda_inicio`/`ronda_fin` presentes en el propio flujo de eventos.
 *
 * CLAUDE.md regla 2 ("todo deja rastro") en vivo: suscrito a
 * `forense.bitacora` filtrado por `caso_id` (solo con fuente supabase, ver
 * `lib/realtime/canal.ts`) — un evento nuevo aparece sin recargar la
 * página, nunca se anima algo que no llegó como fila real.
 */
export function CasoTimeline({ eventos, casoId }: { eventos: EventoForense[]; casoId: string }) {
  const [seleccionado, setSeleccionado] = useState<EventoForense | null>(null);
  const [enVivo, setEnVivo] = useState<EventoForense[]>(eventos);

  useEffect(() => setEnVivo(eventos), [eventos]);

  useCanalForense({
    tabla: "bitacora",
    filtro: `caso_id=eq.${casoId}`,
    onCambio: (payload) => {
      if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
      const evento = mapEventoBitacora(payload.new as Record<string, unknown>);
      setEnVivo((actual) => {
        const sinDuplicado = actual.filter((e) => e.id !== evento.id);
        return [...sinDuplicado, evento];
      });
    },
  });

  const ordenados = useMemo(() => [...enVivo].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), [enVivo]);

  const totales = useMemo(
    () => ({
      llamadas: ordenados.filter((e) => e.tipo_evento === "tool_call").length,
      duracionMs:
        ordenados.length > 1 ? new Date(ordenados[ordenados.length - 1].ts).getTime() - new Date(ordenados[0].ts).getTime() : 0,
    }),
    [ordenados],
  );

  if (ordenados.length === 0) {
    return <p className="rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm text-text-subtle">Sin eventos de bitácora para este caso todavía.</p>;
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
      <ol className="space-y-1.5">
        {ordenados.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => setSeleccionado(e)}
              className="flex w-full items-start gap-2 rounded-md p-1.5 text-left text-xs hover:bg-surface-hover"
            >
              <span className="mt-0.5 w-14 shrink-0 tabular-nums text-text-subtle">{new Date(e.ts).toLocaleTimeString("es-MX")}</span>
              <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-text-muted">{e.tipo_evento}</span>
              <span className="line-clamp-1 flex-1 text-text">{e.payload.resumen}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 border-t border-border pt-2 text-[11px] text-text-subtle">
        {ordenados.length} evento(s) · {totales.llamadas} llamada(s) a herramienta · {Math.round(totales.duracionMs / 1000)}s totales
      </p>
      <TraceDrawer evento={seleccionado} onOpenChange={(open) => !open && setSeleccionado(null)} />
    </div>
  );
}
