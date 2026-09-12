import { dividirEnSecciones, partirEnCitas } from "@/lib/expediente/citas";
import { cn } from "@/lib/utils";

/**
 * 09 §8: render de SOLO LECTURA del documento fixture del Redactor. El
 * editor TipTap/chat de propuestas (montaje real) es de forense-editor
 * (`web/components/editor`, `web/lib/document`, `web/app/api/reportes`) —
 * fuera de esta ownership.
 */
export function ExpedienteView({ markdown, referenciasValidadas }: { markdown: string; referenciasValidadas: ReadonlySet<string> }) {
  const secciones = dividirEnSecciones(markdown);

  return (
    <article className="mx-auto w-full max-w-[794px] rounded-[var(--radius-card)] border border-border bg-surface p-8 sm:p-12">
      {secciones.map((s) => (
        <section key={s.titulo} className="mb-6 last:mb-0">
          <h2 className="mb-2 text-base font-semibold text-text">{s.titulo}</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">
            {partirEnCitas(s.cuerpo, referenciasValidadas).map((seg, i) =>
              seg.tipo === "texto" ? (
                <span key={i}>{seg.texto}</span>
              ) : (
                <span
                  key={i}
                  title={seg.valida ? "Cita con evidencia validada" : "ID no encontrado en evidencia validada de esta corrida"}
                  className={cn(
                    "mx-0.5 rounded-full border px-1.5 py-0.5 font-mono text-[11px]",
                    seg.valida ? "border-border bg-surface-muted text-text-muted" : "border-error/40 bg-error/10 text-error",
                  )}
                >
                  [{seg.cruda}]
                </span>
              ),
            )}
          </p>
        </section>
      ))}
    </article>
  );
}
