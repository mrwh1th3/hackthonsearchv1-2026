"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Corrida, MapperPropuesta } from "@/lib/data";
import { DatosWizard } from "./datos-wizard";
import { InyeccionEnVivo } from "./inyeccion-en-vivo";

export function DatosTabs({ mapperEjemplo, corridas }: { mapperEjemplo: MapperPropuesta; corridas: Corrida[] }) {
  const [modo, setModo] = useState<"cargar" | "inyectar">("cargar");
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-[var(--radius-input)] border border-border bg-surface-muted p-1 sm:w-fit">
        {(
          [
            ["cargar", "Cargar dataset"],
            ["inyectar", "Inyectar datos en vivo"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => setModo(v)}
            className={cn("h-8 rounded-[var(--radius-input)] px-3 text-xs font-medium", modo === v ? "bg-surface text-text shadow-sm" : "text-text-subtle hover:text-text")}
          >
            {l}
          </button>
        ))}
      </div>
      {modo === "cargar" ? <DatosWizard mapperEjemplo={mapperEjemplo} /> : <InyeccionEnVivo corridas={corridas} />}
    </div>
  );
}
