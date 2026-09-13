import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalisisCanvas } from "./analisis-canvas";
import type { Caso, EventoForense, Tarea } from "@/lib/data";

vi.mock("@/components/shared/app-shell", () => ({ useInspectorPanel: () => ({ abrir: () => {}, abierto: false }) }));

const caso = {
  id: "00000000-0000-4000-8000-000000000100",
  corrida_id: "c",
  cluster_id: "k",
  rfc_principal: "DEMO:ENTIDAD-0",
  rfcs_satelite: ["DEMO:ENTIDAD-1"],
  estado: "ronda1",
  creado: "2026-01-31T12:00:00Z",
  terminado: null,
} as unknown as Caso;

const tareas: Tarea[] = [
  {
    id: "t1",
    caso_id: caso.id,
    corrida_id: "c",
    cluster_id: "k",
    agente: "financiero",
    ronda: 1,
    intento: 0,
    version_contexto: 1,
    estado: "ejecutando",
    idempotency_key: "x",
    iniciado: "2026-01-31T12:00:00Z",
    terminado: null,
  },
];

const eventos: EventoForense[] = [
  {
    schema_version: "bitacora.v1",
    id: "1",
    corrida_id: "c",
    caso_id: caso.id,
    tarea_id: "t1",
    seq: 1,
    ts: "2026-01-31T12:00:05Z",
    tipo_evento: "razonamiento",
    payload: { resumen: "Revisa pagos del cluster", referencias: [], operacion_id: null },
    tokens_in: 900,
    tokens_out: 300,
  },
];

describe("AnalisisCanvas", () => {
  it("pinta encabezado, etapa, árbol y abre el modal del subagente con su log en proceso", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<AnalisisCanvas casoId={caso.id} etiqueta="Demo" enVivo={false} inicial={{ caso, tareas, eventos }} />);

    expect(screen.getByRole("heading", { name: /Análisis en proceso/ })).toBeInTheDocument();
    expect(screen.getByText(/1\.2k tokens consumidos/)).toBeInTheDocument();
    expect(screen.getByText("Árbol de trabajo:")).toBeInTheDocument();
    expect(screen.getByText("En etapa de ronda 1 · especialistas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /financiero/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Subagente de financiero" })).toBeInTheDocument();
    expect(within(dialog).getByText("Etapa de ronda 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Revisa pagos del cluster")).toBeInTheDocument();
    expect(within(dialog).getByText(/En proceso/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Salir" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/todavía no ha anotado hallazgos/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
