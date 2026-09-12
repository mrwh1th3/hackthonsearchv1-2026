import { FixtureDataSource } from "./fixture";
import { isSupabaseConfigured, SupabaseDataSource } from "./supabase";
import type { DataSource } from "./source";

export type { DataSource, CasoDetalle, EntidadPerfil, EstadisticasCorrida } from "./source";
export * from "./types";

let cached: DataSource | null = null;

/**
 * Resuelve la fuente de datos activa. Usa Supabase solo si las variables
 * públicas están configuradas; si no, cae a fixtures y toda vista lo declara
 * con un badge visible (CLAUDE.md regla 3, 15 §13, 19 "UI H0-1").
 */
export function getDataSource(): DataSource {
  if (cached) return cached;
  cached = isSupabaseConfigured() ? new SupabaseDataSource() : new FixtureDataSource();
  return cached;
}
