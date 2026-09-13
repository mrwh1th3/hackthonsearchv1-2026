import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Familia, Nivel } from "@/lib/data";

/**
 * Sistema visual único (09 "Sistema visual", 15 §2): mismos colores de
 * nivel/familia en toda la app — cola, cluster, caso, entidad, estadísticas.
 * Nunca renderiza 'definitivo' (CLAUDE.md regla 7): el tipo `Nivel` ya lo
 * excluye en tiempo de compilación.
 */
const NIVEL_ESTILO: Record<Nivel, string> = {
  sin_hallazgos: "bg-green-50 text-green-700 border-green-200",
  anomalia_explicada: "bg-green-50 text-green-600 border-green-200",
  no_concluyente: "bg-surface-muted text-text-muted border-border",
  presuncion: "bg-red-50 text-red-600 border-red-200",
  presuncion_alta: "bg-red-100 text-red-800 border-red-300",
};

export const NIVEL_LABEL: Record<Nivel, string> = {
  sin_hallazgos: "Sin hallazgos",
  anomalia_explicada: "Explained anomaly",
  no_concluyente: "Inconclusive",
  presuncion: "Suspected",
  presuncion_alta: "Strongly suspected",
};

export function NivelBadge({ nivel, motivo, className }: { nivel: Nivel | null; motivo?: string; className?: string }) {
  if (nivel === null) {
    // Caso todavía en curso: el contrato permite `nivel: null` (aún no
    // dictaminado). Nunca se muestra un nivel inventado mientras tanto.
    return (
      <span className={cn("inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-medium text-text-subtle", className)}>
        Running
      </span>
    );
  }
  return (
    <span
      title={nivel === "no_concluyente" ? motivo : undefined}
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", NIVEL_ESTILO[nivel], className)}
    >
      {NIVEL_LABEL[nivel]}
    </span>
  );
}

const FAMILIA_CLASE: Record<Familia, string> = {
  D: "bg-fam-d/10 text-fam-d border-fam-d/30",
  F: "bg-fam-f/10 text-fam-f border-fam-f/30",
  R: "bg-fam-r/10 text-fam-r border-fam-r/30",
  T: "bg-fam-t/10 text-fam-t border-fam-t/30",
  E: "bg-fam-e/10 text-fam-e border-fam-e/30",
};

export const FAMILIA_NOMBRE: Record<Familia, string> = {
  D: "Documental",
  F: "Financiera",
  R: "Relacional",
  T: "Temporal",
  E: "Externa",
};

export function FamiliaChip({ familia, className }: { familia: Familia; className?: string }) {
  return (
    <span
      title={FAMILIA_NOMBRE[familia]}
      className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold", FAMILIA_CLASE[familia], className)}
    >
      {familia}
    </span>
  );
}

const ESTADO_ESTILO: Record<string, string> = {
  en_cola: "bg-surface-muted text-text-subtle border-border",
  ronda_1: "bg-info/10 text-info border-info/30",
  ronda_2: "bg-info/10 text-info border-info/30",
  auditoria: "bg-info/10 text-info border-info/30",
  dictaminado: "bg-ok/10 text-ok border-ok/30",
  reintento: "bg-warn/10 text-warn border-warn/30",
  error: "bg-error/10 text-error border-error/30",
};

const ESTADO_LABEL: Record<string, string> = {
  en_cola: "Queued",
  ronda_1: "Ronda 1",
  ronda_2: "Ronda 2",
  auditoria: "Audit",
  dictaminado: "Dictaminado",
  reintento: "Reintento",
  error: "Error",
};

const ESTADO_ACTIVO = new Set(["ronda_1", "ronda_2", "auditoria"]);

export function EstadoCasoBadge({ estado, nReintentos, className }: { estado: string; nReintentos?: number; className?: string }) {
  const estilo = ESTADO_ESTILO[estado] ?? "bg-surface-muted text-text-subtle border-border";
  const label = ESTADO_LABEL[estado] ?? estado;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", estilo, className)}>
      {ESTADO_ACTIVO.has(estado) && <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden />}
      {label}
      {estado === "reintento" && nReintentos ? ` (${nReintentos})` : ""}
    </span>
  );
}

/**
 * Estado de una inyección (008 §1, `forense.inyecciones.estado`). Distinto
 * catálogo que `EstadoCasoBadge` (una inyección nunca está "en_cola" ni
 * "dictaminado"): recibida→validada→snapshot_creado→pistas_recalculadas→
 * investigando→completada, o un terminal de fallo (rechazada/error).
 * `activo` controla el spinner — CLAUDE.md regla 12: sin evento persistido
 * no hay animación, así que un estado terminal (éxito o fallo) nunca gira.
 */
const INYECCION_ESTADO_ESTILO: Record<string, string> = {
  recibida: "bg-surface-muted text-text-subtle border-border",
  validada: "bg-info/10 text-info border-info/30",
  snapshot_creado: "bg-info/10 text-info border-info/30",
  pistas_recalculadas: "bg-info/10 text-info border-info/30",
  investigando: "bg-info/10 text-info border-info/30",
  completada: "bg-ok/10 text-ok border-ok/30",
  rechazada: "bg-error/10 text-error border-error/30",
  error: "bg-error/10 text-error border-error/30",
};

const INYECCION_ESTADO_LABEL: Record<string, string> = {
  recibida: "Recibida",
  validada: "Validada",
  snapshot_creado: "Snapshot creado",
  pistas_recalculadas: "Pistas recalculadas",
  investigando: "Investigating",
  completada: "Completed",
  rechazada: "Rechazada",
  error: "Error",
};

const INYECCION_ESTADO_ACTIVO = new Set(["recibida", "validada", "snapshot_creado", "pistas_recalculadas", "investigando"]);
export const INYECCION_ESTADOS_TERMINALES_DE_FALLO = new Set(["rechazada", "error"]);

export function EstadoInyeccionBadge({ estado, className }: { estado: string; className?: string }) {
  const estilo = INYECCION_ESTADO_ESTILO[estado] ?? "bg-surface-muted text-text-subtle border-border";
  const label = INYECCION_ESTADO_LABEL[estado] ?? estado;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", estilo, className)}>
      {INYECCION_ESTADO_ACTIVO.has(estado) && <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden />}
      {label}
    </span>
  );
}
