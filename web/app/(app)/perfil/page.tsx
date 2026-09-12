import { FixtureBadge } from "@/components/shared/fixture-badge";
import { ProfileSettings } from "@/components/shared/profile-settings";
import { fuentePrivadaActual, obtenerPerfilPrivado } from "@/lib/data/privado";
import { requerirSesionServidor } from "@/lib/auth/session";

export const metadata = { title: "Forense · Perfil" };
export const dynamic = "force-dynamic";

/** Perfil/teléfono son privados (CLAUDE.md regla 3): se leen de `lib/data/privado.ts` filtrados por el `perfil_id` de la sesión, nunca del DataSource público seleccionable ni de "la primera fila". */
export default async function PerfilPage() {
  const session = await requerirSesionServidor();
  const perfil = await obtenerPerfilPrivado(session.perfil_id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Perfil</h1>
        {fuentePrivadaActual() === "fixture" && <FixtureBadge />}
      </div>
      <ProfileSettings perfil={perfil} />
    </div>
  );
}
