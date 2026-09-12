import { AppShell } from "@/components/shared/app-shell";
import { getDataSource } from "@/lib/data";

/**
 * Envuelve toda ruta autenticada (todo excepto /login) con el shell de
 * 15 §3. `middleware.ts` ya garantiza sesión válida antes de llegar aquí;
 * este layout solo trae perfil/notificaciones para pintar el shell, nunca
 * decide autorización.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ds = getDataSource();
  const [perfil, notificaciones] = await Promise.all([ds.getPerfil(), ds.listNotificaciones()]);
  const noLeidas = notificaciones.filter((n) => !n.leida_at).length;

  return (
    <AppShell perfilNombre={perfil.nombre} perfilOrganizacion={perfil.organizacion} notificacionesNoLeidas={noLeidas}>
      {children}
    </AppShell>
  );
}
