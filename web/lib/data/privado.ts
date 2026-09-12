import { FixtureDataSource } from "./fixture";
import {
  isPrivadoSupabaseConfigured,
  leerInvestigacionesPrivadas,
  leerInvestigacionPrivada,
  leerInyeccionesPrivadas,
  leerInyeccionPrivada,
  leerNotificacionesPrivadas,
  leerPerfilPrivado,
} from "./privado-supabase";
import type { Investigacion, InyeccionResumen, Notificacion, Perfil } from "./types";

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

export async function obtenerPerfilPrivado(): Promise<Perfil> {
  return usaSupabase ? leerPerfilPrivado() : fuentePrivada.getPerfil();
}

export async function obtenerNotificacionesPrivadas(desde?: string): Promise<Notificacion[]> {
  const todas = usaSupabase ? await leerNotificacionesPrivadas() : await fuentePrivada.listNotificaciones();
  if (!desde) return todas;
  const corte = new Date(desde).getTime();
  if (Number.isNaN(corte)) return todas;
  return todas.filter((n) => new Date(n.creado).getTime() > corte);
}

export async function obtenerHistorialPrivado(): Promise<Investigacion[]> {
  return usaSupabase ? leerInvestigacionesPrivadas() : fuentePrivada.listInvestigaciones();
}

export async function obtenerInvestigacionPrivada(id: string): Promise<Investigacion | null> {
  return usaSupabase ? leerInvestigacionPrivada(id) : fuentePrivada.getInvestigacion(id);
}

export async function obtenerInyeccionesPrivadas(): Promise<InyeccionResumen[]> {
  return usaSupabase ? leerInyeccionesPrivadas() : fuentePrivada.listInyecciones();
}

export async function obtenerInyeccionPrivada(id: string): Promise<InyeccionResumen | null> {
  return usaSupabase ? leerInyeccionPrivada(id) : fuentePrivada.getInyeccion(id);
}
