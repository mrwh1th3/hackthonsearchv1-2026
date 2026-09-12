"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DownloadMenu } from "@/components/shared/download-menu";
import { COLUMNAS_POR_TABLA, generarPlantillaCsv, TABLAS_CANONICAS, type TablaCanonica } from "@/lib/ingesta/plantillas";
import { construirInyectar, parsearFilasPegadas } from "@/lib/ingesta/construir-inyectar";
import type { Corrida } from "@/lib/data";

/**
 * 21 §3.1: modo "Inyectar datos en vivo" — pegar filas (CSV o JSON) por
 * tabla canónica, plantilla CSV descargable por tabla. El POST va a
 * `/api/inyecciones` con el JSON exacto de `product.inyectar` (contratos
 * 1.2.0): `{corrida_base_id, origen, tablas: {<tabla>: fila[]},
 * idempotency_key}` — construido con la misma función
 * (`lib/ingesta/construir-inyectar.ts`) que valida el uploader de CSV, y
 * validado ahí mismo antes de enviarlo para no gastar la solicitud si el
 * texto pegado no produjo filas válidas.
 */
export function InyeccionEnVivo({ corridas }: { corridas: Corrida[] }) {
  const [corridaBaseId, setCorridaBaseId] = useState(corridas[0]?.id ?? "");
  const [filasPorTabla, setFilasPorTabla] = useState<Record<TablaCanonica, string>>(
    Object.fromEntries(TABLAS_CANONICAS.map((t) => [t, ""])) as Record<TablaCanonica, string>,
  );
  const [enviando, setEnviando] = useState(false);

  const filasParseadasPorTabla = useMemo(
    () => Object.fromEntries(TABLAS_CANONICAS.map((t) => [t, parsearFilasPegadas(filasPorTabla[t])])) as Record<TablaCanonica, ReturnType<typeof parsearFilasPegadas>>,
    [filasPorTabla],
  );
  const tablasConDatos = TABLAS_CANONICAS.filter((t) => filasParseadasPorTabla[t].length > 0);

  async function enviar() {
    if (!corridaBaseId) {
      toast.error("Selecciona una corrida base.", { duration: Infinity });
      return;
    }
    if (tablasConDatos.length === 0) {
      toast.error("Pega al menos una fila válida en alguna tabla.", { duration: Infinity });
      return;
    }
    setEnviando(true);
    try {
      const payload = construirInyectar({
        corridaBaseId,
        origen: "ui",
        tablas: filasParseadasPorTabla,
        idempotencyKey: crypto.randomUUID(),
      });
      const res = await fetch("/api/inyecciones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 503 && body.error === "backend_no_configurado") {
        toast.error("Backend de inyección no configurado en este entorno todavía.", { duration: Infinity });
      } else if (res.status === 202) {
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
              <p className="text-sm font-medium text-text">
                {tabla}
                {filasParseadasPorTabla[tabla].length > 0 && (
                  <span className="ml-2 rounded-full bg-ok/10 px-1.5 text-[10px] font-normal text-ok">{filasParseadasPorTabla[tabla].length} fila(s)</span>
                )}
              </p>
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
              placeholder="Pega filas CSV (con encabezado) o un arreglo JSON aquí…"
              className="w-full resize-y rounded-[var(--radius-input)] border border-border bg-surface-muted p-2 font-mono text-xs"
            />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-text-subtle">{tablasConDatos.length} de {TABLAS_CANONICAS.length} tabla(s) con filas válidas.</p>
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
