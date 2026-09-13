import type { MetadataRoute } from "next";

/** Installable Inspector identity; generated assets share the SVG star source. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Inspector",
    short_name: "Inspector",
    description: "Evidence-led financial investigations",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/inspector-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/inspector-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/inspector-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
