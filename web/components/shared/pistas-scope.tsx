"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { FamiliaChip } from "./badges";
import { CATALOGO_PISTAS } from "@/lib/pistas/catalogo";
import type { Familia } from "@/lib/data";
import { cn } from "@/lib/utils";

export interface PistasScopeProps {
  /** `Corrida.familias_evaluables` — única señal real de alcance que trae la corrida (docs/22). */
  familiasEvaluables: Familia[];
  className?: string;
}

/**
 * Equivalente real del picker "Columns" del diseño (docs/22 "El picker
 * 'Columns' — se lee, no se inventa"). Es de LECTURA en este corte: enseña
 * las 14 pistas del catálogo con su alcance real por corrida y el conteo
 * "N de 14 en alcance". No hay checkbox que escriba nada — convertirlo en
 * entrada es el incremento siguiente (bump de contrato en
 * `product.investigar.contexto` + trazabilidad en el dictamen), así que
 * ningún control aquí debe parecer que hace algo que no hace.
 *
 * La evaluabilidad por pista se DERIVA de `familias_evaluables` (nivel
 * familia, lo único que el contrato de `Corrida` trae hoy); no existe un
 * accesor de `DataSource` hasta el nivel de pista individual con el motivo
 * persistido de `forense.marcar_no_evaluable` (003 §47), así que el motivo
 * mostrado aquí describe el hecho derivado ("familia fuera de
 * familias_evaluables de esta corrida"), nunca una cita textual de un
 * motivo que no se leyó. Ver reporte del corte para la solicitud al
 * coordinador de un accesor a nivel de pista.
 */
export function PistasScope({ familiasEvaluables, className }: PistasScopeProps) {
  const [open, setOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const enAlcance = useMemo(
    () => CATALOGO_PISTAS.filter((p) => familiasEvaluables.includes(p.familia)).length,
    [familiasEvaluables],
  );

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return CATALOGO_PISTAS;
    return CATALOGO_PISTAS.filter((p) => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q));
  }, [busqueda]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "insp-focus-ring flex h-8 items-center gap-1.5 rounded-[var(--radius-pill)] border border-border/80 bg-surface px-3 text-xs text-text-muted transition-colors hover:border-[var(--brand)]/35 hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]",
            className,
          )}
          aria-label={`Available checks for this dataset: ${enAlcance} de ${CATALOGO_PISTAS.length}`}
        >
          Checks
          <span className="text-text-subtle">
            {enAlcance}/{CATALOGO_PISTAS.length}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-[60] flex w-[300px] max-w-[calc(100vw-24px)] flex-col gap-2.5 rounded-[18px] border border-border/70 bg-surface p-3.5 shadow-[0_12px_40px_rgba(28,36,25,.12)]"
        >
          <div className="flex items-center gap-2 rounded-[11px] border border-border/80 bg-surface-raised px-2.5 transition-colors focus-within:border-[var(--focus)] focus-within:bg-surface focus-within:ring-2 focus-within:ring-[var(--brand-soft)]" style={{ height: 34 }}>
            <Search size={13} className="text-placeholder" aria-hidden />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar pistas"
              className="min-w-0 flex-1 border-none bg-transparent text-xs text-text outline-none"
            />
          </div>
          <p className="px-0.5 text-[11px] leading-relaxed text-text-subtle">
            {enAlcance} of {CATALOGO_PISTAS.length} available for this dataset. This list does not change the investigation scope.
          </p>
          <div className="flex max-h-[260px] flex-col gap-0.5 overflow-y-auto">
            {filtradas.map((p) => {
              const evaluable = familiasEvaluables.includes(p.familia);
              return (
                <div key={p.codigo} className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5">
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[4px] border",
                      evaluable ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]" : "border-border bg-surface-muted",
                    )}
                  >
                    {evaluable && <Check size={9} strokeWidth={3} />}
                  </span>
                  <FamiliaChip familia={p.familia} className="h-4 w-4 text-[9px]" />
                  <span className="min-w-0 flex-1 truncate text-xs text-text" title={evaluable ? undefined : `Category ${p.familia} outside this dataset's available checks`}>
                    {p.nombre}
                  </span>
                  <span className="flex-none font-mono text-[10.5px] text-text-subtle">{p.codigo}</span>
                </div>
              );
            })}
            {filtradas.length === 0 && <p className="px-2 py-3 text-center text-xs text-text-subtle">Ninguna pista coincide.</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
