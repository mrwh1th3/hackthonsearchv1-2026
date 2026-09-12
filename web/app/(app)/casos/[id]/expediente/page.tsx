import { notFound } from "next/navigation";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { DownloadMenu } from "@/components/shared/download-menu";
import { getDataSource } from "@/lib/data";
import { ExpedienteView } from "./expediente-view";

export const metadata = { title: "Forense · Expediente" };

export default async function ExpedientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const detalle = await ds.getCasoDetalle(id);
  if (!detalle || !detalle.redactor) notFound();

  const referenciasValidadas = new Set(detalle.evidencia.filter((e) => e.validada).flatMap((e) => e.referencias));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-text">Expediente · {detalle.caso.rfc_principal}</h1>
          <p className="text-xs text-text-subtle">Documento fixture, solo lectura. Reporte versión 1.</p>
        </div>
        <div className="flex items-center gap-2">
          <DownloadMenu
            options={[
              { label: "Markdown (.md)", build: () => ({ content: detalle.redactor!.markdown, filename: `expediente-${detalle.caso.rfc_principal}.md`, mime: "text/markdown;charset=utf-8" }) },
              { label: "JSON", build: () => ({ content: JSON.stringify(detalle, null, 2), filename: `expediente-${detalle.caso.rfc_principal}.json`, mime: "application/json" }) },
            ]}
          />
          <FixtureBadge />
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] bg-app-bg p-4 sm:p-8">
        <ExpedienteView markdown={detalle.redactor.markdown} referenciasValidadas={referenciasValidadas} />
      </div>

      <div className="flex min-h-[120px] items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border bg-surface-muted text-sm text-text-subtle">
        Editor: montaje pendiente (forense-editor)
      </div>
    </div>
  );
}
