"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { RANGO_PRESET_LABEL, resolveDateRangePreset, type AlcanceRango, type RangoPreset, type RangoResuelto } from "@/lib/date/range";

const PRESETS: RangoPreset[] = ["hoy", "ayer", "7d", "30d", "90d", "mes_actual", "mes_anterior", "todo_el_dataset"];

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
 * El calendario visual completo queda simplificado a `<input type="date">`
 * (accesible, operable por teclado) dado el tiempo del corte; la lógica de
 * conversión de zona horaria es la parte normativa y está cubierta por
 * tests.
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

  const rango = useMemo<RangoResuelto | null>(() => {
    try {
      if (preset === "personalizado") {
        if (!personalizadoDesde || !personalizadoHasta) return null;
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
        <span>{alcance === "dataset" ? "Periodo del dataset" : "Periodo de ejecución"}</span>
        <span aria-hidden>·</span>
        <span>{timezone}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Presets de rango de fecha">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => selectPreset(p)}
            aria-pressed={preset === p}
            className={cn(
              "h-8 rounded-full border border-border px-3 text-xs transition-colors",
              preset === p ? "bg-primary text-white" : "bg-surface text-text hover:bg-surface-hover",
            )}
          >
            {RANGO_PRESET_LABEL[p]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreset("personalizado")}
          aria-pressed={preset === "personalizado"}
          className={cn(
            "h-8 rounded-full border border-border px-3 text-xs transition-colors",
            preset === "personalizado" ? "bg-primary text-white" : "bg-surface text-text hover:bg-surface-hover",
          )}
        >
          Personalizado
        </button>
        <button type="button" onClick={limpiar} className="h-8 rounded-full px-3 text-xs text-text-subtle underline-offset-2 hover:underline">
          Limpiar
        </button>
      </div>
      {preset === "personalizado" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idBase}-desde`}>
            Desde
            <input
              id={`${idBase}-desde`}
              type="date"
              value={personalizadoDesde}
              onChange={(e) => setPersonalizadoDesde(e.target.value)}
              className="h-9 rounded-[var(--radius-input)] border border-border bg-surface px-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted" htmlFor={`${idBase}-hasta`}>
            Hasta (incluido)
            <input
              id={`${idBase}-hasta`}
              type="date"
              value={personalizadoHasta}
              onChange={(e) => setPersonalizadoHasta(e.target.value)}
              className="h-9 rounded-[var(--radius-input)] border border-border bg-surface px-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={applyPersonalizado}
            disabled={!rango}
            className="h-9 rounded-[var(--radius-input)] bg-primary px-3 text-sm text-white disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
      )}
      {rango && (
        <p className="text-xs text-text-subtle">
          {new Date(rango.desde).toLocaleDateString("es-MX", { timeZone: timezone })} –{" "}
          {new Date(new Date(rango.hasta_exclusivo).getTime() - 1).toLocaleDateString("es-MX", { timeZone: timezone })}{" "}
          <span className="text-text-subtle/70">(fin exclusivo en UTC: {rango.hasta_exclusivo})</span>
        </p>
      )}
    </div>
  );
}
