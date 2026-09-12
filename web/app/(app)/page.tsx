import { InspectorHome } from "@/components/shared/inspector-home";
import { getDataSource } from "@/lib/data";

export const metadata = { title: "Forense · Inicio" };
export const dynamic = "force-dynamic";

/**
 * `docs/22-frontend-inspector.md`: el home es **sólo** la UI del diseño
 * (`design-ref/Agents.dc.html`) — hero, picker de corridas y composer— con sus
 * mismas animaciones y transiciones. El estado va en la URL (`?corrida=<id>`),
 * no en un booleano de cliente, para conservar enlace profundo y recarga.
 *
 * La Cola de casos que vivía debajo se movió a `/casos` a pedido del usuario
 * (2026-09-12: "de home oculta esto"). No se borró (regla 9): se alcanza desde
 * el panel izquierdo. Encima de esta UI se irán añadiendo las piezas del
 * dominio, en su lenguaje visual.
 */
export default async function InicioPage({ searchParams }: { searchParams: Promise<{ corrida?: string }> }) {
  const { corrida: corridaIdParam } = await searchParams;
  const ds = getDataSource();
  const corridas = await ds.listCorridas();
  const corridaSeleccionada = corridaIdParam ? await ds.getCorrida(corridaIdParam) : null;

  // El composer necesita un cluster y unos RFC reales de la corrida elegida.
  // Se leen de sus casos; si no hay, el composer lo dice en vez de inventarlos.
  const corridaEnfocada = corridaSeleccionada ?? corridas[0] ?? null;
  const casos = corridaEnfocada ? await ds.listCasos({ corridaId: corridaEnfocada.id }) : [];
  const casoPresuncion = casos.find((c) => c.nivel === "presuncion") ?? casos[0] ?? null;
  const rfcsDisponibles = casoPresuncion ? [casoPresuncion.rfc_principal, ...casoPresuncion.rfcs_satelite] : [];

  return (
    <InspectorHome
      corridas={corridas}
      corridaSeleccionada={corridaSeleccionada}
      clusterId={casoPresuncion?.cluster_id}
      rfcsDisponibles={rfcsDisponibles}
    />
  );
}
