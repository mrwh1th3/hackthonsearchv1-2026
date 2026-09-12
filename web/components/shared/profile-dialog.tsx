"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { FixtureBadge } from "@/components/shared/fixture-badge";
import { ProfileSettings } from "@/components/shared/profile-settings";
import type { Perfil } from "@/lib/data";

/**
 * `/perfil` como modal (2026-09-12: "q /perfil sea modal no pagina"), a
 * pedido del usuario tras poner el disparador en el panel del shell. El
 * contenido es el mismo `ProfileSettings` que usaba la página — el `perfil`
 * privado (regla 3) llega ya resuelto por sesión desde `app/(app)/layout.tsx`,
 * este componente no vuelve a pedirlo.
 */
export function ProfileDialog({
  perfil,
  esFixture,
  abierto,
  onOpenChange,
}: {
  perfil: Perfil;
  esFixture: boolean;
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
}) {
  return (
    <Dialog.Root open={abierto} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-[var(--radius-composer)] border border-border bg-surface p-5 shadow-xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold text-text">Perfil</Dialog.Title>
            <div className="flex items-center gap-2">
              {esFixture && <FixtureBadge />}
              <Dialog.Close
                className="rounded-[var(--radius-input)] border border-border p-1 text-text-muted hover:bg-surface-hover"
                aria-label="Cerrar"
              >
                <X size={14} aria-hidden />
              </Dialog.Close>
            </div>
          </div>
          <ProfileSettings perfil={perfil} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
