import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AppSelect } from "./app-select";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
function Control() {
  const [value, setValue] = useState("all");
  return <AppSelect aria-label="Output source" value={value} onValueChange={setValue} options={[{ value: "all", label: "All sources" }, { value: "codex", label: "Codex runs" }, { value: "mock", label: "Demo runs", disabled: true }]} />;
}

describe("AppSelect", () => {
  it("selects through a custom menu and restores focus without changing values on Escape", async () => {
    render(<Control />);
    const trigger = screen.getByRole("combobox", { name: "Output source" });
    await userEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.getByRole("option", { name: "Demo runs" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("option", { name: "Codex runs" }));
    expect(trigger).toHaveTextContent("Codex runs");
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveTextContent("Codex runs");
  });
  it("supports keyboard opening, typeahead and confirmation", async () => {
    render(<Control />);
    const trigger = screen.getByRole("combobox", { name: "Output source" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await screen.findByRole("listbox");
    await userEvent.keyboard("c");
    await waitFor(() => expect(screen.getByRole("option", { name: "Codex runs" })).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    expect(trigger).toHaveTextContent("Codex runs");
  });
  it("preserves an honest unavailable state for empty choices", () => {
    render(<AppSelect aria-label="Dataset" value="" options={[]} onValueChange={() => {}} placeholder="No datasets available" />);
    expect(screen.getByRole("combobox", { name: "Dataset" })).toBeDisabled();
    expect(screen.getByText("No datasets available")).toBeVisible();
  });
});
