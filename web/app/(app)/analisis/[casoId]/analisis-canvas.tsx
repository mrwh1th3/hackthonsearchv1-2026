"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, GitBranch, Pause, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoardTimeline } from "@/components/shared/board-timeline";
import { CanvasHeader } from "@/components/shared/canvas-header";
import { ArbolFlujo, Flecha } from "@/components/shared/arbol-flujo";
import { MapaLogico } from "@/components/shared/mapa-logico";
import type { Caso, EventoForense, Senal, Tarea } from "@/lib/data";
import { mapSenal } from "@/lib/data/supabase";
import { useCanalForense } from "@/lib/realtime/usar-canal";
import { construirArbol, duracion, formatoTokens, nombreAgente, type NodoAgente } from "@/lib/analisis/arbol";
import { fechaHora } from "@/lib/date/formato";
import { cn } from "@/lib/utils";
import type { EjecucionAgenteInfo } from "@/lib/data/privado";
import { estimarCostoUsd, formatoCostoEstimado } from "@/lib/analisis/costo";

const ESTADOS_RUNTIME_ACTIVOS = new Set(["preparar_contexto", "solicitar_modelo", "ejecutar_herramienta", "validar_salida", "reparar_json", "espera_reintento"]);

/** `true` mientras el runtime sigue en un estado activo (no terminó/erró/hizo timeout). */
function runtimeActivo(estadoInterno: string): boolean {
  return ESTADOS_RUNTIME_ACTIVOS.has(estadoInterno);
}

export interface EstadoAnalisis {
  caso: Caso | null;
  tareas: Tarea[];
  eventos: EventoForense[];
  /**
   * Runtime real de agentes (BFF privado, `/api/analisis/[casoId]`):
   * `undefined` en el estado inicial pasado por Server Components que no lo
   * cargaron todavía (se trata igual que "sin ejecuciones"), nunca inventado.
   */
  runtime?: { ejecuciones: EjecucionAgenteInfo[]; tokensTotales: { in: number; out: number } | null; costoTotal: number | null };
  /** Pizarrón (`forense.senales`, pública + realtime): sembrado por el poll, mantenido en vivo por `useCanalForense`. */
  senales?: Senal[];
}

const INTERVALO_MS = 3000;

/**
 * Sondea `/api/analisis/[casoId]` mientras el caso no esté dictaminado. Mismo
 * criterio que `useNotificacionesPolling`: arranca al montar, no sondea con la
 * pestaña oculta y se detiene al desmontar o al terminar.
 */
function useEstadoAnalisis(casoId: string, inicial: EstadoAnalisis, sondear: boolean) {
  const [estado, setEstado] = useState(inicial);
  const [errorActualizacion, setErrorActualizacion] = useState(false);
  const terminadoRef = useRef(false);

  // Preview de desarrollo: pinta el estado inicial tal cual, sin pedir nada.
  useEffect(() => {
    if (!sondear) setEstado(inicial);
  }, [sondear, inicial]);

  useEffect(() => {
    if (!sondear) return;
    let cancelado = false;
    let temporizador: ReturnType<typeof setTimeout>;
    let ciclo = 0;
    async function sondear() {
      if (terminadoRef.current || cancelado) return;
      // Con la pestaña oculta se sigue sondeando, pero uno de cada cuatro ciclos: una auditoría
      // de fondo que termina mientras nadie mira debe verse terminada al volver.
      ciclo += 1;
      if (document.visibilityState !== "hidden" || ciclo % 4 === 0) {
        try {
          const res = await fetch(`/api/analisis/${encodeURIComponent(casoId)}`, { cache: "no-store" });
          if (!cancelado) {
            if (res.ok) { setEstado((await res.json()) as EstadoAnalisis); setErrorActualizacion(false); }
            else setErrorActualizacion(true);
          }
        } catch {
          if (!cancelado) setErrorActualizacion(true);
          // Keep the last persisted state while retrying.
        }
      }
      if (!cancelado) temporizador = setTimeout(sondear, INTERVALO_MS);
    }
    temporizador = setTimeout(sondear, INTERVALO_MS);
    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [casoId, sondear]);

  return { estado, terminadoRef, errorActualizacion };
}

/** Reloj de pantalla para el tiempo transcurrido; los instantes de inicio/fin sí son persistidos. */
function useAhora(activo: boolean) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activo]);
  return ahora;
}

