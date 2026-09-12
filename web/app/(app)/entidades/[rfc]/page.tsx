import Link from "next/link";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { TrayectoriaPanel } from "@/components/shared/trayectoria-panel";
import { getDataSource } from "@/lib/data";
import { AtributosCompartidosTable, FacturasTable, ParesPanel } from "./entidad-tablas";
import { EntidadGrafo } from "./entidad-grafo";

export const metadata = { title: "Forense · Entidad" };

/**
 * 09 §4: el RFC puede aparecer en distintos snapshots — `?corrida_id=`
 * conserva el alcance de la consulta (aquí solo se muestra, ya que el
 * fixture no tiene múltiples corridas todavía).
 */
export default async function EntidadPage({
  params,
  searchParams,
}: {
  params: Promise<{ rfc: string }>;
  searchParams: Promise<{ corrida_id?: string }>;
}) {
  const { rfc: rfcParam } = await params;
  const { corrida_id: corridaId } = await searchParams;
  const rfc = decodeURIComponent(rfcParam);

  const ds = getDataSource();
  const [entidad, pares, trayectoria] = await Promise.all([ds.getEntidad(rfc), ds.getPares(rfc), ds.getTrayectoria(rfc)]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold text-text">{rfc}</h1>
          {corridaId && <p className="text-xs text-text-subtle">Alcance: corrida {corridaId.slice(0, 8)}…</p>}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="h-8 rounded-[var(--radius-input)] bg-primary px-3 text-xs leading-8 text-white hover:bg-primary-hover">
            Investigar este RFC
          </Link>
          <FixtureBadge />
        </div>
      </div>

      {!entidad ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface p-6 text-center text-sm text-text-subtle">
          Sin perfil de entidad para este RFC en el fixture actual (cobertura parcial). Trayectoria/pares se muestran si existen.
        </p>
      ) : (
        <>
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <p className="text-sm text-text" title="dato no confiable, no citable en el dictamen">
              {entidad.razon_social_untrusted}
            </p>
            <p className="mt-1 text-xs text-text-subtle">Giro: {entidad.giro}</p>
            <p className="mt-1 text-xs">
              {entidad.en_lista_sat ? (
                <span className="rounded-full border border-error/40 bg-error/10 px-2 py-0.5 text-error">En lista(s) SAT: {entidad.listas_sat.join(", ")}</span>
              ) : (
                <span className="text-text-subtle">Sin presencia en listas SAT (en este fixture)</span>
              )}
            </p>
            {entidad.casos_previos.length > 0 && (
              <p className="mt-2 text-xs text-text-subtle">
                Casos previos:{" "}
                {entidad.casos_previos.map((cid, i) => (
                  <span key={cid}>
                    {i > 0 && ", "}
                    <Link href={`/casos/${cid}`} className="text-focus hover:underline">
                      {cid.slice(0, 8)}…
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>

          {entidad.atributos_compartidos.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-text">Atributos compartidos</h2>
              <AtributosCompartidosTable atributos={entidad.atributos_compartidos} />
            </div>
          )}

          {entidad.facturas.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-text">Facturas</h2>
              <FacturasTable facturas={entidad.facturas} />
            </div>
          )}

          <div>
            <h2 className="mb-2 text-sm font-medium text-text">Relacionados</h2>
            <EntidadGrafo entidad={entidad} />
          </div>
        </>
      )}

      {pares.length > 0 && <ParesPanel rfc={rfc} pares={pares} />}
      {trayectoria.length > 0 && <TrayectoriaPanel rfc={rfc} puntos={trayectoria} />}
    </div>
  );
}
