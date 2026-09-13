"use client";

/**
 * Pantalla de fallo de la capa de datos. La comparten las dos fronteras de
 * error (`app/error.tsx` y `app/(app)/error.tsx`).
 *
 * Por qué existe: `SupabaseDataSource` y `lib/data/privado-supabase.ts`
 * PROPAGAN el error de Postgres a propósito en vez de devolver lista vacía
 * (CLAUDE.md regla 10: no mezclar una corrida real con datos de demo). Eso
 * es lo correcto, pero deja el orden de instalación como carga crítica: si
 * se configuran las variables ANTES de exponer el schema `forense` en
 * PostgREST, cada consulta lanza. Sin frontera de error, Next enseña su 500
 * por omisión — en medio del demo, y sin decir qué arreglar.
 *
 * Esta pantalla NO cae a fixtures. Un fallo de la fuente real no se disfraza
 * de "sin resultados": eso convertiría una instalación a medias en un
 * dictamen vacío, que es justo lo que el sistema no debe hacer.
 *
 * En producción Next borra el mensaje del error de servidor antes de que
 * llegue al cliente y deja sólo `digest`, así que el texto accionable no
 * puede depender de `error.message`: se publica la lista ordenada de causas
 * y el digest para cruzarlo con el log de la función.
 */
export function FalloDatos({
  error,
  reset,
  alcance,
}: {
  error: Error & { digest?: string };
  /** Ausente cuando lo pinta un layout por `try/catch` y no una frontera. */
  reset?: () => void;
  alcance: "app" | "pagina";
}) {
  const mensaje = error.message && error.message.length < 400 ? error.message : null;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-14" data-testid="fallo-datos">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="h-2 w-2 rounded-full bg-error" />
        <h1 className="text-lg font-semibold text-text">The data service did not respond</h1>
      </div>

      <p className="text-sm text-text-muted">
        {alcance === "app" ? "Could not load your profile and app navigation." : "Could not load this screen. Other pages remain available."}
        {" "}This does not mean there are no findings. Your real data has not been replaced with demo data.
      </p>
      <details className="rounded-lg border border-border p-4 text-sm text-text-muted">
        <summary>Troubleshooting</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Check Supabase → Project Settings → API → Exposed schemas for <code>forense</code>.</li>
          <li>Check the project’s availability, server configuration and applied migrations.</li>
          <li>After changing public environment variables, rebuild and redeploy.</li>
        </ol>
      </details>

      {(mensaje || error.digest) && (
        <p className="text-xs text-text-subtle">
          {mensaje ? (
            <>
              Details: <code className="text-text-muted">{mensaje}</code>
            </>
          ) : (
            <>
              Error reference: <code className="text-text-muted">{error.digest}</code>
            </>
          )}
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={() => (reset ? reset() : window.location.reload())}
          className="h-9 rounded-[var(--radius-input)] bg-primary px-3 text-sm text-white hover:bg-primary-hover"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
