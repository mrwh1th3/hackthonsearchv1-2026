import * as Tabs from "@radix-ui/react-tabs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { getDataSource } from "@/lib/data";
import { fuentePrivadaActual, obtenerInvestigacionPrivada } from "@/lib/data/privado";

export const metadata = { title: "Forense · Investigación" };
export const dynamic = "force-dynamic";

/** La investigación es privada (CLAUDE.md regla 3, `lib/data/privado.ts`); caso/bitácora siguen en el DataSource público — el caso en sí no es privado. */
export default async function InvestigacionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const inv = await obtenerInvestigacionPrivada(id);
  if (!inv) notFound();

  const casoId = inv.caso_ids[0];
  const detalle = casoId ? await ds.getCasoDetalle(casoId) : null;
  const bitacora = await ds.getBitacoraCorrida(inv.corrida_id);
  const bitacoraCaso = casoId ? bitacora.filter((e) => e.caso_id === casoId) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">{inv.titulo ?? "Investigación"}</h1>
          <p className="text-sm text-text-subtle">{inv.mensaje}</p>
        </div>
        {fuentePrivadaActual() === "fixture" && <FixtureBadge />}
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-text-subtle">
        <span>Estado: {inv.estado}</span>
        <span>·</span>
        <span>Directriz: {inv.directriz_id ?? "—"}</span>
        <span>·</span>
        <span>Creada: {new Date(inv.creado).toLocaleString("es-MX")}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {detalle && (
          <Link href={`/casos/${detalle.caso.id}`} className="h-8 rounded-[var(--radius-input)] border border-border px-3 text-xs leading-8 hover:bg-surface-hover">
            Ver cluster/caso
          </Link>
        )}
        {inv.reporte_manifest[0] && (
          <Link
            href={`/casos/${inv.reporte_manifest[0].caso_id}/expediente`}
            className="h-8 rounded-[var(--radius-input)] bg-primary px-3 text-xs leading-8 text-white hover:bg-primary-hover"
          >
            Abrir reporte
          </Link>
        )}
      </div>

      <Tabs.Root defaultValue="resumen">
        <Tabs.List className="mb-3 flex gap-1 border-b border-border" aria-label="Secciones de la investigación">
          {["resumen", "ejecuciones", "evidencia", "reportes", "actividad"].map((v) => (
            <Tabs.Trigger key={v} value={v} className="border-b-2 border-transparent px-3 py-2 text-sm capitalize text-text-muted data-[state=active]:border-primary data-[state=active]:text-text">
              {v}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="resumen" className="text-sm text-text">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Info label="Modo" value={inv.modo} />
            <Info label="Corrida" value={inv.corrida_id.slice(0, 8) + "…"} />
            <Info label="Casos" value={String(inv.caso_ids.length)} />
            <Info label="Padre" value={inv.investigacion_padre_id ?? "Ninguna (raíz)"} />
            <Info label="Completada" value={inv.completada_at ? new Date(inv.completada_at).toLocaleString("es-MX") : "—"} />
          </dl>
        </Tabs.Content>

        <Tabs.Content value="ejecuciones" className="text-sm">
          {detalle && detalle.tareas.length > 0 ? (
            <ul className="space-y-1">
              {detalle.tareas.map((t) => (
                <li key={t.id} className="rounded border border-border p-2 text-xs">
                  {t.agente} · ronda {t.ronda} · intento {t.intento} · {t.estado}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-subtle">Sin ejecuciones técnicas registradas para este fixture.</p>
          )}
        </Tabs.Content>

        <Tabs.Content value="evidencia" className="text-sm">
          {detalle && detalle.evidencia.length > 0 ? (
            <ul className="space-y-1">
              {detalle.evidencia.map((e) => (
                <li key={e.id} className="rounded border border-border p-2 text-xs">
                  {e.pista_codigo} · {e.tipo} · {e.ref_id} · {e.validada ? "validada" : "no validada"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-subtle">Sin evidencia todavía.</p>
          )}
        </Tabs.Content>

        <Tabs.Content value="reportes" className="text-sm">
          {inv.reporte_manifest.length > 0 ? (
            <ul className="space-y-1">
              {inv.reporte_manifest.map((r) => (
                <li key={r.reporte_id} className="rounded border border-border p-2 text-xs">
                  Reporte {r.reporte_id} · versión {r.version} · hash {r.content_hash.slice(0, 12)}…
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-subtle">Sin reportes persistidos todavía.</p>
          )}
        </Tabs.Content>

        <Tabs.Content value="actividad" className="text-sm">
          {bitacoraCaso.length > 0 ? (
            <ul className="space-y-1">
              {bitacoraCaso.map((e) => (
                <li key={e.id} className="rounded border border-border p-2 text-xs">
                  <span className="text-text-subtle">{new Date(e.ts).toLocaleTimeString("es-MX")}</span> · {e.tipo_evento} · {e.payload.resumen}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-subtle">Sin actividad de bitácora para este caso.</p>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-subtle">{label}</dt>
      <dd className="text-sm text-text">{value}</dd>
    </div>
  );
}
