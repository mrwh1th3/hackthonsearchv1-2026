import { AppShell } from "@/components/shared/app-shell";
import { obtenerNotificacionesPrivadas, obtenerPerfilPrivado } from "@/lib/data/privado";

export const dynamic = "force-dynamic";

/**
 * Envuelve toda ruta autenticada (todo excepto /login) con el shell de
 * 15 §3. `middleware.ts` ya garantiza sesión válida antes de llegar aquí;
 * este layout solo trae perfil/notificaciones para pintar el shell, nunca
 * decide autorización. Perfil/notificaciones son privados (CLAUDE.md regla
 * 3): se leen de `lib/data/privado.ts`, nunca del `DataSource` seleccionable
 * por `NEXT_PUBLIC_DATA_SOURCE` (`SupabaseDataSource.getPerfil()` lanza a
 * propósito si algo la llama).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [perfil, notificaciones] = await Promise.all([obtenerPerfilPrivado(), obtenerNotificacionesPrivadas()]);
  const noLeidas = notificaciones.filter((n) => !n.leida_at).length;

  return (
    <AppShell perfilNombre={perfil.nombre} perfilOrganizacion={perfil.organizacion} notificacionesNoLeidas={noLeidas}>
      {children}
    </AppShell>
  );
}
