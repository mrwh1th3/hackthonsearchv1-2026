import { describe, expect, it } from "vitest";
import { dividirEnSecciones, partirEnCitas } from "./citas";

describe("partirEnCitas (09 §8: cita inválida se marca en rojo)", () => {
  const validadas = new Set(["CFDI:00000000-0000-4000-8000-000000000901"]);

  it("una cita cuyo ID está en evidencia validada se marca válida", () => {
    const segmentos = partirEnCitas("Texto antes [CFDI:00000000-0000-4000-8000-000000000901] texto después.", validadas);
    const cita = segmentos.find((s) => s.tipo === "cita");
    expect(cita).toBeTruthy();
    expect(cita!.valida).toBe(true);
  });

  it("una cita cuyo ID NO está en evidencia validada se marca inválida (roja)", () => {
    const segmentos = partirEnCitas("Ver [CFDI:ffffffff-ffff-4fff-8fff-ffffffffffff] aquí.", validadas);
    const cita = segmentos.find((s) => s.tipo === "cita");
    expect(cita).toBeTruthy();
    expect(cita!.valida).toBe(false);
  });

  it("texto sin citas produce un único segmento de texto", () => {
    const segmentos = partirEnCitas("Sin citas aquí.", validadas);
    expect(segmentos).toEqual([{ tipo: "texto", texto: "Sin citas aquí." }]);
  });

  it("varias citas en el mismo párrafo se detectan todas", () => {
    const segmentos = partirEnCitas("[CFDI:00000000-0000-4000-8000-000000000901] y [CFDI:aaaa-bbbb]", validadas);
    const citas = segmentos.filter((s) => s.tipo === "cita");
    expect(citas).toHaveLength(2);
    expect(citas[0].valida).toBe(true);
    expect(citas[1].valida).toBe(false);
  });
});

describe("dividirEnSecciones", () => {
  it("divide un documento de 8 secciones fijas por encabezado '## N. Título'", () => {
    const md = "## 1. Resumen\n\nA\n\n## 2. Contribuyente\n\nB";
    const secciones = dividirEnSecciones(md);
    expect(secciones).toHaveLength(2);
    expect(secciones[0].titulo).toBe("1. Resumen");
    expect(secciones[0].cuerpo).toBe("A");
    expect(secciones[1].titulo).toBe("2. Contribuyente");
  });
});
