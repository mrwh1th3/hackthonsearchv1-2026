import { FixtureBadge } from "@/components/shared/fixture-badge";
import { ProfileSettings } from "@/components/shared/profile-settings";
import { getDataSource } from "@/lib/data";

export const metadata = { title: "Forense · Perfil" };
export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const ds = getDataSource();
  const perfil = await ds.getPerfil();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Perfil</h1>
        <FixtureBadge />
      </div>
      <ProfileSettings perfil={perfil} />
    </div>
  );
}
