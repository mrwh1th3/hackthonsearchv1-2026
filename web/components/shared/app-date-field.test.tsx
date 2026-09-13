import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppDateField, isISODate } from "./app-date-field";

function ControlledDateField({
  initialValue = "2024-01-15",
  onChange = () => undefined,
  min,
  max,
  disabled,
}: {
  initialValue?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <AppDateField
      label="Report date"
      value={value}
      referenceDate="2024-01-15"
      min={min}
      max={max}
      disabled={disabled}
      onChange={(next) => { setValue(next); onChange(next); }}
    />
  );
}

describe("AppDateField", () => {
  it.each(["2024-02-29", "2000-02-29", "2026-12-31"])("accepts the real ISO date %s", (value) => {
    expect(isISODate(value)).toBe(true);
  });

  it.each(["2023-02-29", "1900-02-29", "2024-02-30", "2024-13-01", "2024-01-00", "2024-1-15", "01/15/2024", ""])("rejects %s without normalizing it", (value) => {
    expect(isISODate(value)).toBe(false);
  });

  it("keeps an invalid draft visible while clearing the submitted value, then accepts a leap day", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledDateField onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Report date" });
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("placeholder", "YYYY-MM-DD");

    await user.clear(input);
    await user.type(input, "2023-02-29");
    expect(input).toHaveValue("2023-02-29");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onChange).toHaveBeenLastCalledWith("");

    await user.clear(input);
    await user.type(input, "2024-02-29");
    expect(input).toHaveValue("2024-02-29");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(onChange).toHaveBeenLastCalledWith("2024-02-29");
  });

  it("supports arrow, week and month keyboard navigation before selecting a date", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledDateField onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Open calendar for Report date" }));
    expect(screen.getByRole("grid", { name: "Choose Report date" })).toBeInTheDocument();
    const selected = screen.getByRole("button", { name: "January 15, 2024" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(selected).toHaveFocus());

    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(screen.getByRole("button", { name: "January 23, 2024" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("button", { name: "January 21, 2024" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: "January 27, 2024" })).toHaveFocus();
    await user.keyboard("{PageDown}");
    expect(screen.getByRole("button", { name: "February 27, 2024" })).toHaveFocus();
    await user.keyboard("{PageUp}{ArrowLeft}{ArrowUp}");
    expect(screen.getByRole("button", { name: "January 19, 2024" })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Report date" })).toHaveValue("2024-01-19");
    expect(onChange).toHaveBeenLastCalledWith("2024-01-19");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("closes with Escape and returns focus to the calendar trigger", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledDateField onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Open calendar for Report date" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("enforces inclusive min and max for both calendar selection and manual entry", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledDateField min="2024-01-10" max="2024-01-20" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Open calendar for Report date" }));
    expect(screen.getByRole("button", { name: "January 9, 2024" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "January 21, 2024" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "January 10, 2024" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "January 20, 2024" }));
    expect(onChange).toHaveBeenLastCalledWith("2024-01-20");

    const input = screen.getByRole("textbox", { name: "Report date" });
    for (const date of ["2024-01-09", "2024-01-21"]) {
      await user.clear(input);
      await user.type(input, date);
      expect(input).toHaveValue(date);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(onChange).toHaveBeenLastCalledWith("");
    }
    await user.clear(input);
    await user.type(input, "2024-01-10");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(onChange).toHaveBeenLastCalledWith("2024-01-10");
  });

  it("clears the field through its named control", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledDateField onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Open calendar for Report date" }));
    await user.click(screen.getByRole("button", { name: "Clear Report date" }));
    expect(screen.getByRole("textbox", { name: "Report date" })).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("prevents editing and opening the calendar while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledDateField disabled onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "Report date" })).toBeDisabled();
    const trigger = screen.getByRole("button", { name: "Open calendar for Report date" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    { value: "0001-01-01", dateLabel: "January 1, 1", unavailableMonth: "Previous month", arrow: "{ArrowLeft}" },
    { value: "9999-12-31", dateLabel: "December 31, 9999", unavailableMonth: "Next month", arrow: "{ArrowRight}" },
  ])("keeps calendar navigation inside the ISO year boundary $value", async ({ value, dateLabel, unavailableMonth, arrow }) => {
    const user = userEvent.setup();
    render(<ControlledDateField initialValue={value} />);
    await user.click(screen.getByRole("button", { name: "Open calendar for Report date" }));
    const selected = screen.getByRole("button", { name: dateLabel });
    expect(selected).toBeEnabled();
    expect(screen.getByRole("button", { name: unavailableMonth })).toBeDisabled();
    await waitFor(() => expect(selected).toHaveFocus());
    await user.keyboard(arrow);
    expect(selected).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Report date" })).toHaveValue(value);
  });
});
