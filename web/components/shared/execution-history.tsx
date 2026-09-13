"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Investigacion } from "@/lib/data";
import { fechaHora } from "@/lib/date/formato";

export const ESTADO_LABEL: Record<Investigacion["estado"], string> = {
  en_cola: "Queued",
  investigando: "Investigating",
  generando_reporte: "Generando reporte",
  investigacion_completa: "Full investigation",
  parcial: "Parcial",
  error: "Error",
  cancelada: "Cancelada",
};

const ESTADO_CLASE: Record<Investigacion["estado"], string> = {
  en_cola: "bg-surface-muted text-text-subtle border-border",
  investigando: "bg-info/10 text-info border-info/30",
  generando_reporte: "bg-info/10 text-info border-info/30",
  investigacion_completa: "bg-ok/10 text-ok border-ok/30",
  parcial: "bg-warn/10 text-warn border-warn/30",
  error: "bg-error/10 text-error border-error/30",
  cancelada: "bg-surface-muted text-text-subtle border-border",
};

export interface EjecucionHija {
  id: string;
  agente: string;
  ronda: number;
  intento: number;
  estado: string;
}

export interface ExecutionHistoryRow {
  investigacion: Investigacion;
  duracionMs: number | null;
  autor: string;
  dataset: string;
  hijas?: EjecucionHija[];
}

/**
 * 15 §7: historial con columnas título/inicio-fin/origen/autor/directriz/
 * estado/duración/resultado/reporte/aviso, expandible a ejecuciones
 * técnicas hijas. "Investigación completa" es estado de entrega, no de
 * riesgo: nunca se confunde con el nivel del caso.
 */
export function ExecutionHistory({ rows, emptyMessage = "No investigations match this filter." }: { rows: ExecutionHistoryRow[]; emptyMessage?: string }) {
  if (rows.length === 0) {
    return <p className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-sm text-text-subtle">{emptyMessage}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <ExecutionRow key={row.investigacion.id} row={row} />
      ))}
    </ul>
  );
}

function ExecutionRow({ row }: { row: ExecutionHistoryRow }) {
  const [abierto, setAbierto] = useState(false);
  const { investigacion } = row;

  return (
    <li className="rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          aria-label={abierto ? "Contraer ejecuciones" : "Expandir ejecuciones"}
          className="rounded p-0.5 text-text-subtle hover:bg-surface-hover"
          disabled={!row.hijas || row.hijas.length === 0}
        >
          <ChevronDown size={16} className={cn("transition-transform", abierto && "rotate-180")} />
        </button>

        <div className="min-w-[180px] flex-1">
          <Link href={`/documentos/${investigacion.id}`} className="font-medium text-text hover:underline">
            {investigacion.titulo ?? investigacion.mensaje ?? "Investigation"}
          </Link>
          <p className="text-xs text-text-subtle">
            {fechaHora(investigacion.creado)}
            {investigacion.completada_at ? ` → ${fechaHora(investigacion.completada_at)}` : ""}
          </p>
        </div>

        <span className="text-xs text-text-subtle">{row.dataset}</span>
        <span className="text-xs text-text-subtle">{row.autor}</span>
        <span className="text-xs text-text-subtle">{investigacion.directriz_id ?? "—"}</span>
        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", ESTADO_CLASE[investigacion.estado])}>
          {ESTADO_LABEL[investigacion.estado]}
        </span>
        <span className="text-xs tabular-nums text-text-subtle">{row.duracionMs !== null ? `${Math.round(row.duracionMs / 1000)}s` : "—"}</span>
        {investigacion.reporte_manifest.length > 0 ? (
          <Link href={`/casos/${investigacion.reporte_manifest[0].caso_id}/expediente`} className="text-xs text-focus hover:underline">
            Abrir reporte
          </Link>
        ) : (
          <span className="text-xs text-text-subtle">Sin reporte</span>
        )}
      </div>

      {abierto && row.hijas && row.hijas.length > 0 && (
        <div className="border-t border-border bg-surface-muted p-3">
          <p className="mb-1.5 text-xs font-medium text-text-muted">Technical runs</p>
          <ul className="space-y-1 text-xs text-text-subtle">
            {row.hijas.map((h) => (
              <li key={h.id} className="flex gap-2">
                <span className="font-mono">{h.agente}</span>
                <span>ronda {h.ronda}</span>
                <span>intento {h.intento}</span>
                <span>{h.estado}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
