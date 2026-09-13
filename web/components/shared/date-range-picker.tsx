"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveDateRangePreset, type AlcanceRango, type RangoPreset, type RangoResuelto } from "@/lib/date/range";
import { AppDateField, isISODate } from "./app-date-field";

const PRESETS: RangoPreset[] = ["hoy", "ayer", "7d", "30d", "90d", "mes_actual", "mes_anterior", "todo_el_dataset"];
const PRESET_LABELS: Record<RangoPreset, string> = {
  hoy: "Today", ayer: "Yesterday", "7d": "7 days", "30d": "30 days", "90d": "90 days",
  mes_actual: "This month", mes_anterior: "Last month", todo_el_dataset: "Full dataset", personalizado: "Custom",
};

export interface DateRangePickerProps {
  /** "ejecucion": reloj real (historial). "dataset": ancla a fecha_corte del snapshot (analítica), 15 §9. */
  alcance: AlcanceRango;
  /** Reloj real (alcance ejecución) o fecha_corte del snapshot (alcance dataset). */
  referencia: Date;
  timezone?: string;
  datasetDesde?: Date;
  datasetHastaExclusivo?: Date;
  onChange?: (rango: RangoResuelto & { preset: RangoPreset }) => void;
  /** Preset seleccionado al montar (default "30d"); el llamador lo ajusta cuando 30 días dejaría vacía la vista (p.ej. datos históricos fijos de un fixture). */
  presetInicial?: RangoPreset;
  className?: string;
}

/**
 * 15 §9: presets + rango personalizado con inputs manuales, dos alcances
 * separados, salida siempre en UTC con fin exclusivo (ver `lib/date/range`).
 * El calendario comparte la entrada ISO manual; la conversión de zona
 * horaria permanece en el contrato existente, cubierta por tests.
 */
export function DateRangePicker({
  alcance,
  referencia,
  timezone = "America/Monterrey",
  datasetDesde,
  datasetHastaExclusivo,
  onChange,
  presetInicial = "30d",
  className,
}: DateRangePickerProps) {
  const [preset, setPreset] = useState<RangoPreset>(presetInicial);
  const [personalizadoDesde, setPersonalizadoDesde] = useState("");
  const [personalizadoHasta, setPersonalizadoHasta] = useState("");
  const idBase = useId();
  const referenceDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(referencia);

  const rango = useMemo<RangoResuelto | null>(() => {
    try {
      if (preset === "personalizado") {
        if (!isISODate(personalizadoDesde) || !isISODate(personalizadoHasta)) return null;
        const [y1, m1, d1] = personalizadoDesde.split("-").map(Number);
        const [y2, m2, d2] = personalizadoHasta.split("-").map(Number);
        return resolveDateRangePreset({
          preset,
          timezone,
          referencia,
          personalizado: {
            desde: new Date(Date.UTC(y1, m1 - 1, d1)),
            // "hasta" del input es el último día incluido; el contrato pide fin exclusivo (día siguiente).
            hastaExclusivo: new Date(Date.UTC(y2, m2 - 1, d2 + 1)),
          },
        });
      }
      return resolveDateRangePreset({ preset, timezone, referencia, datasetDesde, datasetHastaExclusivo });
    } catch {
      return null;
    }
  }, [preset, personalizadoDesde, personalizadoHasta, timezone, referencia, datasetDesde, datasetHastaExclusivo]);

  // Propaga el rango resuelto al montar y cada vez que cambia — así el
  // preset visualmente activo (incluido `presetInicial`) siempre coincide
  // con lo que el llamador está filtrando, sin esperar al primer click.
  // 'personalizado' es la excepción: solo se propaga al pulsar "Aplicar"
  // (evita recalcular en cada tecla mientras se escribe la fecha).
  useEffect(() => {
    if (preset !== "personalizado" && rango) onChange?.({ ...rango, preset });
  }, [rango, preset, onChange]);

  function selectPreset(p: RangoPreset) {
    setPreset(p);
  }

  function applyPersonalizado() {
    if (rango) onChange?.({ ...rango, preset: "personalizado" });
  }

  function limpiar() {
    setPreset(presetInicial);
    setPersonalizadoDesde("");
    setPersonalizadoHasta("");
  }

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="date-range-picker">
      <div className="flex items-center gap-1.5 text-xs text-text-subtle">
        <span>{alcance === "dataset" ? "Dataset period" : "Execution period"}</span>
        <span aria-hidden>·</span>
        <span>{timezone}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => selectPreset(p)}
            aria-pressed={preset === p}
            className={cn(
              "insp-focus-ring h-8 rounded-full border border-border px-3 text-xs transition-colors",
              preset === p ? "border-[var(--brand)]/25 bg-[var(--brand-soft)] text-[var(--brand-strong)]" : "bg-surface text-text-muted hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]",
            )}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreset("personalizado")}
          aria-pressed={preset === "personalizado"}
          className={cn(
            "insp-focus-ring h-8 rounded-full border border-border px-3 text-xs transition-colors",
            preset === "personalizado" ? "border-[var(--brand)]/25 bg-[var(--brand-soft)] text-[var(--brand-strong)]" : "bg-surface text-text-muted hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]",
          )}
        >
          Custom
        </button>
        <button type="button" onClick={limpiar} className="insp-focus-ring h-8 rounded-full px-3 text-xs text-text-subtle hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]">
          Clear
        </button>
      </div>
      {preset === "personalizado" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 text-xs text-text-muted">
            <label htmlFor={`${idBase}-desde`}>From</label>
            <AppDateField id={`${idBase}-desde`} label="From" value={personalizadoDesde} onChange={setPersonalizadoDesde} referenceDate={referenceDate}/>
          </div>
          <div className="flex flex-col gap-1 text-xs text-text-muted">
            <label htmlFor={`${idBase}-hasta`}>To (inclusive)</label>
            <AppDateField id={`${idBase}-hasta`} label="To (inclusive)" value={personalizadoHasta} onChange={setPersonalizadoHasta} referenceDate={personalizadoDesde || referenceDate}/>
          </div>
          <button
            type="button"
            onClick={applyPersonalizado}
            disabled={!rango}
            className="insp-focus-ring h-9 rounded-[10px] bg-[var(--brand-strong)] px-3 text-xs text-white hover:brightness-110 disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      )}
      {rango && (
        <p className="text-xs text-text-subtle">
          {new Date(rango.desde).toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" })} –{" "}
          {new Date(new Date(rango.hasta_exclusivo).getTime() - 1).toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" })}{" "}
          <span className="text-text-subtle/70">(exclusive end in UTC: {rango.hasta_exclusivo})</span>
        </p>
      )}
    </div>
  );
}
