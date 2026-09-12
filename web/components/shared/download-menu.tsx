"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Download } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface DownloadOption {
  label: string;
  /** Genera el contenido en el momento del click (nunca se computa si no se abre el menú). */
  build: () => { content: string; filename: string; mime: string };
}

/**
 * 15 §11: dropdown de descargas con nombre legible, y estado
 * generando/éxito/error. Cada descarga es exactamente el conjunto filtrado
 * visible (el llamador arma `build()` a partir de las mismas props que la
 * vista). El navegador del viewer maneja el guardado real del blob.
 */
export function DownloadMenu({ options, className }: { options: DownloadOption[]; className?: string }) {
  const [estado, setEstado] = useState<"idle" | "generando" | "error">("idle");

  function descargar(opt: DownloadOption) {
    setEstado("generando");
    try {
      const { content, filename, mime } = opt.build();
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setEstado("idle");
    } catch {
      setEstado("error");
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-input)] border border-border bg-surface px-2.5 text-xs text-text hover:bg-surface-hover",
            className,
          )}
          aria-label="Descargar"
        >
          <Download size={14} aria-hidden />
          Descargar
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[180px] rounded-[var(--radius-card)] border border-border bg-surface p-1 text-sm shadow-lg"
        >
          {options.map((opt) => (
            <DropdownMenu.Item
              key={opt.label}
              onSelect={() => descargar(opt)}
              className="cursor-pointer rounded-md px-2 py-1.5 text-text outline-none hover:bg-surface-hover focus:bg-surface-hover"
            >
              {opt.label}
            </DropdownMenu.Item>
          ))}
          {estado === "error" && <p className="px-2 py-1 text-xs text-error">Error al generar el archivo. Reintenta.</p>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
