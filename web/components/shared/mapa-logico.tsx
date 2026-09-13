"use client";

import type { Senal } from "@/lib/data";
import type { AnotacionAgenteIA } from "@/lib/data/privado";
import { fechaHora, soloHora } from "@/lib/date/formato";
import { nombreAgente, type EtapaArbol } from "@/lib/analisis/arbol";
import { ArbolFlujo } from "@/components/shared/arbol-flujo";
import { cn } from "@/lib/utils";
import { useId, useState } from "react";
import { ArrowRight, Check, ChevronDown, Circle, GitBranch, LoaderCircle } from "lucide-react";

export interface FaseMapaLogico {
  id: string;
  label: string;
  status: string;
  detail?: string;
}

const ESTADO_FASE: Record<string, string> = {
  pending: "Pending", queued: "Queued", running: "Running", completed: "Completed",
  partial: "Finished", failed: "Interrupted", error: "Error", skipped: "Skipped",
  unrecorded: "Not recorded", awaiting_review: "Awaiting review",
};

const MACROFASES = [
  { id: "motor", label: "Rule checks", ids: ["engine", "motor", "load"], description: "The rule engine checks your data and loads the saved investigation context." },
  { id: "contexto", label: "Context", ids: ["context", "sample"], description: "Industry context and a bounded sample prepare both investigators." },
  { id: "agentes", label: "AI review", ids: ["agent_a", "agent_b", "handoff"], description: "A challenges known signals. B explores unflagged entities. Both use the same dataset." },
  { id: "compilador", label: "Synthesis", ids: ["compiler"], description: "Supported conclusions become proposals and notes for review." },
  { id: "revision", label: "Human review", ids: ["persist", "review", "human_review"], description: "Results are saved for human review. Saving is not approval." },
] as const;

type MacroId = typeof MACROFASES[number]["id"];

/** Macro states summarize persisted substeps; a saved proposal never implies human approval. */
function estadoMacro(id: MacroId, fases: FaseMapaLogico[]): string {
  if (!fases.length) return "unrecorded";
  if (fases.some((fase) => ["failed", "error"].includes(fase.status))) return "failed";
  if (fases.some((fase) => fase.status === "running")) return "running";
  if (fases.some((fase) => fase.status === "partial")) return "partial";
  const revisada = fases.some((fase) => ["review", "human_review"].includes(fase.id) && fase.status === "completed");
  if (id === "revision" && !revisada && fases.some((fase) => fase.id === "persist" && fase.status === "completed")) return "awaiting_review";
  if (fases.every((fase) => ["completed", "skipped"].includes(fase.status))) return "completed";
  return fases.some((fase) => fase.status === "queued") ? "queued" : "pending";
}

function IconoEstado({ estado }: { estado: string }) {
  if (estado === "running") return <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" aria-hidden />;
  if (estado === "completed") return <Check size={12} aria-hidden />;
  return <Circle size={8} fill={["partial", "failed", "error"].includes(estado) ? "currentColor" : "none"} aria-hidden />;
}

