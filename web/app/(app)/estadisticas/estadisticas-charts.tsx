"use client";

import { ChartPanel } from "@/components/shared/chart-panel";
import type { EmbudoEtapa } from "@/lib/data";
import { EmbudoChart } from "./embudo-chart";

interface PorTipologia {
  tipologia: string;
  cantidad: number;
  monto_en_riesgo: string;
}

export function EmbudoPanel({ etapas }: { etapas: EmbudoEtapa[] }) {
  return (
    <ChartPanel
      title="Embudo"
      alcance="pistas → RFC candidatos → clusters → casos ≥2 familias → presunción alta"
      columns={[
        { key: "etapa", header: "Etapa" },
        { key: "cantidad", header: "Cantidad", align: "right" },
        { key: "denominador", header: "Denominador", align: "right" },
      ]}
      rows={etapas}
      getRowKey={(e) => e.etapa}
      csvFilename="embudo"
    >
      <EmbudoChart etapas={etapas} />
    </ChartPanel>
  );
}

export function PorTipologiaPanel({ filas }: { filas: PorTipologia[] }) {
  return (
    <ChartPanel
      title="Casos por tipología"
      columns={[
        { key: "tipologia", header: "Tipología" },
        { key: "cantidad", header: "Cantidad", align: "right" },
        { key: "monto_en_riesgo", header: "Monto en riesgo", align: "right" },
      ]}
      rows={filas}
      getRowKey={(t) => t.tipologia}
      csvFilename="por-tipologia"
    />
  );
}
