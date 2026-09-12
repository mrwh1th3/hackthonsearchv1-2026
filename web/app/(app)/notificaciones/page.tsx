import { FixtureBadge } from "@/components/shared/fixture-badge";
import { NotificacionesEnVivo } from "@/components/shared/notificaciones-en-vivo";
import { fuentePrivadaActual, obtenerNotificacionesPrivadas } from "@/lib/data/privado";
import { requerirSesionServidor } from "@/lib/auth/session";

export const metadata = { title: "Forense · Notificaciones" };
export const dynamic = "force-dynamic";

/** Perfil/notificaciones son privados (CLAUDE.md regla 3): `lib/data/privado.ts` filtrado por el `perfil_id` de la sesión para el render inicial, `/api/notificaciones` (mismo filtro) para el polling en vivo del cliente. */
export default async function NotificacionesPage() {
  const session = await requerirSesionServidor();
  const notificaciones = await obtenerNotificacionesPrivadas(session.perfil_id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Notificaciones</h1>
        {fuentePrivadaActual() === "fixture" && <FixtureBadge />}
      </div>
      <NotificacionesEnVivo iniciales={notificaciones} />
    </div>
  );
}