/** Compact first: five macro phases, with all operational substeps available on demand. */
function MapaFases({ fases, faseSeleccionada, onSeleccionarFase }: {
  fases: FaseMapaLogico[];
  faseSeleccionada?: string | null;
  onSeleccionarFase?: (id: string) => void;
}) {
  const detalleId = useId();
  const [desglosado, setDesglosado] = useState(false);
  const [grupoSeleccionado, setGrupoSeleccionado] = useState<MacroId | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);
  const seleccion = faseSeleccionada === undefined ? expandida : faseSeleccionada;
  const grupos = MACROFASES.map((grupo) => {
    const pasos = fases.filter((fase) => (grupo.ids as readonly string[]).includes(fase.id));
    return { ...grupo, pasos, estado: estadoMacro(grupo.id, pasos) };
  });
  const idsConocidos = new Set<string>(MACROFASES.flatMap((grupo) => [...grupo.ids]));
  const otrosPasos = fases.filter((fase) => !idsConocidos.has(fase.id));
  const grupo = grupos.find((item) => item.id === grupoSeleccionado)
    ?? grupos.find((item) => item.pasos.some((paso) => paso.id === seleccion))
    ?? grupos.find((item) => item.estado === "running")
    ?? grupos.find((item) => item.estado === "failed")
    ?? grupos.find((item) => item.pasos.length > 0);
  const activa = fases.find((fase) => fase.status === "running");

  function seleccionarFase(fase: FaseMapaLogico) {
    setExpandida(fase.id);
    onSeleccionarFase?.(fase.id);
  }

  function paso(fase: FaseMapaLogico) {
    const limitada = ["partial", "failed", "error"].includes(fase.status);
    return <div key={fase.id} className={cn("min-w-0 rounded-control border bg-surface", seleccion === fase.id ? "border-border-stronger" : "border-border")}>
      <button type="button" onClick={() => seleccionarFase(fase)} aria-label={`${fase.label}: ${ESTADO_FASE[fase.status] ?? fase.status}`} aria-expanded={seleccion === fase.id} className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
        <span className="min-w-0 text-[11.5px] font-medium text-text">{fase.label}</span>
        <span className={cn("flex flex-none items-center gap-1.5 text-[10px]", limitada ? "text-warn" : "text-text-subtle")}><IconoEstado estado={fase.status} />{ESTADO_FASE[fase.status] ?? fase.status.replaceAll("_", " ")}</span>
      </button>
      {seleccion === fase.id && <p className="whitespace-pre-line break-words border-t border-border px-3 py-2.5 text-[11.5px] leading-relaxed text-text-subtle">{fase.detail || "Open the investigation details to inspect the recorded checks and results."}</p>}
    </div>;
  }

  return (
    <section aria-label="Investigation map" className="flex w-full min-w-0 flex-col gap-3 rounded-card-sm border border-border bg-surface-raised px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="text-[12px] font-medium text-text">Investigation map</h2><p className="mt-0.5 truncate text-[10.5px] text-text-subtle">{activa ? `In progress · ${activa.label}` : "Data → rule checks → AI review → proposals"}</p></div>
        {fases.length > 0 && <button type="button" aria-expanded={desglosado} aria-controls={detalleId} onClick={() => setDesglosado((value) => !value)} className="flex flex-none items-center gap-1 rounded-control px-2 py-1.5 text-[10.5px] text-text-subtle hover:bg-surface hover:text-text">{desglosado ? "Hide steps" : "Explore steps"}<ChevronDown size={12} className={cn("transition-transform", desglosado && "rotate-180")} aria-hidden /></button>}
      </div>
      {fases.length === 0 ? <p className="rounded-control border border-dashed border-border bg-surface px-3 py-3 text-center text-[11.5px] text-text-subtle">Waiting for the first recorded step.</p> : <ol aria-label="Main stages" className="m-0 grid list-none grid-cols-5 gap-1 p-0 sm:gap-2">
        {grupos.map((item, index) => <li key={item.id} className="relative min-w-0"><button type="button" disabled={!item.pasos.length} aria-label={`${item.label}: ${ESTADO_FASE[item.estado] ?? item.estado}`} aria-expanded={desglosado && grupo?.id === item.id} onClick={() => { setGrupoSeleccionado(item.id); setDesglosado(true); const primera = item.pasos.find((fase) => fase.status === "running") ?? item.pasos[0]; if (primera) seleccionarFase(primera); }} className={cn("flex min-h-[54px] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-control border bg-surface px-0.5 py-2 text-center transition-colors hover:border-border-stronger disabled:cursor-default disabled:opacity-50", desglosado && grupo?.id === item.id || item.estado === "running" ? "border-border-stronger" : "border-border")}>
          <span className={cn("flex h-3 items-center justify-center", ["partial", "failed", "error", "awaiting_review"].includes(item.estado) ? "text-warn" : "text-text-subtle")}>{item.id === "agentes" && !["running", "completed"].includes(item.estado) ? <GitBranch size={12} aria-hidden /> : <IconoEstado estado={item.estado} />}</span>
          <span className="text-[10px] font-medium leading-tight text-text sm:text-[11px]">{item.label}</span>
          <span className="text-[8.5px] leading-tight text-text-subtle sm:text-[9px]">{ESTADO_FASE[item.estado] ?? item.estado}</span>
        </button>{index < grupos.length - 1 && <ArrowRight size={8} className="absolute -right-[6px] top-1/2 z-[1] -translate-y-1/2 bg-surface-raised text-text-subtle sm:-right-[8px]" aria-hidden />}</li>)}
      </ol>}
      {desglosado && <div id={detalleId} className="flex flex-col gap-3 border-t border-border pt-3">
        {grupo && <><p className="text-[11.5px] leading-relaxed text-text-subtle">{grupo.description}</p>
          {grupo.id === "agentes" ? <><div className="grid grid-cols-2 gap-2">{grupo.pasos.filter((fase) => ["agent_a", "agent_b"].includes(fase.id)).map(paso)}</div>{grupo.pasos.filter((fase) => fase.id === "handoff").map(paso)}</> : <div className="flex flex-col gap-2">{grupo.pasos.map(paso)}</div>}
          {grupo.estado === "awaiting_review" && <p className="text-[11px] leading-relaxed text-warn">Results saved. Human approval has not been recorded.</p>}
        </>}
        {otrosPasos.length > 0 && <details><summary className="text-[11px] text-text-subtle">Other recorded steps ({otrosPasos.length})</summary><div className="mt-2 flex flex-col gap-2">{otrosPasos.map(paso)}</div></details>}
      </div>}
    </section>
  );
}