function Puntos() {
  return (
    <span aria-hidden className="insp-dots inline-flex items-end gap-[3px]">
      <span className="h-[5px] w-[5px] rounded-full bg-current" />
      <span className="h-[5px] w-[5px] rounded-full bg-current" />
      <span className="h-[5px] w-[5px] rounded-full bg-current" />
    </span>
  );
}

function ModalAgente({
  nodo,
  senales,
  ahora,
  onCerrar,
}: {
  nodo: NodoAgente | null;
  senales: Senal[];
  ahora: number;
  onCerrar: () => void;
}) {
  const abierto = nodo != null;
  const fin = nodo?.detenido ? new Date(nodo.detenido).getTime() : ahora;
  // Lo que descubrió este subagente: sus anotaciones en el pizarrón
  // (`forense.senales`) de la misma ronda. El id del nodo es `agente:ronda`.
  const ronda = nodo ? Number(nodo.id.split(":")[1]) : NaN;
  const hallazgos = nodo
    ? senales
        .filter((s) => s.agente === nodo.agente && (Number.isNaN(ronda) || s.ronda === ronda))
        .sort((a, b) => (a.creado || "").localeCompare(b.creado || ""))
    : [];

  return (
    <Dialog.Root open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 focus:outline-none"
        >
          {nodo && (
            <div className="relative flex max-h-[80vh] flex-col gap-4 rounded-[var(--radius-composer)] border border-border bg-surface p-5 shadow-xl">
              <Dialog.Close
                aria-label="Close"
                className="insp-focus-ring absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-hover"
              >
                <X size={15} aria-hidden />
              </Dialog.Close>
              <div className="flex flex-col gap-1 pr-8">
                <Dialog.Title className="m-0 text-[18px] font-semibold tracking-tight text-text">
                  Agent for {nombreAgente(nodo.agente)}
                </Dialog.Title>
                <p className="m-0 text-[13px] text-text-muted">Stage of {nodo.etapa}</p>
                <p className="m-0 text-[12px] text-text-subtle">
                  {duracion(nodo.iniciado, fin)} Running · {formatoTokens(nodo.tokens)} tokens used
                </p>
                {nodo.runtime && (
                  <p className="m-0 text-[11.5px] text-text-subtle">
                    Runtime: paso {nodo.runtime.paso} · {nodo.runtime.estado_interno.replaceAll("_", " ")} ·{" "}
                    {nodo.runtime.tokens_in != null || nodo.runtime.tokens_out != null
                      ? `${formatoTokens(nodo.runtime.tokens_in ?? 0)} in / ${formatoTokens(nodo.runtime.tokens_out ?? 0)} out`
                      : "tokens no disp."}{" "}
                    · {formatoCostoEstimado(estimarCostoUsd(nodo.runtime.model_id, nodo.runtime.tokens_in, nodo.runtime.tokens_out))} ·{" "}
                    {duracion(nodo.runtime.creado, runtimeActivo(nodo.runtime.estado_interno) && !nodo.runtime.cancelada ? ahora : new Date(nodo.runtime.actualizado).getTime())}{" "}
                    runtime
                  </p>
                )}
              </div>

              {nodo.runtime && nodo.runtime.tools.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                  <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">
                    Herramientas ({nodo.runtime.tools.length})
                  </span>
                  <ul className="m-0 flex max-h-[140px] list-none flex-col gap-1.5 overflow-y-auto p-0">
                    {nodo.runtime.tools.map((t) => (
                      <li key={t.id} className="flex flex-col gap-0.5 rounded-[8px] border border-border bg-surface-raised px-2 py-1.5">
                        <span className="flex items-center gap-1.5 text-[12px] text-text">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 flex-none rounded-full",
                              t.estado === "ejecutando" ? "bg-live-dot animate-pulse" : t.estado === "error" ? "bg-error" : "bg-border-stronger",
                            )}
                          />
                          {t.nombre ?? "herramienta"}
                          {t.args_hash && <span className="font-mono text-[10px] text-text-subtle">#{t.args_hash.slice(0, 8)}</span>}
                        </span>
                        <span className="text-[10.5px] text-text-subtle">
                          {t.duracion_ms != null ? `${t.duracion_ms} ms` : "in progress"}
                          {t.resultado_resumen ? ` · ${t.resultado_resumen}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex min-h-0 flex-col gap-1.5 border-t border-border pt-3">
                <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Hallazgos ({hallazgos.length})</span>
                {hallazgos.length === 0 ? (
                  <p className="m-0 text-[12.5px] text-text-subtle">
                    {nodo.estado === "pendiente" || nodo.estado === "ejecutando"
                      ? "This investigator has not recorded findings yet."
                      : "This investigator recorded no findings."}
                  </p>
                ) : (
                  <ul className="m-0 flex max-h-[220px] list-none flex-col gap-1.5 overflow-y-auto p-0">
                    {hallazgos.map((s) => (
                      <li key={s.id} className="flex flex-col gap-0.5 rounded-[8px] border border-border bg-surface-raised px-2.5 py-1.5">
                        <span className="text-[12.5px] leading-snug text-text">{s.titular}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-text-subtle">
                          confianza {s.confianza}
                          {s.refuta && <span className="rounded-[var(--radius-pill)] border border-border px-1.5">descarta</span>}
                          {s.ids.length > 0 && (
                            <span className="font-mono">
                              {s.ids.slice(0, 3).join(", ")}
                              {s.ids.length > 3 ? ` +${s.ids.length - 3}` : ""}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {nodo.logs.length > 0 && (
                <ol className="m-0 flex min-h-0 list-none flex-col gap-2.5 overflow-y-auto border-t border-border p-0 pt-3.5">
                {nodo.logs.map((log) => (
                  <li key={log.id} className="flex flex-col gap-0.5">
                    <span className="break-words text-[13px] text-text">{log.nombre}</span>
                    {log.ts ? (
                      <span className="text-[11.5px] text-text-subtle">{fechaHora(log.ts)}</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[11.5px] text-text-subtle">
                        In progress <Puntos />
                      </span>
                    )}
                  </li>
                ))}
                </ol>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Canvas "Análisis en proceso" (pedido del usuario, 2026-09-12) dentro del
 * lienzo punteado del bloque `boardOpen` del diseño: encabezado con los tres
 * puntos, tiempo y tokens; "Árbol de trabajo:" con la etapa actual; el árbol
 * entrada → rondas de especialistas → auditoría → defensa → auditor final →
 * redacción; y Cancelar/Pausar debajo. Cada subagente abre su modal.
 */
export function AnalisisCanvas({
  casoId,
  etiqueta,
  enVivo,
  inicial,
  sondear = true,
}: {
  casoId: string;
  etiqueta: string;
  enVivo: boolean;
  inicial: EstadoAnalisis;
  /** `false` solo en `/analisis/preview` (datos de ejemplo, sin BFF). */
  sondear?: boolean;
}) {
  const { estado, terminadoRef, errorActualizacion } = useEstadoAnalisis(casoId, inicial, sondear);
  const arbol = useMemo(
    () => construirArbol(estado.caso, estado.tareas, estado.eventos, estado.runtime?.ejecuciones ?? []),
    [estado],
  );
  useEffect(() => {
    terminadoRef.current = arbol.terminado;
  }, [arbol.terminado, terminadoRef]);
  const ahora = useAhora(!arbol.terminado);
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const [vistaAnalisis, setVistaAnalisis] = useState<"flujo" | "mapa" | "eventos">("flujo");
  const nodoAbierto = abiertoId ? (arbol.etapas.flatMap((e) => e.nodos).find((n) => n.id === abiertoId) ?? null) : null;

  const caso = estado.caso;
  const fin = caso?.terminado ? new Date(caso.terminado).getTime() : ahora;

  // Pizarrón en vivo: sembrado por el poll (`estado.senales`), luego
  // suscrito directo a `forense.senales` filtrado por cluster (regla 12: una
  // inyección con el sistema corriendo debe verse sin recargar).
  const [senales, setSenales] = useState<Senal[]>(estado.senales ?? []);
  useEffect(() => setSenales(estado.senales ?? []), [estado.senales]);
  useCanalForense({
    tabla: "senales",
    filtro: caso?.cluster_id ? `cluster_id=eq.${caso.cluster_id}` : undefined,
    onCambio: (payload) => {
      if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
      const senal = mapSenal(payload.new as Record<string, unknown>);
      setSenales((actual) => [...actual.filter((s) => s.id !== senal.id), senal]);
    },
  });

  // Auditoría de un estate: al dictaminarse, todo se muestra en su investigación
  // (hallazgos, descartes, reporte). No se navega solo: el usuario decide seguir.
  const investigacionAuditoria = caso?.origen === "auditoria" ? (caso.origen_valor ?? null) : null;
  const destinoResultados = investigacionAuditoria ? `/documentos/${investigacionAuditoria}?doc=0` : `/casos/${casoId}/expediente`;

  // Gate "Continuar" (pedido 2026-09-13): al entrar a una investigación
  // nueva no se muestra el mapa lógico de inmediato, hay que confirmar
  // primero. Es URL-addressable (`?continuar=1`), no estado local, para que
  // sobreviva a un refresh/deep-link — el juez inyecta con el sistema
  // corriendo y puede recargar en cualquier momento (regla 12).
  const router = useRouter();
  const searchParams = useSearchParams();
  const continuar = searchParams.get("continuar") === "1";
  if (!continuar) {
    return (
      <>
        <CanvasHeader etiqueta={etiqueta} enVivo={enVivo} acciones={null} />
        <div className="insp-home relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-card-lg border border-border px-5 py-12 text-center">
          <span className="mb-2 flex h-14 w-14 items-center justify-center rounded-card-lg border border-border bg-surface"><GitBranch size={24} strokeWidth={1.4} className="text-text-muted" aria-hidden /></span>
          <span className="insp-eyebrow">TRAZABILIDAD DE LA INVESTIGACIÓN</span>
          <h1 className="m-0 max-w-[520px] text-balance font-display text-[32px] font-medium leading-tight tracking-tight text-text">Your investigation map will appear here</h1>
          <p className="m-0 max-w-[420px] text-[12.5px] text-text-subtle">
            Follow the investigation as its steps are recorded.
          </p>
          <button
            type="button"
            onClick={() => { const params = new URLSearchParams(searchParams.toString()); params.set("continuar", "1"); router.replace(`?${params.toString()}`); }}
            className="flex h-9 items-center rounded-[10px] bg-primary px-4 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <CanvasHeader
        etiqueta={etiqueta}
        enVivo={enVivo}
        acciones={
          <div className="flex items-center gap-2">
            {arbol.terminado && caso?.estado === "dictaminado" && (
              <Link
                href={destinoResultados}
                className="flex h-8 flex-none items-center rounded-[10px] bg-primary px-3.5 text-[12.5px] font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
              >
                Ver resultados
              </Link>
            )}
            <Link
              href="/"
              className="flex h-8 flex-none items-center rounded-[10px] border border-border bg-surface px-3.5 text-[12.5px] text-text-muted transition-colors duration-150 hover:bg-surface-hover"
            >
              Back
            </Link>
          </div>
        }
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-card-lg)] border border-border bg-surface-raised bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px]">
        <div className="absolute inset-x-4 top-3.5 flex items-center justify-between gap-3"><span className="insp-eyebrow">EJECUCIÓN DEL MOTOR EXISTENTE</span><Link href={caso?.corrida_id ? `/?corrida=${encodeURIComponent(caso.corrida_id)}` : "/"} className="flex items-center gap-1 text-[11px] text-text-subtle hover:text-text">New investigation <ArrowUpRight size={12} aria-hidden /></Link></div>

        <div className="mx-auto flex w-full max-w-[1080px] flex-col items-center gap-6 px-4 pb-8 pt-16 sm:px-6">
          <header className="flex w-full flex-col items-center gap-3 text-center">
            <h1 className="m-0 flex items-end gap-2 font-display text-[32px] font-medium tracking-tight text-text">
              {arbol.terminado ? (caso?.estado === "error" ? "Investigation interrupted" : "Investigation finished") : "Investigation in progress"}
              {!arbol.terminado && (
                <span className="pb-[9px]">
                  <Puntos />
                </span>
              )}
            </h1>
            <p className="m-0 text-[12.5px] text-text-subtle">
              {arbol.runtimeSpan
                ? `${duracion(arbol.runtimeSpan.desde, arbol.runtimeSpan.hasta ? new Date(arbol.runtimeSpan.hasta).getTime() : ahora)} de runtime`
                : `${duracion(caso?.creado, fin)} elapsed`}{" "}
              ·{" "}
              {arbol.tokensRuntime
                ? `${formatoTokens(arbol.tokensRuntime.in + arbol.tokensRuntime.out)} tokens (${formatoTokens(arbol.tokensRuntime.in)} in / ${formatoTokens(arbol.tokensRuntime.out)} out)`
                : `${formatoTokens(arbol.tokens)} tokens consumidos`}{" "}
              · {formatoCostoEstimado(arbol.costoEstimadoUsd)}
            </p>
          </header>

          {errorActualizacion && <p role="status" className="w-full rounded-control border border-warn/20 bg-surface px-4 py-3 text-[12px] text-warn">Could not refresh. Showing the last saved state and retrying automatically.</p>}

          <div className="grid w-full grid-cols-3 overflow-hidden rounded-card-sm border border-border bg-surface">
            {[{ label: "Recorded events", value: estado.eventos.length }, { label: "Recorded signals", value: senales.length }, { label: "Ejecuciones IA", value: estado.runtime === undefined ? "—" : estado.runtime.ejecuciones.length }].map((item) => <div key={item.label} className="flex flex-col gap-1 border-r border-border p-4 last:border-r-0"><span className="text-[10px] leading-relaxed text-text-subtle">{item.label}</span><span className="font-display text-2xl font-medium tabular-nums text-text">{item.value}</span></div>)}
          </div>
          <nav aria-label="Execution view" className="flex w-full flex-wrap gap-1 rounded-card-sm border border-border bg-surface p-1">
            {([{ id: "flujo", label: "Workflow tree" }, { id: "mapa", label: "Signal map" }, { id: "eventos", label: "Activity & evidence" }] as const).map((item) => <button key={item.id} type="button" aria-pressed={vistaAnalisis === item.id} onClick={() => setVistaAnalisis(item.id)} className={cn("rounded-control px-4 py-2.5 text-[12px] transition-colors", vistaAnalisis === item.id ? "bg-primary font-medium text-white" : "text-text-subtle hover:bg-surface-hover")}>{item.label}</button>)}
          </nav>

          {vistaAnalisis === "flujo" && <>
          <div className="flex w-full flex-col items-center gap-1">
            <h2 className="m-0 text-[15px] font-medium text-text">Workflow tree:</h2>
            <p className="m-0 text-[12.5px] text-text-subtle">In stage {arbol.etapaActual}</p>
          </div>

          <div className="flex w-full flex-col items-center">
            {/* Entrada: el cluster que recibió el caso (persistido en `casos`). */}
            <div className="flex w-[260px] flex-col gap-1 rounded-[13px] border border-border-strong bg-surface px-3.5 py-2.5 text-center">
              <span className="text-[11px] uppercase tracking-[.05em] text-text-subtle">Input</span>
              {caso ? (
                <>
                  <span className="truncate text-[13px] font-medium text-text">{caso.rfc_principal}</span>
                  <span className="text-[11.5px] text-text-subtle">
                    Group of {1 + caso.rfcs_satelite.length} RFC · caso {caso.id.slice(0, 8)}
                  </span>
                </>
              ) : (
                <span className="text-[12px] text-text-subtle">Request accepted. Waiting for the case.</span>
              )}
            </div>
            <Flecha />
            <ArbolFlujo etapas={arbol.etapas} ahora={ahora} onAbrir={(n) => setAbiertoId(n.id)} />
          </div>

          <p className="max-w-[600px] text-center text-[11px] leading-relaxed text-text-subtle">Open a step to inspect its activity. Rule checks and AI calls are labeled separately.</p>
          </>}
          {vistaAnalisis === "mapa" && <MapaLogico mode={arbol.terminado ? "historico" : "en_curso"} senales={senales} />}
          {vistaAnalisis === "eventos" && <section className="w-full rounded-card-sm border border-border bg-surface p-4 sm:p-5"><h2 className="mb-2 text-sm font-medium">Every step and its source</h2><p className="mb-5 text-xs leading-relaxed text-text-subtle">Select an event to inspect its evidence, identifiers and original record.</p><BoardTimeline eventos={estado.eventos} limite={20} /></section>}

          {arbol.terminado && caso?.estado === "dictaminado" && (
            <div className="flex w-full flex-col items-center gap-2.5 rounded-[13px] border border-border-strong bg-surface px-4 py-4 text-center">
              <span className="text-[13.5px] font-medium text-text">Investigation finished</span>
              <span className="text-[12px] text-text-subtle">Explore the workflow or continue to the results.</span>
              <Link
                href={destinoResultados}
                className="flex h-9 items-center rounded-[10px] bg-primary px-4 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                Continuar a resultados
              </Link>
            </div>
          )}

          {!arbol.terminado && (
            <div className="flex flex-col items-center gap-2"><p className="text-center text-[11px] text-text-subtle">Pause and cancellation are not available for this run.</p><div className="flex items-center gap-2">
              <button
                type="button"
                disabled
                title="Cancellation is unavailable for this run"
                className="h-9 rounded-[10px] border border-border bg-surface px-4 text-[12.5px] text-text-muted transition-colors hover:bg-surface-hover disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled
                title="Pause is unavailable for this run"
                className="flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                <Pause size={13} aria-hidden /> Pausar
              </button>
            </div></div>
          )}
        </div>
      </div>

      <ModalAgente key={abiertoId ?? "cerrado"} nodo={nodoAbierto} senales={senales} ahora={ahora} onCerrar={() => setAbiertoId(null)} />
    </>
  );
}
