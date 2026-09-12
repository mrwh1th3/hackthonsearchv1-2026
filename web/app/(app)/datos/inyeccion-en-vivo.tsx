"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DownloadMenu } from "@/components/shared/download-menu";
import { COLUMNAS_POR_TABLA, generarPlantillaCsv, TABLAS_CANONICAS, type TablaCanonica } from "@/lib/ingesta/plantillas";
import type { Corrida } from "@/lib/data";

/**
 * 21 §3.1: modo "Inyectar datos en vivo" — pegar filas por tabla canónica,
 * plantilla CSV descargable por tabla. El POST real va a `/api/inyecciones`
 * (ya construido, valida sesión y forma; sin N8N_WEBHOOK_BASE/
 * INTERNAL_WEBHOOK_SECRET responde 503 backend_no_configurado, nunca
 * finge aceptación). `ingesta_id` aquí es un placeholder generado en el
 * cliente: no existe todavía un endpoint que registre la ingesta antes de
 * inyectar (ver solicitudes_coordinador).
 */
export function InyeccionEnVivo({ corridas }: { corridas: Corrida[] }) {
  const [corridaBaseId, setCorridaBaseId] = useState(corridas[0]?.id ?? "");
  const [filasPorTabla, setFilasPorTabla] = useState<Record<TablaCanonica, string>>(
    Object.fromEntries(TABLAS_CANONICAS.map((t) => [t, ""])) as Record<TablaCanonica, string>,
  );
  const [enviando, setEnviando] = useState(false);

  const tablasConDatos = TABLAS_CANONICAS.filter((t) => filasPorTabla[t].trim().length > 0);

  async function enviar() {
    if (!corridaBaseId) {
      toast.error("Selecciona una corrida base.", { duration: Infinity });
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/inyecciones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          corrida_base_id: corridaBaseId,
          ingesta_id: crypto.randomUUID(),
          idempotency_key: crypto.randomUUID(),
          prioridad: "inyectados",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 503 && body.error === "backend_no_configurado") {
        toast.error("Backend de inyección no configurado en este entorno todavía.", { duration: Infinity });
      } else if (res.ok) {
        toast.success("Inyección recibida.");
      } else {
        toast.error(`No se pudo inyectar (${body.error ?? res.status}).`, { duration: Infinity });
      }
    } catch {
      toast.error("No se pudo conectar con el servidor.", { duration: Infinity });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="corrida-base">
          Corrida base (nunca se muta; se clona)
        </label>
        <select
          id="corrida-base"
          value={corridaBaseId}
          onChange={(e) => setCorridaBaseId(e.target.value)}
          className="h-9 w-full max-w-sm rounded-[var(--radius-input)] border border-border bg-surface px-2 text-sm"
        >
          {corridas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      <ul className="space-y-3">
        {TABLAS_CANONICAS.map((tabla) => (
          <li key={tabla} className="rounded-[var(--radius-input)] border border-border p-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium text-text">{tabla}</p>
              <DownloadMenu
                options={[
                  {
                    label: "Plantilla CSV",
                    build: () => ({ content: generarPlantillaCsv(tabla), filename: `${tabla}-plantilla.csv`, mime: "text/csv;charset=utf-8" }),
                  },
                ]}
              />
            </div>
            <p className="mb-1 text-[11px] text-text-subtle">Columnas: {COLUMNAS_POR_TABLA[tabla].join(", ")}</p>
            <textarea
              rows={2}
              value={filasPorTabla[tabla]}
              onChange={(e) => setFilasPorTabla((prev) => ({ ...prev, [tabla]: e.target.value }))}
              placeholder="Pega filas CSV o JSON aquí…"
              className="w-full resize-y rounded-[var(--radius-input)] border border-border bg-surface-muted p-2 font-mono text-xs"
            />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-text-subtle">{tablasConDatos.length} de {TABLAS_CANONICAS.length} tabla(s) con filas pegadas.</p>
        <button
          type="button"
          onClick={enviar}
          disabled={enviando}
          className="h-9 rounded-[var(--radius-input)] bg-primary px-4 text-sm text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {enviando ? "Enviando…" : "Inyectar"}
        </button>
      </div>
    </div>
  );
}
