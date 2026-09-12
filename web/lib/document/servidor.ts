import { NextResponse } from "next/server";

import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/auth/session";
import { getDataSource } from "@/lib/data";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";

import { sembrarCaso } from "./almacen-demo";
import { desdeMarkdown } from "./markdown";
import { obtenerRepositorio, type ModoPersistencia, type RepositorioExpediente } from "./repositorio";
import type { Documento, Reporte } from "./tipos";

/**
 * Utilidades comunes del BFF de reportes (`app/api/reportes/*`).
 *
 * **Solo servidor.** No lo importa ningún componente cliente (el paquete
 * `server-only` no está instalado y no se añaden dependencias): el editor del
 * navegador usa exclusivamente los módulos puros de `lib/document/*`.
 *
 * CLAUDE.md regla 3: la UI nunca habla con n8n; toda mutación pasa por este
 * BFF con sesión. Hay DOS decisiones distintas, y confundirlas fue el defecto
 * que corrigió este corte:
 *
 * 1. **De dónde sale una propuesta** (`/api/reportes/propuestas`) —
 *    `modoPropuesta()`:
 *    - `webhook`: hay `N8N_WEBHOOK_BASE` + `INTERNAL_WEBHOOK_SECRET` → la
 *      redacta el agente Editor real (07 §4, `POST /webhook/forense/editar`);
 *      `origen: "n8n"`.
 *    - `fixture`: la fuente de datos activa es la de fixtures → transformación
 *      fija, etiquetada `origen: "fixture"`. No se simula un modelo.
 *    - `no_configurado`: fuente real sin webhook → 503.
 *
 * 2. **Dónde se persiste el expediente** (aplicar, descartar, revertir,
 *    borrador, versiones, exportar) — `repositorio.ts`. `N8N_WEBHOOK_BASE`
 *    **no** interviene: `MANIFEST.md` §5 nodo 8 dice que Aplicar es operación
 *    determinista del BFF y no hay nodo de webhook para estas cinco
 *    operaciones. Manda `SUPABASE_SERVICE_ROLE_KEY`; si falta, o bien fixture
 *    declarado, o bien 503. Nunca memoria disfrazada de persistencia.
 */

export type OrigenRespuesta = "fixture" | "n8n" | "supabase";

export type ModoPropuesta = "webhook" | "fixture" | "no_configurado";

export function modoPropuesta(): ModoPropuesta {
  const base = process.env.N8N_WEBHOOK_BASE;
  const secreto = process.env.INTERNAL_WEBHOOK_SECRET;
  if (base && secreto) return "webhook";
  return getDataSource().label === "fixture" ? "fixture" : "no_configurado";
}

export function origenDe(modo: ModoPropuesta): OrigenRespuesta {
  return modo === "webhook" ? "n8n" : "fixture";
}

/**
 * Repositorio de persistencia del expediente, o `null` si no hay ninguno
 * configurado (el llamador responde 503: el borrador se conserva en cliente).
 */
export function repositorio(): RepositorioExpediente | null {
  return obtenerRepositorio(getDataSource().label);
}

export type { ModoPersistencia };

export interface ContextoPeticion {
  session: SessionPayload;
  body: unknown;
}

/** Origen + sesión + rate limit. Devuelve la respuesta de error o el contexto. */
export async function guardas(
  req: Request,
  clave: string,
  limite = 60,
  ventanaMs = 60_000,
): Promise<{ error: NextResponse } | { ok: ContextoPeticion }> {
  if (!isSameOriginRequest(req)) {
    return { error: NextResponse.json({ error: "origen_no_permitido" }, { status: 403 }) };
  }
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await verifySession(token);
  if (!session) return { error: NextResponse.json({ error: "no_autenticado" }, { status: 401 }) };

  const rate = checkRateLimit(`${clave}:${clientKeyFromRequest(req)}`, limite, ventanaMs);
  if (!rate.ok) {
    return {
      error: NextResponse.json({ error: "demasiadas_solicitudes", retry_after_ms: rate.retryAfterMs }, { status: 429 }),
    };
  }

  let body: unknown = undefined;
  if (req.method !== "GET") {
    try {
      body = await req.json();
    } catch {
      return { error: NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 }) };
    }
  }
  return { ok: { session, body } };
}

export interface CasoEditor {
  casoId: string;
  documentoBase: Documento;
  referenciasValidadas: Set<string>;
  versionActual: Reporte;
  rfc: string;
}

/**
 * Carga el expediente del caso y siembra la versión 1 en el almacén a partir
 * del Markdown del Redactor (importación única de 15 §10). Determinista: la
 * página y el BFF derivan el MISMO documento, con los mismos ids y hashes.
 */
export async function cargarCasoEditor(casoId: string, repo?: RepositorioExpediente | null): Promise<CasoEditor | null> {
  const repositorioUsado = repo ?? repositorio();
  if (!repositorioUsado) return null;
  const detalle = await getDataSource().getCasoDetalle(casoId);
  if (!detalle || !detalle.redactor) return null;
  const documentoBase = desdeMarkdown(detalle.redactor.markdown);
  // Solo el almacén de demostración se siembra desde el Markdown del Redactor.
  // Con persistencia real la versión 1 la escribió el Redactor en
  // `forense.expedientes`: si no está, no hay expediente que editar.
  if (repositorioUsado.modo === "fixture") sembrarCaso(casoId, documentoBase);
  const actual = await repositorioUsado.versionActual(casoId);
  if (!actual) return null;
  const referencias = new Set(detalle.evidencia.filter((e) => e.validada).flatMap((e) => e.referencias));
  return {
    casoId,
    documentoBase,
    referenciasValidadas: referencias,
    versionActual: actual,
    rfc: detalle.caso.rfc_principal,
  };
}

/** Reenvío al webhook de n8n con el secreto en header. Nunca se registra el secreto. */
export async function reenviarAWebhook(ruta: string, payload: unknown): Promise<Response> {
  const base = process.env.N8N_WEBHOOK_BASE;
  const secreto = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!base || !secreto) throw new Error("webhook_no_configurado");
  return fetch(`${base.replace(/\/$/, "")}${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forense-secret": secreto },
    body: JSON.stringify(payload),
  });
}

export function respuestaNoConfigurado(): NextResponse {
  return NextResponse.json({ error: "backend_no_configurado" }, { status: 503 });
}

export function nuevoUuid(): string {
  return globalThis.crypto.randomUUID();
}
