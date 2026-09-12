"use client";

import { useEffect, useRef } from "react";
import { suscribirCanalForense, type SuscribirCanalParams } from "./canal";

/**
 * Hook de conveniencia sobre `suscribirCanalForense` para componentes
 * cliente: abre el canal al montar (o cuando cambia `filtro`), lo cierra al
 * desmontar — nunca deja un socket huérfano por navegación (09 §Realtime).
 * `onCambio` se guarda en un ref para no reabrir el canal en cada render
 * cuando el llamador pasa una función nueva cada vez.
 */
export function useCanalForense<Fila extends Record<string, unknown> = Record<string, unknown>>(
  params: SuscribirCanalParams<Fila>,
): void {
  const onCambioRef = useRef(params.onCambio);
  onCambioRef.current = params.onCambio;

  useEffect(() => {
    const suscripcion = suscribirCanalForense<Fila>({
      tabla: params.tabla,
      filtro: params.filtro,
      onCambio: (payload) => onCambioRef.current(payload),
    });
    return () => suscripcion.cerrar();
  }, [params.tabla, params.filtro]);
}
