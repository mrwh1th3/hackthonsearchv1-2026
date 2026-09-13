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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(32,40,30,.22)] backdrop-blur-[5px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-[20px] border border-border/70 bg-surface p-6 shadow-[0_24px_80px_rgba(28,36,25,.16)] focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-4">
            <Dialog.Title className="font-display text-[22px] font-medium tracking-[-.035em] text-text">Profile</Dialog.Title>
            <div className="flex items-center gap-2">
              {esFixture && <FixtureBadge />}
              <Dialog.Close
                className="insp-focus-ring flex h-8 w-8 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]"
                aria-label="Close"
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
