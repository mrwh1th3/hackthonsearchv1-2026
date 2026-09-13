import { AppShell } from "@/components/shared/app-shell";
import { FalloDatos } from "@/components/shared/fallo-datos";
import { fuentePrivadaActual, obtenerHistorialPrivado, obtenerNotificacionesPrivadas, obtenerPerfilPrivado } from "@/lib/data/privado";
import { requerirSesionServidor } from "@/lib/auth/session";
import { listLabs } from "@/lib/laboratorio/server";

export const dynamic = "force-dynamic";

/**
 * Envuelve toda ruta autenticada (todo excepto /login) con el shell de
 * 15 §3. `middleware.ts` ya garantiza sesión válida antes de llegar aquí;
 * este layout solo trae perfil/notificaciones para pintar el shell, nunca
 * decide autorización. Perfil/notificaciones son privados (CLAUDE.md regla
 * 3): se leen de `lib/data/privado.ts` FILTRADAS por el `perfil_id` de la
 * sesión (Corte 3 hallazgo 1 — nunca "la primera fila"), nunca del
 * `DataSource` seleccionable por `NEXT_PUBLIC_DATA_SOURCE`
 * (`SupabaseDataSource.getPerfil()` lanza a propósito si algo la llama).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requerirSesionServidor();

  // El fallo se atrapa AQUÍ y no en una frontera `error.tsx`, por lo medido
  // con `next start` y `SUPABASE_URL` apuntando a un host inexistente: un
  // throw de Server Component durante el SSR hace que Next sirva su documento
  // `__next_error__` con **500**, y la frontera no pinta hasta que el cliente
  // hidrata. Con este `try` la misma ruta sale **200** con la pantalla ya
  // renderizada en el servidor, que es lo que se quiere de un layout del que
  // cuelga toda la aplicación. (Se probó también una frontera en
  // `app/error.tsx`: no cambió el resultado, así que se quitó por redundante.)
  //
  // `obtenerPerfilPrivado`/`obtenerNotificacionesPrivadas` lanzan a propósito
  // cuando Supabase privado está configurado pero no responde (schema
  // `forense` sin exponer, URL mal puesta, migraciones sin aplicar). No se
  // cae al perfil de fixture: eso pintaría el nombre de un auditor de demo
  // sobre una instalación real a medias.
  let perfil: Awaited<ReturnType<typeof obtenerPerfilPrivado>>;
  let notificaciones: Awaited<ReturnType<typeof obtenerNotificacionesPrivadas>>;
  let investigaciones: Awaited<ReturnType<typeof obtenerHistorialPrivado>>;
  try {
    [perfil, notificaciones, investigaciones] = await Promise.all([
      obtenerPerfilPrivado(session.perfil_id),
      obtenerNotificacionesPrivadas(session.perfil_id),
      // El panel izquierdo del shell Inspector (docs/22) lista investigaciones
      // reales del perfil de la sesión — privadas (regla 3), nunca
      // `DataSource.listInvestigaciones()` público, que no filtra por perfil.
      obtenerHistorialPrivado(session.perfil_id),
    ]);
  } catch (e) {
    console.error("[forense-webapp] layout: la fuente privada no respondió:", e);
    return <FalloDatos error={e instanceof Error ? e : new Error(String(e))} alcance="app" />;
  }
  const noLeidas = notificaciones.filter((n) => !n.leida_at).length;
  const labRuns = await listLabs(session.perfil_id);

  return (
    <AppShell
      perfilNombre={perfil.nombre}
      perfilOrganizacion={perfil.organizacion}
      notificacionesNoLeidas={noLeidas}
      investigaciones={investigaciones}
      labRuns={labRuns}
      perfil={perfil}
      perfilEsFixture={fuentePrivadaActual() === "fixture"}
    >
      {children}
    </AppShell>
  );
}
