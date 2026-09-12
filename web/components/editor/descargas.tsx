"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { exportarReporte } from "./cliente";

/**
 * `DownloadMenu` del expediente (15 §11): Markdown, JSON y PDF.
 *
 * - MD y JSON los arma el BFF con manifiesto (caso, versión, fecha, origen,
 *   hash del contenido y citas sin evidencia). El nombre del archivo es legible
 *   y lleva la versión.
 * - El PDF se imprime desde el navegador con el CSS A4 de la hoja: no se añade
 *   una segunda biblioteca de render (15 §13: "no dos bibliotecas por función").
 * - Estados generando / éxito / error visibles; un error no se silencia.
 */
export function DescargasExpediente({
  casoId,
  version,
  className,
}: {
  casoId: string;
  version: number;
  className?: string;
}) {
  const [estado, setEstado] = useState<"idle" | "generando">("idle");

  async function descargar(formato: "md" | "json") {
    setEstado("generando");
    const resultado = await exportarReporte({ caso_id: casoId, version, formato });
    setEstado("idle");
    if (!resultado.ok) {
      toast.error(
        resultado.error.error === "backend_no_configurado"
          ? "Sin backend configurado: no se genera la exportación."
          : `No se pudo exportar (${resultado.error.error}).`,
      );
      return;
    }
    const { contenido, nombre, mime, citas } = resultado.datos;
    const url = URL.createObjectURL(new Blob([contenido], { type: mime }));
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
    toast.success(`${nombre} · ${citas.length} cita(s) conservada(s)`);
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
          aria-label="Descargar expediente"
        >
          {estado === "generando" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
          Descargar
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[220px] rounded-[var(--radius-card)] border border-border bg-surface p-1 text-sm shadow-lg"
        >
          <DropdownMenu.Item
            onSelect={() => void descargar("md")}
            className="cursor-pointer rounded-md px-2 py-1.5 text-text outline-none hover:bg-surface-hover focus:bg-surface-hover"
          >
            Markdown (.md)
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void descargar("json")}
            className="cursor-pointer rounded-md px-2 py-1.5 text-text outline-none hover:bg-surface-hover focus:bg-surface-hover"
          >
            JSON del expediente
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => window.print()}
            className="cursor-pointer rounded-md px-2 py-1.5 text-text outline-none hover:bg-surface-hover focus:bg-surface-hover"
          >
            PDF (imprimir hoja A4)
          </DropdownMenu.Item>
          <p className="px-2 py-1 text-[11px] leading-tight text-text-subtle">
            Cada archivo lleva versión, fecha, hash y las citas sin evidencia.
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
