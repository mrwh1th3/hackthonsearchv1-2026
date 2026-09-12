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
  // Selector explícito (decisión H3): Supabase solo con NEXT_PUBLIC_DATA_SOURCE=supabase
  // y credenciales públicas presentes; en cualquier otro caso, fixtures rotulados.
  const quiereSupabase = process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase";
  cached = quiereSupabase && isSupabaseConfigured() ? new SupabaseDataSource() : new FixtureDataSource();
  return cached;
}
