import { contractVersion } from "@/lib/contracts/validate";
import { cn } from "@/lib/utils";

/**
 * Badge obligatorio en toda vista alimentada por `FixtureDataSource`
 * (CLAUDE.md regla 3, 15 §13). `origen` distingue los shapes con contrato
 * v1.0.0 publicado de los fixtures locales de UI (cluster, grafo,
 * estadísticas, trayectoria, contraste, pares, inyección) que
 * `web/lib/data/types.ts` documenta como "fixture local de UI, SIN contrato
 * v1.0.0" — ver solicitudes_coordinador para incorporarlos como contrato.
 */
export function FixtureBadge({
  origen = "contrato",
  className,
}: {
  origen?: "contrato" | "local";
  className?: string;
}) {
  const label =
    origen === "contrato"
      ? `Datos de demostración · contratos v${contractVersion}`
      : "Datos de demostración · fixture local de UI";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs text-text-subtle",
        className,
      )}
      data-testid="fixture-badge"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />
      {label}
    </span>
  );
}
