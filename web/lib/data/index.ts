import { FixtureDataSource } from "./fixture";
import { quiereFuenteSupabase, SupabaseDataSource } from "./supabase";
import type { DataSource } from "./source";

export type { AuditorHallazgo, AuditorLead, AuditorResultado, DataSource, CasoDetalle, EntidadPerfil, EstadisticasCorrida } from "./source";
export * from "./types";

let cached: DataSource | null = null;

/**
 * Resuelve la fuente de datos activa. Usa Supabase solo si las variables
 * públicas están configuradas; si no, cae a fixtures y toda vista lo declara
 * con un badge visible (CLAUDE.md regla 3, 15 §13, 19 "UI H0-1").
 */
export function getDataSource(): DataSource {
  if (cached) return cached;
  // Selector explícito (decisión H3, ver `./supabase.ts#quiereFuenteSupabase`):
  // Supabase solo con NEXT_PUBLIC_DATA_SOURCE=supabase y credenciales públicas
  // presentes; en cualquier otro caso, fixtures rotulados.
  cached = quiereFuenteSupabase() ? new SupabaseDataSource() : new FixtureDataSource();
  return cached;
}
