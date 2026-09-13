import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { getDataSource } from "@/lib/data";
import { obtenerEjecucionesPrivadas } from "@/lib/data/privado";

export const runtime = "nodejs";

// El canvas sondea cada ~3 s; 60/min deja margen para dos pestañas abiertas.
const LIMIT = 60;
const WINDOW_MS = 60_000;

/**
 * Estado vivo del canvas "Análisis en proceso" (`/analisis/[casoId]`). Lee
 * sólo lo persistido — `casos`, `tareas_agente`, `bitacora` — por la misma
 * fuente de datos que el render del servidor, nunca n8n (regla 3). Un caso
 * que aún no existe (el webhook responde 202 antes de "Crear caso") no es
 * error: vuelve `caso: null` y el canvas sigue en cola.
 */
export async function GET(req: Request, { params }: { params: Promise<{ casoId: string }> }) {
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  }

  const rate = checkRateLimit(`analisis:${clientKeyFromRequest(req)}`, LIMIT, WINDOW_MS);
  if (!rate.ok) {
    return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });
  }

  const { casoId } = await params;
  const ds = getDataSource();
  // `runtime` (ejecuciones_agente/llm_solicitudes/tool_ejecuciones) es BFF
  // privado (regla 3): sin política de SELECT, solo esta ruta con sesión ya
  // verificada arriba puede leerlo. Si esa consulta falla no se cae el resto
  // del canvas — se manda vacío, y el panel de runtime lo muestra como
  // "no disponible" en vez de tirar el árbol de tareas/bitácora que sí sirvió.
  const [detalle, eventos, runtime] = await Promise.all([
    ds.getCasoDetalle(casoId),
    ds.getBitacoraCaso(casoId),
    obtenerEjecucionesPrivadas(casoId).catch(() => ({ ejecuciones: [], tokensTotales: null, costoTotal: null })),
  ]);
  // Pizarrón: `senales` es pública + realtime (regla 3), pero el cluster_id
  // sólo se conoce con el caso ya cargado por esta misma ruta con sesión —
  // se manda la siembra aquí y el cliente sigue en vivo con `useCanalForense`.
  const senales = detalle ? await ds.listSenalesCluster(detalle.caso.cluster_id) : [];
  return NextResponse.json({ caso: detalle?.caso ?? null, tareas: detalle?.tareas ?? [], eventos, runtime, senales });
}
