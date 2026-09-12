import { SignJWT, jwtVerify } from "jose";

/**
 * Sesión demo (15 §4). Credencial fija auditor/1234 para un workspace
 * sintético compartido, no autenticación empresarial. La cookie es HttpOnly,
 * SameSite=Lax, firmada HS256 con jose; no es un JWT de Supabase (16 §6) y no
 * autoriza canales realtime privados.
 */

export const SESSION_COOKIE = "forense_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 horas: duración de una sesión de hackathon.
const DEV_DEFAULT_SESSION_SECRET = "forense-dev-session-secret-not-for-production";
const DEV_DEFAULT_DEMO_PASSWORD = "1234";

export interface SessionPayload {
  sub: string; // identificador simbólico, siempre "auditor" en este alcance
  perfil_id: string;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

let warnedSecret = false;
let warnedPassword = false;

export function getSessionSecret(): string | null {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length > 0) return configured;
  if (isProduction()) return null;
  if (!warnedSecret) {
    // eslint-disable-next-line no-console
    console.warn(
      "[forense-webapp] SESSION_SECRET no configurado; usando secreto de desarrollo. " +
        "No usar en producción.",
    );
    warnedSecret = true;
  }
  return DEV_DEFAULT_SESSION_SECRET;
}

export function getDemoPassword(): string | null {
  const configured = process.env.DEMO_PASSWORD;
  if (configured && configured.length > 0) return configured;
  if (isProduction()) return null;
  if (!warnedPassword) {
    // eslint-disable-next-line no-console
    console.warn(
      "[forense-webapp] DEMO_PASSWORD no configurado; usando contraseña de desarrollo 1234. " +
        "No usar en producción.",
    );
    warnedPassword = true;
  }
  return DEV_DEFAULT_DEMO_PASSWORD;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey(secret));
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const secret = getSessionSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    if (typeof payload.sub !== "string" || typeof payload.perfil_id !== "string") return null;
    return { sub: payload.sub, perfil_id: payload.perfil_id };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;
