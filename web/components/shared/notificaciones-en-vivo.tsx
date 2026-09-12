"use client";

import { toast } from "sonner";
import { NotificationCenter } from "./notification-center";
import { useNotificacionesPolling } from "@/lib/notificaciones/use-polling";
import type { Notificacion } from "@/lib/data";

/**
 * Envoltorio cliente de `NotificationCenter` con polling acotado y dedupe
 * (Corte 2 punto 3). El listado inicial viene del render del servidor
 * (`/notificaciones` vía `lib/data/privado.ts`); a partir de ahí este
 * componente sondea `/api/notificaciones` y agrega solo lo nuevo — nunca
 * relee todo el historial en cada sondeo.
 */
export function NotificacionesEnVivo({ iniciales }: { iniciales: Notificacion[] }) {
  const notificaciones = useNotificacionesPolling(iniciales, (nuevas) => {
    for (const n of nuevas) toast(n.titulo);
  });
  return <NotificationCenter notificaciones={notificaciones} />;
}
