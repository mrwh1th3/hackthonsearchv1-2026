import Link from "next/link";
import { notFound } from "next/navigation";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { NivelBadge } from "@/components/shared/badges";
import { getDataSource } from "@/lib/data";

export const metadata = { title: "Forense · Mapa de clusters" };
export const dynamic = "force-dynamic";

/**
 * 09 §5: grid de bloques por cluster, ordenado por score. Es la vista que
 * demuestra escalabilidad (contexto por agente no crece con el dataset,
 * CLAUDE.md regla 5) — con el generador grande se verían decenas de
 * bloques con el mismo patrón.
 */
export default async function CorridaClustersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const corrida = await ds.getCorrida(id);
  if (!corrida) notFound();
  const clusters = await ds.listClusters(id);
  const ordenados = [...clusters].sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">{corrida.nombre}</h1>
          <p className="text-xs text-text-subtle">
            Dataset {corrida.dataset} · corte {new Date(corrida.fecha_corte).toLocaleString("es-MX")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/corridas/${id}/raw`} className="h-8 rounded-[var(--radius-input)] border border-border px-3 text-xs leading-8 hover:bg-surface-hover">
            Bitácora cruda
          </Link>
          <FixtureBadge />
        </div>
      </div>

      {ordenados.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-sm text-text-subtle">Sin clusters todavía en esta corrida.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ordenados.map((c) => (
            <li key={c.id}>
              <Link href={`/clusters/${c.id}`} className="block rounded-[var(--radius-card)] border border-border bg-surface p-3 hover:bg-surface-hover">
                <p className="font-mono text-xs text-text-subtle">{c.id.slice(0, 8)}…</p>
                <p className="mt-1 text-sm font-medium text-text">{c.n_rfc} RFC</p>
                <p className="text-xs text-text-subtle">Estado: {c.estado}</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, (c.ronda_actual / 2) * 100)}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-text-subtle">Ronda {c.ronda_actual}/2 · score {c.score.toFixed(2)}</p>
                {c.nivel && (
                  <div className="mt-2">
                    <NivelBadge nivel={c.nivel} />
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
