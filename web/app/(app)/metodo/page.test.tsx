import fs from "node:fs";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MetodoPage from "./page";

/**
 * Corte 3 hallazgo 6: antes se leía "el primero disponible" de
 * [DECISIONES.md, ESTADO.md-en-la-raíz] y se mostraba solo ESE — con
 * ESTADO.md movido a reports/handoff/, esa cadena nunca llegaba a
 * RUNBOOK.md ni al ESTADO.md real. Ahora los tres se leen independiente y
 * se muestran todos (o su estado "no encontrado" individual), solo lectura.
 */
afterEach(() => vi.restoreAllMocks());

function mockFs(porRuta: Record<string, string>) {
  vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
    const ruta = String(p);
    const encontrada = Object.keys(porRuta).find((sufijo) => ruta.endsWith(sufijo));
    if (!encontrada) throw new Error(`ENOENT: no existe ${ruta}`);
    return porRuta[encontrada];
  });
}

describe("MetodoPage", () => {
  it("con los tres documentos presentes: los renderiza todos, cada uno bajo su propio encabezado de sección", () => {
    mockFs({
      "reports/handoff/DECISIONES.md": "# DECISIONES\n\nTexto de decisiones.",
      "RUNBOOK.md": "# RUNBOOK\n\n```bash\nnpm test\n```",
      "reports/handoff/ESTADO.md": "# ESTADO\n\nTexto de estado.",
    });
    render(<MetodoPage />);
    expect(screen.getByText("Texto de decisiones.")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("Texto de estado.")).toBeInTheDocument();
  });

  it("con solo DECISIONES.md presente (RUNBOOK/ESTADO ausentes): decisiones se muestra, y los otros dos dicen 'no encontrado', nunca se ocultan ni fingen contenido", () => {
    mockFs({ "reports/handoff/DECISIONES.md": "# DECISIONES\n\nSolo esto existe." });
    render(<MetodoPage />);
    expect(screen.getByText("Solo esto existe.")).toBeInTheDocument();
    expect(screen.getAllByText("No encontrado todavía en esta ubicación.")).toHaveLength(2);
  });

  it("sin ningún documento: aviso general, sin lanzar", () => {
    mockFs({});
    render(<MetodoPage />);
    expect(screen.getByText(/no se encontró ninguno/i)).toBeInTheDocument();
  });

  it("un bloque de código de RUNBOOK.md se renderiza en <pre><code>, no como un párrafo aplastado", () => {
    mockFs({ "RUNBOOK.md": "```bash\n# comentario\ncd web\n```" });
    render(<MetodoPage />);
    const pre = document.querySelector("pre code");
    expect(pre?.textContent).toBe("# comentario\ncd web");
  });
});
