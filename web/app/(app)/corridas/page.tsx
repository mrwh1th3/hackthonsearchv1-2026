import Link from "next/link";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { getDataSource } from "@/lib/data";

export const metadata = { title: "Forense · Corridas" };
export const dynamic = "force-dynamic";

/**
 * 09 §5-6: vista técnica de corridas (15 §7 la nombra "historial de
 * ejecuciones"). Comparación de dos corridas lado a lado queda pendiente:
 * este fixture solo trae una corrida, así que no hay par que comparar
 * todavía (ver pendientes).
 */
export default async function CorridasPage() {
  const ds = getDataSource();
  const corridas = await ds.listCorridas();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Corridas</h1>
        <FixtureBadge />
      </div>
      {corridas.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-sm text-text-subtle">Sin corridas todavía.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {corridas.map((c) => (
            <li key={c.id}>
              <Link href={`/corridas/${c.id}`} className="block rounded-[var(--radius-card)] border border-border bg-surface p-4 hover:bg-surface-hover">
                <p className="font-medium text-text">{c.nombre}</p>
                <p className="mt-1 text-xs text-text-subtle">Dataset: {c.dataset}</p>
                <p className="text-xs text-text-subtle">Corte: {new Date(c.fecha_corte).toLocaleString("es-MX")}</p>
                <p className="mt-2 text-xs">
                  Estado: <span className="font-medium text-text">{c.estado}</span>
                </p>
                <div className="mt-2 flex gap-1">
                  {c.familias_evaluables.map((f) => (
                    <span key={f} className="rounded-full border border-border px-1.5 text-[10px] text-text-subtle">
                      {f}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
