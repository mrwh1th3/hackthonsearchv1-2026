"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Pause, Send, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CanvasHeader } from "@/components/shared/canvas-header";
import type { Caso, EventoForense, Tarea } from "@/lib/data";
import {
  construirArbol,
  duracion,
  formatoTokens,
  nombreAgente,
  type EstadoNodo,
  type EtapaArbol,
  type NodoAgente,
} from "@/lib/analisis/arbol";
import { fechaHora } from "@/lib/date/formato";
import { cn } from "@/lib/utils";

export interface EstadoAnalisis {
  caso: Caso | null;
  tareas: Tarea[];
  eventos: EventoForense[];
}

const INTERVALO_MS = 3000;

/**
 * Sondea `/api/analisis/[casoId]` mientras el caso no esté dictaminado. Mismo
 * criterio que `useNotificacionesPolling`: arranca al montar, no sondea con la
 * pestaña oculta y se detiene al desmontar o al terminar.
 */
function useEstadoAnalisis(casoId: string, inicial: EstadoAnalisis) {
  const [estado, setEstado] = useState(inicial);
  const terminadoRef = useRef(false);

  useEffect(() => {
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
          if (res.ok && !cancelado) setEstado((await res.json()) as EstadoAnalisis);
        } catch {
          // Red caída: se reintenta en el siguiente intervalo sin tocar lo ya pintado.
        }
      }
      if (!cancelado) temporizador = setTimeout(sondear, INTERVALO_MS);
    }
    temporizador = setTimeout(sondear, INTERVALO_MS);
    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [casoId]);

  return { estado, terminadoRef };
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

const ESTADO_NODO: Record<EstadoNodo, { texto: string; punto: string }> = {
  pendiente: { texto: "Pendiente", punto: "bg-border-stronger" },
  ejecutando: { texto: "En proceso", punto: "bg-live-dot" },
  completada: { texto: "Completado", punto: "bg-text" },
  omitida: { texto: "Omitido", punto: "bg-border-strong" },
  error: { texto: "Error", punto: "bg-error" },
};

/** Flecha vertical: línea de 1px y punta, del color de borde fuerte del diseño. */
function Flecha({ alto = 22 }: { alto?: number }) {
  return (
    <span aria-hidden className="flex flex-none flex-col items-center">
      <span className="w-px bg-border-stronger" style={{ height: alto }} />
      <span className="h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-border-stronger" />
    </span>
  );
}

function TarjetaAgente({ nodo, ahora, onAbrir }: { nodo: NodoAgente; ahora: number; onAbrir: () => void }) {
  const e = ESTADO_NODO[nodo.estado];
  const fin = nodo.detenido ? new Date(nodo.detenido).getTime() : ahora;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        "insp-focus-ring flex w-[168px] flex-col gap-1 rounded-[13px] border bg-surface px-3 py-2.5 text-left transition-colors duration-150 hover:border-border-stronger hover:bg-surface-hover",
        nodo.estado === "ejecutando" ? "border-border-strong shadow-[0_1px_3px_rgba(20,20,19,.06)]" : "border-border",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 flex-none rounded-full", e.punto, nodo.estado === "ejecutando" && "animate-pulse")} />
        <span className="truncate text-[12.5px] font-medium capitalize text-text">{nombreAgente(nodo.agente)}</span>
      </span>
      <span className="text-[11.5px] text-text-subtle">
        {e.texto}
        {nodo.intento > 0 ? ` · intento ${nodo.intento + 1}` : ""}
      </span>
      <span className="text-[11px] text-text-subtle">
        {duracion(nodo.iniciado, fin)} · {formatoTokens(nodo.tokens)} tokens
      </span>
    </button>
  );
}

/**
 * Una etapa del árbol: con varios agentes se abre en abanico (bus horizontal
 * arriba, una bajada con flecha por agente) y se vuelve a juntar abajo para
 * seguir a la siguiente etapa. Las líneas son medias líneas por hijo, sin
 * `gap`, para que el bus quede continuo a cualquier ancho.
 */
function Etapa({ etapa, ahora, onAbrir, ultima }: { etapa: EtapaArbol; ahora: number; onAbrir: (n: NodoAgente) => void; ultima: boolean }) {
  const n = etapa.nodos.length;
  return (
    <div className="flex flex-col items-center">
      <span
        className={cn(
          "rounded-[var(--radius-pill)] border px-2.5 py-[3px] text-[11px] uppercase tracking-[.05em]",
          etapa.pendiente ? "border-dashed border-border-dashed text-placeholder" : "border-border-strong bg-surface-raised text-text-subtle",
        )}
      >
        {etapa.titulo}
      </span>

      {etapa.pendiente ? (
        <>
          <span aria-hidden className="h-4 w-px border-l border-dashed border-border-dashed" />
          <span className="rounded-[13px] border border-dashed border-border-dashed px-4 py-2 text-[11.5px] text-placeholder">Sin tareas todavía</span>
        </>
      ) : (
        <>
          <span aria-hidden className="h-3 w-px bg-border-stronger" />
          <div className="flex max-w-full overflow-x-auto">
            {etapa.nodos.map((nodo, i) => (
              <div key={nodo.id} className="relative flex flex-col items-center px-2">
                {n > 1 && i > 0 && <span aria-hidden className="absolute left-0 right-1/2 top-0 h-px bg-border-stronger" />}
                {n > 1 && i < n - 1 && <span aria-hidden className="absolute left-1/2 right-0 top-0 h-px bg-border-stronger" />}
                <Flecha alto={12} />
                <TarjetaAgente nodo={nodo} ahora={ahora} onAbrir={() => onAbrir(nodo)} />
                {!ultima && <span aria-hidden className="h-3 w-px bg-border-stronger" />}
                {!ultima && n > 1 && i > 0 && <span aria-hidden className="absolute bottom-0 left-0 right-1/2 h-px bg-border-stronger" />}
                {!ultima && n > 1 && i < n - 1 && <span aria-hidden className="absolute bottom-0 left-1/2 right-0 h-px bg-border-stronger" />}
              </div>
            ))}
          </div>
        </>
      )}
      {!ultima && <Flecha alto={14} />}
    </div>
  );
}

