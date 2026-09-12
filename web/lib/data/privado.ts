import { FixtureDataSource } from "./fixture";
import {
  borrarVistaPrivada as borrarVistaPrivadaSupabase,
  guardarVistaPrivada as guardarVistaPrivadaSupabase,
  isPrivadoSupabaseConfigured,
  leerInvestigacionesPrivadas,
  leerInvestigacionPrivada,
  leerInyeccionesPrivadas,
  leerInyeccionPrivada,
  leerNotificacionesPrivadas,
  leerPerfilPrivado,
  leerVistasGuardadasPrivadas,
} from "./privado-supabase";
import type { Investigacion, InyeccionResumen, Notificacion, Perfil, VistaGuardada } from "./types";

/**
 * Datos privados por perfil: perfil, teléfono, investigaciones, notificaciones
 * e inyecciones (CLAUDE.md regla 3 — "Perfil, teléfono y notificaciones se
 * sirven por BFF privado; anon solo lee datos sintéticos autorizados"). Este
 * módulo es la ÚNICA fuente que `/perfil`, `/notificaciones`, `/historial`,
 * `/investigaciones/[id]` e `/inyecciones/[id]` deben usar, y es
 * intencionalmente INDEPENDIENTE del selector `NEXT_PUBLIC_DATA_SOURCE`: ese
 * selector es sobre el DataSource público (anon+RLS), mientras que aquí la
 * decisión es "¿hay `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` de servidor?"
 * (docs/16, migraciones 006/007/008 — RLS sin política de SELECT, solo
 * `service_role` entra). `SupabaseDataSource.getPerfil()` (el DataSource
 * público) sigue lanzando a propósito si algo la llama por error para esto.
 *
 * Sin esas variables de entorno → fixture, con el badge correspondiente
 * (`fuentePrivadaActual()` le dice a cada página cuál mostrar). Con ellas
 * pero una fila realmente ausente (p.ej. una inyección con ese id no
 * existe), la respuesta es `null`/`[]` — un 404 legítimo, nunca se
 * sustituye en silencio por datos de fixture (eso mezclaría una corrida
 * real con una demo, CLAUDE.md regla 10).
 *
 * Los llamadores de este módulo (rutas API y Server Components de páginas
 * privadas) ya verificaron la sesión antes de invocarlo — este módulo no
 * repite esa verificación.
 */
const fuentePrivada = new FixtureDataSource();
const usaSupabase = isPrivadoSupabaseConfigured();

export function fuentePrivadaActual(): "supabase" | "fixture" {
  return usaSupabase ? "supabase" : "fixture";
}

/**
 * Sin `perfilId`: solo válido para el bootstrap de login (`/api/session`,
 * antes de que exista una sesión que resolver). Todo lo demás DEBE pasar el
 * `perfil_id` de `requerirSesionServidor()`/`session.perfil_id` — ver
 * `leerPerfilPrivado` para el porqué (Corte 3 hallazgo 1, nunca "la primera
 * fila"). El fixture es un único perfil sintético compartido: no hay nada
 * que filtrar ahí, pero la firma es simétrica para no bifurcar los
 * llamadores por fuente de datos.
 */
export async function obtenerPerfilPrivado(perfilId?: string): Promise<Perfil> {
  return usaSupabase ? leerPerfilPrivado(perfilId) : fuentePrivada.getPerfil();
}

export async function obtenerNotificacionesPrivadas(perfilId: string, desde?: string): Promise<Notificacion[]> {
  const todas = usaSupabase ? await leerNotificacionesPrivadas(perfilId) : await fuentePrivada.listNotificaciones();
  if (!desde) return todas;
  const corte = new Date(desde).getTime();
  if (Number.isNaN(corte)) return todas;
  return todas.filter((n) => new Date(n.creado).getTime() > corte);
}

export async function obtenerHistorialPrivado(perfilId: string): Promise<Investigacion[]> {
  return usaSupabase ? leerInvestigacionesPrivadas(perfilId) : fuentePrivada.listInvestigaciones();
}

export async function obtenerInvestigacionPrivada(id: string, perfilId: string): Promise<Investigacion | null> {
  return usaSupabase ? leerInvestigacionPrivada(id, perfilId) : fuentePrivada.getInvestigacion(id);
}

export async function obtenerInyeccionesPrivadas(perfilId: string): Promise<InyeccionResumen[]> {
  return usaSupabase ? leerInyeccionesPrivadas(perfilId) : fuentePrivada.listInyecciones();
}

export async function obtenerInyeccionPrivada(id: string, perfilId: string): Promise<InyeccionResumen | null> {
  return usaSupabase ? leerInyeccionPrivada(id, perfilId) : fuentePrivada.getInyeccion(id);
}

/**
 * Vistas guardadas (15 §9, `forense.vistas_guardadas` — 006 §3). Sin
 * `SupabaseDataSource` (nunca hubo tabla pública para esto: siempre fueron
 * privadas por perfil) ni fixture propio — `null`/`false` aquí es la señal
 * que usa `/api/vistas` para responder 503 `backend_no_configurado`, y el
 * cliente cae a `localStorage` (`web/lib/data/vistas-guardadas.ts`), igual
 * que ya hace el wizard de `/datos` con `product.inyectar`.
 */
export async function obtenerVistasGuardadasPrivadas(perfilId: string, ruta: string): Promise<VistaGuardada[] | null> {
  if (!usaSupabase) return null;
  return leerVistasGuardadasPrivadas(perfilId, ruta);
}

export async function guardarVistaGuardadaPrivada(input: { perfilId: string; nombre: string; ruta: string; filtros: Record<string, unknown> }): Promise<VistaGuardada | null> {
  if (!usaSupabase) return null;
  return guardarVistaPrivadaSupabase(input);
}

export async function borrarVistaGuardadaPrivada(perfilId: string, id: string): Promise<boolean> {
  if (!usaSupabase) return false;
  await borrarVistaPrivadaSupabase(perfilId, id);
  return true;
}
