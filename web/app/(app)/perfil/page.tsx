import { FixtureBadge } from "@/components/shared/fixture-badge";
import { ProfileSettings } from "@/components/shared/profile-settings";
import { obtenerPerfilPrivado } from "@/lib/data/privado";

export const metadata = { title: "Forense · Perfil" };
export const dynamic = "force-dynamic";

/** Perfil/teléfono son privados (CLAUDE.md regla 3): se leen de `lib/data/privado.ts`, nunca del DataSource público seleccionable. */
export default async function PerfilPage() {
  const perfil = await obtenerPerfilPrivado();

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
