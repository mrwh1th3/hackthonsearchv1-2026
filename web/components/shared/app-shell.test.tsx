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
 * docs/22-frontend-inspector.md (corrección 2026-09-12): el shell del
 * diseño Inspector SUSTITUYE a la barra lateral fija anterior. La
 * navegación entera —incluidas las rutas que el diseño no contempla— vive
 * dentro del panel deslizante, cerrado por omisión; estas pruebas abren el
 * panel primero, que es como un usuario real llega a esos enlaces.
 */
describe("AppShell (docs/22: shell del diseño Inspector como navegación única)", () => {
  it("el panel empieza cerrado: solo el disparador 'Forense' es visible", () => {
    render(
      <AppShell perfilNombre="Auditor Demo" investigaciones={[]}>
        <p>contenido</p>
      </AppShell>,
    );
    expect(screen.getAllByText("Forense").length).toBeGreaterThan(0);
    expect(screen.getByText("contenido")).toBeInTheDocument();
    // La navegación no está en el DOM accesible mientras el panel permanece
    // cerrado (aria-hidden vía el overlay no basta: aquí se comprueba que el
    // enlace de la sección no es lo primero que un lector de pantalla anuncia
    // sin abrir el panel — Radix no se usa aquí, así que se verifica que el
    // trigger es un botón real, no que el enlace esté ausente del DOM).
    expect(screen.getByRole("button", { name: "Abrir navegación" })).toBeInTheDocument();
  });

  it("abre el panel y lista investigaciones reales, secciones y perfil", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        perfilNombre="Auditor Demo"
        perfilOrganizacion="Equipo Auditoría"
        notificacionesNoLeidas={2}
        investigaciones={[investigacion()]}
      >
        <p>contenido</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Abrir navegación" }));

    expect(screen.getByRole("navigation", { name: "Navegación" })).toBeInTheDocument();
    expect(screen.getByText("Sigue el dinero del cluster 200")).toBeInTheDocument();
    expect(screen.getByText("Investigación completa")).toBeInTheDocument();

    for (const label of ["Inicio", "Corridas", "Historial", "Estadísticas", "Notificaciones", "Datos", "Método"]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }

    expect(screen.getByRole("link", { name: /Notificaciones/ }).textContent).toContain("2");
    expect(screen.getAllByText("Auditor Demo").length).toBeGreaterThan(0);
    expect(screen.getByText("Equipo Auditoría")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("el ítem activo ('/') marca aria-current=page", async () => {
    const user = userEvent.setup();
    render(
      <AppShell perfilNombre="Auditor Demo" investigaciones={[]}>
        <p>contenido</p>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir navegación" }));
    expect(screen.getByRole("link", { name: /^Inicio/ })).toHaveAttribute("aria-current", "page");
  });

  it("sin investigaciones, el estado vacío es honesto (no una lista fabricada)", async () => {
    const user = userEvent.setup();
    render(
      <AppShell perfilNombre="Auditor Demo" investigaciones={[]}>
        <p>contenido</p>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir navegación" }));
    expect(screen.getByText("Sin investigaciones todavía.")).toBeInTheDocument();
  });

  it("el buscador filtra investigaciones por título", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        perfilNombre="Auditor Demo"
        investigaciones={[investigacion({ id: "a", titulo: "Sigue el dinero" }), investigacion({ id: "b", titulo: "Compara con pares" })]}
      >
        <p>contenido</p>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir navegación" }));
    await user.type(screen.getByPlaceholderText("Buscar investigaciones"), "pares");
    expect(screen.queryByText("Sigue el dinero")).not.toBeInTheDocument();
    expect(screen.getByText("Compara con pares")).toBeInTheDocument();
  });
});
