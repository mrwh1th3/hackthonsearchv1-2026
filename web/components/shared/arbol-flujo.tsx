"use client";

import { duracion, formatoTokens, nombreAgente, type EstadoNodo, type EtapaArbol, type NodoAgente } from "@/lib/analisis/arbol";
import { cn } from "@/lib/utils";

const ESTADOS_RUNTIME_ACTIVOS = new Set(["preparar_contexto", "solicitar_modelo", "ejecutar_herramienta", "validar_salida", "reparar_json", "espera_reintento"]);
function runtimeActivo(estadoInterno: string): boolean {
  return ESTADOS_RUNTIME_ACTIVOS.has(estadoInterno);
}

const ESTADO_NODO: Record<EstadoNodo, { texto: string; punto: string }> = {
  pendiente: { texto: "Pending", punto: "bg-border-stronger" },
  ejecutando: { texto: "In progress", punto: "bg-live-dot" },
  completada: { texto: "Completed", punto: "bg-text" },
  omitida: { texto: "Skipped", punto: "bg-border-strong" },
  error: { texto: "Error", punto: "bg-error" },
};

/** Flecha vertical: línea de 1px y punta, del color de borde fuerte del diseño. */
export function Flecha({ alto = 22 }: { alto?: number }) {
  return (
    <span aria-hidden className="flex flex-none flex-col items-center">
      <span className="w-px bg-border-stronger" style={{ height: alto }} />
      <span className="h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-border-stronger" />
    </span>
  );
}

function TarjetaAgente({ nodo, ahora, onAbrir }: { nodo: NodoAgente; ahora: number; onAbrir?: () => void }) {
  const e = ESTADO_NODO[nodo.estado];
  const fin = nodo.detenido ? new Date(nodo.detenido).getTime() : ahora;
  const rt = nodo.runtime;
  const tokensMostrados = rt && (rt.tokens_in != null || rt.tokens_out != null) ? (rt.tokens_in ?? 0) + (rt.tokens_out ?? 0) : nodo.tokens;
  const elapsedRuntime = rt ? duracion(rt.creado, runtimeActivo(rt.estado_interno) && !rt.cancelada ? ahora : new Date(rt.actualizado).getTime()) : null;
  return (
    <button
      type="button"
      onClick={onAbrir}
      disabled={!onAbrir}
      className={cn(
        "insp-focus-ring flex w-[176px] flex-col gap-1 rounded-[13px] border bg-surface px-3 py-2.5 text-left transition-colors duration-150",
        onAbrir && "hover:border-border-stronger hover:bg-surface-hover",
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
        {duracion(nodo.iniciado, fin)} · {formatoTokens(tokensMostrados)} tokens
      </span>
      {elapsedRuntime && (
        <span className="text-[10.5px] text-text-subtle" title="Runtime: created to last update (or now, while running)">
          runtime: {elapsedRuntime}
        </span>
      )}
      {rt?.toolEnCurso && (
        <span className="flex items-center gap-1 text-[10.5px] text-live-fg">
          <span className="h-1 w-1 flex-none animate-pulse rounded-full bg-live-dot" aria-hidden />
          herramienta: {rt.toolEnCurso.nombre ?? "in progress"}
        </span>
      )}
    </button>
  );
}

/**
 * Una etapa del árbol: con varios agentes se abre en abanico (bus horizontal
 * arriba, una bajada con flecha por agente) y se vuelve a juntar abajo para
 * seguir a la siguiente etapa. Las líneas son medias líneas por hijo, sin
 * `gap`, para que el bus quede continuo a cualquier ancho.
 */
function Etapa({ etapa, ahora, onAbrir, ultima }: { etapa: EtapaArbol; ahora: number; onAbrir?: (n: NodoAgente) => void; ultima: boolean }) {
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
          <span className="rounded-[13px] border border-dashed border-border-dashed px-4 py-2 text-[11.5px] text-placeholder">No tasks yet</span>
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
                <TarjetaAgente nodo={nodo} ahora={ahora} onAbrir={onAbrir ? () => onAbrir(nodo) : undefined} />
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

/**
 * El mismo árbol de trabajo (entrada → rondas de especialistas → auditoría →
 * defensa → auditor final → redacción) que se ve mientras la investigación
 * corre (`analisis-canvas.tsx`). Extraído aquí para que el mapa lógico
 * histórico (`MapaLogico`, `mapa-logico.tsx`) sea el mismo mapa, no uno
 * distinto — pedido explícito del usuario (2026-09-13): "que se vea que es
 * un clon del mapa de flujo que se usaba mientras se hacía la investigación".
 */
export function ArbolFlujo({
  etapas,
  ahora,
  onAbrir,
}: {
  etapas: EtapaArbol[];
  ahora: number;
  onAbrir?: (n: NodoAgente) => void;
}) {
  return (
    <div className="flex w-full flex-col items-center">
      {etapas.map((etapa, i) => (
        <Etapa key={etapa.id} etapa={etapa} ahora={ahora} ultima={i === etapas.length - 1} onAbrir={onAbrir} />
      ))}
    </div>
  );
}
