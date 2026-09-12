import { describe, expect, it } from "vitest";
import { resolveDateRangePreset } from "./range";

const TZ = "America/Monterrey"; // 15 §5: zona horaria de presentación por defecto.

describe("resolveDateRangePreset — UTC, fin exclusivo (15 §9)", () => {
  it("'hoy' en America/Monterrey (UTC-6, sin horario de verano en MX) da [00:00 local, 24:00 local) en UTC", () => {
    const referencia = new Date("2026-06-15T18:00:00Z"); // mediodía local
    const r = resolveDateRangePreset({ preset: "hoy", timezone: TZ, referencia });
    expect(r.desde).toBe("2026-06-15T06:00:00.000Z");
    expect(r.hasta_exclusivo).toBe("2026-06-16T06:00:00.000Z");
    expect(r.timezone).toBe(TZ);
  });

  it("'hasta_exclusivo' nunca es inclusivo: el instante exacto no cae dentro del rango", () => {
    const referencia = new Date("2026-06-15T18:00:00Z");
    const r = resolveDateRangePreset({ preset: "hoy", timezone: TZ, referencia });
    const desde = new Date(r.desde).getTime();
    const hasta = new Date(r.hasta_exclusivo).getTime();
    const dentro = (t: number) => t >= desde && t < hasta;
    expect(dentro(hasta)).toBe(false); // el borde exacto queda fuera
    expect(dentro(hasta - 1)).toBe(true); // 1 ms antes sigue dentro
  });

  it("'ayer' es el día calendario anterior completo, sin traslape con 'hoy'", () => {
    const referencia = new Date("2026-06-15T18:00:00Z");
    const hoy = resolveDateRangePreset({ preset: "hoy", timezone: TZ, referencia });
    const ayer = resolveDateRangePreset({ preset: "ayer", timezone: TZ, referencia });
    expect(ayer.hasta_exclusivo).toBe(hoy.desde); // contiguo, sin hueco ni traslape
  });

  it("'7d' cubre exactamente 7 días de calendario incluyendo hoy", () => {
    const referencia = new Date("2026-06-15T18:00:00Z");
    const r = resolveDateRangePreset({ preset: "7d", timezone: TZ, referencia });
    const dias = (new Date(r.hasta_exclusivo).getTime() - new Date(r.desde).getTime()) / 86_400_000;
    expect(dias).toBe(7);
  });

  it("'mes_actual' y 'mes_anterior' son contiguos y no traslapan", () => {
    const referencia = new Date("2026-06-15T18:00:00Z");
    const actual = resolveDateRangePreset({ preset: "mes_actual", timezone: TZ, referencia });
    const anterior = resolveDateRangePreset({ preset: "mes_anterior", timezone: TZ, referencia });
    expect(anterior.hasta_exclusivo).toBe(actual.desde);
    expect(actual.desde).toBe("2026-06-01T06:00:00.000Z");
    expect(actual.hasta_exclusivo).toBe("2026-07-01T06:00:00.000Z"); // Monterrey es UTC-6 fijo, sin DST
  });

  it("alcance 'dataset': la referencia es fecha_corte, no el reloj real (dataset histórico no queda vacío)", () => {
    const fechaCorte = new Date("2024-01-10T12:00:00Z"); // muy en el pasado
    const r = resolveDateRangePreset({ preset: "hoy", timezone: TZ, referencia: fechaCorte });
    expect(r.desde.startsWith("2024-01-10")).toBe(true);
  });

  it("día de 23 horas por cambio a horario de verano no desplaza el rango (zona con DST)", () => {
    // America/Mexico_City no observa DST en 2026, pero America/Chicago sí:
    // 2026-03-08 es el día del cambio (23 horas) en America/Chicago.
    const referencia = new Date("2026-03-08T18:00:00Z");
    const r = resolveDateRangePreset({ preset: "hoy", timezone: "America/Chicago", referencia });
    const horas = (new Date(r.hasta_exclusivo).getTime() - new Date(r.desde).getTime()) / 3_600_000;
    expect(horas).toBe(23); // el rango respeta el reloj de pared, no asume 24h fijas
  });

  it("preset 'personalizado' respeta las fechas provistas y exige hasta > desde", () => {
    const r = resolveDateRangePreset({
      preset: "personalizado",
      timezone: TZ,
      referencia: new Date(),
      personalizado: { desde: new Date(Date.UTC(2026, 0, 1)), hastaExclusivo: new Date(Date.UTC(2026, 0, 15)) },
    });
    expect(r.desde).toBe("2026-01-01T06:00:00.000Z");
    expect(r.hasta_exclusivo).toBe("2026-01-15T06:00:00.000Z");
  });

  it("preset 'personalizado' con hasta <= desde lanza error explícito", () => {
    expect(() =>
      resolveDateRangePreset({
        preset: "personalizado",
        timezone: TZ,
        referencia: new Date(),
        personalizado: { desde: new Date(Date.UTC(2026, 0, 15)), hastaExclusivo: new Date(Date.UTC(2026, 0, 1)) },
      }),
    ).toThrow();
  });
});
