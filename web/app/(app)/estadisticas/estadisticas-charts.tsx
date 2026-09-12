"use client";

import { ChartPanel } from "@/components/shared/chart-panel";
import type { EmbudoEtapa } from "@/lib/data";
import { EmbudoChart } from "./embudo-chart";

export function CoberturaPanel({ etapas }: { etapas: EmbudoEtapa[] }) {
  return (
    <ChartPanel
      title="Cobertura de la corrida"
      alcance="ground truth → investigados con conclusión → trampas legítimas investigadas"
      columns={[
        { key: "etapa", header: "Etapa" },
        { key: "cantidad", header: "Cantidad", align: "right" },
        { key: "denominador", header: "Denominador", align: "right" },
      ]}
      rows={etapas}
      getRowKey={(e) => e.etapa}
      csvFilename="cobertura"
    >
      <EmbudoChart etapas={etapas} />
    </ChartPanel>
  );
}

interface FilaRecallTipologia {
  tipologia: string;
  tp: number;
  total: number;
  recall: number | null;
}

export function RecallPorTipologiaPanel({ filas }: { filas: FilaRecallTipologia[] }) {
  return (
    <ChartPanel
      title="Recall por tipología (contra ground truth)"
      columns={[
        { key: "tipologia", header: "Tipología" },
        { key: "tp", header: "Detectados (TP)", align: "right" },
        { key: "total", header: "Total en ground truth", align: "right" },
        { key: "recall", header: "Recall", align: "right", render: (f) => (f.recall === null ? "—" : `${Math.round(f.recall * 100)}%`) },
      ]}
      rows={filas}
      getRowKey={(t) => t.tipologia}
      csvFilename="recall-por-tipologia"
    />
  );
}
