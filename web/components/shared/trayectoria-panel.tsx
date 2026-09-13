"use client";

import { ChartPanel } from "./chart-panel";
import { TrayectoriaChart } from "./trayectoria-chart";
import type { TrayectoriaPunto } from "@/lib/data";

/**
 * Wrapper cliente de ChartPanel+TrayectoriaChart. `ChartPanel` es Client
 * Component: sus props de función (`getRowKey`, `columns[].render`) no
 * pueden construirse en un Server Component y pasarse como prop (Next.js
 * rechaza serializar funciones a través del límite RSC). Este wrapper vive
 * enteramente en el cliente y solo recibe datos planos desde la página.
 */
export function TrayectoriaPanel({ rfc, puntos }: { rfc: string; puntos: TrayectoriaPunto[] }) {
  return (
    <ChartPanel
      title="Timeline"
      unidad="MXN"
      alcance={`RFC ${rfc}`}
      columns={[
        { key: "periodo", header: "Period" },
        { key: "eventos", header: "Eventos", render: (p) => (p.eventos.length > 0 ? p.eventos.join(", ") : "—") },
        { key: "monto_emitido", header: "Emitido", align: "right" },
        { key: "monto_recibido", header: "Recibido", align: "right" },
        { key: "n_cfdi", header: "N° CFDI", align: "right" },
      ]}
      rows={puntos}
      getRowKey={(p) => p.periodo}
      csvFilename={`trayectoria-${rfc}`}
    >
      <TrayectoriaChart puntos={puntos} />
    </ChartPanel>
  );
}
