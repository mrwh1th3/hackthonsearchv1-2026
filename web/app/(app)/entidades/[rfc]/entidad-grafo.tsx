"use client";

import { ClusterForceGraph } from "@/components/shared/force-graph";
import type { EntidadPerfil } from "@/lib/data";

/**
 * "Mini grafo de relacionados" (09 §4). El fixture de entidad no trae un
 * grafo aparte: se construye aquí, en el cliente, a partir de las mismas
 * facturas reales del fixture (nunca datos inventados) — un nodo por
 * contraparte y una arista de tipo "factura" por cada una.
 */
export function EntidadGrafo({ entidad }: { entidad: EntidadPerfil }) {
  const nodos = [
    { id: entidad.rfc, tipo: "contribuyente" as const, rfc: entidad.rfc, nivel: null, es_semilla: true, en_lista_sat: entidad.en_lista_sat, frontera: false },
    ...Array.from(new Set(entidad.facturas.map((f) => f.contraparte))).map((rfc) => ({
      id: rfc,
      tipo: "contribuyente" as const,
      rfc,
      nivel: null,
      es_semilla: false,
      en_lista_sat: false,
      frontera: false,
    })),
  ];
  const aristas = entidad.facturas.map((f) => ({
    id: f.id,
    origen: f.direccion === "emitida" ? entidad.rfc : f.contraparte,
    destino: f.direccion === "emitida" ? f.contraparte : entidad.rfc,
    tipo: "factura" as const,
    monto: f.monto,
    fecha: f.fecha,
    ref_id: f.id,
  }));

  return <ClusterForceGraph nodos={nodos} aristas={aristas} height={260} />;
}
