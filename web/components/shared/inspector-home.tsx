"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CorridaPicker } from "./corrida-picker";
import { InvestigationComposer } from "./investigation-composer";
import type { Corrida } from "@/lib/data";

export interface InspectorHomeProps {
  corridas: Corrida[];
  /** `null` cuando no hay `?corrida=` en la URL o el id no resolvió (docs/22 "dataset seleccionado + composer": estado en la URL). */
  corridaSeleccionada: Corrida | null;
  clusterId?: string;
  rfcsDisponibles: string[];
}

/**
 * Estado del diseño en la URL (docs/22 "Ser idéntico y tener URLs no son
 * cosas opuestas"): sin `?corrida=` se ve el hero + picker; con un id
 * válido, el composer de esa corrida. La misma ruta `/`, compartible y
 * recargable, sin bifurcar en una segunda página — `router.push` no
 * recarga ni remonta el shell (`app/(app)/layout.tsx` sigue montado).
 */
export function InspectorHome({ corridas, corridaSeleccionada, clusterId, rfcsDisponibles }: InspectorHomeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function conCorrida(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("corrida", id);
    else params.delete("corrida");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  if (!corridaSeleccionada) {
    return <CorridaPicker corridas={corridas} onSelect={(id) => conCorrida(id)} />;
  }

  return (
    <InvestigationComposer
      corrida={corridaSeleccionada}
      clusterId={clusterId}
      rfcsDisponibles={rfcsDisponibles}
      onChangeDataset={() => conCorrida(null)}
    />
  );
}
