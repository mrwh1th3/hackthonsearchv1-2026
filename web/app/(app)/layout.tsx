import { AppShell } from "@/components/shared/app-shell";
import { obtenerNotificacionesPrivadas, obtenerPerfilPrivado } from "@/lib/data/privado";
import { requerirSesionServidor } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Envuelve toda ruta autenticada (todo excepto /login) con el shell de
 * 15 §3. `middleware.ts` ya garantiza sesión válida antes de llegar aquí;
 * este layout solo trae perfil/notificaciones para pintar el shell, nunca
 * decide autorización. Perfil/notificaciones son privados (CLAUDE.md regla
 * 3): se leen de `lib/data/privado.ts` FILTRADAS por el `perfil_id` de la
 * sesión (Corte 3 hallazgo 1 — nunca "la primera fila"), nunca del
 * `DataSource` seleccionable por `NEXT_PUBLIC_DATA_SOURCE`
 * (`SupabaseDataSource.getPerfil()` lanza a propósito si algo la llama).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requerirSesionServidor();
  const [perfil, notificaciones] = await Promise.all([
    obtenerPerfilPrivado(session.perfil_id),
    obtenerNotificacionesPrivadas(session.perfil_id),
  ]);
  const noLeidas = notificaciones.filter((n) => !n.leida_at).length;

  return (
    <AppShell perfilNombre={perfil.nombre} perfilOrganizacion={perfil.organizacion} notificacionesNoLeidas={noLeidas}>
      {children}
    </AppShell>
  );
}
