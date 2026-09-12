import { FixtureBadge } from "@/components/shared/fixture-badge";
import { InvestigationComposer } from "@/components/shared/investigation-composer";
import { getDataSource } from "@/lib/data";
import type { Nivel } from "@/lib/data";
import { QueueTable, type FilaCola } from "./queue-table";

export const metadata = { title: "Forense · Cola de casos" };

const NIVELES: Nivel[] = ["presuncion_alta", "presuncion", "no_concluyente", "anomalia_explicada", "sin_hallazgos"];

export default async function InicioPage() {
  const ds = getDataSource();
  const corridas = await ds.listCorridas();
  const corrida = corridas[0] ?? null;
  const casos = corrida ? await ds.listCasos({ corridaId: corrida.id }) : [];

  const filas: FilaCola[] = await Promise.all(
    casos.map(async (caso) => {
      const entidad = await ds.getEntidad(caso.rfc_principal);
      return { caso, razonSocialUntrusted: entidad?.razon_social_untrusted ?? null };
    }),
  );

  const porNivel = Object.fromEntries(NIVELES.map((n) => [n, casos.filter((c) => c.nivel === n).length])) as Record<Nivel, number>;
  const enProceso = casos.filter((c) => ["ronda_1", "ronda_2", "auditoria"].includes(c.estado)).length;
  const montoEnRiesgo = casos.reduce((acc, c) => acc + Number(c.monto_en_riesgo), 0);
  const cobertura = casos.length > 0 ? Math.round((casos.filter((c) => c.cobertura_completa).length / casos.length) * 100) : null;

  const casoPresuncion = casos.find((c) => c.nivel === "presuncion") ?? casos[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Cola de casos</h1>
        <FixtureBadge />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {NIVELES.map((n) => (
          <KpiCard key={n} label={n} value={porNivel[n]} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="En proceso" value={enProceso} />
        <KpiCard label="Monto en riesgo" value={`$${montoEnRiesgo.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`} />
        <KpiCard label="Corrida activa" value={corrida?.nombre ?? "—"} small />
        <KpiCard label="Cobertura completa" value={cobertura !== null ? `${cobertura}%` : "—"} />
      </div>

      {corrida && casoPresuncion ? (
        <InvestigationComposer
          corridaId={corrida.id}
          clusterId={casoPresuncion.cluster_id}
          rfcsDisponibles={[casoPresuncion.rfc_principal, ...casoPresuncion.rfcs_satelite]}
          periodo={{ desde: corrida.fecha_corte, hasta_exclusivo: corrida.fecha_corte, timezone: "America/Monterrey" }}
        />
      ) : (
        <p className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-center text-sm text-text-subtle">
          Sin corrida activa todavía. Carga un dataset en <a className="text-focus hover:underline" href="/datos">/datos</a> para empezar.
        </p>
      )}

      {corrida ? (
        <QueueTable filas={filas} />
      ) : (
        <p className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-sm text-text-subtle">Sin casos que mostrar.</p>
      )}
    </div>
  );
}

function KpiCard({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
      <p className="text-[11px] text-text-subtle">{label}</p>
      <p className={small ? "truncate text-sm font-medium text-text" : "text-lg font-semibold tabular-nums text-text"}>{value}</p>
    </div>
  );
}
