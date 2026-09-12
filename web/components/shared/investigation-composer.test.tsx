import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvestigationComposer } from "./investigation-composer";
import type { Corrida } from "@/lib/data";

const corrida: Corrida = {
  id: "00000000-0000-4000-8000-000000000001",
  nombre: "Demo enero 2026",
  dataset: "fixture-contract-v1",
  dataset_hash: "a".repeat(64),
  fecha_corte: "2026-01-31T12:00:00Z",
  corrida_origen_id: null,
  estado: "completada",
  version_prompts: "a".repeat(64),
  version_reglas: "a".repeat(64),
  modo: "fixture",
  familias_evaluables: ["D", "F", "R", "T", "E"],
  inicio: "2026-01-01T00:00:00Z",
  fin: "2026-01-31T23:59:59Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * docs/22-frontend-inspector.md "El payload ya existe: no hace falta tocar
 * n8n en este corte". Lo que se prueba: el payload que sale de la UI
 * respeta el contrato `product.investigar` (nunca `desde === hasta_exclusivo`
 * como hacía la versión anterior con `corrida.fecha_corte` en ambos
 * extremos, y `timezone` siempre viene de `ZONA_POR_OMISION`), y el botón
 * de envío no se habilita sin directriz ni sin periodo resuelto.
 */
describe("InvestigationComposer", () => {
  it("Inspeccionar está deshabilitado hasta elegir una sugerencia (directriz_id es obligatorio en el contrato)", () => {
    render(<InvestigationComposer corrida={corrida} rfcsDisponibles={["DEMO:ENTIDAD-0"]} />);
    expect(screen.getByRole("button", { name: /Inspeccionar/ })).toBeDisabled();
  });

  it("envía product.investigar con un periodo real (desde != hasta_exclusivo) y la zona por omisión", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ status: 202, ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<InvestigationComposer corrida={corrida} rfcsDisponibles={["DEMO:ENTIDAD-0"]} />);

    await user.click(screen.getByRole("button", { name: /^Seguir el dinero/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Inspeccionar/ })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /Inspeccionar/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/investigaciones");
    const body = JSON.parse((init as RequestInit).body as string);

    expect(body.directriz_id).toBe("seguir_dinero");
    expect(body.contexto.corrida_id).toBe(corrida.id);
    expect(body.contexto.periodo.timezone).toBe("America/Monterrey");
    expect(body.contexto.periodo.desde).not.toBe(body.contexto.periodo.hasta_exclusivo);
    expect(new Date(body.contexto.periodo.hasta_exclusivo).getTime()).toBeGreaterThan(new Date(body.contexto.periodo.desde).getTime());
  });

  it("'Cambiar dataset' llama a onChangeDataset sin enviar nada", async () => {
    const user = userEvent.setup();
    const onChangeDataset = vi.fn();
    render(<InvestigationComposer corrida={corrida} rfcsDisponibles={["DEMO:ENTIDAD-0"]} onChangeDataset={onChangeDataset} />);
    await user.click(screen.getByRole("button", { name: "Cambiar dataset" }));
    expect(onChangeDataset).toHaveBeenCalledTimes(1);
  });

  it("el pill de alcance de pistas refleja familias_evaluables de la corrida", () => {
    render(<InvestigationComposer corrida={corrida} rfcsDisponibles={["DEMO:ENTIDAD-0"]} />);
    expect(screen.getByRole("button", { name: /Pistas en alcance/ })).toHaveTextContent("14/14");
  });
});
