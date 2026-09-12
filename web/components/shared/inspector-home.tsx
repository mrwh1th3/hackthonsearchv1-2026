"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
 * recargable.
 *
 * **La transición es la del diseño, no un cambio de pantalla.** En el
 * original el picker no se desmonta: colapsa con
 * `max-height .42s cubic-bezier(.22,.7,.3,1)`, `opacity .3s`,
 * `filter: blur(10px) .32s` y `transform: scale(.97) .42s` mientras el
 * composer ocupa su lugar, y el saludo cambia de texto. Aquí la colapsa
 * dispara **estado local en el mismo click** y la URL va detrás
 * (`router.push`), porque esperar al round-trip de un Server Component
 * `force-dynamic` la haría saltar en seco — docs/22 fija el desempate: si la
 * transición se nota distinta por hacerlo con rutas, gana el diseño.
 */
export function InspectorHome({ corridas, corridaSeleccionada, clusterId, rfcsDisponibles }: InspectorHomeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Optimista: lo que el usuario acaba de elegir manda sobre lo que el
  // servidor todavía no confirma. Se reconcilia en cuanto llega la corrida.
  const [elegida, setElegida] = useState<Corrida | null>(corridaSeleccionada);
  useEffect(() => {
    setElegida(corridaSeleccionada);
  }, [corridaSeleccionada]);

  function seleccionar(id: string | null) {
    setElegida(id ? (corridas.find((c) => c.id === id) ?? null) : null);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("corrida", id);
    else params.delete("corrida");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const hay = elegida != null;

  // Contenedor raíz del diseño (`design-ref/Agents.dc.html` línea 22):
  // `min-height:100vh`, centrado en los dos ejes, `gap:30px`,
  // `padding:56px 24px`.
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-[30px] px-6 py-14">
      <h1 className="m-0 max-w-[640px] text-balance text-center text-[28px] font-medium leading-tight tracking-tight text-text-muted sm:text-[34px]">
        {hay ? "Manos a la obra" : "¿Qué corrida quieres inspeccionar?"}
      </h1>

      <div
        aria-hidden={hay}
        className="flex w-full max-w-[700px] flex-col overflow-hidden"
        style={{
          maxHeight: hay ? "0px" : "600px",
          opacity: hay ? 0 : 1,
          filter: hay ? "blur(10px)" : "blur(0px)",
          transform: hay ? "scale(.97)" : "scale(1)",
          pointerEvents: hay ? "none" : "auto",
          transition:
            "max-height .42s cubic-bezier(.22,.7,.3,1), opacity .3s ease, filter .32s ease, transform .42s cubic-bezier(.22,.7,.3,1)",
        }}
      >
        <CorridaPicker corridas={corridas} onSelect={(id) => seleccionar(id)} />
      </div>

      {elegida && (
        <InvestigationComposer
          corrida={elegida}
          clusterId={clusterId}
          rfcsDisponibles={rfcsDisponibles}
          onChangeDataset={() => seleccionar(null)}
          className="max-w-[700px]"
        />
      )}
    </div>
  );
}
