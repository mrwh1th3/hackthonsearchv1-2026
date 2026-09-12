"use client";

import { ChevronDown, SendHorizonal, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { DateRangePicker } from "./date-range-picker";
import { PistasScope } from "./pistas-scope";
import { SUGERENCIAS, SuggestionChips, type Sugerencia } from "./suggestion-chips";
import type { Corrida, Periodo } from "@/lib/data";
import { ZONA_POR_OMISION } from "@/lib/date/formato";
import { cn } from "@/lib/utils";

export interface InvestigationComposerProps {
  corrida: Corrida;
  clusterId?: string;
  rfcsDisponibles: string[];
  evidenciaIdsDisponibles?: string[];
  /** docs/22 "dataset seleccionado + composer": el pill "Cambiar dataset" regresa al picker. */
  onChangeDataset?: () => void;
  className?: string;
}

/**
 * Composer del diseño Inspector (design-ref/Agents.dc.html líneas 107-166),
 * idéntico en estructura — pill de dataset + tarjeta redondeada con un
 * conmutador "Contexto" que expande contexto/fechas/alcance de pistas, y un
 * botón de envío — con lo del dominio (15 §6: sugerencias = directriz,
 * requisito del contrato) añadido dentro, en el mismo lenguaje visual.
 *
 * El rango de fechas NO reproduce los dos `<input type="date">` sueltos del
 * original: usa `DateRangePicker` (ya probado, docs H11-g/`lib/date/range`)
 * para no reintroducir a mano la conversión de zona horaria naive que ese
 * módulo existe para evitar. Es la única pieza donde gana la corrección de
 * fecha sobre la fidelidad pixel a pixel — ver reporte del corte.
 *
 * Nunca decide nivel ni calcula nada (CLAUDE.md regla 4): arma el payload
 * de `product.investigar` y lo manda al BFF (`/api/investigaciones`), que
 * es quien valida contra el contrato y reenvía a n8n.
 */
export function InvestigationComposer({
  corrida,
  clusterId,
  rfcsDisponibles,
  evidenciaIdsDisponibles = [],
  onChangeDataset,
  className,
}: InvestigationComposerProps) {
  const [expandido, setExpandido] = useState(true);
  const [mensaje, setMensaje] = useState("");
  const [directrizId, setDirectrizId] = useState<Sugerencia["id"] | null>(null);
  const [rfcsSeleccionados, setRfcsSeleccionados] = useState<string[]>(rfcsDisponibles.slice(0, 1));
  const [evidenciaSeleccionada, setEvidenciaSeleccionada] = useState<string[]>([]);
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [enviando, setEnviando] = useState(false);

  const limites = useMemo(() => {
    const desde = new Date(corrida.inicio);
    const finInclusive = new Date(corrida.fin ?? corrida.fecha_corte);
    const hastaExclusivo = new Date(finInclusive.getTime() + 24 * 60 * 60 * 1000);
    return { desde, hastaExclusivo, referencia: new Date(corrida.fecha_corte) };
  }, [corrida.inicio, corrida.fin, corrida.fecha_corte]);

  // Identidad estable: `DateRangePicker` vuelve a disparar su efecto cuando
  // `onChange` cambia de referencia (lee `rango`/`preset`/`onChange` en su
  // dependencia). Una función inline nueva en cada render, junto con el
  // `setPeriodo` que dispara, formaría un bucle de renders infinito — se
  // reprodujo al escribir la prueba de este componente.
  const onPeriodoResuelto = useCallback((r: { desde: string; hasta_exclusivo: string; timezone: string }) => {
    setPeriodo({ desde: r.desde, hasta_exclusivo: r.hasta_exclusivo, timezone: r.timezone });
  }, []);

  const disponible = useMemo(
    () => ({ rfc: rfcsSeleccionados.length > 0, cluster: Boolean(clusterId), evidencia: evidenciaSeleccionada.length > 0 }),
    [rfcsSeleccionados, clusterId, evidenciaSeleccionada],
  );

  function seleccionarSugerencia(s: Sugerencia) {
    setDirectrizId(s.id);
    if (!mensaje) setMensaje(`${s.titulo}: `);
  }

  function quitarRfc(rfc: string) {
    setRfcsSeleccionados((prev) => prev.filter((r) => r !== rfc));
  }

  async function investigar(e: React.FormEvent) {
    e.preventDefault();
    if (!directrizId || !periodo) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/investigaciones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mensaje: mensaje || SUGERENCIAS.find((s) => s.id === directrizId)?.titulo || "Investigar",
          directriz_id: directrizId,
          directriz_version: 1,
          contexto: {
            corrida_id: corrida.id,
            cluster_id: clusterId,
            rfcs: rfcsSeleccionados,
            evidencia_ids: evidenciaSeleccionada,
            periodo,
          },
          investigacion_padre_id: null,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 202 || res.ok) {
        toast.success("Investigación aceptada. Aparecerá en la cola cuando se persista.");
      } else if (res.status === 503 && body.error === "backend_no_configurado") {
        toast.error("El backend de investigación no está configurado en este entorno todavía.", { duration: Infinity });
      } else if (res.status === 401) {
        toast.error("Sesión expirada. Vuelve a entrar.", { duration: Infinity });
      } else {
        toast.error(`No se pudo enviar la investigación (${body.error ?? res.status}).`, { duration: Infinity });
      }
    } catch {
      toast.error("No se pudo conectar con el servidor.", { duration: Infinity });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={investigar} className={cn("flex w-full flex-col gap-2.5", className)}>
      <div className="flex items-center justify-center gap-2">
        <span className="flex h-[30px] max-w-[280px] items-center gap-1.5 truncate rounded-[var(--radius-pill)] border border-border-strong bg-surface-raised px-3 text-[12.5px] text-text">
          <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-primary" />
          {corrida.nombre}
        </span>
        {onChangeDataset && (
          <button
            type="button"
            onClick={onChangeDataset}
            className="h-[30px] rounded-[var(--radius-pill)] border border-border px-3 text-[12.5px] text-text-muted transition-colors hover:bg-surface-hover"
          >
            Cambiar dataset
          </button>
        )}
      </div>

      <div className="flex flex-col rounded-[var(--radius-composer)] border border-border-strong bg-surface p-3.5 shadow-[0_1px_3px_rgba(20,20,19,.05)]">
        <div className="flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={expandido}
            className={cn(
              "flex h-8 items-center gap-2 rounded-[var(--radius-pill)] border border-border px-3.5 text-[12.5px] text-text-muted transition-colors hover:bg-surface-hover hover:border-border-strong",
              expandido && "bg-surface-muted",
            )}
          >
            Contexto
            <ChevronDown size={13} className={cn("transition-transform", expandido && "rotate-180")} aria-hidden />
          </button>
          <button
            type="submit"
            disabled={!directrizId || !periodo || enviando}
            className="flex h-[34px] items-center gap-1.5 rounded-[var(--radius-pill)] bg-primary px-4 text-[13px] font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            <SendHorizonal size={14} aria-hidden />
            {enviando ? "Enviando…" : "Inspeccionar"}
          </button>
        </div>

        {expandido && (
          <div className="mt-3.5 flex flex-col gap-3 border-t border-border pt-3.5">
            <SuggestionChips seleccionId={directrizId} onSelect={seleccionarSugerencia} disponible={disponible} />

            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Agrega contexto para esta inspección…"
              className="w-full resize-none rounded-[var(--radius-card-sm)] border border-border bg-surface-raised p-3 text-[13.5px] leading-relaxed text-text outline-none transition-colors focus:border-primary focus:bg-surface"
            />

            {rfcsSeleccionados.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {rfcsSeleccionados.map((rfc) => (
                  <span key={rfc} className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-border bg-surface px-2 py-0.5 text-xs text-text">
                    {rfc}
                    <button type="button" onClick={() => quitarRfc(rfc)} aria-label={`Quitar ${rfc}`} className="text-text-subtle hover:text-text">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {evidenciaIdsDisponibles.length > 0 && evidenciaSeleccionada.length === 0 && (
              <button
                type="button"
                onClick={() => setEvidenciaSeleccionada(evidenciaIdsDisponibles)}
                className="self-start text-[11px] text-focus underline-offset-2 hover:underline"
              >
                Incluir toda la evidencia validada de este caso
              </button>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <DateRangePicker
                alcance="dataset"
                referencia={limites.referencia}
                timezone={ZONA_POR_OMISION}
                datasetDesde={limites.desde}
                datasetHastaExclusivo={limites.hastaExclusivo}
                presetInicial="todo_el_dataset"
                onChange={onPeriodoResuelto}
              />
              <span className="h-[18px] w-px flex-none bg-border" aria-hidden />
              <PistasScope familiasEvaluables={corrida.familias_evaluables} className="ml-auto" />
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
