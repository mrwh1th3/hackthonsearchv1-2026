import { FixtureBadge } from "@/components/shared/fixture-badge";
import { NotificationCenter } from "@/components/shared/notification-center";
import { getDataSource } from "@/lib/data";

export const metadata = { title: "Forense · Notificaciones" };

export default async function NotificacionesPage() {
  const ds = getDataSource();
  const notificaciones = await ds.listNotificaciones();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Notificaciones</h1>
        <FixtureBadge />
      </div>
      <NotificationCenter notificaciones={notificaciones} />
    </div>
  );
}
