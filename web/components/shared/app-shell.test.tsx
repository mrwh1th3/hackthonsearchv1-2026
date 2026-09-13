import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./app-shell";
import type { Investigacion, Perfil } from "@/lib/data";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: navigate, refresh: vi.fn(), prefetch: vi.fn() }),
}));

const PERFIL: Perfil = {
  id: "perfil-1",
  nombre: "Ana",
  organizacion: "Auditor Demo",
  timezone: "America/Monterrey",
  telefono_e164: null,
  llamadas_activadas: false,
  consentimiento_at: null,
};

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
    render(<AppShell perfilNombre="Ana" perfil={PERFIL} perfilEsFixture investigaciones={[investigacion()]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /Open navigation/i }));

    expect(screen.getByPlaceholderText("Search investigations")).toBeTruthy();
    expect(screen.getByText("Investigations")).toBeTruthy();
    expect(screen.getByText("Sigue el dinero del cluster 200")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("no reaparece una barra de navegación que el diseño no tiene", async () => {
    render(<AppShell perfilNombre="Ana" perfil={PERFIL} perfilEsFixture investigaciones={[investigacion()]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /Open navigation/i }));

    // El diseño no lista secciones en el panel. Si alguien las vuelve a meter,
    // esta prueba lo dice en vez de descubrirlo el usuario por tercera vez.
    for (const prohibido of ["Home", "Corridas", "Estadísticas", "Notificaciones", "Data", "Método", "Navegación de prueba"]) {
      expect(screen.queryByRole("link", { name: prohibido })).toBeNull();
    }
  });

  it("una investigación en curso gira el spinner; una terminada no", async () => {
    render(
      <AppShell
        perfilNombre="Ana"
        perfil={PERFIL}
        perfilEsFixture
        investigaciones={[
          investigacion({ id: "a", titulo: "Running", estado: "investigando", completada_at: null }),
          investigacion({ id: "b", titulo: "Terminada", estado: "investigacion_completa" }),
        ]}
      >
        {null}
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Open navigation/i }));

    expect(screen.getByText("Investigating…")).toBeTruthy();
    expect(screen.getByText(/^Ready · /)).toBeTruthy();
    // El diseño ordena las terminadas al final.
    const titulos = screen.getAllByText(/Running|Terminada/).map((n) => n.textContent);
    expect(titulos.indexOf("Running")).toBeLessThan(titulos.indexOf("Terminada"));
  });

  it("el buscador filtra por título", async () => {
    render(
      <AppShell
        perfilNombre="Ana"
        perfil={PERFIL}
        perfilEsFixture
        investigaciones={[
          investigacion({ id: "a", titulo: "Sigue el dinero" }),
          investigacion({ id: "b", titulo: "Compara pares" }),
        ]}
      >
        {null}
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Open navigation/i }));
    await userEvent.type(screen.getByPlaceholderText("Search investigations"), "pares");

    expect(screen.getByText("Compara pares")).toBeTruthy();
    expect(screen.queryByText("Sigue el dinero")).toBeNull();
  });

  it("sin investigaciones el vacío es honesto, no una lista fabricada", async () => {
    render(<AppShell perfilNombre="Ana" perfil={PERFIL} perfilEsFixture investigaciones={[]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /Open navigation/i }));

    expect(screen.getByText(/No investigations yet/i)).toBeTruthy();
  });

  it("una investigación parcial o fallida nunca aparece lista", async () => {
    render(<AppShell perfilNombre="Ana" perfil={PERFIL} perfilEsFixture investigaciones={[investigacion({ id: "error", estado: "error" }), investigacion({ id: "parcial", estado: "parcial" })]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /Open navigation/i }));
    expect(screen.queryByText(/^Ready ·/)).not.toBeInTheDocument();
    expect(screen.getByText(/Error · inspect run/)).toBeInTheDocument();
    expect(screen.getByText(/Finished · review notes/)).toBeInTheDocument();
  });
});

describe("Hypotheses navigation", () => {
  it("opens the user-requested improvement matrix alongside Home", async () => {
    render(<AppShell perfilNombre="Ana" perfil={PERFIL} perfilEsFixture investigaciones={[]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("button", { name: "Home" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Hypotheses" }));
    expect(navigate).toHaveBeenCalledWith("/hypotheses");
  });
});

describe("AppShell — borrar investigación (2026-09-12)", () => {
  it("pide confirmación, y solo tras confirmar llama a DELETE /api/investigaciones/:id y quita la fila", async () => {
    const fetchFalso = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchFalso);
    render(<AppShell perfilNombre="Ana" perfil={PERFIL} perfilEsFixture investigaciones={[investigacion()]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /Open navigation/i }));

    await userEvent.click(screen.getByRole("button", { name: /Delete sigue el dinero del cluster 200/i }));
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(fetchFalso).toHaveBeenCalledWith("/api/investigaciones/00000000-0000-4000-8000-000000000900", { method: "DELETE" });
    await waitFor(() => expect(screen.queryByText("Sigue el dinero del cluster 200")).toBeNull());
    vi.unstubAllGlobals();
  });

  it("cancelar no llama a fetch y deja la fila", async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);
    render(<AppShell perfilNombre="Ana" perfil={PERFIL} perfilEsFixture investigaciones={[investigacion()]}>{null}</AppShell>);
    await userEvent.click(screen.getByRole("button", { name: /Open navigation/i }));

    await userEvent.click(screen.getByRole("button", { name: /Delete sigue el dinero del cluster 200/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(fetchFalso).not.toHaveBeenCalled();
    expect(screen.getByText("Sigue el dinero del cluster 200")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
