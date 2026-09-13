import { getDataSource } from "@/lib/data";
import { obtenerEjecucionesPrivadas } from "@/lib/data/privado";
import { requerirSesionServidor } from "@/lib/auth/session";
import { AnalisisCanvas } from "./analisis-canvas";

export const metadata = { title: "Forense · Análisis en proceso" };
export const dynamic = "force-dynamic";

/**
 * Board del diseño (`design-ref/Agents.dc.html`, bloque `boardOpen`): al
 * pulsar "Inspeccionar" el composer navega aquí con el `caso_id` que devuelve
 * `FORENSE_investigar_cluster` (su "Responder 202" no trae id de
 * investigación). El lienzo punteado del original llega vacío; su contenido
 * es el pedido del usuario del 2026-09-12 — encabezado "Análisis en proceso",
 * árbol de trabajo y modal por subagente — y se arma en `AnalisisCanvas`
 * sobre el render inicial de aquí más el sondeo de `/api/analisis/[casoId]`.
 */
export default async function AnalisisPage({ params }: { params: Promise<{ casoId: string }> }) {
  const { casoId } = await params;
  await requerirSesionServidor();
  const ds = getDataSource();
  const [detalle, eventos, runtime] = await Promise.all([
    ds.getCasoDetalle(casoId),
    ds.getBitacoraCaso(casoId),
    obtenerEjecucionesPrivadas(casoId).catch(() => ({ ejecuciones: [], tokensTotales: null, costoTotal: null })),
  ]);
  const [corrida, senales] = await Promise.all([
    detalle ? ds.getCorrida(detalle.caso.corrida_id) : Promise.resolve(null),
    detalle ? ds.listSenalesCluster(detalle.caso.cluster_id) : Promise.resolve([]),
  ]);

  return (
    <section className="flex h-[100dvh] max-h-[100dvh] flex-col gap-2.5 overflow-hidden px-[22px] pb-[18px] pt-5">
      <AnalisisCanvas
        casoId={casoId}
        etiqueta={corrida?.nombre ?? detalle?.caso.rfc_principal ?? "Análisis"}
        enVivo={corrida?.corrida_origen_id != null}
        inicial={{ caso: detalle?.caso ?? null, tareas: detalle?.tareas ?? [], eventos, runtime, senales }}
      />
    </section>
  );
}
