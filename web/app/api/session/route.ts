import { NextResponse } from "next/server";
import { obtenerPerfilPrivado } from "@/lib/data/privado";
import { getDemoPassword, signSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";

export const runtime = "nodejs";

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60_000;

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "origen_no_permitido" }, { status: 403 });
  }

  const rate = checkRateLimit(`login:${clientKeyFromRequest(req)}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "demasiados_intentos", retry_after_ms: rate.retryAfterMs },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 });
  }

  const usuario = typeof (body as { usuario?: unknown })?.usuario === "string" ? (body as { usuario: string }).usuario : "";
  const password = typeof (body as { password?: unknown })?.password === "string" ? (body as { password: string }).password : "";

  const demoPassword = getDemoPassword();
  if (!demoPassword) {
    return NextResponse.json({ error: "sesion_no_configurada" }, { status: 503 });
  }

  if (usuario !== "auditor" || password !== demoPassword) {
    return NextResponse.json({ error: "credenciales_invalidas" }, { status: 401 });
  }

  const perfil = await obtenerPerfilPrivado();
  const token = await signSession({ sub: "auditor", perfil_id: perfil.id });
  if (!token) {
    return NextResponse.json({ error: "sesion_no_configurada" }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true, perfil_id: perfil.id });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}

export async function DELETE(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "origen_no_permitido" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
