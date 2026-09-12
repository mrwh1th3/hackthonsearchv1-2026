"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";
import { ExecutionHistory, type ExecutionHistoryRow } from "@/components/shared/execution-history";
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
  return (
    <Tabs.Root value={tab} onValueChange={setTab}>
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
          <ExecutionHistory rows={estados ? rows.filter((r) => estados.includes(r.investigacion.estado)) : rows} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
