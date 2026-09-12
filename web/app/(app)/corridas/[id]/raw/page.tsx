import { notFound } from "next/navigation";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { getDataSource } from "@/lib/data";
import { RawLog } from "./raw-log";

export const metadata = { title: "Forense · Bitácora cruda" };
export const dynamic = "force-dynamic";

export default async function CorridaRawPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const corrida = await ds.getCorrida(id);
  if (!corrida) notFound();
  const eventos = await ds.getBitacoraCorrida(id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Bitácora cruda</h1>
          <p className="text-xs text-text-subtle">{corrida.nombre}</p>
        </div>
        <FixtureBadge />
      </div>
      <RawLog eventos={eventos} />
    </div>
  );
}
