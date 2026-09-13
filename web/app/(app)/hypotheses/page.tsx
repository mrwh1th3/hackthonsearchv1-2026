import { requerirSesionServidor } from "@/lib/auth/session";
import { readHypothesesIndex } from "@/lib/laboratorio/hypotheses-server";
import { HypothesesWorkspace } from "./workspace";
import { esUuid } from "@/lib/auditoria/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: "Inspector · Hypotheses" };

export default async function HypothesesPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const session = await requerirSesionServidor();
  const params = await searchParams;
  return <HypothesesWorkspace index={await readHypothesesIndex(session.perfil_id)} initialRunId={esUuid(params.run) ? params.run : undefined} />;
}
