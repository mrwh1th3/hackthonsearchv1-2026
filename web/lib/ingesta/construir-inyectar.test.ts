import { describe, expect, it } from "vitest";
import { validateContract } from "@/lib/contracts/validate";
import { construirInyectar, parsearFilasPegadas } from "./construir-inyectar";

describe("parsearFilasPegadas", () => {
  it("parsea CSV con encabezado (lo que produce generarPlantillaCsv + filas pegadas)", () => {
    const filas = parsearFilasPegadas("rfc,giro,fecha_alta\nDEMO:INY-001,comercializadora,2025-11-03\n");
    expect(filas).toEqual([{ rfc: "DEMO:INY-001", giro: "comercializadora", fecha_alta: "2025-11-03" }]);
  });

  it("parsea un arreglo JSON de objetos", () => {
    const filas = parsearFilasPegadas('[{"rfc":"DEMO:INY-001","giro":"comercializadora"}]');
    expect(filas).toEqual([{ rfc: "DEMO:INY-001", giro: "comercializadora" }]);
  });

  it("texto vacío o JSON inválido: arreglo vacío, nunca lanza", () => {
    expect(parsearFilasPegadas("")).toEqual([]);
    expect(parsearFilasPegadas("   ")).toEqual([]);
    expect(parsearFilasPegadas("[esto no es json")).toEqual([]);
  });

  it("descarta filas CSV completamente vacías (líneas en blanco)", () => {
    const filas = parsearFilasPegadas("rfc,giro\nDEMO:INY-001,comercializadora\n\n");
    expect(filas).toHaveLength(1);
  });
});

describe("construirInyectar produce el JSON exacto de product.inyectar (validado con el mismo ajv que el BFF)", () => {
  it("un payload con una sola tabla es válido contra el contrato", () => {
    const payload = construirInyectar({
      corridaBaseId: "00000000-0000-4000-8000-000000000001",
      origen: "ui",
      tablas: { contribuyentes: [{ rfc: "DEMO:INY-001", giro: "comercializadora" }] },
      idempotencyKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    });
    const resultado = validateContract("product.inyectar", payload);
    expect(resultado.errors).toEqual([]);
    expect(resultado.ok).toBe(true);
  });

  it("varias tablas a la vez (uploader + inyección en vivo combinados) también validan", () => {
    const payload = construirInyectar({
      corridaBaseId: "00000000-0000-4000-8000-000000000001",
      origen: "ensayo",
      tablas: {
        contribuyentes: [{ rfc: "DEMO:INY-001", giro: "comercializadora" }],
        cfdi: [{ uuid: "0f2c1d4a-6b7e-4c8d-9e0f-1a2b3c4d5e6f", emisor_rfc: "DEMO:INY-001", receptor_rfc: "DEMO:EDOS-001", total: "1160000.00" }],
      },
      nota: "Paquete de prueba del uploader",
      idempotencyKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    });
    expect(validateContract("product.inyectar", payload).ok).toBe(true);
  });

  it("tablas sin filas se filtran; si no queda ninguna, el payload es inválido (el schema exige al menos una tabla o un archivo, nunca vacío)", () => {
    const payload = construirInyectar({
      corridaBaseId: "00000000-0000-4000-8000-000000000001",
      origen: "ui",
      tablas: { contribuyentes: [] },
      idempotencyKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    });
    expect(payload.tablas).toEqual({});
    const resultado = validateContract("product.inyectar", payload);
    expect(resultado.ok).toBe(false);
  });

  it("nunca agrega additionalProperties fuera del contrato (p.ej. el 'ingesta_id' del Corte 1)", () => {
    const payload = construirInyectar({
      corridaBaseId: "00000000-0000-4000-8000-000000000001",
      origen: "ui",
      tablas: { contribuyentes: [{ rfc: "DEMO:INY-001" }] },
      idempotencyKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    });
    expect(Object.keys(payload).sort()).toEqual(["corrida_base_id", "idempotency_key", "origen", "tablas"]);
  });
});
