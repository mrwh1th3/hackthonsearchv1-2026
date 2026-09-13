import path from "node:path";
import type { NextConfig } from "next";

// La ruta /metodo (21 §"El camino") lee tres documentos de la RAÍZ del repo en
// tiempo de petición: es una ruta dinámica (`ƒ` en el build, porque el layout
// de (app) lee la cookie de sesión), así que el `fs.readFileSync` corre en el
// servidor, no en el build. En Vercel el Root Directory es `web/`, y la
// función serverless sólo lleva los archivos que el rastreo de Next incluye:
// sin esto, `../reports/handoff/DECISIONES.md` NO viaja en el despliegue y la
// pantalla que responde "¿cómo llegaron aquí?" saldría vacía en producción
// mientras pasa en local y en las pruebas, que sí tienen el repo entero.
//
// `outputFileTracingRoot` sube la raíz del rastreo un nivel para que esos
// archivos —que están FUERA de `web/`— puedan incluirse, y conserva la
// estructura relativa, así que la ruta `process.cwd()/..` sigue resolviendo
// en la función. Verificar en el primer despliegue: si /metodo sale vacía, el
// rastreo no los incluyó (`.next/server/app/metodo/page.js.nft.json` lista lo
// que sí entró).
const raizRepo = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Independent build output keeps verification from overwriting the active dev server.
  distDir: process.env.FORENSE_NEXT_DIST_DIR || ".next",
  typedRoutes: false,
  // `middleware.ts` cubre /api/estates: sin subir este tope (10 MB por omisión) Next trunca el cuerpo
  // multipart de un dataset antes de que llegue al route. Igual a MAX_BYTES_TOTAL + holgura multipart
  // (lib/estates/archivos.ts y app/api/estates/route.ts), que siguen validando por su cuenta.
  experimental: { serverActions: { bodySizeLimit: "4mb" }, middlewareClientMaxBodySize: "254mb" },
  outputFileTracingRoot: raizRepo,
  outputFileTracingIncludes: {
    "/metodo": [
      "../reports/handoff/DECISIONES.md",
      "../reports/handoff/ESTADO.md",
      "../RUNBOOK.md",
    ],
  },
};

export default nextConfig;
