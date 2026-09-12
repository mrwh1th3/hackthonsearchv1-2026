import { createForenseSupabaseClient, quiereFuenteSupabase } from "@/lib/data/supabase";

/**
 * Realtime (09 §Realtime, `db/001_schema.sql` §Realtime): la publicación
 * `supabase_realtime` solo incluye las tablas que ya son de lectura pública
 * (grant anon/authenticated en el mismo archivo) — `casos`, `bitacora`,
 * `senales`, `clusters`, `expedientes`, `pistas`. Ninguna tabla privada
 * (perfiles/investigaciones/notificaciones/inyecciones, 006/007/008) está
 * en esa publicación ni debería estarlo: esas se refrescan por polling del
 * BFF (`NotificacionesEnVivo`), nunca por un canal anon.
 *
 * Un canal solo se abre con `fuente === "supabase"` (mismo selector que
 * `getDataSource()`, CLAUDE.md regla 3: "la UI nunca lee n8n", y aquí
 * tampoco abre un socket contra un proyecto que no es el que ya se
 * seleccionó). En modo fixture, `suscribirCanalForense` es un no-op: no hay
 * corrida real de la que recibir cambios.
 */
export const TABLAS_REALTIME = ["casos", "bitacora", "senales", "clusters", "expedientes"] as const;
export type TablaRealtime = (typeof TABLAS_REALTIME)[number];

export interface SuscripcionCanal {
  /** Cierra el canal y libera el socket. Idempotente: llamar dos veces no lanza. */
  cerrar: () => void;
}

export interface SuscribirCanalParams<Fila extends Record<string, unknown> = Record<string, unknown>> {
  tabla: TablaRealtime;
  /** p.ej. `corrida_id=eq.<uuid>` o `caso_id=eq.<uuid>` (sintaxis de postgrest). */
  filtro?: string;
  onCambio: (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Fila; old: Partial<Fila> }) => void;
}

const SUSCRIPCION_INACTIVA: SuscripcionCanal = { cerrar: () => {} };

/**
 * Abre (o no) un canal de `postgres_changes` para una tabla pública de la
 * publicación `supabase_realtime`. Nunca lanza por sí sola: un error de
 * conexión lo reporta el propio canal de supabase-js de forma asíncrona
 * (evento `system`), no esta función — el llamador decide si eso importa.
 */
export function suscribirCanalForense<Fila extends Record<string, unknown> = Record<string, unknown>>(
  params: SuscribirCanalParams<Fila>,
): SuscripcionCanal {
  if (!quiereFuenteSupabase()) return SUSCRIPCION_INACTIVA;

  const client = createForenseSupabaseClient();
  const nombreCanal = `forense:${params.tabla}:${params.filtro ?? "todos"}`;
  const channel = client
    .channel(nombreCanal)
    .on(
      "postgres_changes",
      { event: "*", schema: "forense", table: params.tabla, ...(params.filtro ? { filter: params.filtro } : {}) },
      // El tipo de `payload` de supabase-js es genérico; el llamador ya sabe
      // qué fila espera de cada tabla (ver `./canal.test.ts`).
      (payload) => params.onCambio(payload as never),
    )
    .subscribe();

  let cerrado = false;
  return {
    cerrar: () => {
      if (cerrado) return;
      cerrado = true;
      client.removeChannel(channel);
    },
  };
}
