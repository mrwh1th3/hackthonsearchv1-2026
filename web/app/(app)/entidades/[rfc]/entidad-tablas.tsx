"use client";

import { ChartPanel } from "@/components/shared/chart-panel";
import { DataTable } from "@/components/shared/data-table";
import type { EntidadPerfil, ParComparacion } from "@/lib/data";
import { soloFecha } from "@/lib/date/formato";

/**
 * Igual que TrayectoriaPanel: DataTable/ChartPanel son Client Components,
 * así que sus columnas (con funciones `render`) deben definirse aquí, no
 * en la página servidor que solo pasa datos planos.
 */
export function AtributosCompartidosTable({ atributos }: { atributos: EntidadPerfil["atributos_compartidos"] }) {
  return (
    <DataTable
      columns={[
        { key: "atributo", header: "Atributo" },
        { key: "valor", header: "Valor", render: (a) => <span title="dato no confiable">{a.valor_untrusted}</span>, csv: (a) => a.valor_untrusted },
        { key: "rfcs", header: "RFC que lo comparten", render: (a) => a.rfcs_que_lo_comparten.join(", ") },
      ]}
      rows={atributos}
      getRowKey={(a, i) => `${a.atributo}-${i}`}
    />
  );
}

export function FacturasTable({ facturas }: { facturas: EntidadPerfil["facturas"] }) {
  return (
    <DataTable
      columns={[
        { key: "id", header: "ID", render: (f) => <span className="font-mono text-xs">{f.id}</span> },
        { key: "direccion", header: "Dirección" },
        { key: "contraparte", header: "Contraparte", render: (f) => <span className="font-mono text-xs">{f.contraparte}</span> },
        { key: "monto", header: "Monto", align: "right" },
        { key: "fecha", header: "Fecha", render: (f) => soloFecha(f.fecha) },
      ]}
      rows={facturas}
      getRowKey={(f) => f.id}
    />
  );
}

export function ParesPanel({ rfc, pares }: { rfc: string; pares: ParComparacion[] }) {
  return (
    <ChartPanel
      title="Comparación contra pares del giro"
      alcance="valor propio vs p10/p50/p90"
      columns={[
        { key: "metrica", header: "Métrica" },
        { key: "unidad", header: "Unidad" },
        { key: "valor_propio", header: "Valor propio", align: "right" },
        { key: "p10", header: "p10", align: "right" },
        { key: "p50", header: "p50", align: "right" },
        { key: "p90", header: "p90", align: "right" },
      ]}
      rows={pares}
      getRowKey={(p) => p.metrica}
      csvFilename={`pares-${rfc}`}
    />
  );
}
