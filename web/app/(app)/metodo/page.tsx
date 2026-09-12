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

const RUTAS = [
  ["reports", "handoff", "DECISIONES.md"],
  ["ESTADO.md"],
];

function leerPrimeroDisponible(): { contenido: string; ruta: string } | null {
  // Raíz del repo = un nivel arriba de `web/` (process.cwd() en runtime de
  // Next.js es `web/`). Ruta relativa a la raíz, como pide 21 §2.
  const raizRepo = path.resolve(process.cwd(), "..");
  for (const partes of RUTAS) {
    const rutaAbsoluta = path.join(raizRepo, ...partes);
    try {
      const contenido = fs.readFileSync(rutaAbsoluta, "utf8");
      return { contenido, ruta: partes.join("/") };
    } catch {
      continue;
    }
  }
  return null;
}

export default function MetodoPage() {
  let leido: { contenido: string; ruta: string } | null = null;
  let error: string | null = null;
  try {
    leido = leerPrimeroDisponible();
  } catch (e) {
    error = e instanceof Error ? e.message : "Error desconocido leyendo el archivo.";
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Método</h1>
        <FixtureBadge origen="local" />
      </div>

      {!leido ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface p-6 text-sm text-text-subtle">
          <p>
            No se encontró <code>reports/handoff/DECISIONES.md</code> ni <code>ESTADO.md</code> en la raíz del repo todavía.
          </p>
          {error && <p className="mt-1 text-error">{error}</p>}
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
          <p className="mb-4 text-xs text-text-subtle">Fuente: {leido.ruta}</p>
          <MarkdownLite contenido={leido.contenido} />
        </div>
      )}
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
    return <h2 className={`${clases} text-text`}>{bloque.texto}</h2>;
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
