import { FixtureDataSource } from "./fixture";
import type { Investigacion, Notificacion, Perfil } from "./types";

/**
 * Datos privados por perfil: perfil, teléfono y notificaciones (CLAUDE.md
 * regla 3 — "Perfil, teléfono y notificaciones se sirven por BFF privado;
 * anon solo lee datos sintéticos autorizados"). Este módulo es la ÚNICA
 * fuente que `web/app/api/perfil` (futuro), `/api/notificaciones` y
 * `/api/historial` deben usar, y es intencionalmente INDEPENDIENTE del
 * selector `NEXT_PUBLIC_DATA_SOURCE`: aunque la webapp esté en modo
 * `supabase`, `forense` todavía no tiene las tablas de perfil/notificaciones
 * (migraciones 006/007, ver docs/16); `SupabaseDataSource.getPerfil()`
 * lanza a propósito si algo la llama por error (nunca debe usarse para esto,
 * ni siquiera cuando existan esas tablas: ese acceso irá filtrado por
 * `perfil_id` de sesión, nunca por el cliente anon público).
 *
 * Los llamadores de este módulo (rutas API y Server Components de páginas
 * privadas) ya verificaron la sesión antes de invocarlo — este módulo no
 * repite esa verificación.
 */
const fuentePrivada = new FixtureDataSource();

export async function obtenerPerfilPrivado(): Promise<Perfil> {
  return fuentePrivada.getPerfil();
}

export async function obtenerNotificacionesPrivadas(desde?: string): Promise<Notificacion[]> {
  const todas = await fuentePrivada.listNotificaciones();
  if (!desde) return todas;
  const corte = new Date(desde).getTime();
  if (Number.isNaN(corte)) return todas;
  return todas.filter((n) => new Date(n.creado).getTime() > corte);
}

export async function obtenerHistorialPrivado(): Promise<Investigacion[]> {
  return fuentePrivada.listInvestigaciones();
}
