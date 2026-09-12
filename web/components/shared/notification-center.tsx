import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Notificacion } from "@/lib/data";
import { fechaHora } from "@/lib/date/formato";

const TIPO_LABEL: Record<Notificacion["tipo"], string> = {
  investigacion_completa: "Investigación completa",
  llamada_resultado: "Resultado de llamada",
  error: "Error",
};

/**
 * 15 §11 / 09 realtime: centro persistente leído/no leído con acción al
 * recurso. Corte 1 es de solo lectura (BFF con polling/mutación de lectura
 * queda para Corte 2, ver pendientes); no se finge una acción de "marcar
 * leída" sin endpoint real detrás.
 */
export function NotificationCenter({ notificaciones }: { notificaciones: Notificacion[] }) {
  if (notificaciones.length === 0) {
    return <p className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-sm text-text-subtle">Sin notificaciones todavía.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {notificaciones.map((n) => {
        const href = n.recurso.tipo === "investigacion" ? `/investigaciones/${n.recurso.id}` : `/casos/${n.recurso.id}/expediente`;
        const noLeida = !n.leida_at;
        return (
          <li key={n.id} className={cn("rounded-[var(--radius-card)] border p-3", noLeida ? "border-focus/40 bg-info/5" : "border-border bg-surface")}>
            <Link href={href} className="flex items-start gap-2">
              {noLeida && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-focus" />}
              <span className="flex-1">
                <span className="block text-xs text-text-subtle">{TIPO_LABEL[n.tipo]}</span>
                <span className="block text-sm text-text">{n.titulo}</span>
                <span className="block text-xs text-text-subtle">{fechaHora(n.creado)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