/**
 * Mapa lógico: reemplaza al Pizarrón (regla del usuario, 2026-09-13) en las
 * dos pantallas donde vivía — `en_curso` sustituye a `Pizarron` dentro del
 * canvas de análisis (`analisis-canvas.tsx`), `historico` sustituye a
 * `SeccionPizarron`/`SeccionPizarronIA` en el expediente ya terminado
 * (`investigacion-resumen.tsx`).
 *
 * Los conteos de `historico` salen SIEMPRE de `senales` (escritas desde
 * `forense.bitacora`/`forense.senales`, capa determinista — regla 4: "el LLM
 * no calcula ni decide el nivel"). Las `anotaciones` (capa IA,
 * `forense.anotaciones_agente`) se muestran debajo como texto libre del
 * agente, nunca como fuente de un número — regla 6, texto no confiable.
 */
export function MapaLogico({
  mode,
  senales,
  anotaciones = [],
  etapas,
  fases,
  faseSeleccionada,
  onSeleccionarFase,
}: {
  mode: "en_curso" | "historico";
  senales: Senal[];
  anotaciones?: AnotacionAgenteIA[];
  /**
   * Árbol de trabajo ya construido (`construirArbol`, `lib/analisis/arbol.ts`)
   * de la MISMA investigación, congelado. Con esto el mapa lógico histórico
   * pinta el mismo árbol (entrada → rondas → auditoría → defensa → auditor
   * final → redacción) que se vio en vivo durante el análisis — no una vista
   * distinta con solo conteos.
   */
  etapas?: EtapaArbol[];
  fases?: FaseMapaLogico[];
  faseSeleccionada?: string | null;
  onSeleccionarFase?: (id: string) => void;
}) {
  if (fases !== undefined) return <MapaFases fases={fases} faseSeleccionada={faseSeleccionada} onSeleccionarFase={onSeleccionarFase} />;
  const ordenadas = [...senales].sort((a, b) => (a.creado || "").localeCompare(b.creado || ""));

  if (mode === "en_curso") {
    if (ordenadas.length === 0) {
      return (
        <div className="flex w-full flex-col gap-1.5 rounded-[13px] border border-dashed border-border-dashed px-3.5 py-3 text-center">
          <span className="text-[11px] uppercase tracking-[.05em] text-placeholder">Investigation map</span>
          <span className="text-[11.5px] text-placeholder">No steps have been recorded yet.</span>
        </div>
      );
    }
    return (
      <div className="flex w-full flex-col gap-2 rounded-[13px] border border-border bg-surface px-3.5 py-3">
        <span className="text-[11px] uppercase tracking-[.05em] text-text-subtle">Investigation map ({ordenadas.length})</span>
        <ol className="m-0 flex max-h-[220px] list-none flex-col gap-1.5 overflow-y-auto p-0">
          {ordenadas.map((s) => (
            <li key={s.id} className="flex flex-col gap-0.5 rounded-[8px] border border-border bg-surface-raised px-2.5 py-1.5">
              <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-text">
                <span className="font-medium capitalize">{nombreAgente(s.agente)}</span>
                <span className="text-text-subtle">ronda {s.ronda} · intento {s.intento + 1}</span>
                {s.refuta && <span className="rounded-[var(--radius-pill)] border border-border px-1.5 text-[10px] text-text-subtle">descarta</span>}
                {s.creado && <span className="ml-auto text-[10.5px] text-text-subtle">{fechaHora(s.creado)}</span>}
              </span>
              <span className="text-[12px] leading-snug text-text-muted">{s.titular}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // historico: conteo de pasos por agente (fuente: senales/bitácora, número real).
  const conteoPorAgente = new Map<string, number>();
  for (const s of ordenadas) conteoPorAgente.set(s.agente, (conteoPorAgente.get(s.agente) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-2.5">
      {etapas && etapas.length > 0 && (
        <div className="flex flex-col items-center gap-1.5 rounded-[13px] border border-border bg-surface-raised bg-[radial-gradient(#e6e3dd_1px,transparent_1px)] px-3.5 py-4 [background-size:22px_22px]">
          <span className="self-start text-[11px] uppercase tracking-[.05em] text-text-subtle">Saved investigation map</span>
          <ArbolFlujo etapas={etapas} ahora={Date.now()} />
        </div>
      )}
      <div className="flex flex-col gap-2 rounded-[13px] border border-border bg-surface px-3.5 py-3">
        <span className="text-[11px] uppercase tracking-[.05em] text-text-subtle">Investigation map · history ({ordenadas.length} pasos)</span>
        {conteoPorAgente.size === 0 ? (
          <p className="m-0 text-[12px] text-text-subtle">No activity has been recorded yet.</p>
        ) : (
          <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
            {[...conteoPorAgente.entries()].map(([agente, n]) => (
              <div key={agente} className="flex flex-col gap-1 rounded-[10px] border border-border bg-surface-raised px-2.5 py-2">
                <span className="text-[10.5px] uppercase tracking-[.03em] text-text-subtle capitalize">{nombreAgente(agente)}</span>
                <span className="text-[18px] font-semibold text-text">{n}</span>
              </div>
            ))}
          </div>
        )}
        <ol className="m-0 flex max-h-[220px] list-none flex-col gap-1.5 overflow-y-auto p-0">
          {ordenadas.map((s) => (
            <li key={s.id} className="flex flex-col gap-0.5 rounded-[8px] border border-border bg-surface-raised px-2.5 py-1.5">
              <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-text">
                <span className="font-medium capitalize">{nombreAgente(s.agente)}</span>
                <span className="text-text-subtle">ronda {s.ronda} · intento {s.intento + 1}</span>
                {s.refuta && <span className="rounded-[var(--radius-pill)] border border-border px-1.5 text-[10px] text-text-subtle">descarta</span>}
              </span>
              <span className="text-[12px] leading-snug text-text-muted">{s.titular}</span>
            </li>
          ))}
        </ol>
      </div>

      {/*
        Capa IA superpuesta (`anotaciones_agente`): texto libre del agente,
        `_untrusted` por naturaleza — visualmente distinta y jamás sumada al
        conteo de arriba (regla 6).
      */}
      <div className="flex flex-col gap-2 rounded-[13px] border border-dashed border-amber-300 bg-amber-50/40 px-3.5 py-3">
        <span className="text-[11px] uppercase tracking-[.05em] text-amber-700">AI notes (unverified) — {anotaciones.length}</span>
        {anotaciones.length === 0 ? (
          <p className="m-0 text-[12px] text-text-subtle">No AI notes for this investigation.</p>
        ) : (
          <ul className="m-0 flex flex-col gap-1.5 p-0">
            {anotaciones.map((a) => (
              <li key={a.id} className={cn("flex flex-col gap-0.5 rounded-[8px] border px-2.5 py-1.5", a.tipo === "error" ? "border-red-200 bg-red-50" : "border-amber-200 bg-white")}>
                <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-text">
                  <span className="font-medium capitalize">{nombreAgente(a.rol)}</span>
                  <span className="text-text-subtle">turno {a.turno}</span>
                  <span className="ml-auto text-[10.5px] text-text-subtle">{soloHora(a.creado)}</span>
                </span>
                {a.texto && <span className="text-[12px] leading-snug text-text-muted">{a.texto}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
