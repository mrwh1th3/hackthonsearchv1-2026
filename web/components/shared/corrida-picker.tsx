"use client";

import { ArrowDownUp, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Corrida } from "@/lib/data";
import { soloFecha } from "@/lib/date/formato";
import { cn } from "@/lib/utils";

export interface CorridaPickerProps {
  corridas: Corrida[];
  onSelect: (id: string) => void;
}

type Orden = "reciente" | "antigua";

/**
 * Hero + picker del diseño Inspector (design-ref/Agents.dc.html líneas
 * 58-104), idéntico en estructura, con datos reales de `listCorridas()`
 * (docs/22 "hero + picker de datasets" -> `/`, corte 1 punto 3).
 *
 * Lo que el original fabrica y aquí no se copia: `d.size` no tiene fuente
 * real (`Corrida` no trae tamaño) y `d.dynamic`/el punto cuadrado-vs-redondo
 * eran del booleano inventado `SCHEMAS[...].dynamic` del bloque de lógica.
 * Se muestran en su lugar dataset/fecha de corte/estado (reales) y el badge
 * de inyección en vivo verdadero: `corrida_origen_id != null` (CLAUDE.md
 * regla 12), con los tokens `--live-*`.
 */
export function CorridaPicker({ corridas, onSelect }: CorridaPickerProps) {
  const [query, setQuery] = useState("");
  const [orden, setOrden] = useState<Orden>("reciente");
  const [estadoFiltro, setEstadoFiltro] = useState<string>("todos");

  const estados = useMemo(() => Array.from(new Set(corridas.map((c) => c.estado))).sort(), [corridas]);

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return corridas
      .filter((c) => estadoFiltro === "todos" || c.estado === estadoFiltro)
      .filter((c) => !q || c.nombre.toLowerCase().includes(q) || c.dataset.toLowerCase().includes(q))
      .sort((a, b) => {
        const diff = new Date(a.fecha_corte).getTime() - new Date(b.fecha_corte).getTime();
        return orden === "reciente" ? -diff : diff;
      });
  }, [corridas, query, estadoFiltro, orden]);

  return (
    <div className="flex w-full flex-col items-center gap-8 py-6">
      <h1 className="max-w-[640px] text-balance text-center text-[28px] font-medium leading-tight tracking-tight text-text-muted sm:text-[34px]">
        ¿Qué corrida quieres inspeccionar?
      </h1>

      <section className="flex w-full max-w-[700px] flex-col gap-3">
        <div className="flex items-stretch gap-3 max-sm:flex-col">
          <Link
            href="/datos"
            className="flex w-full flex-none flex-col items-center justify-center gap-3.5 rounded-[var(--radius-card-lg)] border border-dashed border-border-dashed bg-surface-raised px-5 py-8 text-center transition-colors hover:border-border-stronger hover:bg-surface-hover sm:w-[260px]"
          >
            <Upload size={28} strokeWidth={1.6} aria-hidden className="text-text" />
            <span className="text-[15px] font-medium text-text">Cargar datos</span>
            <span className="text-[12.5px] leading-relaxed text-text-subtle">CSV, JSON o base de datos en vivo</span>
          </Link>

          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <div className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-3 transition-colors focus-within:border-border-stronger">
                <Search size={14} className="text-placeholder" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar corridas"
                  className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-text outline-none"
                />
              </div>
              <select
                value={estadoFiltro}
                onChange={(e) => setEstadoFiltro(e.target.value)}
                aria-label="Filtrar por estado"
                className="h-[34px] rounded-[var(--radius-control)] border border-border bg-surface px-2 text-[12.5px] text-text-muted"
              >
                <option value="todos">Todos los estados</option>
                {estados.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOrden((o) => (o === "reciente" ? "antigua" : "reciente"))}
                className="flex h-[34px] flex-none items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-[13px] text-text-muted transition-colors hover:bg-surface-hover"
              >
                <ArrowDownUp size={13} aria-hidden />
                {orden === "reciente" ? "Más reciente" : "Más antigua"}
              </button>
            </div>

            <div className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto pb-1 pr-1">
              {visibles.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="flex flex-none items-center gap-2.5 rounded-[var(--radius-card-sm)] border border-border bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-primary" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text">{c.nombre}</span>
                  {c.corrida_origen_id != null && (
                    <span className="flex flex-none items-center gap-1.5 rounded-[6px] border border-live-border bg-live-bg px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-live-fg">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-live-dot" />
                      Inyección en vivo
                    </span>
                  )}
                  <span className="flex-none text-[11.5px] text-text-subtle">{c.estado}</span>
                  <span className="flex-none text-[11.5px] text-text-subtle">{soloFecha(c.fecha_corte)}</span>
                </button>
              ))}
              {visibles.length === 0 && corridas.length > 0 && (
                <p className="py-5 text-center text-[13px] text-text-subtle">Ningún dataset coincide con &ldquo;{query}&rdquo;.</p>
              )}
              {corridas.length === 0 && (
                <p className={cn("py-5 text-center text-[13px] text-text-subtle")}>
                  Sin corridas todavía. Carga un dataset en <Link href="/datos" className="text-focus underline-offset-2 hover:underline">/datos</Link> para empezar.
                </p>
              )}
            </div>
          </div>
        </div>

        <Link
          href="/datos"
          className="flex h-9 w-full items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-[12.5px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:border-border-strong"
        >
          Administrar datos
        </Link>
      </section>
    </div>
  );
}
