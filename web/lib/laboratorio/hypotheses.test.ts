import { describe, expect, it } from "vitest";
import { ideasFromRun } from "./hypotheses";
import type { LabDetail } from "./types";

export function hypothesisRun(overrides: Partial<LabDetail> = {}): LabDetail {
  return { launch: { run_id: "00000000-0000-4000-8000-000000000011", corrida_id: "00000000-0000-4000-8000-000000000012", corrida_nombre: "Estate seed 105", provider: "codex", data_source: "supabase", giro: "", status: "completed", started_at: "2026-09-13T08:46:07Z" }, summary: null, brief: null, agent_a: null, agent_b: null, compiler: null, proposals: [], notes: [], traces: [], ...overrides };
}

describe("saved investigation outputs", () => {
  it("does not fabricate findings, proposals or approval from an empty run", () => {
    expect(ideasFromRun(hypothesisRun())).toEqual([]);
  });
  it("keeps A reviews separate from B hypotheses and preserves exact citations", () => {
    const entries = ideasFromRun(hypothesisRun({
      agent_a: { reviews: [{ rule_id: "kickback", verdict: "parte", confidence: 0.4, new_lead: { ids: ["EMP:1"], hypothesis: "Trace the sender" }, reasoning_steps: [{ action: "conclude", claim: "Sender ownership is unknown", evidence_ids: ["bank_txns:BNK-1", "bank_txns:BNK-1"] }] }] },
      agent_b: { findings: [{ mechanism_one_liner: "Unlinked transfer", evidence_ids: ["bank_txns:BNK-2"], why_engine_missed: "No matching rule", confidence: 0.6 }] },
    }));
    expect(entries.map(entry => [entry.actor, entry.kind])).toEqual([["A", "review"], ["A", "lead"], ["B", "hypothesis"]]);
    expect(entries[0]).toMatchObject({ status: "parte", summary: "Sender ownership is unknown", confidence: 0.4, evidence: ["bank_txns:BNK-1"] });
    expect(entries[2]).toMatchObject({ status: "hypothesis", evidence: ["bank_txns:BNK-2"] });
    expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
  });
  it("only lists gated proposals, leaves them pending and retains notes when no rule qualifies", () => {
    const entries = ideasFromRun(hypothesisRun({
      proposals: [{ nombre: "Check ownership", status: "approved", predicados: [{ field: "derived.txn_count", operator: "gt", value: 3 }], evidencia_ids: ["bank_txns:BNK-1"] }],
      compiler: { proposals: [{ nombre: "Rejected raw proposal" }], rejected_echoes: ["kickback: Already canonical"] },
      notes: [{ title: "Missing evidence", reason: "No account owner returned", evidence_ids: [] }],
      agent_b: { findings: [], reasoning_steps: [{ action: "conclude", claim: "No findings supported", evidence_ids: [] }], tool_requests: [] },
    }));
    expect(entries.map(e => e.kind)).toEqual(["proposal", "note", "duplicate", "journal"]);
    expect(entries[0].status).toBe("pending_human");
    expect(entries.some(e => e.title === "Rejected raw proposal")).toBe(false);
    expect(entries[3].actor).toBe("B");
  });
});
