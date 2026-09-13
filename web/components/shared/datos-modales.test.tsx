import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdministrarDatosModal, TipoDatasetModal } from "./datos-modales";
import type { Corrida } from "@/lib/data";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

function corrida(over: Partial<Corrida> = {}): Corrida {
  return {
    ...({} as Corrida),
    id: "00000000-0000-4000-8000-000000000001",
    nombre: "Demo enero 2026",
    dataset: "sintetico_v1",
    estado: "completada",
    fecha_corte: "2026-01-31T00:00:00.000Z",
    inicio: "2026-01-01T00:00:00.000Z",
    fin: "2026-01-31T00:00:00.000Z",
    corrida_origen_id: null,
    familias_evaluables: [],
    ...over,
  } as Corrida;
}

/**
 * Los dos pop-ups del diseño con datos reales. Lo que se prueba es justo lo
 * que el original hacía mal: no hay "Connect database" con credenciales a
 * ninguna parte, no hay tamaños ni "Updated 2h ago" fabricados, y el badge de
 * dinámico es `corrida_origen_id != null`, no un booleano inventado.
 */
describe("Pop-ups de datos del diseño Inspector", () => {
  it("el pop-up de tipo de dataset ofrece estático e inyección en vivo, y ninguna cadena de conexión", () => {
    render(<TipoDatasetModal onClose={vi.fn()} />);
    expect(screen.getByText("File upload")).toBeInTheDocument();
    expect(screen.getByText("Live injection")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/postgres:\/\//)).not.toBeInTheDocument();
  });

  it("administrar datos lista corridas reales y pone las inyecciones primero", () => {
    render(
      <AdministrarDatosModal
        corridas={[corrida(), corrida({ id: "hija", nombre: "Inyección juez", corrida_origen_id: "00000000-0000-4000-8000-000000000001" })]}
        onClose={vi.fn()}
      />,
    );
    const nombres = screen.getAllByText(/Demo enero 2026|Inyección juez/).map((n) => n.textContent);
    expect(nombres[0]).toBe("Inyección juez");
    expect(screen.queryByText(/KB|MB|GB/)).not.toBeInTheDocument();
  });

  it("«Inspeccionar» abre el preview tipo hoja de cálculo con los datos del estate", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tablas: [{ nombre: "vendors", filas: 2 }, { nombre: "invoices", filas: 0 }],
        tabla: "vendors",
        columnas: ["rfc", "legal_name"],
        filas: [["AAA010101AA1", "Proveedor Uno SA de CV"], ["BBB020202BB2", null]],
        total: 2,
        offset: 0,
        limit: 100,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdministrarDatosModal corridas={[corrida()]} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Inspeccionar" }));
    expect(await screen.findByText("Proveedor Uno SA de CV")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toContain("corrida_id=00000000-0000-4000-8000-000000000001");
    expect(screen.getByRole("columnheader", { name: /A\s*rfc/ })).toBeInTheDocument();
    expect(screen.getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText("Filas 1–2 de 2")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

/** XHR falso: registra el cuerpo, emite progreso y responde lo que diga la prueba. */
function stubXhr(status: number, body: unknown) {
  const enviados: FormData[] = [];
  class FakeXhr {
    status = 0;
    responseText = "";
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null; onload: (() => void) | null } = {
      onprogress: null,
      onload: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open() {}
    send(form: FormData) {
      enviados.push(form);
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        this.upload.onload?.();
        this.status = status;
        this.responseText = JSON.stringify(body);
        this.onload?.();
      }, 0);
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return enviados;
}

describe("Añadir dataset — multi-formato (2026-09-13)", () => {
  it("el selector acepta SQLite, CSV, XLSX y ZIP, y varios archivos a la vez", () => {
    render(<TipoDatasetModal onClose={vi.fn()} />);
    const input = screen.getByLabelText("Upload dataset") as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe(".db,.sqlite,.sqlite3,.csv,.xlsx,.zip");
    expect(screen.getByText(/Multiple CSVs form one dataset/i)).toBeInTheDocument();
  });

  it("varios CSV van en un solo POST y, al cargar, se muestra el resumen de estructura antes de abrir la corrida", async () => {
    const user = userEvent.setup();
    const enviados = stubXhr(201, {
      corrida_id: "c1",
      estructura: {
        estado: "adapted",
        resumen: "1 table(s) and 1 column(s) mapped from other names.",
        formato: "csv_dir",
        entradas: [],
        tablas: [{ canonica: "invoices", origen: "facturas", filas: 3, usable: true, confianza: 0.9, columnas: [{ canonica: "issuer_rfc", origen: "RFC Emisor", confianza: 0.71, metodo: "deterministic", cambiadas: 0 }], faltantes: [], noMapeadas: [] }],
        bajaConfianza: ["invoices.issuer_rfc"],
        detectoresApagados: [{ detector: "kickback", faltan: ["bank_txns.from_clabe"] }],
        evidenciaReducida: [{ detector: "phantom_vendor", faltan: ["ledger.entry_id"] }],
        precisionPerdida: [{ campo: "vendors.bank_clabe", valores: 4 }],
        colisiones: [],
        tablasNoUsadas: [],
        avisos: [],
      },
    });
    const onCargado = vi.fn();
    const onClose = vi.fn();
    render(<TipoDatasetModal onClose={onClose} onCargado={onCargado} />);
    await user.upload(screen.getByLabelText("Upload dataset"), [
      new File(["rfc\n"], "vendors.csv", { type: "text/csv" }),
      new File(["uuid\n"], "facturas.csv", { type: "text/csv" }),
    ]);

    expect(await screen.findByText("Dataset uploaded")).toBeInTheDocument();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].getAll("archivos").map((f) => (f as File).name)).toEqual(["vendors.csv", "facturas.csv"]);
    expect(screen.getByText("Mappings to review")).toBeInTheDocument();
    expect(screen.getByText("kickback: falta bank_txns.from_clabe")).toBeInTheDocument();
    expect(screen.getByText("phantom_vendor: sin ledger.entry_id")).toBeInTheDocument();
    expect(screen.getByText(/vendors\.bank_clabe: 4 due to precision loss/)).toBeInTheDocument();
    expect(screen.getByText("← facturas")).toBeInTheDocument();
    expect(onCargado).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open dataset" }));
    expect(onCargado).toHaveBeenCalledWith("c1");
    expect(onClose).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("un error de estructura (422) se muestra con el detalle del servidor y no abre nada", async () => {
    const user = userEvent.setup();
    stubXhr(422, { error: "estructura_invalida", detalle: "required fields invoices.total could not be located." });
    const onCargado = vi.fn();
    render(<TipoDatasetModal onClose={vi.fn()} onCargado={onCargado} />);
    await user.upload(screen.getByLabelText("Upload dataset"), new File(["x\n"], "facturas.csv", { type: "text/csv" }));
    expect(await screen.findByText(/invoices\.total could not be located/)).toBeInTheDocument();
    expect(onCargado).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("el preview ofrece «Estructura», que lee el reporte privado de la corrida", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("/api/estates/estructura")
        ? { ok: false, status: 404, json: async () => ({ error: "sin_reporte", detalle: "Esta corrida no tiene reporte de estructura." }) }
        : { ok: true, json: async () => ({ tablas: [], tabla: "vendors", columnas: [], filas: [], total: 0, offset: 0, limit: 100 }) },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AdministrarDatosModal corridas={[corrida()]} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Inspeccionar" }));
    await user.click(await screen.findByRole("button", { name: "Estructura" }));
    expect(await screen.findByText("Esta corrida no tiene reporte de estructura.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/estates/estructura?corrida_id=00000000-0000-4000-8000-000000000001"))).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("Administrar datos — borrar corrida (2026-09-12)", () => {
  it("pide confirmación y solo tras confirmar llama a DELETE /api/corridas/:id y quita la fila", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdministrarDatosModal corridas={[corrida()]} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Delete demo enero 2026/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/corridas/00000000-0000-4000-8000-000000000001", { method: "DELETE" });
    await waitFor(() => expect(screen.queryByText("Demo enero 2026")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("muestra el error del servidor y deja la fila si el borrado falla", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ detalle: "corrida no existe" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdministrarDatosModal corridas={[corrida()]} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Delete demo enero 2026/i }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("corrida no existe")).toBeInTheDocument();
    expect(screen.getByText("Demo enero 2026")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
