import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DatosWizard } from "./datos-wizard";
import type { Corrida, MapperPropuesta } from "@/lib/data";

/**
 * Corte 3 hallazgo 3: el paso "Mapeo" del asistente de `/datos` SIEMPRE
 * muestra `mapperEjemplo` (no hay backend de mapper IA conectado en este
 * corte), incluso cuando el usuario ya subió un CSV real — sin badge ni
 * aviso ahí, alguien podría pensar que el mapeo refleja las columnas de su
 * archivo. `FixtureDataSource regla 3: texto libre` no aplica aquí, pero la
 * misma disciplina de "nunca fingir que es un dato real" sí.
 */
const mapperEjemplo: MapperPropuesta = {
  schema_version: "1.0.0",
  adapter_candidate: "cfdi_generico",
  field_mappings: [{ source: "rfc_emisor", target: "rfc", transform: { op: "identity" }, confidence: "alta", reason: "coincide por nombre" }],
  relationships: [],
  ambiguities: [],
  missing_required_fields: [],
  proposed_capabilities: [],
  warnings: [],
};

const corridas: Corrida[] = [{ id: "corrida-1", nombre: "Corrida demo", estado: "lista" } as Corrida];

async function irAPasoMapeo() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^2\. Perfil detectado$/ }));
  await user.click(screen.getByRole("button", { name: /^3\. Mapeo$/ }));
  return user;
}

describe("DatosWizard — paso Mapeo (Corte 3 hallazgo 3)", () => {
  it("sin CSV real: marca el mapeo como fixture con el badge de datos de demostración", async () => {
    render(<DatosWizard mapperEjemplo={mapperEjemplo} corridas={corridas} />);
    await irAPasoMapeo();
    expect(screen.getByTestId("fixture-badge")).toBeInTheDocument();
    expect(screen.getByText(/sube un CSV en el paso 1/i)).toBeInTheDocument();
  });

  it("con un CSV real subido: el aviso deja claro que el mapeo mostrado NO refleja el archivo subido", async () => {
    render(<DatosWizard mapperEjemplo={mapperEjemplo} corridas={corridas} />);
    const user = userEvent.setup();
    const csv = new File(["rfc,monto\nAAA010101AAA,100"], "reales.csv", { type: "text/csv" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csv);
    await screen.findByText(/reales\.csv/);

    await user.click(screen.getByRole("button", { name: /^2\. Perfil detectado$/ }));
    await user.click(screen.getByRole("button", { name: /^3\. Mapeo$/ }));

    expect(screen.getByTestId("fixture-badge")).toBeInTheDocument();
    expect(screen.getByText(/aunque tu csv ya fue leído/i)).toBeInTheDocument();
    // Nunca debe decir lo contrario de "no refleja tu archivo".
    expect(screen.queryByText(/sube un CSV en el paso 1/i)).not.toBeInTheDocument();
  });
});
