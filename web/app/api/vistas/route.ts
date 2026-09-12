import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";
import { borrarVistaGuardadaPrivada, guardarVistaGuardadaPrivada, obtenerVistasGuardadasPrivadas } from "@/lib/data/privado";

export const runtime = "nodejs";

const LIMIT = 30;
const WINDOW_MS = 60_000;

const NOMBRE_MAX = 80;
const RUTA_MAX = 200;

/**
 * BFF de "Guardar vista" (15 §9, `forense.vistas_guardadas` — 006 §3): la
 * tabla tiene RLS sin política de SELECT (solo `service_role`), así que
 * nunca se lee/escribe directo desde el cliente — todo pasa por aquí, y
 * SIEMPRE con `session.perfil_id` (nunca uno que mande el body: eso
 * dejaría borrar/leer vistas de otro perfil). Sin
 * `SUPABASE_SERVICE_ROLE_KEY` de servidor, 503 `backend_no_configurado`:
 * el cliente (`web/lib/data/vistas-guardadas.ts`) cae a `localStorage`,
 * igual que el wizard de `/datos` con `product.inyectar`.
 */
function sesionOError(req: Request) {
  if (!isSameOriginRequest(req)) return { error: NextResponse.json({ error: "origen_no_permitido" }, { status: 403 }) };
  return null;
}

async function requerirSesion(req: Request) {
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  return verifySession(token);
}

export async function GET(req: Request) {
  const errorOrigen = sesionOError(req);
  if (errorOrigen) return errorOrigen.error;

  const session = await requerirSesion(req);
  if (!session) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });

  const rate = checkRateLimit(`vistas-get:${clientKeyFromRequest(req)}`, LIMIT, WINDOW_MS);
  if (!rate.ok) return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });

  const ruta = new URL(req.url).searchParams.get("ruta");
  if (!ruta || ruta.length > RUTA_MAX) return NextResponse.json({ error: "argumento_invalido" }, { status: 400 });

  const vistas = await obtenerVistasGuardadasPrivadas(session.perfil_id, ruta);
  if (vistas === null) return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
  return NextResponse.json({ vistas });
}

export async function POST(req: Request) {
  const errorOrigen = sesionOError(req);
  if (errorOrigen) return errorOrigen.error;

  const session = await requerirSesion(req);
  if (!session) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });

  const rate = checkRateLimit(`vistas-post:${clientKeyFromRequest(req)}`, LIMIT, WINDOW_MS);
  if (!rate.ok) return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 });
  }

  const { nombre, ruta, filtros } = (body ?? {}) as { nombre?: unknown; ruta?: unknown; filtros?: unknown };
  if (
    typeof nombre !== "string" ||
    nombre.trim().length === 0 ||
    nombre.length > NOMBRE_MAX ||
    typeof ruta !== "string" ||
    ruta.length === 0 ||
    ruta.length > RUTA_MAX ||
    typeof filtros !== "object" ||
    filtros === null ||
    Array.isArray(filtros)
  ) {
    return NextResponse.json({ error: "argumento_invalido" }, { status: 400 });
  }

  const vista = await guardarVistaGuardadaPrivada({ perfilId: session.perfil_id, nombre: nombre.trim(), ruta, filtros: filtros as Record<string, unknown> });
  if (vista === null) return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
  return NextResponse.json({ vista }, { status: 201 });
}

export async function DELETE(req: Request) {
  const errorOrigen = sesionOError(req);
  if (errorOrigen) return errorOrigen.error;

  const session = await requerirSesion(req);
  if (!session) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });

  const rate = checkRateLimit(`vistas-delete:${clientKeyFromRequest(req)}`, LIMIT, WINDOW_MS);
  if (!rate.ok) return NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "argumento_invalido" }, { status: 400 });

  const borrada = await borrarVistaGuardadaPrivada(session.perfil_id, id);
  if (!borrada) return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
  return NextResponse.json({ ok: true });
}
