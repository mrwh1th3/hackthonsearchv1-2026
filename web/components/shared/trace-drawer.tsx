"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Fingerprint, X } from "lucide-react";
import { useState } from "react";
import type { EventoForense } from "@/lib/data";
import { fechaHora } from "@/lib/date/formato";

/** Progressive disclosure: what happened, its references, then exact technical provenance. */
export function TraceDrawer({ evento, onOpenChange }: { evento: EventoForense | null; onOpenChange: (open: boolean) => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [errorCopia, setErrorCopia] = useState(false);
  async function copiar() {
    if (!evento) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(evento, null, 2));
      setCopiado(evento.id);
      setErrorCopia(false);
    } catch { setErrorCopia(true); }
  }

  return (
    <Dialog.Root open={Boolean(evento)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(32,40,30,.22)] backdrop-blur-[5px]" />
        <Dialog.Content className="fixed inset-y-3 right-3 z-50 flex w-[calc(100vw-24px)] max-w-[520px] flex-col overflow-hidden rounded-[20px] border border-border/70 bg-surface shadow-[0_24px_80px_rgba(28,36,25,.16)] focus:outline-none">
          <div className="flex items-start justify-between gap-4 border-b border-border/70 bg-surface-raised p-6">
            <div className="min-w-0"><span className="insp-eyebrow flex items-center gap-2 text-[var(--brand)]"><Fingerprint size={13} aria-hidden /> TRAZABILIDAD</span><Dialog.Title className="mt-2 break-words font-display text-[22px] font-medium tracking-[-.035em] text-text">{evento?.tipo_evento.replaceAll("_", " ")}</Dialog.Title><Dialog.Description className="mt-1 text-xs text-text-subtle">Evento persistido y referencias que lo respaldan.</Dialog.Description></div>
            <Dialog.Close asChild><button type="button" aria-label="Close" className="insp-focus-ring flex h-8 w-8 flex-none items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]"><X size={16} aria-hidden /></button></Dialog.Close>
          </div>
          {evento && (
            <div className="insp-scroll min-h-0 flex-1 space-y-6 overflow-y-auto p-6 text-xs text-text">
              <section><h3 className="insp-eyebrow mb-2">QUÉ OCURRIÓ</h3><p className="rounded-[14px] border border-border/60 bg-surface-raised p-4 text-[13px] leading-relaxed">{evento.payload.resumen || "No summary was recorded for this event."}</p><time dateTime={evento.ts} className="mt-2 block text-[11px] text-text-subtle">{fechaHora(evento.ts)}</time></section>
              <section><h3 className="insp-eyebrow mb-3">REFERENCIAS · {evento.payload.referencias.length}</h3>{evento.payload.referencias.length > 0 ? <ul className="space-y-2">{evento.payload.referencias.map((r, i) => <li key={`${r}-${i}`} className="break-all rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-[11px] leading-relaxed">{r}</li>)}</ul> : <p className="text-text-subtle">This event has no evidence references.</p>}</section>
              {(evento.tokens_in != null || evento.tokens_out != null || evento.duracion_ms != null) && <dl className="grid grid-cols-3 gap-3 rounded-[14px] bg-[var(--brand-soft)] p-4">{[["Input", evento.tokens_in == null ? "—" : `${evento.tokens_in.toLocaleString("es-MX")} tokens`], ["Output", evento.tokens_out == null ? "—" : `${evento.tokens_out.toLocaleString("es-MX")} tokens`], ["Duration", evento.duracion_ms == null ? "—" : `${evento.duracion_ms.toLocaleString("es-MX")} ms`]].map(([label, value]) => <div key={label}><dt className="text-[10px] text-text-subtle">{label}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd></div>)}</dl>}
              <details className="rounded-card-sm border border-border"><summary className="insp-focus-ring rounded-[14px] px-4 py-3 text-[12px] font-medium text-text-muted transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]">Identificadores y origen</summary><dl className="space-y-3 border-t border-border p-4"><Row label="Event ID" value={evento.id} /><Row label="Secuencia" value={String(evento.seq ?? "—")} /><Row label="Corrida" value={evento.corrida_id} /><Row label="Caso" value={evento.caso_id ?? "—"} /><Row label="Tarea" value={evento.tarea_id ?? "—"} /><Row label="Operation" value={evento.payload.operacion_id ?? "—"} /></dl></details>
              <details className="rounded-card-sm border border-border"><summary className="insp-focus-ring rounded-[14px] px-4 py-3 text-[12px] font-medium text-text-muted transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]">Evento completo · JSON</summary><pre className="overflow-x-auto border-t border-border bg-surface-raised p-4 text-[11px] leading-relaxed">{JSON.stringify(evento, null, 2)}</pre></details>
            </div>
          )}
          <footer className="border-t border-border/70 p-4"><button type="button" onClick={copiar} className="insp-focus-ring flex w-full items-center justify-center gap-2 rounded-[12px] border border-border/80 bg-surface px-4 py-2.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]">{copiado === evento?.id ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{copiado === evento?.id ? "Evento copiado" : "Copiar evento completo"}</button>{errorCopia && <p role="status" className="mt-2 text-xs text-error">Could not copy. Select the JSON in the full event instead.</p>}</footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><dt className="mb-1 text-[10px] text-text-subtle">{label}</dt><dd className="break-all font-mono text-[11px] leading-relaxed">{value}</dd></div>;
}
