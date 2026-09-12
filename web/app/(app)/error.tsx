"use client";

import { FalloDatos } from "@/components/shared/fallo-datos";

/**
 * Frontera de error de las rutas autenticadas. Atrapa el fallo de una
 * página concreta —`getDataSource()` contra el schema `forense`— dejando el
 * shell de navegación en pie, así que una pantalla rota no se lleva el resto
 * del sistema por delante.
 */
export default function ErrorApp({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <FalloDatos error={error} reset={reset} alcance="pagina" />;
}
