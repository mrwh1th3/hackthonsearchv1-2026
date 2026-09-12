import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FalloDatos } from "./fallo-datos";

/**
 * H11-h: la capa de datos propaga el error de Postgres a propósito
 * (CLAUDE.md regla 10), así que la pantalla de fallo es lo único que separa
 * "no se pudo preguntar" de "no hay hallazgos". Estas pruebas fijan esa
 * distinción y el hecho de que nunca se degrade a datos de demostración.
 */
const err = () => Object.assign(new Error("listCorridas: fetch failed"), { digest: "abc123" });

describe("FalloDatos", () => {
  it("dice que no se pudo preguntar, no que no haya hallazgos", () => {
    render(<FalloDatos error={err()} reset={() => {}} alcance="pagina" />);
    expect(screen.getByText(/Esto no significa que no haya hallazgos/i)).toBeTruthy();
  });

  it("nunca ofrece datos de demostración como sustituto", () => {
    const { container } = render(<FalloDatos error={err()} reset={() => {}} alcance="app" />);
    // El badge de fixture es el que rotula datos sintéticos: si apareciera
    // aquí, una instalación a medias se estaría enseñando como una corrida.
    expect(container.querySelector('[data-testid="fixture-badge"]')).toBeNull();
    // El texto sí menciona los datos de demostración, pero para decir que NO
    // se usan: lo que no puede aparecer es el rótulo que los presenta como
    // contenido de la pantalla ("Datos de demostración · contratos v…").
    expect(container.textContent).not.toMatch(/Datos de demostración ·/);
    expect(container.textContent).toMatch(/No se sustituye por datos de demostración/i);
  });

  it("nombra el schema sin exponer como primera causa a revisar", () => {
    render(<FalloDatos error={err()} reset={() => {}} alcance="app" />);
    const pasos = screen.getAllByRole("listitem");
    expect(pasos[0].textContent).toMatch(/Exposed schemas/);
  });

  it("distingue el alcance: el layout tumba la app, una página no", () => {
    const { unmount } = render(<FalloDatos error={err()} reset={() => {}} alcance="app" />);
    expect(screen.getByText(/shell de toda la aplicación/i)).toBeTruthy();
    unmount();
    render(<FalloDatos error={err()} reset={() => {}} alcance="pagina" />);
    expect(screen.getByText(/El resto de la navegación sigue en pie/i)).toBeTruthy();
  });

  it("con mensaje corto lo muestra; sin él, publica el digest para el log", () => {
    const { unmount, container } = render(
      <FalloDatos error={err()} reset={() => {}} alcance="pagina" />,
    );
    expect(container.textContent).toMatch(/listCorridas: fetch failed/);
    unmount();
    // En producción Next borra el mensaje del servidor y deja sólo el digest.
    const opaco = Object.assign(new Error("x".repeat(500)), { digest: "def456" });
    render(<FalloDatos error={opaco} reset={() => {}} alcance="pagina" />);
    expect(screen.getByText(/def456/)).toBeTruthy();
  });

  it("reintentar usa el reset de la frontera cuando lo hay", () => {
    const reset = vi.fn();
    render(<FalloDatos error={err()} reset={reset} alcance="pagina" />);
    screen.getByRole("button", { name: /Reintentar/i }).click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("sin reset (lo pinta un layout) recarga en vez de romperse", () => {
    const recargar = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload: recargar },
    });
    render(<FalloDatos error={err()} alcance="app" />);
    screen.getByRole("button", { name: /Reintentar/i }).click();
    expect(recargar).toHaveBeenCalledOnce();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
