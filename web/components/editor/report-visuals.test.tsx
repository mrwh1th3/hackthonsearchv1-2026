import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, it, vi } from "vitest";
import { AmountProof, EvidenceTrail, PatternOverview, ReportSnapshot, RunTiming, TraceabilityPreview } from "./report-visuals";
import type { LabRun } from "@/lib/laboratorio/types";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

it("keeps paths separate and opens the citation belonging to the selected transfer", async () => {
  const onEvidence = vi.fn();
  const finding = { money_trails: [[{ from: "A", to: "B", amount: 10, date: "2026-01-01", exhibit_id: "E1" }], [{ from: "C", to: "D", amount: 20, date: "2026-01-02", exhibit_id: "E2" }]], exhibits: [{ exhibit_id: "E1", record_id: "BANK1" }, { exhibit_id: "E2", record_id: "BANK2" }] };
  render(<EvidenceTrail finding={finding} onEvidence={onEvidence} />);
  expect(screen.queryByText("C")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("combobox", { name: "Payment path" }));
  await userEvent.click(screen.getByRole("option", { name: "Path 2 · 1 movements" }));
  expect(screen.queryByText("A")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open evidence E2 for movement 1" }));
  expect(onEvidence).toHaveBeenCalledWith(finding.exhibits[1]);
});
it("does not invent links between disconnected source movements", () => {
  render(<EvidenceTrail finding={{ money_trail: [{ from: "A", to: "B", amount: 10 }, { from: "C", to: "D", amount: 20 }] }} onEvidence={() => {}} />);
  expect(screen.getByText(/Separate transfer/)).toBeInTheDocument();
});
it("computes arithmetic from saved source records and shows a discrepancy outside tolerance", () => {
  const onReference = vi.fn();
  render(<AmountProof finding={{ peso_amount: 100, reconciliation: { table: "invoices", items: [["I1", 50], ["I2", 40]] } }} onReference={onReference} />);
  expect(screen.getByText("Amount needs review")).toBeInTheDocument();
  expect(screen.getByText(/Difference:/)).toHaveTextContent("-MX$10.00");
  fireEvent.click(screen.getByRole("button", { name: "I2" }));
  expect(onReference).toHaveBeenCalledWith("invoices:I2");
});
it("confidence graphic preserves unknown ratings and warns that exposures may overlap", () => {
  render(<ReportSnapshot findings={[{ peso_amount: .1, confidence: "proven" }, { peso_amount: .2, confidence: "other" }]} onFindings={() => {}} />);
  expect(screen.getByRole("img")).toHaveAccessibleName("1 proven, 0 probable, 1 unrated findings");
  expect(screen.getByText("MX$0.30")).toBeInTheDocument();
  expect(screen.getByText(/Amounts can overlap/)).toBeInTheDocument();
  expect(within(screen.getByRole("img")).getByText("2")).toBeInTheDocument();
});

it("keeps closed leads and AI hypotheses separate and opens their own review views",()=>{
  const onDismissed=vi.fn(),onReview=vi.fn();
  render(<ReportSnapshot findings={[{peso_amount:100,confidence:"proven"}]} onFindings={()=>{}} closedCount={4} hypothesesCount={2} onDismissed={onDismissed} onReview={onReview}/>);
  const dismissed=screen.getByRole("button",{name:/4\s*Leads investigated & closed/});
  const hypotheses=screen.getByRole("button",{name:/2\s*Additional AI hypotheses/});
  fireEvent.click(dismissed);fireEvent.click(hypotheses);
  expect(onDismissed).toHaveBeenCalledOnce();expect(onReview).toHaveBeenCalledOnce();
  expect(screen.getByRole("img")).toHaveAccessibleName("1 proven, 0 probable findings");
});

it("does not present missing finding amounts as zero exposure",()=>{
  render(<ReportSnapshot findings={[{confidence:"proven"}]} onFindings={()=>{}}/>);
  expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  expect(screen.queryByText("MX$0.00")).not.toBeInTheDocument();
});

it("uses whole-run elapsed time and makes missing timestamps explicit",()=>{
  const run={launch:{status:"completed",started_at:"2026-09-13T10:00:00Z",total_duration_ms:120500,timing_scope:"through_report"},summary:{total_duration_ms:10}} as LabRun;
  render(<RunTiming run={run}/>);
  expect(screen.getByLabelText("Whole-investigation timing")).toHaveTextContent("2m 00s");
  expect(screen.getByLabelText("Whole-investigation timing")).toHaveTextContent("120.500 wall-clock seconds");
  expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  expect(screen.getByText("Whole workflow · including report preparation")).toBeInTheDocument();
});

it("opens the underlying pattern rather than conflating counts with confidence",()=>{
  const onPattern=vi.fn();
  render(<PatternOverview findings={[{scheme_type:"round_tripping"},{scheme_type:"round_tripping"},{scheme_type:"new_pattern"}]} onPattern={onPattern}/>);
  fireEvent.click(screen.getByRole("button",{name:"Circular payments: 2 findings"}));
  expect(onPattern).toHaveBeenCalledWith("round_tripping");
  expect(screen.getByRole("button",{name:"new pattern: 1 findings"})).toBeInTheDocument();
});

it("traceability preview opens a saved source record and preserves unique citation count",()=>{
  const onEvidence=vi.fn(),onFinding=vi.fn();
  const first={source_table:"bank_txns",record_id:"B1",exhibit_id:"E1"};
  render(<TraceabilityPreview finding={{subject_name:"Vendor One",exhibits:[first,{...first,exhibit_id:"E2"}]}} index={0} onEvidence={onEvidence} onFinding={onFinding}/>);
  fireEvent.click(screen.getByRole("button",{name:/1 cited records/}));
  expect(onEvidence).toHaveBeenCalledWith(first);
  fireEvent.click(screen.getByRole("button",{name:/Read the finding/}));
  expect(onFinding).toHaveBeenCalledOnce();
});
