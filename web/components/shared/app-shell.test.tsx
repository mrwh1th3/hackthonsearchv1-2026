import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("AppShell (15 §3: shell de aplicación)", () => {
  it("renderiza logo, marca, navegación completa y perfil", () => {
    render(
      <AppShell perfilNombre="Auditor Demo" perfilOrganizacion="Equipo Auditoría" notificacionesNoLeidas={2}>
        <p>contenido</p>
      </AppShell>,
    );

    expect(screen.getByText("Forense")).toBeInTheDocument();
    for (const label of ["Inicio", "Investigaciones", "Historial", "Estadísticas", "Notificaciones", "Datos", "Método"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("contenido")).toBeInTheDocument();
    expect(screen.getAllByText("Auditor Demo").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Notificaciones, 2 sin leer/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("el ítem de navegación activo ('/') marca aria-current=page", () => {
    render(
      <AppShell perfilNombre="Auditor Demo">
        <p>contenido</p>
      </AppShell>,
    );
    const inicioLinks = screen.getAllByRole("link", { name: "Inicio" });
    expect(inicioLinks.some((l) => l.getAttribute("aria-current") === "page")).toBe(true);
  });
});
