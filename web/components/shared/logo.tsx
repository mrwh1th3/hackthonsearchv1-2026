import { cn } from "@/lib/utils";

/**
 * Símbolo propio de Forense: documento de esquina doblada con dos trazos
 * verticales interiores (15 §1 — "Logo/favicon"). Usa `currentColor`, así
 * que el mismo trazo sirve para el botón/cabecera negra (variante blanca)
 * y para superficies claras (variante negra); ver `app/icon.svg` para el
 * favicon estático con fondo blanco fijo.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("h-5 w-5", className)}
      aria-hidden="true"
    >
      <path
        d="M6 3.5H14.5L18.5 7.5V20.5H6V3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14.5 3.5V7.5H18.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9.5 11V17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13 11V17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
