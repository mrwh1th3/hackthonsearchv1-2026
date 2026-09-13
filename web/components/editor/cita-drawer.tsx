"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface EvidenciaCita {
  /** id de la fila de evidencia (`common.bigint`), el que viaja en `evidencia_ids`. */
  id: string;
  /** Todas las referencias que produce esta fila; una cita puede ser cualquiera. */
  referencias: string[];
  /** Referencia principal, para listar y abrir el drawer. */
  referencia: string;
  tipo: string;
  pista_codigo: string;
  familia: string;
  ref_id: string;
  rfcs_afectados: string[];
  validada: boolean;
  refutada: boolean;
  hecho_validado: Record<string, unknown>;
}

/**
 * Drawer del registro fuente de una cita (09 §8, 15 §10: "citas clicables abren
 * registro fuente en drawer sin perder selección").
 *
 * Si el ID citado NO existe en la evidencia validada de la corrida, el drawer
 * lo dice con todas sus letras en lugar de inventar un registro: esa cita
 * bloquea la publicación final, no el borrador.
 */
export function CitaDrawer({
  referencia,
  evidencia,
  onOpenChange,
}: {
  referencia: string | null;
  evidencia: EvidenciaCita | null;
  onOpenChange: (abierto: boolean) => void;
}) {
  return (
    <Dialog.Root open={referencia !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col gap-3 border-l border-border bg-surface p-5 shadow-xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-sm font-semibold text-text">Registro citado</Dialog.Title>
              <p className="mt-0.5 break-all font-mono text-xs text-text-subtle">[{referencia}]</p>
            </div>
            <Dialog.Close
              className="rounded-[var(--radius-input)] border border-border p-1 text-text-muted hover:bg-surface-hover"
              aria-label="Close"
            >
              <X size={14} aria-hidden />
            </Dialog.Close>
          </div>

          {!evidencia ? (
            <div className="rounded-[var(--radius-card)] border border-error/40 bg-error/5 p-3 text-sm text-error">
              <p className="font-medium">No validated evidence for this ID.</p>
              <p className="mt-1 text-xs text-text-muted">
                Correct this citation or remove its claim before publishing. Your draft is preserved.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 overflow-auto text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium text-white",
                    evidencia.familia === "D" && "bg-fam-d",
                    evidencia.familia === "F" && "bg-fam-f",
                    evidencia.familia === "R" && "bg-fam-r",
                    evidencia.familia === "T" && "bg-fam-t",
                    evidencia.familia === "E" && "bg-fam-e",
                  )}
                >
                  {evidencia.familia} · {evidencia.pista_codigo}
                </span>
                <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[11px] text-text-muted">
                  {evidencia.tipo}
                </span>
                {evidencia.refutada && (
                  <span className="rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] text-info">refutada</span>
                )}
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-text-subtle">ref_id</dt>
                <dd className="break-all font-mono text-text">{evidencia.ref_id}</dd>
                <dt className="text-text-subtle">RFC afectados</dt>
                <dd className="text-text">{evidencia.rfcs_afectados.join(", ") || "—"}</dd>
              </dl>

              <div>
                <p className="mb-1 text-xs font-medium text-text-muted">Hecho validado</p>
                <pre className="max-h-[40vh] overflow-auto rounded-[var(--radius-card)] border border-border bg-surface-muted p-2 font-mono text-[11px] text-text">
                  {JSON.stringify(evidencia.hecho_validado, null, 2)}
                </pre>
              </div>

              <p className="text-xs text-text-subtle">
                Freeform source fields are marked <code>_untrusted</code> and cannot establish a conclusion.
              </p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
