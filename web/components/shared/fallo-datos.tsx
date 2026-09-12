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
        <h1 className="text-lg font-semibold text-text">La capa de datos no respondió</h1>
      </div>

      <p className="text-sm text-text-muted">
        {alcance === "app"
          ? "Falló la lectura de perfil y notificaciones, que alimenta el shell de toda la aplicación."
          : "Falló la consulta de esta pantalla. El resto de la navegación sigue en pie."}{" "}
        <strong className="font-medium text-text">Esto no significa que no haya hallazgos:</strong>{" "}
        significa que no se pudo preguntar. No se sustituye por datos de demostración a propósito,
        para no mezclar una corrida real con un fixture.
      </p>

      <div className="rounded-lg border border-border bg-surface-muted p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-subtle">
          Qué revisar, en este orden
        </p>
        <p className="mb-2 text-xs text-text-subtle">
          Si esto empezó <strong className="font-medium">a media sesión</strong> y antes funcionaba,
          la configuración no es la causa: mira primero el estado del proyecto Supabase y el log de
          la función, y reintenta.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-text-muted">
          <li>
            Que el schema <code className="text-text">forense</code> esté expuesto en Supabase →
            Project Settings → API → Exposed schemas. Es el fallo más probable: las claves pueden
            estar bien y PostgREST seguir rechazando el schema.
          </li>
          <li>
            Que estén las variables de servidor <code className="text-text">SUPABASE_URL</code> y{" "}
            <code className="text-text">SUPABASE_SERVICE_ROLE_KEY</code>, y las públicas{" "}
            <code className="text-text">NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
            <code className="text-text">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          </li>
          <li>
            Que las migraciones <code className="text-text">001</code>–
            <code className="text-text">020</code> estén aplicadas en el proyecto al que apuntan
            esas variables.
          </li>
          <li>
            Si acabas de cambiar una variable <code className="text-text">NEXT_PUBLIC_*</code>:
            hace falta volver a desplegar, no sólo guardarla. Se incrustan en el bundle al
            construir.
          </li>
        </ol>
      </div>

      {(mensaje || error.digest) && (
        <p className="text-xs text-text-subtle">
          {mensaje ? (
            <>
              Detalle: <code className="text-text-muted">{mensaje}</code>
            </>
          ) : (
            <>
              El mensaje del servidor no viaja al navegador en producción. Busca este identificador
              en el log de la función: <code className="text-text-muted">{error.digest}</code>
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
          Reintentar
        </button>
      </div>
    </div>
  );
}
