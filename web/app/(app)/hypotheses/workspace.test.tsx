import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HypothesesWorkspace } from "./workspace";
import { ideasFromRun } from "@/lib/laboratorio/hypotheses";
import type { LabDetail } from "@/lib/laboratorio/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const run: LabDetail = { launch: { run_id: "00000000-0000-4000-8000-000000000011", corrida_id: "00000000-0000-4000-8000-000000000012", corrida_nombre: "Estate seed 105", provider: "codex", data_source: "supabase", giro: "", status: "completed", started_at: "2026-09-13T08:46:07Z" }, summary: null, brief: null, agent_a: { reviews: [{ rule_id: "kickback", verdict: "parte", confidence: .4, reasoning_steps: [{ action: "conclude", claim: "The sender is not identified", evidence_ids: ["bank_txns:BNK-1"] }], missing_datum_to_close: "Account ownership" }] }, agent_b: { findings: [{ mechanism_one_liner: "Unlinked transfer", why_engine_missed: "No matching rule", evidence_ids: ["bank_txns:BNK-2"] }] }, compiler: null, proposals: [{ nombre: "Ownership condition", novelty_summary: "Cross-check the account", predicados: [{ field: "derived.txn_count", operator: "gt", value: 3 }] }], notes: [], traces: [] };
const index = { runs: [run], entries: ideasFromRun(run), unreadableRuns: 0 };

describe("Hypotheses workspace", () => {
  it("filters A and B independently and opens the actual source record", async () => {
    render(<HypothesesWorkspace index={index} />);
    await userEvent.click(screen.getByRole("button", { name: "B · Hypotheses" }));
    expect(screen.queryByRole("button", { name: /Open Pattern review/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open New hypothesis: Unlinked transfer" }));
    const detail = screen.getByRole("complementary", { name: "Selected output" });
    expect(within(detail).getByText("A research lead, not a validated fraud finding.")).toBeInTheDocument();
    const link = within(detail).getByRole("link", { name: /Open investigation/ });
    expect(link.getAttribute("href")).toBe("/?corrida=00000000-0000-4000-8000-000000000012&run=00000000-0000-4000-8000-000000000011");
    await userEvent.click(within(detail).getByText("Evidence references"));
    await userEvent.click(within(detail).getByRole("button", { name: "bank_txns:BNK-2" }));
    expect(within(detail).getByText("Saved reference")).toBeVisible();
  });
  it("finds an exact citation and keeps rule promotion gated", async () => {
    render(<HypothesesWorkspace index={index} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Search hypotheses, evidence or subjects" }), "BNK-1");
    expect(screen.getByRole("button", { name: /Open Pattern review/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Open New hypothesis/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole("textbox", { name: "Search hypotheses, evidence or subjects" }));
    await userEvent.click(screen.getByRole("button", { name: "Proposals" }));
    await userEvent.click(screen.getByRole("button", { name: "Open Rule proposal: Ownership condition" }));
    expect(screen.getByText(/Human review and separate validation are required/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /activate|approve/i })).not.toBeInTheDocument();
  });
  it("honors a source investigation link and never substitutes a different run", () => {
    const another = { ...run, launch: { ...run.launch, run_id: "00000000-0000-4000-8000-000000000021", provider: "mock" as const, corrida_nombre: "Demo estate" } };
    render(<HypothesesWorkspace index={{ ...index, runs: [run, another], entries: [...index.entries, ...ideasFromRun(another)] }} initialRunId={another.launch.run_id} />);
    expect(screen.getByRole("combobox", { name: "Investigation" })).toHaveTextContent("Demo estate");
    expect(screen.getByRole("combobox", { name: "Output source" })).toHaveTextContent("Demo runs");
  });
  it("uses an honest empty state", () => {
    render(<HypothesesWorkspace index={{ entries: [], runs: [], unreadableRuns: 0 }} />);
    expect(screen.getByRole("link", { name: "Start an investigation" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Open New hypothesis/ })).not.toBeInTheDocument();
  });
  it("does not substitute all runs when the linked investigation is unavailable", () => {
    render(<HypothesesWorkspace index={index} initialRunId="00000000-0000-4000-8000-000000000099" />);
    expect(screen.getByRole("status")).toHaveTextContent("This investigation is unavailable");
    expect(screen.queryByRole("button", { name: /^Open Pattern review/ })).not.toBeInTheDocument();
  });
});
