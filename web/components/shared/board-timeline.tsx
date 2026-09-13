"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Fingerprint, Search } from "lucide-react";
import type { EventoForense } from "@/lib/data";
import { soloHora } from "@/lib/date/formato";
import { TraceDrawer } from "./trace-drawer";

/** Only persisted events are shown. Every row opens its exact evidence and source event. */
export function BoardTimeline({ eventos, limite = 12 }: { eventos: EventoForense[]; limite?: number }) {
  const [seleccionado, setSeleccionado] = useState<EventoForense | null>(null);
  const [consulta, setConsulta] = useState("");
  const [todos, setTodos] = useState(false);
  const filtrados = useMemo(() => {
    const q = consulta.trim().toLowerCase();
    return [...eventos]
      .filter((e) => !q || [e.tipo_evento, e.payload.resumen, e.id, ...e.payload.referencias].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0) || Date.parse(b.ts) - Date.parse(a.ts));
  }, [eventos, consulta]);
  const ordenados = todos || consulta ? filtrados : filtrados.slice(0, limite);

  if (eventos.length === 0) {
    return <p className="rounded-card-sm border border-dashed border-border bg-surface-raised p-5 text-center text-xs text-text-subtle">No activity recorded for this dataset yet.</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {eventos.length > limite && (
        <div className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2">
          <Search size={14} className="flex-none text-text-subtle" aria-hidden />
          <input aria-label="Search activity" placeholder="Search a check, event or reference…" value={consulta} onChange={(e) => setConsulta(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
          <span className="text-[10px] tabular-nums text-text-subtle">{filtrados.length}</span>
        </div>
      )}
      <ol aria-label="Investigation events" className="m-0 flex list-none flex-col p-0">
        {ordenados.map((e, i) => (
          <li key={e.id} className="grid grid-cols-[60px_14px_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[72px_14px_minmax(0,1fr)]">
            <time dateTime={e.ts} className="pt-3 text-[10.5px] tabular-nums text-text-subtle">{soloHora(e.ts)}</time>
            <span className="flex h-full flex-col items-center gap-0.5">
              <span aria-hidden className="mt-[15px] h-2 w-2 flex-none rounded-full border-[1.5px] border-text-subtle bg-surface" />
              {i < ordenados.length - 1 && <span aria-hidden className="min-h-[24px] w-px flex-1 bg-border" />}
            </span>
            <button type="button" onClick={() => setSeleccionado(e)} className="group mb-2 flex min-w-0 flex-col gap-2 rounded-card-sm border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-surface-raised">
              <span className="flex w-full items-start gap-3"><span className="min-w-0 flex-1 break-words text-[12.5px] leading-relaxed text-text">{e.payload.resumen || "Recorded event without a summary"}</span><ArrowUpRight size={13} className="mt-0.5 flex-none text-text-subtle opacity-50 group-hover:opacity-100" aria-hidden /></span>
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-text-subtle">
                <span className="font-mono">{e.tipo_evento}</span>
                {e.payload.referencias.length > 0 && <span className="inline-flex items-center gap-1"><Fingerprint size={11} aria-hidden />{e.payload.referencias.length} referencia{e.payload.referencias.length === 1 ? "" : "s"}</span>}
                {e.duracion_ms != null && <span className="tabular-nums">{e.duracion_ms.toLocaleString("es-MX")} ms</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {ordenados.length === 0 && <p className="py-4 text-center text-xs text-text-subtle">No events match your search.</p>}
      {!consulta && filtrados.length > limite && <button type="button" className="self-start rounded-control border border-border bg-surface px-3 py-2 text-[12px] text-text-muted hover:bg-surface-hover" onClick={() => setTodos((v) => !v)}>{todos ? "Show latest" : `View ${filtrados.length} eventos`}</button>}
      <TraceDrawer evento={seleccionado} onOpenChange={(abierto) => { if (!abierto) setSeleccionado(null); }} />
    </div>
  );
}
