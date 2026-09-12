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
  sin_hallazgos: "bg-surface-muted text-text-subtle border-border",
  anomalia_explicada: "bg-info/10 text-info border-info/30",
  no_concluyente: "bg-surface-muted text-text-muted border-border",
  presuncion: "bg-warn/10 text-warn border-warn/30",
  presuncion_alta: "bg-error/10 text-error border-error/30",
};

const NIVEL_LABEL: Record<Nivel, string> = {
  sin_hallazgos: "Sin hallazgos",
  anomalia_explicada: "Anomalía explicada",
  no_concluyente: "No concluyente",
  presuncion: "Presunción",
  presuncion_alta: "Presunción alta",
};

export function NivelBadge({ nivel, motivo, className }: { nivel: Nivel | null; motivo?: string; className?: string }) {
  if (nivel === null) {
    // Caso todavía en curso: el contrato permite `nivel: null` (aún no
    // dictaminado). Nunca se muestra un nivel inventado mientras tanto.
    return (
      <span className={cn("inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-medium text-text-subtle", className)}>
        En curso
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

const FAMILIA_NOMBRE: Record<Familia, string> = {
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
  en_cola: "En cola",
  ronda_1: "Ronda 1",
  ronda_2: "Ronda 2",
  auditoria: "Auditoría",
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
