"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { EventoForense } from "@/lib/data";

/**
 * Drawer de detalle de un evento de `forense.bitacora` (CLAUDE.md regla 2:
 * "si un paso no escribió en bitácora, no existió"). Se usa desde la
 * bitácora cruda, el pizarrón y el timeline de caso — siempre el mismo
 * evento persistido, nunca un estado inventado en memoria.
 */
export function TraceDrawer({ evento, onOpenChange }: { evento: EventoForense | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={Boolean(evento)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-border bg-surface p-4">
          <div className="mb-3 flex items-start justify-between">
            <Dialog.Title className="text-sm font-medium text-text">{evento?.tipo_evento}</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Cerrar" className="rounded p-1 hover:bg-surface-hover">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          {evento && (
            <div className="flex-1 overflow-y-auto text-xs text-text">
              <dl className="mb-3 space-y-1">
                <Row label="ID" value={evento.id} />
                <Row label="Secuencia" value={String(evento.seq ?? "—")} />
                <Row label="Timestamp" value={new Date(evento.ts).toLocaleString("es-MX")} />
                <Row label="Corrida" value={evento.corrida_id} />
                <Row label="Caso" value={evento.caso_id ?? "—"} />
                <Row label="Tarea" value={evento.tarea_id ?? "—"} />
                <Row label="Operación" value={evento.payload.operacion_id ?? "—"} />
              </dl>
              <p className="mb-1 font-medium text-text-muted">Resumen</p>
              <p className="mb-3 rounded border border-border bg-surface-muted p-2">{evento.payload.resumen}</p>
              {evento.payload.referencias.length > 0 && (
                <>
                  <p className="mb-1 font-medium text-text-muted">Referencias</p>
                  <ul className="mb-3 space-y-0.5 font-mono">
                    {evento.payload.referencias.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mb-1 font-medium text-text-muted">Evento crudo</p>
              <pre className="overflow-x-auto rounded border border-border bg-surface-muted p-2">{JSON.stringify(evento, null, 2)}</pre>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-text-subtle">{label}</dt>
      <dd className="truncate text-right font-mono">{value}</dd>
    </div>
  );
}
