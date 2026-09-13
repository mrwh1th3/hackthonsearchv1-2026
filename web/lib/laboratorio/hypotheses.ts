import type { JsonObject, LabDetail, LabProvider, LabRun } from "./types";

export type IdeaKind = "review" | "hypothesis" | "lead" | "proposal" | "note" | "duplicate" | "journal";
export type IdeaActor = "A" | "B" | "Compiler";
export interface IdeaStep { action: string; claim: string; evidence: string[]; question: string }
export interface InvestigationIdea {
  id: string; kind: IdeaKind; actor: IdeaActor; title: string; summary: string; status: string;
  runId: string; datasetId: string; dataset: string; date: string; provider: LabProvider;
  rule: string; confidence: number | null; evidence: string[]; subjects: string[]; steps: IdeaStep[];
  alternative: string; missing: string; novelty: string; counterexample: string;
  predicates: JsonObject[]; raw: JsonObject;
}
export interface HypothesesIndex { entries: InvestigationIdea[]; runs: LabRun[]; unreadableRuns: number }

const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const objects = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter(v => v && typeof v === "object" && !Array.isArray(v)) : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const unique = (values: string[]) => [...new Set(values)];

export const RULE_NAMES: Record<string, string> = { phantom_vendor: "Fictitious suppliers", kickback: "Employee kickbacks", round_tripping: "Circular payments", threshold_splitting: "Split purchases", split_purchases: "Split purchases", revenue_inflation: "Inflated revenue" };
export const KIND_NAMES: Record<IdeaKind, string> = { review: "Pattern review", hypothesis: "New hypothesis", lead: "Follow-up lead", proposal: "Rule proposal", note: "Research note", duplicate: "Already covered", journal: "Investigation record" };
export const IDEA_STATUS_NAMES: Record<string, string> = { sostiene: "Supported", parte: "Partly supported", tumba: "Challenged", dato_insuficiente: "Needs evidence", hypothesis: "Untested", pending_human: "Human review needed", note: "Recorded", duplicate: "Already covered", recorded: "Recorded" };

/** A projection of saved artifacts, never an inference that a rule was approved. */
export function ideasFromRun(run: LabDetail): InvestigationIdea[] {
  const entries: InvestigationIdea[] = [];
  function add(kind: IdeaKind, actor: IdeaActor, value: JsonObject, title: string, summary: string, status: string) {
    const steps = objects(value.reasoning_steps).map(step => ({ action: string(step.action), claim: string(step.claim), evidence: strings(step.evidence_ids), question: string(step.open_question) }));
    const confidence = value.confidence ?? value.confianza;
    entries.push({ id: `${run.launch.run_id}:${kind}:${entries.length}`, kind, actor, title, summary, status,
      runId: run.launch.run_id, datasetId: run.launch.corrida_id, dataset: run.launch.corrida_nombre,
      date: run.launch.started_at, provider: run.launch.provider, rule: string(value.rule_id ?? value.sobre_regla),
      confidence: typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null,
      evidence: unique([...strings(value.evidence_ids), ...strings(value.evidencia_ids), ...steps.flatMap(step => step.evidence)]),
      subjects: unique([...strings(value.ids), ...strings(value.tag_ids), ...strings(value.exemplar_ids)]), steps,
      alternative: string(value.licit_explanation_considered), missing: string(value.missing_datum_to_close ?? value.dato_faltante_para_promover),
      novelty: string(value.why_engine_missed ?? value.novelty_summary), counterexample: string(value.contraejemplo_que_la_tumba),
      predicates: objects(value.predicados), raw: value });
  }
  for (const review of objects(run.agent_a?.reviews)) {
    const steps = objects(review.reasoning_steps);
    const conclusion = [...steps].reverse().find(s => s.action === "conclude") ?? steps[0];
    add("review", "A", review, RULE_NAMES[string(review.rule_id)] || string(review.rule_id) || "Pattern review", string(conclusion?.claim) || string(review.licit_explanation_considered), string(review.verdict) || "recorded");
    const lead = object(review.new_lead);
    if (string(lead.hypothesis).trim()) add("lead", "A", { ...lead, rule_id: review.rule_id, missing_datum_to_close: review.missing_datum_to_close, reasoning_steps: review.reasoning_steps }, string(lead.hypothesis), string(review.missing_datum_to_close), "hypothesis");
  }
  for (const finding of objects(run.agent_b?.findings)) add("hypothesis", "B", finding, string(finding.mechanism_one_liner) || string(finding.finding_id) || "New hypothesis", string(finding.why_engine_missed), "hypothesis");
  for (const proposal of run.proposals) add("proposal", "Compiler", proposal, string(proposal.nombre) || "Rule proposal", string(proposal.novelty_summary), "pending_human");
  for (const note of objects(run.notes)) add("note", "Compiler", note, string(note.title) || "Research note", string(note.reason), "note");
  for (const echo of strings(run.compiler?.rejected_echoes)) add("duplicate", "Compiler", { reason: echo }, echo.split(":")[0].slice(0, 120) || "Existing rule", echo, "duplicate");
  for (const [actor, artifact] of [["A", run.agent_a], ["B", run.agent_b]] as const) {
    const steps = objects(artifact?.reasoning_steps);
    const requests = objects(artifact?.tool_requests);
    if (steps.length || requests.length) {
      const conclusion = [...steps].reverse().find(s => s.action === "conclude") ?? steps[0];
      add("journal", actor, { reasoning_steps: steps, tool_requests: requests }, `${actor === "A" ? "Pattern review" : "Residual search"} · investigation record`, string(conclusion?.claim) || "Saved tool requests", "recorded");
    }
  }
  return entries;
}

export function investigationLink(entry: Pick<InvestigationIdea, "datasetId" | "runId">): string {
  return `/?${new URLSearchParams({ corrida: entry.datasetId, run: entry.runId })}`;
}
