"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { InvestigationDocument } from "@/components/editor/investigation-document";
import { RunTiming } from "@/components/editor/report-visuals";
import { ArrowUpRight } from "lucide-react";
import { effectiveStatus, isActive, STATUS_LABEL, type LabRun } from "@/lib/laboratorio/types";
import { CorridaPicker } from "./corrida-picker";
import { InvestigationComposer } from "./investigation-composer";
import type { Corrida } from "@/lib/data";

export interface InspectorHomeProps {
  corridas: Corrida[];
  corridaSeleccionada: Corrida | null;
  clusterId?: string;
  rfcsDisponibles?: string[];
  initialRuns?: LabRun[];
}

const NO_RUNS: LabRun[] = [];

/** Dataset selection, execution and results are states of the same original main screen. */
export function InspectorHome({ corridas, corridaSeleccionada, initialRuns = NO_RUNS }: InspectorHomeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const runParam = searchParams.get("run");
  const [elegida, setElegida] = useState<Corrida | null>(corridaSeleccionada);
  const [runActivo, setRunActivo] = useState<string | null>(runParam);
  const [runs, setRuns] = useState(initialRuns);
  useEffect(() => setRuns(initialRuns), [initialRuns]);
  const hasActive = runs.some(isActive);
  useEffect(() => {
    if (!hasActive || runActivo) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/laboratorio", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json() as { runs?: LabRun[] };
        if (!controller.signal.aborted && Array.isArray(body.runs)) setRuns(body.runs);
      } catch { /* Keep the last saved measurement until the next poll. */ }
    }
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [hasActive, runActivo]);
  useEffect(() => setElegida(corridaSeleccionada), [corridaSeleccionada]);
  useEffect(() => setRunActivo(runParam), [runParam]);

  function seleccionar(id: string | null) {
    setElegida(id ? (corridas.find((c) => c.id === id) ?? null) : null);
    setRunActivo(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("run");
    if (id) params.set("corrida", id);
    else params.delete("corrida");
    router.push(params.size ? `${pathname}?${params}` : pathname);
  }

  function iniciar(runId: string) {
    setRunActivo(runId);
    const params = new URLSearchParams(searchParams.toString());
    if (elegida) params.set("corrida", elegida.id);
    params.set("run", runId);
    router.push(`${pathname}?${params}`);
  }

  function volver() {
    setRunActivo(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("run");
    router.push(params.size ? `${pathname}?${params}` : pathname);
  }

  if (runActivo) {
    return <InvestigationDocument key={runActivo} runId={runActivo} onBack={volver} />;
  }

  const hay = elegida != null;
  const latest = runs.filter(run => run.launch.corrida_id === elegida?.id)
    .sort((a, b) => b.launch.started_at.localeCompare(a.launch.started_at))[0];
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-[30px] px-6 py-20">
      <header className="flex max-w-[640px] flex-col items-center gap-3 text-center">
        <h1 className="m-0 text-balance font-display text-[28px] font-medium leading-tight tracking-tight text-text-muted sm:text-[34px]">{hay ? "Start an investigation" : "Choose your data"}</h1>
      </header>
      <div aria-hidden={hay} inert={hay} className="flex w-full max-w-[700px] flex-col overflow-hidden" style={{ maxHeight: hay ? "0px" : "600px", opacity: hay ? 0 : 1, filter: hay ? "blur(10px)" : "blur(0px)", transform: hay ? "scale(.97)" : "scale(1)", pointerEvents: hay ? "none" : "auto" }}>
        <CorridaPicker corridas={corridas} onSelect={(id) => seleccionar(id)} />
      </div>
      {elegida && <InvestigationComposer key={elegida.id} corrida={elegida} onChangeDataset={() => seleccionar(null)} onStarted={iniciar} className="max-w-[700px]" />}
      {latest && <button type="button" onClick={() => iniciar(latest.launch.run_id)} aria-label={isActive(latest) ? "Follow latest investigation" : "Open latest investigation"} className="insp-focus-ring group flex w-full max-w-[700px] flex-wrap items-center justify-between gap-4 rounded-[16px] border border-border bg-surface px-5 py-4 text-left transition-colors hover:bg-[var(--brand-soft)]">
        <span className="flex min-w-0 flex-col gap-1.5"><span className="text-[10px] uppercase tracking-[.14em] text-text-subtle">Latest investigation{latest.launch.provider === "mock" ? " · Demo" : ""}</span><span className="text-[13px] text-text-muted">{STATUS_LABEL[effectiveStatus(latest)]}</span></span>
        <span className="flex flex-wrap items-center gap-4"><RunTiming run={latest} compact /><ArrowUpRight size={16} className="text-[var(--brand-strong)]" aria-hidden="true"/></span>
      </button>}
    </div>
  );
}
