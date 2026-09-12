import { notFound } from "next/navigation";
import { getDataSource } from "@/lib/data";
import { obtenerInvestigacionPrivada, obtenerHistorialPrivado } from "@/lib/data/privado";
import { requerirSesionServidor } from "@/lib/auth/session";
import { ZONA_POR_OMISION } from "@/lib/date/formato";
import { resolveDateRangePreset } from "@/lib/date/range";
import { desdeMarkdown } from "@/lib/document/markdown";
import { InvestigacionVista } from "./investigacion-vista";

export const metadata = { title: "Forense · Investigación" };
export const dynamic = "force-dynamic";

/**
 * Abrir una investigación entra a la pantalla de resultados del diseño con el
 * **documento** abierto y el **chat** a la derecha (docs/22; bloque
 * `resultsOpen` + `docOpen` del original). Los tabs
 * resumen/ejecuciones/evidencia/reportes/actividad que vivían aquí se
 * sustituyen por eso: el diseño no tiene tabs, y su contenido no se pierde —
 * evidencia y pistas están en la vista de hallazgos ("Cerrar" en el
 * documento), la actividad es el Timeline de esa vista, y el reporte se abre
 * **como editor, aquí mismo**, con su chat de propuestas.
 *
 * La investigación es privada (CLAUDE.md regla 3, `lib/data/privado.ts`),
 * filtrada por id Y por el `perfil_id` de la sesión: una investigación de OTRO
 * perfil da el mismo 404 que un id inexistente (Corte 3 hallazgo 1).
 */
export default async function InvestigacionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const session = await requerirSesionServidor();
  const inv = await obtenerInvestigacionPrivada(id, session.perfil_id);
  if (!inv) notFound();

  const casoId = inv.caso_ids[0];
  const [detalle, corrida, historial] = await Promise.all([
    casoId ? ds.getCasoDetalle(casoId) : Promise.resolve(null),
    ds.getCorrida(inv.corrida_id),
    obtenerHistorialPrivado(session.perfil_id),
  ]);

  const bitacoraCorrida = await ds.getBitacoraCorrida(inv.corrida_id);
  const bitacora = casoId ? bitacoraCorrida.filter((e) => e.caso_id === casoId) : bitacoraCorrida;

  // Resumen de investigación (vista auditor, feedback 2026-09-12): una
  // investigación puede abarcar varios casos (`inv.caso_ids`), no sólo el
  // primero. Se traen todos con su cluster (para el puntaje de riesgo real,
  // `clusters.score`) y su propio recorte de bitácora — nada inventado, todo
  // sale de lo ya persistido.
  const detalles = await Promise.all(inv.caso_ids.map((id) => (id === casoId ? Promise.resolve(detalle) : ds.getCasoDetalle(id))));
  const [casosCargados, estadisticas] = await Promise.all([
    Promise.all(
      detalles
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .map(async (d) => {
          const [cluster, grafo] = await Promise.all([ds.getCluster(d.caso.cluster_id), ds.getClusterGrafo(d.caso.cluster_id)]);
          return {
            detalle: d,
            cluster,
            grafo,
            bitacora: bitacoraCorrida.filter((e) => e.caso_id === d.caso.id),
          };
        }),
    ),
    ds.getEstadisticas(inv.corrida_id),
  ]);
  const casos = casosCargados;

  const [contraste, trayectoria, entidad] = detalle
    ? await Promise.all([
        ds.getContraste(detalle.caso.id),
        ds.getTrayectoria(detalle.caso.rfc_principal, detalle.caso.corrida_id),
        ds.getEntidad(detalle.caso.rfc_principal, detalle.caso.corrida_id),
      ])
    : [null, [], null];

  // Mismo cálculo que la pantalla de caso: la ventana real de la corrida,
  // resuelta por `lib/date/range` en la zona declarada (H11-g).
  const finInclusive = new Date(corrida?.fin ?? corrida?.fecha_corte ?? inv.creado);
  const periodo = resolveDateRangePreset({
    preset: "todo_el_dataset",
    timezone: ZONA_POR_OMISION,
    referencia: new Date(corrida?.fecha_corte ?? inv.creado),
    datasetDesde: new Date(corrida?.inicio ?? inv.creado),
    datasetHastaExclusivo: new Date(finInclusive.getTime() + 24 * 60 * 60 * 1000),
  });

  // El cuerpo del documento es el Markdown REAL del Redactor, el mismo que
  // edita el expediente. Sin Redactor no hay documento y se dice.
  const documento = detalle?.redactor ? desdeMarkdown(detalle.redactor.markdown) : null;

  // Lo que el editor necesita para decorar y auditar citas: exactamente lo
  // mismo que le pasa `/casos/[id]/expediente`, para que abrir el reporte
  // desde aquí y desde allá sea el mismo editor con el mismo estado.
  const referenciasValidadas = detalle
    ? [...new Set(detalle.evidencia.filter((e) => e.validada).flatMap((e) => e.referencias))]
    : [];
  const evidenciaCitas = (detalle?.evidencia ?? []).map((e) => ({
    id: e.id,
    referencias: e.referencias,
    referencia: e.referencias[0] ?? e.ref_id,
    tipo: e.tipo,
    pista_codigo: e.pista_codigo,
    familia: e.familia,
    ref_id: e.ref_id,
    rfcs_afectados: e.rfcs_afectados,
    validada: e.validada,
    refutada: e.refutada,
    hecho_validado: e.hecho_validado,
  }));

  return (
    <section className="flex h-[100dvh] max-h-[100dvh] flex-col gap-2.5 overflow-hidden px-[22px] pb-[18px] pt-5">
      <InvestigacionVista
        etiqueta={detalle?.caso.rfc_principal ?? (inv.titulo ?? "Investigación")}
        enVivo={corrida?.corrida_origen_id != null}
        investigacion={inv}
        detalle={detalle}
        documento={documento}
        evidenciaCitas={evidenciaCitas}
        referenciasValidadas={referenciasValidadas}
        origen={ds.label}
        bitacora={bitacora}
        contraste={contraste}
        trayectoria={trayectoria}
        razonSocialUntrusted={entidad?.razon_social_untrusted ?? null}
        periodo={periodo}
        investigaciones={historial}
        corrida={corrida}
        casos={casos}
        tokensCorrida={estadisticas?.operacion.tokens_total ?? null}
      />
    </section>
  );
}
