import { notFound } from "next/navigation";
import { getDataSource } from "@/lib/data";
import { obtenerAnotacionesAgenteIAPrivadas, obtenerEjecucionesPrivadas, obtenerInvestigacionPrivada } from "@/lib/data/privado";
import { requerirSesionServidor } from "@/lib/auth/session";
import { cargarCasoEditor } from "@/lib/document/servidor";
import { aMarkdown } from "@/lib/document/markdown";
import { emparejarHallazgos, emparejarLeads } from "@/lib/analisis/emparejar-auditor";
import { derivarCadenaExplicacion } from "@/lib/analisis/cadena-explicacion";
import { generarDocumentoBase, type EntradaDocumentoBase } from "@/lib/expediente/documento-base";
import { leerSubmissionEntregable } from "@/lib/auditoria/submission";
import { rutaLegible } from "@/lib/auditoria/runner";
import { InvestigacionVista } from "./investigacion-vista";

export const metadata = { title: "Inspector · Investigation" };
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

  // Todas las lecturas independientes salen a la vez: antes iban en cascada
  // (detalle → bitácora → resto de casos → clusters → contraste → editor) y
  // abrir una investigación desde el panel tardaba la suma de todas.
  const casoId = inv.caso_ids[0];
  const [detalles, corrida, bitacoraCorrida] = await Promise.all([
    Promise.all(inv.caso_ids.map((id) => ds.getCasoDetalle(id))),
    ds.getCorrida(inv.corrida_id),
    ds.getBitacoraCorrida(inv.corrida_id),
  ]);
  const detalle = casoId ? (detalles[0] ?? null) : null;
  const bitacora = casoId ? bitacoraCorrida.filter((e) => e.caso_id === casoId) : bitacoraCorrida;

  // Resumen de investigación (vista auditor, feedback 2026-09-12): una
  // investigación puede abarcar varios casos (`inv.caso_ids`), no sólo el
  // primero. Se traen todos con su cluster (para el puntaje de riesgo real,
  // `clusters.score`) y su propio recorte de bitácora — nada inventado, todo
  // sale de lo ya persistido.
  const [casosCargados, estadisticas, [contraste, trayectoria, entidad], casoEditor, auditorResultado] = await Promise.all([
    Promise.all(
      detalles
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .map(async (d) => {
          const [cluster, grafo, contrasteCaso, trayectoriaCaso, ejecucionesCaso] = await Promise.all([
            ds.getCluster(d.caso.cluster_id),
            ds.getClusterGrafo(d.caso.cluster_id),
            ds.getContraste(d.caso.id),
            ds.getTrayectoria(d.caso.rfc_principal, d.caso.corrida_id),
            obtenerEjecucionesPrivadas(d.caso.id).catch(() => ({ ejecuciones: [], tokensTotales: null, costoTotal: null })),
          ]);
          return {
            detalle: d,
            cluster,
            grafo,
            bitacora: bitacoraCorrida.filter((e) => e.caso_id === d.caso.id),
            contraste: contrasteCaso,
            trayectoria: trayectoriaCaso,
            ejecuciones: ejecucionesCaso,
            // Se completa abajo una vez que `auditorResultado` está resuelto (misma corrida para todos los casos).
            auditorResultado: null as Awaited<ReturnType<typeof ds.getAuditorResultado>>,
          };
        }),
    ),
    // Solo alimenta el contador de tokens. En corridas grandes la RPC de métricas
    // puede pasar el statement_timeout de `anon` (3 s) en frío; eso no debe
    // tumbar el documento entero, así que el contador queda en "—".
    ds.getEstadisticas(inv.corrida_id).catch(() => null),
    detalle
      ? Promise.all([
          ds.getContraste(detalle.caso.id),
          ds.getTrayectoria(detalle.caso.rfc_principal, detalle.caso.corrida_id),
          ds.getEntidad(detalle.caso.rfc_principal, detalle.caso.corrida_id),
        ])
      : Promise.resolve([null, [], null] as [null, never[], null]),
    // El cuerpo y la versión del documento son los REALMENTE vigentes en
    // `forense.expedientes` (mismo motivo que `/casos/[id]/expediente`: sembrar
    // el editor con la versión 1 fija cuando ya hay una versión mayor produce
    // "conflicto_version" en el primer autoguardado o propuesta). Sin
    // repositorio configurado se cae al Markdown original del Redactor en
    // versión 1. Sin Redactor no hay documento y se dice.
    detalle?.redactor ? cargarCasoEditor(detalle.caso.id) : Promise.resolve(null),
    ds.getAuditorResultado(inv.corrida_id).catch(() => null),
  ]);
  const casos = casosCargados.map((c) => ({ ...c, auditorResultado }));

  // `submission.json` de la corrida junto a "Reporte completo" (descarga directa, sin editor). La ruta en disco
  // solo se muestra si de ahí salen los bytes que se descargan (`lib/auditoria/submission.ts`).
  const entregaSubmission = auditorResultado ? await leerSubmissionEntregable(inv.corrida_id, ds).catch(() => null) : null;
  const descargaSubmission = entregaSubmission
    ? {
        href: `/auditoria/${inv.corrida_id}/submission`,
        ruta: entregaSubmission.origen === "disco" && entregaSubmission.ruta ? rutaLegible(entregaSubmission.ruta) : null,
      }
    : null;

  // Pizarrón de los 5 agentes IA (`forense.anotaciones_agente`, migración
  // 028): por `investigacion_id`, NO por `caso_id` — el caso del
  // complemento IA (`origen='ia_complemento'`) no está en `inv.caso_ids`
  // (ver `leerAnotacionesAgenteInvestigacion`). Fixture o error (028 sin
  // aplicar en remoto, falta el grant) caen igual a `[]`: la sección lo
  // dice como "sin anotaciones todavía", que es honesto en ambos casos —
  // ninguno finge un dato que sí existe.
  const anotacionesIA = await obtenerAnotacionesAgenteIAPrivadas(inv.id).catch(() => []);

  // Base mínima del reporte (feedback 2026-09-12): un caso `origen='auditor'`
  // SIEMPRE trae `redactor.markdown` (lo escribe `markdown_hallazgo` del
  // loader) y, con repositorio configurado, `casoEditor` no es null — la
  // versión vigente ahí es la v1 del Redactor (`Reporte.autor === 'agente'`),
  // no una edición humana. Sólo cuando un humano ya editó y Aplicó
  // (`autor === 'humano'`, regla 11) el documento se respeta INTACTO. En
  // cualquier otro caso (sin editor persistido, o versión vigente todavía del
  // agente) se completa/genera la base mínima desde lo persistido
  // (`lib/expediente/documento-base.ts`) — sólo lectura, nunca versiona ni
  // sobreescribe nada en `forense.expedientes`.
  const entradaBase: EntradaDocumentoBase | null = detalle
    ? {
        detalle,
        hallazgo: emparejarHallazgos([detalle.caso], auditorResultado?.findings ?? []).asignados.get(detalle.caso.id) ?? null,
        leads: emparejarLeads([detalle.caso], auditorResultado?.leads ?? []).porCaso.get(detalle.caso.id) ?? [],
        contraste,
        trayectoria,
        cadena: derivarCadenaExplicacion(auditorResultado, detalle.caso.rfc_principal),
        agentesBitacora: [...new Set(detalle.tareas.map((t) => t.agente))],
      }
    : null;
  const documento =
    casoEditor && casoEditor.versionActual.autor === "humano"
      ? casoEditor.versionActual.contenido_json
      : entradaBase
        ? generarDocumentoBase({
            ...entradaBase,
            markdownExistente: casoEditor ? aMarkdown(casoEditor.versionActual.contenido_json) : (detalle?.redactor?.markdown ?? null),
          })
        : (casoEditor?.versionActual.contenido_json ?? null);
  const versionDocumento = casoEditor?.versionActual.version ?? 1;

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
        etiqueta={detalle?.caso.rfc_principal ?? (inv.titulo ?? "Investigation")}
        enVivo={corrida?.corrida_origen_id != null}
        investigacion={inv}
        detalle={detalle}
        documento={documento}
        versionDocumento={versionDocumento}
        evidenciaCitas={evidenciaCitas}
        referenciasValidadas={referenciasValidadas}
        origen={ds.label}
        bitacora={bitacora}
        contraste={contraste}
        trayectoria={trayectoria}
        razonSocialUntrusted={entidad?.razon_social_untrusted ?? null}
        corrida={corrida}
        casos={casos}
        tokensCorrida={estadisticas?.operacion.tokens_total ?? null}
        anotacionesIA={anotacionesIA}
        descargaSubmission={descargaSubmission}
      />
    </section>
  );
}
