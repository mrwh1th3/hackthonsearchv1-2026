import { FixtureBadge } from "@/components/shared/fixture-badge";
import { InspectorHome } from "@/components/shared/inspector-home";
import { getDataSource } from "@/lib/data";
import type { Nivel } from "@/lib/data";
import { QueueTable, type FilaCola } from "./queue-table";

export const metadata = { title: "Forense · Inicio" };
export const dynamic = "force-dynamic";

const NIVELES: Nivel[] = ["presuncion_alta", "presuncion", "no_concluyente", "anomalia_explicada", "sin_hallazgos"];

/**
 * docs/22-frontend-inspector.md, corte 1 puntos 3-4: hero + picker de
 * corridas reales, y el composer de la corrida elegida — con el estado en
 * la URL (`?corrida=<id>`), no en un booleano de cliente, para conservar
 * enlace profundo/recarga (docs/22 "Ser idéntico y tener URLs no son cosas
 * opuestas").
 *
 * Debajo se conserva la Cola de casos existente (09 §1 `/`), re-alcanzada a
 * la corrida elegida — o a la primera disponible cuando nada se ha elegido
 * todavía, que es el comportamiento previo a este corte. CLAUDE.md regla 9:
 * ninguna entrega incremental borra una función existente.
 */
export default async function InicioPage({ searchParams }: { searchParams: Promise<{ corrida?: string }> }) {
  const { corrida: corridaIdParam } = await searchParams;
  const ds = getDataSource();
  const corridas = await ds.listCorridas();
  const corridaSeleccionada = corridaIdParam ? await ds.getCorrida(corridaIdParam) : null;
  const corridaEnfocada = corridaSeleccionada ?? corridas[0] ?? null;

  const casos = corridaEnfocada ? await ds.listCasos({ corridaId: corridaEnfocada.id }) : [];

  const filas: FilaCola[] = await Promise.all(
    casos.map(async (caso) => {
      const entidad = await ds.getEntidad(caso.rfc_principal, caso.corrida_id);
      return { caso, razonSocialUntrusted: entidad?.razon_social_untrusted ?? null };
    }),
  );

  const porNivel = Object.fromEntries(NIVELES.map((n) => [n, casos.filter((c) => c.nivel === n).length])) as Record<Nivel, number>;
  const enProceso = casos.filter((c) => ["ronda_1", "ronda_2", "auditoria"].includes(c.estado)).length;
  const montoEnRiesgo = casos.reduce((acc, c) => acc + Number(c.monto_en_riesgo), 0);
  const cobertura = casos.length > 0 ? Math.round((casos.filter((c) => c.cobertura_completa).length / casos.length) * 100) : null;

  const casoPresuncion = casos.find((c) => c.nivel === "presuncion") ?? casos[0] ?? null;
  const rfcsDisponibles = casoPresuncion ? [casoPresuncion.rfc_principal, ...casoPresuncion.rfcs_satelite] : [];

  return (
    <div className="flex flex-col gap-10">
      <InspectorHome
        corridas={corridas}
        corridaSeleccionada={corridaSeleccionada}
        clusterId={casoPresuncion?.cluster_id}
        rfcsDisponibles={rfcsDisponibles}
      />

      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-text">Cola de casos</h2>
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
          <KpiCard label="Corrida activa" value={corridaEnfocada?.nombre ?? "—"} small />
          <KpiCard label="Cobertura completa" value={cobertura !== null ? `${cobertura}%` : "—"} />
        </div>

        {corridaEnfocada ? (
          <QueueTable filas={filas} />
        ) : (
          <p className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-sm text-text-subtle">Sin casos que mostrar.</p>
        )}
      </div>
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
