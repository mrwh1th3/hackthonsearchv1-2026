"use client";

import { ChevronDown, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PistasScope } from "./pistas-scope";
import { AppDateField, isISODate } from "./app-date-field";
import type { Corrida } from "@/lib/data";
import { cn } from "@/lib/utils";
import motion from "./investigation-composer.module.css";

export interface InvestigationComposerProps {
  corrida: Corrida;
  clusterId?: string;
  rfcsDisponibles?: string[];
  onChangeDataset?: () => void;
  onStarted?: (runId: string) => void;
  className?: string;
}

/** One submission owns the complete investigation, from the motor to reviewed proposals. */
export function InvestigationComposer({ corrida, onChangeDataset, onStarted, className }: InvestigationComposerProps) {
  const [expandido, setExpandido] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const limites = { desde: corrida.inicio.slice(0, 10), hasta: (corrida.fin ?? corrida.fecha_corte).slice(0, 10) };
  const [desde, setDesde] = useState(limites.desde);
  const [hasta, setHasta] = useState(limites.hasta);
  const rangoInvalido = !isISODate(desde) || !isISODate(hasta) || desde > hasta || desde < limites.desde || hasta > limites.hasta;
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function investigar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando || rangoInvalido) return;
    setEnviando(true);
    setError(null);
    try {
      const response = await fetch("/api/laboratorio", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ corrida_id: corrida.id, mensaje: mensaje.trim(), filtros: { desde, hasta }, provider: "codex" }),
      });
      const body = await response.json().catch(() => ({}));
      const runId = body.launch?.run_id;
      if (response.status === 202 && typeof runId === "string") {
        if (onStarted) onStarted(runId);
        else router.push(`/?corrida=${encodeURIComponent(corrida.id)}&run=${encodeURIComponent(runId)}`);
        router.refresh();
        return;
      }
      setError(response.status === 401 ? "Your session expired. Sign in to start the investigation." : `Could not start the investigation: ${body.detalle ?? body.error ?? response.status}.`);
    } catch { setError("Could not connect. Please try again."); }
    finally { setEnviando(false); }
  }

  return (
    <form onSubmit={investigar} aria-label="Start investigation" className={cn("flex w-full flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span title={corrida.nombre} className="flex min-h-[30px] max-w-[280px] items-center gap-2 rounded-pill border border-border-strong bg-surface-raised px-3 py-1 text-[12px] text-text"><span aria-hidden className="h-1.5 w-1.5 flex-none rounded-sm bg-primary" /><span className="truncate">{corrida.nombre}</span></span>
        {onChangeDataset && <button type="button" onClick={onChangeDataset} disabled={enviando} className="min-h-[30px] rounded-pill border border-border bg-surface px-3 text-[12px] text-text-subtle hover:bg-surface-hover disabled:opacity-50">Change dataset</button>}
      </div>
      <div className="flex flex-col gap-4 rounded-composer border border-border-strong bg-surface p-4 shadow-[0_1px_3px_rgba(20,20,19,.04)] sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" aria-expanded={expandido} onClick={() => setExpandido(!expandido)} className={cn(motion.contextButton,"flex h-9 items-center gap-3 rounded-pill border border-border px-4 text-[12.5px] text-text-muted")}>Context <span aria-hidden className="h-3 w-px bg-border-strong"/> Filters<ChevronDown size={12} aria-hidden/></button>
          <button type="submit" disabled={enviando || rangoInvalido} aria-busy={enviando || undefined} className={cn(motion.investigate,"flex h-9 items-center gap-2 rounded-pill bg-primary px-4 text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-40")}><Search size={14} aria-hidden/>{enviando ? "Starting…" : "Investigate"}</button>
        </div>
        {expandido && <div className={cn(motion.contextPanel,"flex flex-col gap-3 border-t border-border pt-4")}>
          <textarea aria-label="Context for the investigators" value={mensaje} onChange={(event) => setMensaje(event.target.value)} disabled={enviando} maxLength={4000} rows={5} placeholder="What should the investigation and its report focus on?" className="w-full resize-y rounded-card-sm border border-border bg-surface-raised px-3.5 py-3 text-[13px] text-text outline-none focus:border-border-stronger"/>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <AppDateField label="From" value={desde} min={limites.desde} max={hasta || limites.hasta} disabled={enviando} onChange={setDesde} referenceDate={limites.desde}/>
            <span className="text-text-subtle">to</span>
            <AppDateField label="To" value={hasta} min={desde || limites.desde} max={limites.hasta} disabled={enviando} onChange={setHasta} referenceDate={limites.hasta}/>
            <button type="button" disabled={enviando} onClick={() => {setDesde(limites.desde); setHasta(limites.hasta);}} className="insp-focus-ring h-[35px] rounded-[10px] border border-border px-3 text-text-muted hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40">Full date range</button>
            <PistasScope familiasEvaluables={corrida.familias_evaluables}/>
          </div>
          <span className="text-[11px] text-text-subtle">Priority period for the AI review.</span>
        </div>}
      </div>
      {error && <p role="alert" className="rounded-control border border-error/20 bg-error/5 px-4 py-3 text-xs leading-relaxed text-error">{error}</p>}
    </form>
  );
}
