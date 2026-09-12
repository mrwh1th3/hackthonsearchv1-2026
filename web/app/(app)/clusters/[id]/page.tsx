import Link from "next/link";
import { notFound } from "next/navigation";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { NivelBadge } from "@/components/shared/badges";
import { getDataSource } from "@/lib/data";
import { ClusterView } from "./cluster-view";

export const metadata = { title: "Forense · Cluster" };
export const dynamic = "force-dynamic";

export default async function ClusterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const cluster = await ds.getCluster(id);
  if (!cluster) notFound();

  const casos = await ds.listCasos({ corridaId: cluster.corrida_id });
  const caso = casos.find((c) => c.cluster_id === id) ?? null;
  const detalle = caso ? await ds.getCasoDetalle(caso.id) : null;
  const senales = await ds.listSenalesCluster(id);
  const grafo = await ds.getClusterGrafo(id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Cluster {id.slice(0, 8)}…</h1>
          <p className="text-xs text-text-subtle">
            {cluster.n_rfc} RFC · ronda {cluster.ronda_actual} · score {cluster.score.toFixed(2)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {cluster.nivel && <NivelBadge nivel={cluster.nivel} />}
          {caso && (
            <Link href={`/casos/${caso.id}`} className="h-8 rounded-[var(--radius-input)] bg-primary px-3 text-xs leading-8 text-white hover:bg-primary-hover">
              Ver caso
            </Link>
          )}
          <FixtureBadge />
        </div>
      </div>

      <ClusterView tareas={detalle?.tareas ?? []} senales={senales} grafo={grafo} />
    </div>
  );
}
