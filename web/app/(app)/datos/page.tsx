import { FixtureBadge } from "@/components/shared/fixture-badge";
import { getDataSource } from "@/lib/data";
import { DatosTabs } from "./datos-tabs";

export const metadata = { title: "Forense · Datos" };
export const dynamic = "force-dynamic";

/**
 * 19 / 21 §3.1: uploader → perfil → mapping → cobertura → confirmación, y
 * el modo "Inyectar datos en vivo" del ensayo de inyección. La importación
 * nunca dispara por sí sola una investigación completa.
 */
export default async function DatosPage() {
  const ds = getDataSource();
  const [mapperEjemplo, corridas] = await Promise.all([ds.getMapperEjemplo(), ds.listCorridas()]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Datos</h1>
        <FixtureBadge />
      </div>
      <DatosTabs mapperEjemplo={mapperEjemplo} corridas={corridas} />
    </div>
  );
}
