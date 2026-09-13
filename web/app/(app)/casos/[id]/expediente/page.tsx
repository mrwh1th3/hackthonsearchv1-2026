import Link from "next/link";
import { notFound } from "next/navigation";
import { CanvasHeader } from "@/components/shared/canvas-header";
import { DocumentWorkspace } from "@/components/editor/document-workspace";
import { getDataSource } from "@/lib/data";
import { desdeMarkdown } from "@/lib/document/markdown";
import { cargarCasoEditor } from "@/lib/document/servidor";

export const metadata = { title: "Inspector · Report" };

export default async function ExpedientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const detalle = await ds.getCasoDetalle(id);
  if (!detalle || !detalle.redactor) notFound();

  // La versión y el contenido con los que arranca el editor son los
  // REALMENTE vigentes en `forense.expedientes` — no la versión 1 fija ni el
  // Markdown original del Redactor —, o el primer autoguardado choca con
  // "conflicto_version" (409) contra una versión que el editor ni sabía que
  // existía. Sin repositorio (backend no configurado) se cae al Markdown
  // original en versión 1: es la mejor aproximación disponible, y el resto
  // del editor ya declara 503 en cuanto se intenta guardar o proponer.
  const casoEditor = await cargarCasoEditor(id);
  const documentoActual = casoEditor?.versionActual.contenido_json ?? desdeMarkdown(detalle.redactor.markdown);
  const versionActual = casoEditor?.versionActual.version ?? 1;

  const referenciasValidadas = new Set(detalle.evidencia.filter((e) => e.validada).flatMap((e) => e.referencias));

  return (
    <section className="flex h-[100dvh] max-h-[100dvh] flex-col gap-2.5 overflow-hidden px-[22px] pb-[18px] pt-5">
      <CanvasHeader
        etiqueta={`Reporte · ${detalle.caso.rfc_principal}`}
        acciones={
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex h-8 flex-none items-center rounded-[10px] border border-border bg-surface px-3.5 text-[12.5px] text-text-muted transition-colors duration-150 hover:bg-surface-hover"
            >
              Back
            </Link>
          </div>
        }
      />

      {/* Editor tipo Docs + chat (forense-editor). El documento canónico se
          importa UNA vez desde el Markdown del Redactor (15 §10) y es el mismo
          que siembra el BFF, con los mismos ids de bloque y los mismos hashes.

          Sin tarjeta que lo envuelva: el workspace ya emite **dos**
          contenedores hermanos —documento e IA— igual que en
          `/documentos/[id]`. Una caja externa alrededor de los dos
          borraba justo esa separación (feedback 2026-09-12). */}
      <DocumentWorkspace
        casoId={detalle.caso.id}
        rfc={detalle.caso.rfc_principal}
        documento={documentoActual}
        version={versionActual}
        estadoRevision={casoEditor?.versionActual.estado_revision ?? "validado"}
        nivel={detalle.caso.nivel ?? undefined}
        origen={ds.label}
        referenciasValidadas={[...referenciasValidadas]}
        evidencia={detalle.evidencia.map((e) => ({
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
        }))}
      />
    </section>
  );
}