function ModalAgente({
  nodo,
  ahora,
  onCerrar,
}: {
  nodo: NodoAgente | null;
  ahora: number;
  onCerrar: () => void;
}) {
  const [nota, setNota] = useState("");
  const abierto = nodo != null;
  const fin = nodo?.detenido ? new Date(nodo.detenido).getTime() : ahora;

  // Sin backend de control todavía: no hay estado `pausada` en
  // `forense.tareas_agente` ni webhook de pausa/nota en `n8n/workflows`. Se
  // dice en pantalla en vez de fingir que la corrida se detuvo (regla 3: la
  // UI no llama a n8n directo para suplirlo).
  function pausar() {
    toast.info("Pausar un subagente todavía no está conectado al runtime; el agente sigue en ejecución.");
  }
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nota.trim()) {
      toast.info("La nota es opcional: escribe algo para enviarla.");
      return;
    }
    toast.info("Las notas a subagentes todavía no se persisten; la nota no se envió.");
  }

  return (
    <Dialog.Root open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 focus:outline-none"
        >
          {/* "X" fuera de la caja visual, en su esquina superior derecha. */}
          <Dialog.Close
            aria-label="Cerrar"
            className="insp-focus-ring absolute -top-11 right-0 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text-muted shadow-[0_1px_3px_rgba(20,20,19,.08)] transition-colors hover:bg-surface-hover"
          >
            <X size={15} aria-hidden />
          </Dialog.Close>

          {nodo && (
            <div className="flex max-h-[80vh] flex-col gap-4 rounded-[var(--radius-composer)] border border-border bg-surface p-5 shadow-xl">
              <div className="flex flex-col gap-1">
                <Dialog.Title className="m-0 text-[18px] font-semibold tracking-tight text-text">
                  Subagente de {nombreAgente(nodo.agente)}
                </Dialog.Title>
                <p className="m-0 text-[13px] text-text-muted">Etapa de {nodo.etapa}</p>
                <p className="m-0 text-[12px] text-text-subtle">
                  {duracion(nodo.iniciado, fin)} en ejecución · {formatoTokens(nodo.tokens)} tokens consumidos
                </p>
              </div>

              <ol className="m-0 flex min-h-0 list-none flex-col gap-2.5 overflow-y-auto border-t border-border p-0 pt-3.5">
                {nodo.logs.length === 0 && <li className="text-[12.5px] text-text-subtle">Sin pasos registrados en la bitácora todavía.</li>}
                {nodo.logs.map((log) => (
                  <li key={log.id} className="flex flex-col gap-0.5">
                    <span className="break-words text-[13px] text-text">{log.nombre}</span>
                    {log.ts ? (
                      <span className="text-[11.5px] text-text-subtle">{fechaHora(log.ts)}</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[11.5px] text-text-subtle">
                        En proceso <Puntos />
                      </span>
                    )}
                  </li>
                ))}
              </ol>

              <form onSubmit={enviar} className="flex items-center gap-2">
                <input
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  maxLength={2000}
                  placeholder="Nota para el subagente (opcional)"
                  aria-label="Nota (opcional)"
                  className="h-9 min-w-0 flex-1 rounded-[var(--radius-input)] border border-border bg-surface-raised px-3 text-[13px] text-text outline-none transition-colors placeholder:text-placeholder focus:border-primary focus:bg-surface"
                />
                <button
                  type="button"
                  onClick={pausar}
                  aria-label="Pausar"
                  className="flex h-9 flex-none items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-[12.5px] text-text-muted transition-colors hover:bg-surface-hover"
                >
                  <Pause size={13} aria-hidden /> Pausar
                </button>
                <button
                  type="submit"
                  aria-label="Enviar"
                  className="flex h-9 flex-none items-center gap-1.5 rounded-[10px] bg-primary px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover"
                >
                  <Send size={13} aria-hidden /> Enviar
                </button>
              </form>

              <button
                type="button"
                onClick={onCerrar}
                className="h-9 w-full rounded-[10px] border border-border bg-surface text-[12.5px] text-text-muted transition-colors hover:bg-surface-hover"
              >
                Salir
              </button>
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
}: {
  casoId: string;
  etiqueta: string;
  enVivo: boolean;
  inicial: EstadoAnalisis;
}) {
  const { estado, terminadoRef } = useEstadoAnalisis(casoId, inicial);
  const arbol = useMemo(() => construirArbol(estado.caso, estado.tareas, estado.eventos), [estado]);
  useEffect(() => {
    terminadoRef.current = arbol.terminado;
  }, [arbol.terminado, terminadoRef]);
  const ahora = useAhora(!arbol.terminado);
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const nodoAbierto = abiertoId ? (arbol.etapas.flatMap((e) => e.nodos).find((n) => n.id === abiertoId) ?? null) : null;

  const caso = estado.caso;
  const fin = caso?.terminado ? new Date(caso.terminado).getTime() : ahora;

  // Auditoría de un estate: al dictaminarse, todo se muestra en su investigación
  // (hallazgos, descartes, reporte), en el mismo lugar que el resto de investigaciones.
  const router = useRouter();
  const investigacionAuditoria = caso?.origen === "auditoria" ? (caso.origen_valor ?? null) : null;
  const destinoResultados = investigacionAuditoria ? `/documentos/${investigacionAuditoria}?doc=0` : `/casos/${casoId}/expediente`;
  useEffect(() => {
    if (!investigacionAuditoria || caso?.estado !== "dictaminado") return;
    const t = setTimeout(() => router.push(`/documentos/${investigacionAuditoria}?doc=0`), 2500);
    return () => clearTimeout(t);
  }, [investigacionAuditoria, caso?.estado, router]);

  // Control de la corrida: mismo motivo que en el modal — no existe todavía
  // la ruta BFF → webhook de cancelación/pausa, así que no se finge.
  function cancelar() {
    toast.info("Cancelar el análisis todavía no está conectado al runtime; la investigación sigue en curso.");
  }
  function pausar() {
    toast.info("Pausar el análisis todavía no está conectado al runtime; la investigación sigue en curso.");
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
              Atrás
            </Link>
          </div>
        }
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-card-lg)] border border-border bg-surface-raised bg-[radial-gradient(#e6e3dd_1px,transparent_1px)] [background-size:22px_22px]">
        <span className="absolute left-4 top-3.5 text-[11px] uppercase tracking-[.05em] text-text-subtle">Canvas</span>

        <div className="mx-auto flex w-full max-w-[900px] flex-col items-center gap-6 px-4 pb-8 pt-12">
          <header className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="m-0 flex items-end gap-2 text-[26px] font-medium tracking-tight text-text">
              {arbol.terminado ? (caso?.estado === "error" ? "Análisis con error" : "Análisis terminado") : "Análisis en proceso"}
              {!arbol.terminado && (
                <span className="pb-[9px]">
                  <Puntos />
                </span>
              )}
            </h1>
            <p className="m-0 text-[12.5px] text-text-subtle">
              {duracion(caso?.creado, fin)} de ejecución · {formatoTokens(arbol.tokens)} tokens consumidos
            </p>
          </header>

          <div className="flex w-full flex-col items-center gap-1">
            <h2 className="m-0 text-[15px] font-medium text-text">Árbol de trabajo:</h2>
            <p className="m-0 text-[12.5px] text-text-subtle">En etapa de {arbol.etapaActual}</p>
          </div>

          <div className="flex w-full flex-col items-center">
            {/* Entrada: el cluster que recibió el caso (persistido en `casos`). */}
            <div className="flex w-[260px] flex-col gap-1 rounded-[13px] border border-border-strong bg-surface px-3.5 py-2.5 text-center">
              <span className="text-[11px] uppercase tracking-[.05em] text-text-subtle">Entrada</span>
              {caso ? (
                <>
                  <span className="truncate text-[13px] font-medium text-text">{caso.rfc_principal}</span>
                  <span className="text-[11.5px] text-text-subtle">
                    Cluster de {1 + caso.rfcs_satelite.length} RFC · caso {caso.id.slice(0, 8)}
                  </span>
                </>
              ) : (
                <span className="text-[12px] text-text-subtle">Solicitud aceptada; esperando que se cree el caso</span>
              )}
            </div>
            <Flecha />
            {arbol.etapas.map((etapa, i) => (
              <Etapa key={etapa.id} etapa={etapa} ahora={ahora} ultima={i === arbol.etapas.length - 1} onAbrir={(n) => setAbiertoId(n.id)} />
            ))}
          </div>

          {!arbol.terminado && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelar}
                className="h-9 rounded-[10px] border border-border bg-surface px-4 text-[12.5px] text-text-muted transition-colors hover:bg-surface-hover"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={pausar}
                className="flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[12.5px] font-medium text-white transition-colors hover:bg-primary-hover"
              >
                <Pause size={13} aria-hidden /> Pausar
              </button>
            </div>
          )}
        </div>
      </div>

      <ModalAgente key={abiertoId ?? "cerrado"} nodo={nodoAbierto} ahora={ahora} onCerrar={() => setAbiertoId(null)} />
    </>
  );
}
