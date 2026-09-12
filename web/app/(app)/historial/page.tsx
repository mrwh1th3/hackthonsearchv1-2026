import { FixtureBadge } from "@/components/shared/fixture-badge";
import type { ExecutionHistoryRow } from "@/components/shared/execution-history";
import { getDataSource } from "@/lib/data";
import { HistorialTabs } from "./historial-tabs";

export const metadata = { title: "Forense · Historial" };

export default async function HistorialPage() {
  const ds = getDataSource();
  const investigaciones = await ds.listInvestigaciones();
  const perfil = await ds.getPerfil();

  const rows: ExecutionHistoryRow[] = await Promise.all(
    investigaciones.map(async (inv) => {
      const casoId = inv.caso_ids[0];
      const detalle = casoId ? await ds.getCasoDetalle(casoId) : null;
      const duracionMs = inv.completada_at ? new Date(inv.completada_at).getTime() - new Date(inv.creado).getTime() : null;
      return {
        investigacion: inv,
        duracionMs,
        autor: perfil.nombre,
        dataset: detalle?.caso.corrida_id.slice(0, 8) ?? inv.corrida_id.slice(0, 8),
        hijas: detalle?.tareas.map((t) => ({ id: t.id, agente: t.agente, ronda: t.ronda, intento: t.intento, estado: t.estado })),
      };
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Historial</h1>
        <FixtureBadge />
      </div>
      <p className="text-sm text-text-subtle">Solicitudes, ejecuciones y llamadas de tu workspace. El estado de entrega no implica el nivel de riesgo.</p>
      <HistorialTabs rows={rows} />
    </div>
  );
}
