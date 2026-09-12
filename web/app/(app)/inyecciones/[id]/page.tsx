import Link from "next/link";
import { notFound } from "next/navigation";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { NivelBadge } from "@/components/shared/badges";
import { getDataSource } from "@/lib/data";

export const metadata = { title: "Forense · Inyección" };

const PASOS_ORDEN = [
  "recibida",
  "validada",
  "snapshot_creado",
  "pistas_recalculadas",
  "clusters_afectados",
  "investigacion",
  "dictamen",
] as const;

const PASO_LABEL: Record<string, string> = {
  recibida: "Recibida",
  validada: "Validada",
  snapshot_creado: "Snapshot N+1",
  pistas_recalculadas: "Pistas recalculadas",
  clusters_afectados: "Clusters afectados",
  investigacion: "Investigación",
  dictamen: "Dictamen",
};

/**
 * 21 §3.3: timeline recibida→validada→snapshot→pistas→clusters→
 * investigación→dictamen con timestamps reales; nada se anima sin evento
 * persistido. Diff antes/después por RFC responde literalmente a "¿qué
 * pasó y cómo se explica?" (21 §1.3).
 */
export default async function InyeccionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const inyeccion = await ds.getInyeccion(id);
  if (!inyeccion) notFound();

  const pasosPorNombre = new Map(inyeccion.timeline.map((p) => [p.paso, p.ts]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Inyección {id.slice(0, 8)}…</h1>
          <p className="text-xs text-text-subtle">
            Corrida base{" "}
            <Link href={`/corridas/${inyeccion.corrida_base_id}`} className="text-focus hover:underline">
              {inyeccion.corrida_base_id.slice(0, 8)}…
            </Link>
            {inyeccion.corrida_nueva_id && (
              <>
                {" "}
                → corrida nueva{" "}
                <Link href={`/corridas/${inyeccion.corrida_nueva_id}`} className="text-focus hover:underline">
                  {inyeccion.corrida_nueva_id.slice(0, 8)}…
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-text-muted">{inyeccion.origen}</span>
          <FixtureBadge />
        </div>
      </div>

      {inyeccion.diagnostico?.mensaje && (
        <p className="rounded-[var(--radius-input)] border border-dashed border-border bg-surface-muted p-3 text-xs text-text-subtle">
          {inyeccion.diagnostico.mensaje}
        </p>
      )}

      {/* Timeline */}
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <ol className="flex min-w-[640px] items-start justify-between">
          {PASOS_ORDEN.map((paso, i) => {
            const ts = pasosPorNombre.get(paso);
            return (
              <li key={paso} className="flex flex-1 flex-col items-center text-center">
                <div className="flex w-full items-center">
                  <span className={`h-px flex-1 ${i === 0 ? "opacity-0" : ts ? "bg-primary" : "bg-border"}`} />
                  <span className={`mx-1 h-3 w-3 shrink-0 rounded-full ${ts ? "bg-primary" : "bg-border"}`} />
                  <span className={`h-px flex-1 ${i === PASOS_ORDEN.length - 1 ? "opacity-0" : ts ? "bg-primary" : "bg-border"}`} />
                </div>
                <p className="mt-1 text-[11px] font-medium text-text">{PASO_LABEL[paso]}</p>
                <p className="text-[10px] text-text-subtle">{ts ? new Date(ts).toLocaleTimeString("es-MX") : "pendiente"}</p>
              </li>
            );
          })}
        </ol>
        {inyeccion.terminado && (
          <p className="mt-3 text-center text-xs text-text-subtle">
            Latencia recibida → dictamen:{" "}
            {Math.round((new Date(inyeccion.terminado).getTime() - new Date(inyeccion.creado).getTime()) / 1000)}s
          </p>
        )}
      </div>

      {/* Diff antes/después */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-text">Diff antes/después por RFC</h2>
        {inyeccion.diff.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm text-text-subtle">Sin diferencias registradas todavía.</p>
        ) : (
          <ul className="space-y-2">
            {inyeccion.diff.map((d) => (
              <li key={d.rfc} className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-text">{d.rfc}</span>
                  {d.nivel_anterior ? <NivelBadge nivel={d.nivel_anterior} /> : <span className="text-xs text-text-subtle">sin caso previo</span>}
                  <span className="text-text-subtle">→</span>
                  {d.nivel_nuevo ? <NivelBadge nivel={d.nivel_nuevo} /> : <span className="text-xs text-text-subtle">sin cambio</span>}
                  {d.caso_id && (
                    <Link href={`/casos/${d.caso_id}`} className="ml-auto text-xs text-focus hover:underline">
                      Ver caso
                    </Link>
                  )}
                </div>
                {d.pistas_nuevas.length > 0 && (
                  <p className="mt-1 text-xs text-text-subtle">Pistas nuevas: {d.pistas_nuevas.join(", ")}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-text-subtle">RFC afectados: {inyeccion.rfcs_afectados.join(", ")}</p>
    </div>
  );
}
