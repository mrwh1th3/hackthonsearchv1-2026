"use client";

import { Toaster } from "sonner";

/**
 * 15 §11: toasts abajo-derecha en desktop, arriba en móvil; éxito 4s, error
 * permanece hasta cerrar, máximo 3 visibles. `richColors` mapea a los
 * tokens semánticos definidos en globals.css a través de las clases que
 * sonner expone; `closeButton` para que el error no dependa de esperar.
 */
export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      expand={false}
      visibleToasts={3}
      closeButton
      toastOptions={{
        duration: 4000,
        className: "!rounded-[var(--radius-card)] !border !border-border !bg-surface !text-text !shadow-lg",
      }}
      mobileOffset={16}
      className="sm:!bottom-4 sm:!right-4"
    />
  );
}
