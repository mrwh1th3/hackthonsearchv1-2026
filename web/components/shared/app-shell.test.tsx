import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./app-shell";
import type { Investigacion } from "@/lib/data";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function investigacion(overrides: Partial<Investigacion> = {}): Investigacion {
  return {
    id: "00000000-0000-4000-8000-000000000900",
    perfil_id: "perfil-1",
    modo: "corrida",
    corrida_id: "00000000-0000-4000-8000-000000000001",
    caso_ids: [],
    estado: "investigacion_completa",
    investigacion_padre_id: null,
    creado: "2026-01-31T12:00:00Z",
    completada_at: "2026-01-31T12:05:00Z",
    reporte_manifest: [],
    titulo: "Sigue el dinero del cluster 200",
    ...overrides,
  };
}

/**
 * `docs/22-frontend-inspector.md`: el shell es un puerto **fiel** del `aside`
 * de `design-ref/Agents.dc.html` (líneas 26–56). Estas pruebas fijan que siga
 * siendo fiel, porque ya se desvió dos veces: se le añadieron nueve entradas de
 * navegación y una pantalla índice que el diseño no tiene.
 */
describe("AppShell (puerto fiel del panel del diseño)", () => {
  it("el panel lleva SOLO lo que lleva el diseño: buscador, rótulo, lista y pie", async () => {
    render(<AppShell perfilNombre="Ana" investigaciones={[investigacion()]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /abrir navegación/i }));

    expect(screen.getByPlaceholderText("Buscar investigaciones")).toBeTruthy();
    expect(screen.getByText("Investigaciones")).toBeTruthy();
    expect(screen.getByText("Sigue el dinero del cluster 200")).toBeTruthy();
    expect(screen.getByRole("button", { name: /salir/i })).toBeTruthy();
  });

  it("no reaparece una barra de navegación que el diseño no tiene", async () => {
    render(<AppShell perfilNombre="Ana" investigaciones={[investigacion()]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /abrir navegación/i }));

    // El diseño no lista secciones en el panel. Si alguien las vuelve a meter,
    // esta prueba lo dice en vez de descubrirlo el usuario por tercera vez.
    for (const prohibido of ["Inicio", "Corridas", "Estadísticas", "Notificaciones", "Datos", "Método", "Navegación de prueba"]) {
      expect(screen.queryByRole("link", { name: prohibido })).toBeNull();
    }
  });

  it("una investigación en curso gira el spinner; una terminada no", async () => {
    render(
      <AppShell
        perfilNombre="Ana"
        investigaciones={[
          investigacion({ id: "a", titulo: "En curso", estado: "investigando", completada_at: null }),
          investigacion({ id: "b", titulo: "Terminada", estado: "investigacion_completa" }),
        ]}
      >
        {null}
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /abrir navegación/i }));

    expect(screen.getByText("Investigando…")).toBeTruthy();
    expect(screen.getByText(/^Lista · /)).toBeTruthy();
    // El diseño ordena las terminadas al final.
    const titulos = screen.getAllByText(/En curso|Terminada/).map((n) => n.textContent);
    expect(titulos.indexOf("En curso")).toBeLessThan(titulos.indexOf("Terminada"));
  });

  it("el buscador filtra por título", async () => {
    render(
      <AppShell
        perfilNombre="Ana"
        investigaciones={[
          investigacion({ id: "a", titulo: "Sigue el dinero" }),
          investigacion({ id: "b", titulo: "Compara pares" }),
        ]}
      >
        {null}
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /abrir navegación/i }));
    await userEvent.type(screen.getByPlaceholderText("Buscar investigaciones"), "pares");

    expect(screen.getByText("Compara pares")).toBeTruthy();
    expect(screen.queryByText("Sigue el dinero")).toBeNull();
  });

  it("sin investigaciones el vacío es honesto, no una lista fabricada", async () => {
    render(<AppShell perfilNombre="Ana" investigaciones={[]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /abrir navegación/i }));

    expect(screen.getByText(/Todavía no hay investigaciones/i)).toBeTruthy();
  });
});
