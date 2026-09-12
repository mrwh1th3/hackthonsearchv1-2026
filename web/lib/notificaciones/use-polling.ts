"use client";

import { useEffect, useRef, useState } from "react";
import type { Notificacion } from "@/lib/data";
import { fusionarNotificaciones, siguienteIntervalo, INTERVALO_MS } from "./polling";

/**
 * Sondea `/api/notificaciones?since=` con backoff acotado y dedupe (ver
 * `polling.ts`). Arranca de inmediato al montar (sin esperar el primer
 * intervalo) para que la vista se ponga al día apenas se abre; se detiene
 * al desmontar. Nunca sondea si la pestaña está oculta — retoma al volver
 * visible en vez de acumular sondeos perdidos.
 */
export function useNotificacionesPolling(iniciales: Notificacion[], onNuevas?: (nuevas: Notificacion[]) => void) {
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>(iniciales);
  const desdeRef = useRef<string>(iniciales.reduce((max, n) => (n.creado > max ? n.creado : max), ""));
  const notificacionesRef = useRef(notificaciones);
  notificacionesRef.current = notificaciones;

  useEffect(() => {
    let cancelado = false;
    let intervaloActual = INTERVALO_MS;
    let temporizador: ReturnType<typeof setTimeout>;

    async function sondear() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        temporizador = setTimeout(sondear, intervaloActual);
        return;
      }
      let huboError = false;
      try {
        const qs = desdeRef.current ? `?since=${encodeURIComponent(desdeRef.current)}` : "";
        const res = await fetch(`/api/notificaciones${qs}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { notificaciones: Notificacion[] };
          const { lista, nuevas, desde } = fusionarNotificaciones(notificacionesRef.current, body.notificaciones, desdeRef.current);
          desdeRef.current = desde;
          if (nuevas.length > 0 && !cancelado) {
            setNotificaciones(lista);
            onNuevas?.(nuevas);
          }
        } else {
          huboError = true;
        }
      } catch {
        huboError = true;
      } finally {
        intervaloActual = siguienteIntervalo(intervaloActual, huboError);
        if (!cancelado) temporizador = setTimeout(sondear, intervaloActual);
      }
    }

    temporizador = setTimeout(sondear, 0);
    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onNuevas puede cambiar de identidad en cada render del llamador; solo se fija el intervalo al montar.
  }, []);

  return notificaciones;
}
