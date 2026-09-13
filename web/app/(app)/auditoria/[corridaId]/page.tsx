import Link from "next/link";
import { getDataSource } from "@/lib/data";
import { requerirSesionServidor } from "@/lib/auth/session";
import { AuditorResultadoCompleto } from "@/components/shared/auditor-resultado";

export const metadata = { title: "Inspector · Audit results" };
export const dynamic = "force-dynamic";

/**
 * Resultados del auditor determinista (docs/23) para una corrida: lo mismo
 * que se entrega a los jueces — resumen con costos, un bloque por hallazgo
 * (regla, monto, narrativa, rastro del dinero, exhibits, conciliación,
 * revisión adversarial) y los leads cerrados en el cuerpo, no en un anexo.
 * Todo valor sale de `forense.auditor_resultados`; si la corrida no se ha
 * auditado se dice así, nunca "sin hallazgos". El render en sí vive en
 * `components/shared/auditor-resultado.tsx` — `/documentos/[id]` reutiliza
 * exactamente el mismo componente para no duplicar este JSX (feedback
 * 2026-09-12: "/documentos sin filtrar").
 */
export default async function AuditoriaPage({ params }: { params: Promise<{ corridaId: string }> }) {
  const { corridaId } = await params;
  await requerirSesionServidor();
  const ds = getDataSource();
  const [corrida, r] = await Promise.all([ds.getCorrida(corridaId), ds.getAuditorResultado(corridaId)]);

  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/?corrida=${corridaId}`} className="text-[12.5px] text-text-muted hover:underline">
            ← Back to dataset
          </Link>
          <h1 className="mt-1 text-[24px] font-medium tracking-tight text-text">{corrida?.nombre ?? "Corrida"}</h1>
        </div>
      </div>
      <AuditorResultadoCompleto resultado={r} />
    </main>
  );
}
