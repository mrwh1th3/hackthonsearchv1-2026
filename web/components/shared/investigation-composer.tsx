"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { Periodo } from "@/lib/data";
import { cn } from "@/lib/utils";
import { SUGERENCIAS, SuggestionChips, type Sugerencia } from "./suggestion-chips";

export interface InvestigationComposerProps {
  corridaId: string;
  clusterId?: string;
  rfcsDisponibles: string[];
  periodo: Periodo;
  evidenciaIdsDisponibles?: string[];
  className?: string;
}

/**
 * 15 §6: compositor de investigación. Sugerencia = directriz + contexto
 * visible y editable ("Contexto que se enviará"); Investigar es la única
 * acción que envía. El servidor resuelve/valida todo lo demás — este
 * componente nunca decide nivel ni calcula nada, solo arma el payload de
 * `product.investigar`.
 */
export function InvestigationComposer({
  corridaId,
  clusterId,
  rfcsDisponibles,
  periodo,
  evidenciaIdsDisponibles = [],
  className,
}: InvestigationComposerProps) {
  const [mensaje, setMensaje] = useState("");
  const [directrizId, setDirectrizId] = useState<Sugerencia["id"] | null>(null);
  const [rfcsSeleccionados, setRfcsSeleccionados] = useState<string[]>(rfcsDisponibles.slice(0, 1));
  const [evidenciaSeleccionada, setEvidenciaSeleccionada] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

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

  async function investigar() {
    if (!directrizId) return;
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
            corrida_id: corridaId,
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
    <div className={cn("rounded-[var(--radius-card)] border border-border bg-surface p-4", className)}>
      <SuggestionChips seleccionId={directrizId} onSelect={seleccionarSugerencia} disponible={disponible} className="mb-3" />

      <textarea
        value={mensaje}
        onChange={(e) => setMensaje(e.target.value)}
        placeholder="¿Qué quieres investigar?"
        rows={3}
        className="w-full resize-y rounded-[var(--radius-input)] border border-border bg-surface-muted p-3 text-sm outline-none focus:border-focus"
      />

      <div className="mt-3 rounded-[var(--radius-input)] border border-dashed border-border bg-surface-muted p-3 text-xs">
        <p className="mb-1.5 font-medium text-text-muted">Contexto que se enviará</p>
        <div className="flex flex-wrap gap-1.5">
          <ContextoChip label={`Corrida ${corridaId.slice(0, 8)}…`} />
          {clusterId && <ContextoChip label={`Cluster ${clusterId.slice(0, 8)}…`} />}
          {rfcsSeleccionados.map((rfc) => (
            <ContextoChip key={rfc} label={rfc} onRemove={() => quitarRfc(rfc)} />
          ))}
          {evidenciaSeleccionada.length > 0 && <ContextoChip label={`${evidenciaSeleccionada.length} evidencia(s)`} />}
          <ContextoChip label={`Periodo ${periodo.desde.slice(0, 10)} → ${periodo.hasta_exclusivo.slice(0, 10)}`} />
        </div>
        {evidenciaIdsDisponibles.length > 0 && evidenciaSeleccionada.length === 0 && (
          <button
            type="button"
            onClick={() => setEvidenciaSeleccionada(evidenciaIdsDisponibles)}
            className="mt-2 text-[11px] text-focus underline-offset-2 hover:underline"
          >
            Incluir toda la evidencia validada de este caso
          </button>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={investigar}
          disabled={!directrizId || enviando}
          className="h-10 rounded-[var(--radius-input)] bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {enviando ? "Enviando…" : "Investigar"}
        </button>
      </div>
    </div>
  );
}

function ContextoChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-text">
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Quitar ${label}`} className="text-text-subtle hover:text-text">
          <X size={12} />
        </button>
      )}
    </span>
  );
}
