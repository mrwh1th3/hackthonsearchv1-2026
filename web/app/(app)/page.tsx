import { InspectorHome } from "@/components/shared/inspector-home";
import { getDataSource } from "@/lib/data";
import { requerirSesionServidor } from "@/lib/auth/session";
import { listLabs } from "@/lib/laboratorio/server";

export const metadata = { title: "Inspector · Home" };
export const dynamic = "force-dynamic";

/** The main screen owns dataset selection, the unified investigation and its results. */
export default async function InicioPage({ searchParams }: { searchParams: Promise<{ corrida?: string; run?: string }> }) {
  const { corrida: corridaId } = await searchParams;
  const ds = getDataSource();
  const session = await requerirSesionServidor();
  const [corridas, corridaSeleccionada, runs] = await Promise.all([
    ds.listCorridas(),
    corridaId ? ds.getCorrida(corridaId) : Promise.resolve(null),
    listLabs(session.perfil_id),
  ]);
  return <InspectorHome corridas={corridas} corridaSeleccionada={corridaSeleccionada} initialRuns={runs} />;
}
