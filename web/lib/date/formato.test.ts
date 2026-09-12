import { describe, expect, it } from "vitest";
import { ZONA_POR_OMISION, fechaHora, soloFecha, soloHora } from "./formato";

describe("formato de fechas con zona explícita", () => {
  it("el corte del snapshot NO se corre de día aunque el proceso esté en UTC", () => {
    // 2026-01-31 23:59:59-06 es 2026-02-01 05:59:59Z. Con la zona del proceso
    // en UTC —una Vercel Function— se enseñaría como 1 de febrero. Este es el
    // bug que el módulo existe para evitar.
    const corte = "2026-01-31T23:59:59-06:00";
    expect(soloFecha(corte)).toBe("31/1/2026");
    expect(new Date(corte).toISOString().slice(0, 10)).toBe("2026-02-01");
  });

  it("no depende de la zona del proceso: el resultado es el mismo con TZ=UTC", () => {
    const antes = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      expect(soloFecha("2026-01-31T23:59:59-06:00")).toBe("31/1/2026");
      process.env.TZ = "Asia/Tokyo";
      expect(soloFecha("2026-01-31T23:59:59-06:00")).toBe("31/1/2026");
    } finally {
      process.env.TZ = antes;
    }
  });

  it("acepta una zona distinta cuando el perfil la fija", () => {
    // El mismo instante, visto desde una zona al este, ya es otro día.
    expect(soloFecha("2026-01-31T23:59:59-06:00", "UTC")).toBe("1/2/2026");
  });

  it("un valor ausente o ilegible sale como guion, nunca como Invalid Date", () => {
    for (const v of [null, undefined, "", "no es una fecha"]) {
      expect(fechaHora(v)).toBe("—");
      expect(soloFecha(v)).toBe("—");
      expect(soloHora(v)).toBe("—");
    }
  });

  it("la zona por omisión es la misma que la del selector de rangos", () => {
    expect(ZONA_POR_OMISION).toBe("America/Monterrey");
  });

  it("fechaHora lleva hora y soloFecha no", () => {
    const v = "2026-01-15T14:30:00-06:00";
    expect(fechaHora(v)).toMatch(/14:30|2:30/);
    expect(soloFecha(v)).not.toMatch(/:/);
    expect(soloHora(v)).toMatch(/14:30|2:30/);
  });
});
