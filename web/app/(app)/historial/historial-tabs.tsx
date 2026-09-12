"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useMemo, useState } from "react";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { ExecutionHistory, type ExecutionHistoryRow } from "@/components/shared/execution-history";
import type { RangoResuelto } from "@/lib/date/range";
import type { EstadoInvestigacion } from "@/lib/data";

const GRUPOS: Record<string, EstadoInvestigacion[] | null> = {
  todas: null,
  en_curso: ["en_cola", "investigando", "generando_reporte"],
  completas: ["investigacion_completa"],
  parciales: ["parcial"],
  errores: ["error", "cancelada"],
};

const TAB_LABEL: Record<string, string> = {
  todas: "Todas",
  en_curso: "En curso",
  completas: "Completas",
  parciales: "Parciales",
  errores: "Errores",
};

export function HistorialTabs({ rows }: { rows: ExecutionHistoryRow[] }) {
  const [tab, setTab] = useState("todas");
  const [rango, setRango] = useState<RangoResuelto | null>(null);

  const filasEnRango = useMemo(() => {
    if (!rango) return rows;
    const desde = new Date(rango.desde).getTime();
    const hasta = new Date(rango.hasta_exclusivo).getTime();
    return rows.filter((r) => {
      const t = new Date(r.investigacion.creado).getTime();
      return t >= desde && t < hasta;
    });
  }, [rows, rango]);

  return (
    <Tabs.Root value={tab} onValueChange={setTab}>
      {/* 15 §9: alcance "ejecución" — fechas de la solicitud/ejecución, nunca de las operaciones del dataset. */}
      <DateRangePicker
        alcance="ejecucion"
        referencia={new Date()}
        // "30 días" reales vaciaría la vista: las fechas del fixture son fijas
        // (enero 2026), no relativas al reloj real. "Todo el dataset" con un
        // límite inferior amplio muestra el historial completo por defecto.
        presetInicial="todo_el_dataset"
        datasetDesde={new Date("2020-01-01T00:00:00Z")}
        onChange={setRango}
        className="mb-3"
      />
      <Tabs.List className="mb-3 flex gap-1 border-b border-border" aria-label="Filtrar historial">
        {Object.keys(GRUPOS).map((key) => (
          <Tabs.Trigger
            key={key}
            value={key}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-text-muted data-[state=active]:border-primary data-[state=active]:text-text"
          >
            {TAB_LABEL[key]}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {Object.entries(GRUPOS).map(([key, estados]) => (
        <Tabs.Content key={key} value={key}>
          <ExecutionHistory rows={estados ? filasEnRango.filter((r) => estados.includes(r.investigacion.estado)) : filasEnRango} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
