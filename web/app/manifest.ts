import type { MetadataRoute } from "next";

/**
 * 15 §12: manifest `display=standalone`, theme color blanco. Los iconos
 * raster 192/512 y `apple-touch-icon.png` 180 quedan pendientes: este
 * entorno no tiene un rasterizador SVG→PNG disponible (no se instalan
 * paquetes fuera de ownership); `app/icon.svg` cubre el favicon vía la
 * convención de archivo de Next. Ver pendientes del corte.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Forense",
    short_name: "Forense",
    description: "Agente forense de facturación falsa",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAFA",
    theme_color: "#FFFFFF",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
