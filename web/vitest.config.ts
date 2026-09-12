import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}", "../tests/editor/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "."), "@contracts": path.resolve(__dirname, "../contracts") } },
  // Petición de forense-editor: sus specs viven en `../tests/editor` y su
  // helper de contratos apunta a `../contracts` (fuera de `web/`, la raíz
  // inferida de este proyecto Vite). `server.fs.allow` REEMPLAZA la lista
  // por defecto (no la extiende) — hay que seguir incluyendo `web/` o los
  // tests propios de este paquete se rompen.
  server: {
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, "../tests"), path.resolve(__dirname, "../contracts")],
    },
  },
});
