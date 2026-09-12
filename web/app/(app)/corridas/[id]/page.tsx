import Link from "next/link";
import { notFound } from "next/navigation";
import { BoardTimeline } from "@/components/shared/board-timeline";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { NivelBadge } from "@/components/shared/badges";
import { ClusterForceGraph } from "@/components/shared/force-graph";
import { getDataSource } from "@/lib/data";
import { fechaHora } from "@/lib/date/formato";
import { cn } from "@/lib/utils";

export const metadata = { title: "Forense · Board de la corrida" };
export const dynamic = "force-dynamic";

/**
 * Board del diseño Inspector (docs/22, corte 1 punto 5): Canvas con el
 * grafo de un cluster (`getClusterGrafo`) y Timeline con la bitácora real
 * de la corrida (`getBitacoraCorrida`, CLAUDE.md regla 2). `getClusterGrafo`
 * es por CLUSTER, no por corrida, así que el Canvas necesita uno elegido —
 * en vez de fabricar esa elección (p.ej. "el primero"), el Mapa de clusters
 * existente (09 §5) hace de selector: cada tarjeta enlaza a
 * `?cluster=<id>` (estado en la URL, recargable) y por omisión se elige el
 * de mayor score. El grid no se borra (CLAUDE.md regla 9); cada tarjeta
 * conserva además su enlace directo a `/clusters/[id]` para el detalle
 * completo (carriles/pizarrón/grafo, ya existente).
 */
export default async function CorridaClustersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cluster?: string }>;
}) {
  const { id } = await params;
  const { cluster: clusterIdParam } = await searchParams;
  const ds = getDataSource();
  const corrida = await ds.getCorrida(id);
  if (!corrida) notFound();
  const clusters = await ds.listClusters(id);
  const ordenados = [...clusters].sort((a, b) => b.score - a.score);

  const clusterSeleccionado = clusterIdParam
    ? (ordenados.find((c) => c.id === clusterIdParam) ?? ordenados[0] ?? null)
    : (ordenados[0] ?? null);
  const grafo = clusterSeleccionado ? await ds.getClusterGrafo(clusterSeleccionado.id) : null;
  const bitacora = await ds.getBitacoraCorrida(id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">{corrida.nombre}</h1>
          <p className="text-xs text-text-subtle">
            Dataset {corrida.dataset} · corte {fechaHora(corrida.fecha_corte)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/corridas/${id}/raw`} className="h-8 rounded-[var(--radius-control)] border border-border px-3 text-xs leading-8 hover:bg-surface-hover">
            Bitácora cruda
          </Link>
          <FixtureBadge />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex flex-col gap-2 rounded-[var(--radius-card-lg)] border border-border bg-surface-raised p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">Canvas</span>
            {clusterSeleccionado && (
              <span className="text-[11px] text-text-subtle">
                Cluster {clusterSeleccionado.id.slice(0, 8)}… · score {clusterSeleccionado.score.toFixed(2)}
              </span>
            )}
          </div>
          {clusterSeleccionado ? (
            <ClusterForceGraph nodos={grafo?.nodos ?? []} aristas={grafo?.aristas ?? []} height={420} />
          ) : (
            <div className="flex h-[240px] items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border text-sm text-text-subtle">
              Sin clusters todavía en esta corrida: nada que dibujar en el Canvas.
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2.5 rounded-[var(--radius-card-lg)] border border-border bg-surface p-4">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">Timeline</span>
          <BoardTimeline eventos={bitacora} />
        </section>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-text">Mapa de clusters</h2>
        {ordenados.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-sm text-text-subtle">Sin clusters todavía en esta corrida.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ordenados.map((c) => (
              <li key={c.id}>
                {/*
                  Dos enlaces, no anidados: la tarjeta entera selecciona el
                  cluster para el Canvas (`?cluster=<id>`, overlay
                  `absolute inset-0`) y "Abrir cluster" —por encima, z-10—
                  navega a /clusters/[id] sin interferir con la selección.
                  Anidar <a> dentro de <a> es HTML inválido y el navegador
                  corta el anidado de forma impredecible.
                */}
                <div
                  className={cn(
                    "relative rounded-[var(--radius-card)] border bg-surface p-3 transition-colors hover:bg-surface-hover",
                    c.id === clusterSeleccionado?.id ? "border-primary" : "border-border",
                  )}
                >
                  <Link
                    href={`/corridas/${id}?cluster=${c.id}`}
                    aria-current={c.id === clusterSeleccionado?.id ? "true" : undefined}
                    aria-label={`Ver cluster ${c.id} en el Canvas`}
                    className="absolute inset-0 z-0 rounded-[var(--radius-card)]"
                  />
                  <p className="pointer-events-none font-mono text-xs text-text-subtle">{c.id.slice(0, 8)}…</p>
                  <p className="pointer-events-none mt-1 text-sm font-medium text-text">{c.n_rfc} RFC</p>
                  <p className="pointer-events-none text-xs text-text-subtle">Estado: {c.estado}</p>
                  <div className="pointer-events-none mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, (c.ronda_actual / 2) * 100)}%` }} />
                  </div>
                  <p className="pointer-events-none mt-1 text-[11px] text-text-subtle">
                    Ronda {c.ronda_actual}/2 · score {c.score.toFixed(2)}
                  </p>
                  <div className="relative z-10 mt-2 flex items-center justify-between gap-2">
                    {c.nivel ? <NivelBadge nivel={c.nivel} /> : <span />}
                    <Link href={`/clusters/${c.id}`} className="text-[11px] text-focus hover:underline">
                      Abrir cluster →
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
