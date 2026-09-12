import fs from "node:fs";
import path from "node:path";
import { FixtureBadge } from "@/components/shared/fixture-badge";
import { parsearMarkdownLite, partirInline, type BloqueMd } from "@/lib/metodo/markdown-lite";

export const metadata = { title: "Forense · Método" };

// Lee del disco en cada request (nunca en build): el archivo cambia
// durante las 36h y no existe en el entorno de build de Vercel hasta que
// se despliegue junto al repo. 21 §2: "estática, sin backend" se refiere a
// que no hay lógica de servidor más allá de leer el archivo.
export const dynamic = "force-dynamic";

/**
 * Corte 3 hallazgo 6: antes solo se leía "el primero disponible" de
 * [DECISIONES.md, ESTADO.md] — con `ESTADO.md` movido a
 * `reports/handoff/ESTADO.md` (ya no en la raíz), esa cadena solo llegaba a
 * mostrar DECISIONES.md y nunca ESTADO.md ni RUNBOOK.md, aunque los tres
 * existieran. Ahora los tres se leen de forma independiente y se muestran
 * todos, cada uno con su propio estado "encontrado/no encontrado" — solo
 * lectura, nunca se editan desde aquí.
 */
const DOCUMENTOS = [
  { id: "decisiones", titulo: "Decisiones", partes: ["reports", "handoff", "DECISIONES.md"] },
  { id: "runbook", titulo: "Runbook", partes: ["RUNBOOK.md"] },
  { id: "estado", titulo: "Estado", partes: ["reports", "handoff", "ESTADO.md"] },
] as const;

interface DocumentoLeido {
  id: string;
  titulo: string;
  ruta: string;
  contenido: string | null;
  error: string | null;
}

function leerDocumentosMetodo(): DocumentoLeido[] {
  // Raíz del repo = un nivel arriba de `web/` (process.cwd() en runtime de
  // Next.js es `web/`). Rutas relativas a la raíz, como pide 21 §2.
  const raizRepo = path.resolve(process.cwd(), "..");
  return DOCUMENTOS.map(({ id, titulo, partes }) => {
    const ruta = partes.join("/");
    try {
      return { id, titulo, ruta, contenido: fs.readFileSync(path.join(raizRepo, ...partes), "utf8"), error: null };
    } catch (e) {
      return { id, titulo, ruta, contenido: null, error: e instanceof Error ? e.message : "Error desconocido leyendo el archivo." };
    }
  });
}

export default function MetodoPage() {
  const documentos = leerDocumentosMetodo();
  const disponibles = documentos.filter((d) => d.contenido !== null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Método</h1>
        <FixtureBadge origen="local" />
      </div>

      {disponibles.length > 0 && (
        <nav className="flex flex-wrap gap-2 text-xs" aria-label="Documentos de método">
          {documentos.map((d) => (
            <a
              key={d.id}
              href={`#${d.id}`}
              aria-disabled={d.contenido === null}
              className={
                d.contenido === null
                  ? "cursor-not-allowed rounded-full border border-dashed border-border px-2.5 py-1 text-text-subtle opacity-60"
                  : "rounded-full border border-border px-2.5 py-1 text-text hover:bg-surface-hover"
              }
            >
              {d.titulo}
            </a>
          ))}
        </nav>
      )}

      {disponibles.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface p-6 text-sm text-text-subtle">
          <p>
            No se encontró ninguno de <code>reports/handoff/DECISIONES.md</code>, <code>RUNBOOK.md</code> ni{" "}
            <code>reports/handoff/ESTADO.md</code> en la raíz del repo todavía.
          </p>
        </div>
      )}

      {documentos.map((d) => (
        <section key={d.id} id={d.id} className="scroll-mt-4 rounded-[var(--radius-card)] border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium text-text">{d.titulo}</h2>
            <p className="text-xs text-text-subtle">Fuente: {d.ruta}</p>
          </div>
          {d.contenido !== null ? (
            <MarkdownLite contenido={d.contenido} />
          ) : (
            <p className="text-sm text-text-subtle">No encontrado todavía en esta ubicación.</p>
          )}
        </section>
      ))}
    </div>
  );
}

function MarkdownLite({ contenido }: { contenido: string }) {
  const bloques = parsearMarkdownLite(contenido);
  return (
    <div className="space-y-4 text-sm text-text">
      {bloques.map((b, i) => (
        <Bloque key={i} bloque={b} />
      ))}
    </div>
  );
}

function Bloque({ bloque }: { bloque: BloqueMd }) {
  if (bloque.tipo === "encabezado") {
    const clases = bloque.nivel === 1 ? "text-xl font-semibold" : bloque.nivel === 2 ? "text-lg font-medium" : "text-base font-medium";
    return <h3 className={`${clases} text-text`}>{bloque.texto}</h3>;
  }
  if (bloque.tipo === "codigo") {
    return (
      <pre className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface-muted p-3 text-[11px] leading-relaxed text-text">
        <code>{bloque.texto}</code>
      </pre>
    );
  }
  if (bloque.tipo === "tabla") {
    return (
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
        <table className="w-full min-w-[600px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left">
              {bloque.encabezados.map((h, i) => (
                <th key={i} className="p-2 font-medium text-text-subtle">
                  <Inline texto={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bloque.filas.map((fila, i) => (
              <tr key={i} className="border-b border-border last:border-0 align-top">
                {fila.map((celda, j) => (
                  <td key={j} className="p-2">
                    <Inline texto={celda} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <p className="leading-relaxed">
      <Inline texto={bloque.texto} />
    </p>
  );
}

function Inline({ texto }: { texto: string }) {
  return (
    <>
      {partirInline(texto).map((s, i) =>
        s.negrita ? (
          <strong key={i}>{s.texto}</strong>
        ) : s.codigo ? (
          <code key={i} className="rounded bg-surface-muted px-1 font-mono text-[11px]">
            {s.texto}
          </code>
        ) : (
          <span key={i}>{s.texto}</span>
        ),
      )}
    </>
  );
}
