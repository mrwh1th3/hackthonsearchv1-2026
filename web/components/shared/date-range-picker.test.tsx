import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRangePicker } from "./date-range-picker";

describe("DateRangePicker (15 §9) — componente", () => {
  it("al elegir 'Hoy' entrega un rango en UTC con fin exclusivo", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Mediodía en America/Monterrey (UTC-6) del 15 de junio de 2026.
    const referencia = new Date("2026-06-15T18:00:00Z");

    render(<DateRangePicker alcance="ejecucion" referencia={referencia} timezone="America/Monterrey" onChange={onChange} />);

    // Se dispara una vez al montar (con el preset inicial) y otra vez al
    // elegir "Hoy": el llamador siempre recibe el rango que se ve activo.
    expect(onChange).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Today" }));

    const rango = onChange.mock.calls.at(-1)![0];
    expect(rango.desde).toBe("2026-06-15T06:00:00.000Z");
    expect(rango.hasta_exclusivo).toBe("2026-06-16T06:00:00.000Z");
    // Fin exclusivo: el instante exacto de hasta_exclusivo no pertenece al rango.
    const desdeMs = new Date(rango.desde).getTime();
    const hastaMs = new Date(rango.hasta_exclusivo).getTime();
    expect(hastaMs > desdeMs).toBe(true);
  });

  it("declara el alcance ('Periodo del dataset' vs 'Periodo de ejecución')", () => {
    const referencia = new Date("2026-06-15T18:00:00Z");
    const { rerender } = render(<DateRangePicker alcance="ejecucion" referencia={referencia} />);
    expect(screen.getByText("Execution period")).toBeInTheDocument();

    rerender(<DateRangePicker alcance="dataset" referencia={referencia} />);
    expect(screen.getByText("Dataset period")).toBeInTheDocument();
  });

  it("preset activo se marca con aria-pressed", async () => {
    const user = userEvent.setup();
    const referencia = new Date("2026-06-15T18:00:00Z");
    render(<DateRangePicker alcance="ejecucion" referencia={referencia} />);

    const boton30d = screen.getByRole("button", { name: "30 days" });
    expect(boton30d).toHaveAttribute("aria-pressed", "true"); // default del componente

    const botonHoy = screen.getByRole("button", { name: "Today" });
    await user.click(botonHoy);
    expect(botonHoy).toHaveAttribute("aria-pressed", "true");
    expect(boton30d).toHaveAttribute("aria-pressed", "false");
  });

  it("converts an inclusive custom day to an exclusive UTC end across DST", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker alcance="ejecucion" referencia={new Date("2024-03-10T12:00:00Z")} timezone="America/New_York" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    onChange.mockClear();
    await user.type(screen.getByRole("textbox", { name: "From" }), "2024-03-10");
    await user.type(screen.getByRole("textbox", { name: "To (inclusive)" }), "2024-03-10");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      desde: "2024-03-10T05:00:00.000Z",
      hasta_exclusivo: "2024-03-11T04:00:00.000Z",
      timezone: "America/New_York",
      preset: "personalizado",
    });
  });

  it("does not apply impossible dates and resets custom fields to the initial preset", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker alcance="dataset" referencia={new Date("2024-03-15T12:00:00Z")} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Custom" }));
    onChange.mockClear();
    await user.type(screen.getByRole("textbox", { name: "From" }), "2024-02-30");
    await user.type(screen.getByRole("textbox", { name: "To (inclusive)" }), "2024-03-10");
    expect(screen.getByRole("textbox", { name: "From" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("textbox", { name: "From" })).not.toBeInTheDocument();
    expect(onChange.mock.calls.at(-1)?.[0].preset).toBe("30d");
  });
});
