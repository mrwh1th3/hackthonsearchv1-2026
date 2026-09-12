"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GrafoArista, GrafoNodo, Nivel } from "@/lib/data";

// react-force-graph-2d usa canvas/`document` en el import: nunca en SSR.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false, loading: () => <GraphSkeleton /> });

const NIVEL_COLOR: Record<Nivel, string> = {
  sin_hallazgos: "#16a34a",
  anomalia_explicada: "#4ade80",
  no_concluyente: "#a1a1aa",
  presuncion: "#ef4444",
  presuncion_alta: "#b91c1c",
};

export interface ForceGraphNode extends GrafoNodo {
  id: string;
  x?: number;
  y?: number;
}
export interface ForceGraphLink {
  source: string;
  target: string;
  arista: GrafoArista;
}

export function ClusterForceGraph({
  nodos,
  aristas,
  onNodeClick,
  onLinkClick,
  height = 360,
  resaltado = null,
}: {
  nodos: GrafoNodo[];
  aristas: GrafoArista[];
  onNodeClick?: (n: GrafoNodo) => void;
  onLinkClick?: (a: GrafoArista) => void;
  height?: number;
  /** Id del nodo seleccionado: se agranda y oscurecen sus aristas. */
  resaltado?: string | null;
}) {
  const graphData = useMemo(
    () => ({
      nodes: nodos.map((n) => ({ ...n })),
      links: aristas.map((a) => ({ source: a.origen, target: a.destino, arista: a })),
    }),
    [nodos, aristas],
  );

  // Sin `width`, ForceGraph2D toma el ancho de la ventana y centra los nodos
  // fuera de un contenedor más angosto (se veía el recuadro vacío).
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState<number>();
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAncho(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodos.length]);

  if (nodos.length === 0) {
    return <div className="flex h-[240px] items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border text-sm text-text-subtle">Sin grafo disponible para esta investigación en el fixture.</div>;
  }

  return (
    <div ref={contenedor} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      {ancho !== undefined && (
      <ForceGraph2D
        graphData={graphData}
        width={ancho}
        height={height}
        nodeId="id"
        nodeLabel={(n: object) => {
          const node = n as GrafoNodo;
          return `${node.rfc ?? node.id}${node.en_lista_sat ? " · lista 69-B" : ""}`;
        }}
        nodeColor={(n: object) => {
          const node = n as GrafoNodo;
          return node.nivel ? NIVEL_COLOR[node.nivel] : "#a1a1aa";
        }}
        nodeRelSize={5}
        nodeVal={(n: object) => ((n as GrafoNodo).id === resaltado ? 3 : 1)}
        linkDirectionalArrowLength={4}
        linkWidth={(l: object) => Math.max(1, Math.min(6, Number((l as ForceGraphLink).arista.monto) / 500))}
        linkLineDash={(l: object) => ((l as ForceGraphLink).arista.tipo === "movimiento" ? [2, 2] : undefined as unknown as number[])}
        linkColor={(l: object) => {
          const a = (l as ForceGraphLink).arista;
          return resaltado && (a.origen === resaltado || a.destino === resaltado) ? "#141413" : "#a1a1aa";
        }}
        onNodeClick={(n: object) => onNodeClick?.(n as GrafoNodo)}
        onLinkClick={(l: object) => onLinkClick?.((l as ForceGraphLink).arista)}
        cooldownTicks={80}
      />
      )}
    </div>
  );
}

function GraphSkeleton() {
  return <div className="h-[240px] animate-pulse rounded-[var(--radius-card)] bg-surface-muted motion-reduce:animate-none" aria-label="Cargando grafo" />;
}
