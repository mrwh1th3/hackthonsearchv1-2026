"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, Circle, Clock3, FileSearch, FlaskConical, GitBranch, Layers3, LoaderCircle, Play, RefreshCw, Search, ShieldCheck, Sparkles, Workflow, X } from "lucide-react";
import type { JsonObject, LabDetail, LabProvider, LabRun, LabTrace } from "@/lib/laboratorio/types";
import { effectiveStatus, isActive, STATUS_LABEL } from "@/lib/laboratorio/types";
import { RastroDinero } from "@/components/shared/rastro-dinero";
import { AppSelect } from "@/components/shared/app-select";
import { MapaLogico, type FaseMapaLogico } from "@/components/shared/mapa-logico";
import type { AuditorPaso } from "@/lib/data/source";
import type { DeliveryStatus } from "@/lib/laboratorio/entregas";
import styles from "./laboratorio.module.css";

interface Props {
  initialRuns: LabRun[];
  corridas: Array<{ id: string; nombre: string; estado: string; dataset: string }>;
  source: "fixture" | "supabase";
  initialRun?: string;
  initialCorrida?: string;
  dataError?: string;
  embedded?: boolean;
}

const ACTORS: Record<string, string> = { deterministic: "Rule engine", agent_a: "A · Challenge", agent_b: "B · Discovery", a: "A · Challenge", b: "B · Discovery", compiler: "Synthesis", runner: "Workflow", context: "Industry context", context_tool: "Industry context", sector_selector: "Identify industry", "tool:estate_universe": "Dataset scope", "tool:memory_lookup": "Saved methods", "tool:sector_inputs": "Company activity", "tool:context": "Industry research", "tool:evidence_rows": "Evidence lookup", "tool:cfdi_bank_join": "Invoice & payment matching", "tool:graph_paths": "Money trail lookup", "tool:subject_slice": "Entity lookup" };
const STEPS = [
  { key: "context", title: "Context", icon: BookOpen, subtitle: "Understand the industry" },
  { key: "agent_a", title: "Challenge", icon: ShieldCheck, subtitle: "Review flagged activity" },
  { key: "agent_b", title: "Discover", icon: Search, subtitle: "Explore unflagged activity" },
  { key: "compiler", title: "Synthesize", icon: GitBranch, subtitle: "Evidence-backed proposals" },
];
const LABELS: Record<string, string> = {
  subject_name: "Company under review", scheme_type: "Pattern", peso_amount: "Amount (MXN)", narrative: "What happened", rule_broken: "Rule violated", exhibits: "Evidence records", money_trail: "Money movements", reconciliation: "Reconciliation", reconciled_against: "Amount checks", defense: "Alternative explanations", closed_by: "Closed by", tool_calls_made: "Queries performed", investigated_as: "Pattern investigated", signal_detail: "Why it was flagged", signal: "Signal", from: "From", to: "To", amount: "Amount", date: "Date", company_rfc: "Company tax ID", detector_hits: "Signals detected", leads_investigated: "Leads investigated", run_metadata: "Rule-engine metrics", estate_sha256: "Dataset fingerprint", fingerprint: "Run fingerprint", licit_explanation_considered: "Legitimate explanation considered", missing_datum_to_close: "Evidence still needed", compiler_proposal: "Synthesis proposal", exemplar_ids: "Entities reviewed", tag_ids: "Flagged entities", new_lead: "New lead", tool_requests: "Requested queries", claim: "Statement", open_question: "Open question", action: "Action",
  hypothesis: "Hypothesis", hypothesis_name: "Hypothesis", mechanism: "Mechanism", novelty: "What it adds", rationale: "Rationale", reasoning_steps: "Investigation steps", evidence_ids: "Evidence references", evidence: "Evidence", evidence_refs: "Evidence references", legitimate_explanation: "Legitimate explanation", alternative_explanation: "Alternative explanation", disconfirming_test: "Disconfirming test", disconfirmation: "Challenge", verdict: "Conclusion", conclusion: "Conclusion", status: "Status", rule_id: "Source rule", rule_name: "Rule", confidence: "Confidence", missing_data: "Missing data", limitations: "Limitations", title: "Title", name: "Name", subject: "Entity", subjects: "Entities", entity_ids: "Entities", entities: "Entities", source: "Source", sources: "Sources", url: "Link", summary: "Summary", reasoning: "Rationale", why: "Reason", outcome: "Results", finding_id: "Finding", supporting_evidence: "Supporting evidence", contradicting_evidence: "Contradicting evidence", tests: "Checks", predicate: "Testable condition", predicates: "Testable conditions", preconditions: "Preconditions", expected_effect: "Expected effect", normal_operations: "Normal business activity", mechanisms: "Known mechanisms", giro: "Industry", context_status: "Context status", sample_for_a: "A's sample", sample_for_b: "B's sample", zones: "Investigation scope", tagged: "Flagged entities", closed_lead: "Dismissed leads", no_signal: "Unflagged entities", record_id: "Record", source_table: "Source table", exhibit_id: "Reference", note: "Description", notes: "Notes", sample_size: "Sample size", scope: "Scope", counterexamples: "Counterexamples", proposed_rule: "Proposed rule", type: "Type", proposal_type: "Proposal type", risk: "Risk", tags: "Tags", reviewed_at: "Last reviewed", query: "Query", result: "Results", signals: "Signals", checks: "Checks", entity: "Entity", id: "Identifier", rule_description: "Rule description", explanation: "Explanation", observations: "Observations", required_data: "Required data", human_review: "Human review", semantic_novelty: "Mechanism novelty", formalizable: "Ready to formalize", provenance: "Provenance", related_ids: "Connections", transferred_ids: "Transferred IDs", reason: "Reason", reviewed_rule: "Rule reviewed", suggestion: "Proposal", findings: "Findings", reviews: "Challenges", group_size: "Entity/check pairs", exemplars: "Examples", period: "Period", counts: "Counts", canonical_typologies: "Engine patterns", anti_patterns: "Patterns to avoid", playbook_excerpt: "Industry context", run_id: "Investigation", valid: "Valid", validation: "Validation", validation_errors: "Validation issues", created_at: "Created", statement: "Statement", source_url: "Source", case_date: "Case date", fetched_at: "Retrieved", pending_human: "Awaiting human review", coverage: "Scope",
};
const VALUES: Record<string, string> = { pending_human: "Awaiting human review", no_concluyente: "Inconclusive", supported: "Supported", contradicted: "Contradicted", inconclusive: "Insufficient evidence", not_tested: "Not checked", unavailable: "Unavailable", dato_insuficiente: "Insufficient data", sostiene: "Supported", refuta: "Refuted", matiza: "Needs refinement", none: "None", missing: "Pending", cached: "Cached context", ready: "Available", verified: "Verified", completed: "Completed", partial: "With notes", failed: "Interrupted", running: "Running", pending: "Pending", skipped: "Skipped", mock: "Demo", codex: "Codex", retained: "Supported", refuted: "Refuted", refinement: "Rule refinement", new_rule: "New rule", exception: "Exception" };

function human(value: string): string { return VALUES[value] ?? LABELS[value] ?? value.replace(/_/g, " "); }
function number(value: number | undefined): string { return typeof value === "number" ? value.toLocaleString("en-US") : "—"; }
function tokens(value: number | undefined, unknownUsage = false): string { return unknownUsage ? (typeof value === "number" && value > 0 ? `≥ ${number(value)}` : "Unavailable") : number(value); }
function duration(ms: number | undefined): string {
  if (typeof ms !== "number") return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.floor((ms % 60_000) / 1000)} s`;
}
function date(value: string): string { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Mexico_City" }).format(parsed); }
function objects(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }

function JsonDetails({ value, label = "View original record" }: { value: unknown; label?: string }) {
  const [open, setOpen] = useState(false);
  return <details className={styles.raw} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{label}<ChevronDown size={13} /></summary>{open && <pre>{JSON.stringify(value, null, 2)}</pre>}</details>;
}

function RecordDisclosure({ value, index, depth, initialOpen }: { value: unknown; index: number; depth: number; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Record {index + 1}<ChevronDown size={13}/></summary>{open && <Value value={value} depth={depth + 1}/>}</details>;
}

export function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className={styles.muted}>Not recorded</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number") return <span>{number(value)}</span>;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) return <a className={styles.sourceLink} href={value} target="_blank" rel="noopener noreferrer">{value}<ArrowUpRight size={13}/></a>;
    return <span>{human(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className={styles.muted}>No records</span>;
    if (value.every((item) => typeof item === "string" || typeof item === "number")) return <ul className={styles.valueList}>{value.map((item, index) => <li key={index}><Value value={item} depth={depth + 1}/></li>)}</ul>;
    return <div className={styles.nested}>{value.map((item, index) => <RecordDisclosure key={index} value={item} index={index} depth={depth} initialOpen={depth < 1 && value.length <= 3}/>)}</div>;
  }
  return <dl className={styles.fields}>{Object.entries(value as JsonObject).map(([key, item]) => <div key={key}><dt>{human(key)}</dt><dd>{depth > 3 && item && typeof item === "object" ? <JsonDetails value={item}/> : <Value value={item} depth={depth + 1}/>}</dd></div>)}</dl>;
}

function Finding({ item, index, actor }: { item: JsonObject; index: number; actor: "A" | "B" | "P" }) {
  const title = text(item.title) || text(item.hypothesis_name) || text(item.hypothesis) || text(item.rule_id) || text(item.id) || `${actor === "P" ? "Proposal" : "Results"} ${index + 1}`;
  const summary = text(item.conclusion) || text(item.summary) || text(item.rationale) || text(item.reason);
  const status = text(item.status) || text(item.verdict);
  return <details className={styles.finding}>
    <summary><span className={styles.findingIcon}>{actor === "P" ? <GitBranch size={17}/> : actor}</span><span className={styles.findingHeading}><strong>{title}</strong>{summary && <span>{summary}</span>}</span>{status && <span className={styles.pill}>{human(status)}</span>}<ChevronDown size={16}/></summary>
    <div className={styles.findingBody}><Value value={item}/><JsonDetails value={item}/></div>
  </details>;
}

const SCHEMES: Record<string, string> = { phantom_vendor: "Phantom vendor", kickback: "Employee kickback", round_tripping: "Circular payments", threshold_splitting: "Split purchases", revenue_inflation: "Inflated revenue" };
function pesos(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }

function EngineResult({ engine, active, reviews }: { engine: JsonObject | null | undefined; active: boolean; reviews: JsonObject[] }) {
  const [query, setQuery] = useState("");
  const [pattern, setPattern] = useState("");
  const [page, setPage] = useState(0);
  if (!engine) return <section className={styles.panel}><div className={styles.panelTitle}><ShieldCheck size={18}/><h3>Analyzing your data</h3></div><Empty text={active ? "Results appear once records and amounts have been checked." : "No rule-engine result was saved for this run."}/></section>;
  const findings = objects(engine.findings);
  const leads = objects(engine.leads);
  const matches = (item: JsonObject) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase());
  const visibleFindings = findings.filter((item) => matches(item) && (!pattern || item.scheme_type === pattern));
  const visibleLeads = leads.filter(matches);
  const lastPage = Math.max(0, Math.ceil(visibleLeads.length / 10) - 1);
  const currentPage = Math.min(page, lastPage);
  const proven = findings.filter((finding) => finding.confidence === "proven").length;
  const probable = findings.filter((finding) => finding.confidence === "probable").length;
  const reported = findings.reduce((sum, finding) => sum + (typeof finding.peso_amount === "number" ? finding.peso_amount : 0), 0);
  return <>
    <div className={styles.resultIntroduction}><h3>{findings.length ? `${findings.length} finding${findings.length === 1 ? "" : "s"} from the rule engine.` : "No findings passed validation."}</h3><p>{text(engine.company_rfc)}{Array.isArray(engine.period) ? ` · ${engine.period.join(" — ")}` : ""}</p></div>
    <div className={`${styles.metrics} ${styles.resultMetrics}`}><Metric label="Findings" value={number(findings.length)} detail={`${proven} proven · ${probable} probable`}/><Metric label="Flagged amount" value={pesos(reported)} detail="Sum across findings · MXN"/><Metric label="Dismissed leads" value={number(leads.length)} detail="With the reason for each dismissal"/></div>
    <section className={styles.explorer} aria-label="Explore results"><label className={styles.searchBox}><Search size={17}/><input aria-label="Search findings and dismissed leads" placeholder="Search a company, record or amount…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }}/></label><div className={styles.patternGrid}>{Object.entries(SCHEMES).map(([key, label]) => { const count = findings.filter((item) => item.scheme_type === key).length; return <button key={key} type="button" aria-label={`${label} ${count}`} aria-pressed={pattern === key} onClick={() => setPattern(pattern === key ? "" : key)}><span>{label}<strong>{count}</strong></span><i><b style={{width: `${findings.length ? count / findings.length * 100 : 0}%`}}/></i></button>; })}</div>{pattern && <button className={styles.clearFilter} onClick={() => setPattern("")}>Show all patterns ×</button>}</section>
    <section className={styles.panel}><div className={styles.panelTitle}><ShieldCheck size={18}/><h3>Findings & evidence trails</h3><span>{visibleFindings.length} / {findings.length}</span></div>{visibleFindings.length ? visibleFindings.map((finding, index) => {
      const steps: AuditorPaso[] = objects(finding.money_trail).flatMap((step) => typeof step.from === "string" && typeof step.to === "string" && typeof step.amount === "number" && typeof step.date === "string" && typeof step.exhibit_id === "string" ? [{ from: step.from, to: step.to, amount: step.amount, date: step.date, exhibit_id: step.exhibit_id }] : []);
      const confidence = finding.confidence === "proven" ? "Proven" : finding.confidence === "probable" ? "Probable" : "Not rated";
      const review = reviews.find((item) => item.rule_id === finding.scheme_type);
      const verdict = review ? ({ sostiene: "A · pattern supported", parte: "A · pattern needs refinement", tumba: "A · pattern challenged", dato_insuficiente: "A · pattern needs evidence" } as Record<string, string>)[text(review.verdict)] : undefined;
      return <details className={styles.finding} key={index}><summary><span className={styles.findingIcon}>{index + 1}</span><span className={styles.findingHeading}><strong>{text(finding.subject_name) || text(finding.scheme_type) || `Finding ${index + 1}`}</strong><span className={styles.findingClassification}>{SCHEMES[text(finding.scheme_type)] ?? human(text(finding.scheme_type))} · {confidence}</span><span>{Array.isArray(finding.entities) ? finding.entities.join(" · ") : text(finding.subject_id)}</span>{verdict && <span className={styles.pill}>{verdict}</span>}</span><span className={styles.pill}>{typeof finding.peso_amount === "number" ? pesos(finding.peso_amount) : "No amount"} MXN</span><ChevronDown size={16}/></summary><div className={styles.findingBody}>{steps.length > 0 && <div className={styles.moneyTrail}><h4>Follow the money</h4><RastroDinero pasos={steps} etiquetas={{ COMPANY: "Company under review" }}/></div>}<div className={styles.caseExplanation}><h4>What the evidence shows</h4><p>{text(finding.narrative)}</p><p className={styles.muted}>{text(finding.rule_broken)}</p></div><details><summary>Supporting records · {objects(finding.exhibits).length}</summary><Value value={finding.exhibits}/></details><details><summary>Alternative explanations & amount checks</summary><Value value={{defense: finding.defense, reconciliation: finding.reconciliation}}/></details><JsonDetails value={finding}/></div></details>;
    }) : <Empty text="No matching findings. Clear the search or pattern filter to see all results."/>}</section>
    <section className={styles.panel}><div className={styles.panelTitle}><CheckCheck size={18}/><h3>Why these leads were dismissed</h3><span>{visibleLeads.length} / {leads.length}</span></div>{visibleLeads.length ? visibleLeads.slice(currentPage * 10, currentPage * 10 + 10).map((lead, index) => <article key={index} className={styles.declinedLead}><div><strong>{text(lead.entity) || `Lead ${index + 1}`}</strong><span>{text(lead.signal_detail) || human(text(lead.signal))}</span></div><p>{text(lead.reason) || "No specific reason was recorded."}</p><details><summary>Evidence and checks performed<ChevronDown size={13}/></summary><Value value={lead}/></details></article>) : <Empty text="No matching dismissed leads."/>}{visibleLeads.length > 10 && <nav className={styles.pagination} aria-label="Dismissed leads pages"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage * 10 + 1}–{Math.min((currentPage + 1) * 10, visibleLeads.length)} of {visibleLeads.length}</span><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}</section>
    <details className={styles.technicalDisclosure}><summary>Full rule-engine details<ChevronDown size={14}/></summary><div className={styles.padded}><Value value={Object.fromEntries(Object.entries(engine).filter(([key]) => !["findings", "leads", "triage"].includes(key)))}/><JsonDetails value={engine} label="Original rule-engine result"/></div></details>
  </>;
}

function ArtifactDisclosure({ runId, reference, label }: { runId: string; reference: unknown; label: string }) {
  const [data, setData] = useState<unknown>(undefined);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  if (typeof reference !== "string" || !/^(prompts|tools|responses|validated|rejected|engine)\//.test(reference) && !/^(memory_snapshot|sampling)\.json$/.test(reference)) return null;
  async function load() {
    if (loading || data !== undefined) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/laboratorio/${runId}/artefacto?ref=${encodeURIComponent(String(reference))}`, { cache: "no-store" });
      if (!response.ok) throw new Error("This artifact is not available yet.");
      const body = await response.json() as { data: unknown };
      setData(body.data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load this artifact."); }
    finally { setLoading(false); }
  }
  return <details className={styles.artifact} onToggle={(event) => { if (event.currentTarget.open) void load(); }}><summary>{label}<ChevronDown size={14}/></summary><div className={styles.padded}>{loading && <span className={styles.muted}>Loading recorded artifact…</span>}{error && <p role="status" className={styles.muted}>{error}</p>}{data !== undefined && <><Value value={data}/><JsonDetails value={data}/></>}</div></details>;
}

const TRACE_STEPS: Record<string, string> = {"engine.run": "Run rule checks", load: "Load evidence", prepare: "Prepare context", tool: "Look up evidence", sample: "Select review sample", think: "Review evidence", conclude: "Record conclusion", compile: "Synthesize findings", persist: "Save results"};
function traceDescription(trace: LabTrace): string {
  const source = trace.rationale || trace.thought || "Recorded investigation event";
  const legacy: Record<string, string> = {
    "Aplicar el motor al conjunto completo antes de entregar el resultado a A y B.": "Check the dataset before starting the AI review.",
    "Leer snapshot del motor sin alterar sus resultados.": "Read the saved rule-engine result.",
    "Recuperar sujetos sin señal del padrón canónico; no vuelve a ejecutar detectores.": "Identify unflagged entities in the dataset.",
    "Consultar reglas canónicas, excepciones y propuestas previas.": "Retrieve saved rules, exceptions and proposals.",
    "Leer actividades acotadas para orientar la herramienta sectorial.": "Read company activity to identify relevant industry context.",
    "Consulta obligatoria inicial del giro para A y B; separar mecanismos externos de evidencia local.": "Retrieve industry methods for both investigators. External cases are context, not evidence against this company.",
    "Seleccionar grupos de señales y sujetos residuales con límites reproducibles.": "Select pattern groups and unflagged entities for review.",
    "Guardar propuestas pending_human; ninguna regla se activa automáticamente.": "Save proposals for human review. No rules change automatically.",
  };
  if (source.endsWith(": contrastar el recorte recibido y devolver conclusiones citadas conforme al contrato.")) return "Review the supplied evidence and record supported conclusions.";
  return legacy[source] ?? source;
}

export function Trace({ trace, index, runId }: { trace: LabTrace; index: number; runId: string }) {
  const failed = Boolean(trace.error) || trace.status === "failed";
  const running = trace.status === "running";
  return <details className={styles.trace}>
    <summary><span className={`${styles.traceDot} ${failed ? styles.dotError : ""}`}>{failed ? <X size={12}/> : running ? <LoaderCircle size={12} className={styles.spinner}/> : <Check size={12}/>}</span><span className={styles.traceHeading}><span><strong>{TRACE_STEPS[trace.step || trace.action || ""] ?? human(trace.step || trace.action || "Recorded step")}</strong><small>{ACTORS[trace.actor] ?? human(trace.actor)}</small></span><span>{traceDescription(trace)}</span></span><span className={styles.traceTime}>{running ? "Running" : duration(trace.duration_ms)}<small>{trace.ts_start ? date(trace.ts_start) : `Event ${index + 1}`}</small></span><ChevronDown size={14}/></summary>
    <div className={styles.traceBody}>
      <div className={styles.traceMetrics}><span>Input <strong>{tokens(trace.tokens_in, Boolean(trace.usage_unknown || trace.usage_incomplete))} tokens</strong></span><span>Output <strong>{tokens(trace.tokens_out, Boolean(trace.usage_unknown || trace.usage_incomplete))} tokens</strong></span><span>Model <strong>{trace.model || "Deterministic code"}</strong></span></div>
      {trace.evidence_ids && trace.evidence_ids.length > 0 && <div className={styles.evidenceChips}>{trace.evidence_ids.map((id) => <code key={id}>{id}</code>)}</div>}
      {Boolean(trace.error) && <div className={styles.notice} role="status"><Value value={trace.error}/></div>}
      <ArtifactDisclosure runId={runId} reference={trace.input_ref} label="View the input supplied"/>
      <ArtifactDisclosure runId={runId} reference={trace.output_ref} label="View this step's result"/>
      <JsonDetails value={trace} label="References & original event"/>
    </div>
  </details>;
}

/** Same persisted investigation, embedded in the original main workspace. */
export function IntegratedLabRun({ runId, onBack }: { runId: string; onBack?: () => void }) {
  return <>{onBack && <button type="button" onClick={onBack} className={styles.backButton}>← Back to dataset</button>}<Laboratorio key={runId} initialRun={runId} initialRuns={[]} corridas={[]} source="supabase" embedded/></>;
}

export function Laboratorio({ initialRuns, corridas, source, initialRun, initialCorrida, dataError, embedded = false }: Props) {
  const [runs, setRuns] = useState(initialRuns);
  const [selectedId, setSelectedId] = useState(initialRun || initialRuns[0]?.launch.run_id || "");
  const [detail, setDetail] = useState<LabDetail | null>(null);
  const [corridaId, setCorridaId] = useState(corridas.some((run) => run.id === initialCorrida) ? initialCorrida! : corridas[0]?.id ?? "");
  const [giro, setGiro] = useState("");
  const [tab, setTab] = useState<"overview" | "evidence" | "trace" | "proposals">("overview");
  const [error, setError] = useState(dataError ?? "");
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<LabProvider | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [traceFilter, setTraceFilter] = useState("all");
  const [deliveries, setDeliveries] = useState<DeliveryStatus>({ submission: false, expediente: false, motor: false });
  const selectedRun = runs.find((run) => run.launch.run_id === selectedId);
  const current = detail?.launch.run_id === selectedId ? detail : null;
  const run = current ?? selectedRun;
  const active = Boolean(run && isActive(run));
  const summary = current?.summary;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, selectedId]);
  const elapsed = active && run ? Math.max(0, clock - Date.parse(run.launch.started_at)) : run?.launch.total_duration_ms ?? (run?.launch.completed_at ? Date.parse(run.launch.completed_at) - Date.parse(run.launch.started_at) : undefined);
  const usageIncomplete = Boolean(summary?.usage_unknown || summary?.usage_incomplete);
  const trackedInvocations = typeof summary?.llm_calls === "number" ? summary.llm_calls + (summary.sector_research?.calls ?? 0) : undefined;
  const counts = summary?.counts;
  const coverage = summary?.coverage;
  const reviews = objects(current?.agent_a?.reviews);
  const findings = objects(current?.agent_b?.findings);
  const stageList = summary?.stages ?? [];
  const processStages: FaseMapaLogico[] = [
    { id: "engine", label: "Rule engine", status: current?.engine ? "completed" : run?.launch.phase === "engine" ? (effectiveStatus(run) === "failed" ? "failed" : "running") : run?.launch.phase === "agents" ? "completed" : "pending", detail: "Checks, relationships, amounts and evidence. A and B review this same result." },
    ...stageList.map((stage) => ({ ...stage, detail: ({load: "Read the saved rule-engine result and prior methods.", context: "Industry research is supporting context, not local evidence. Source checks and limits are in Evidence & context.", sample: "A reviews selected pattern groups; B reviews a sample of unflagged entities. The reviewed scope is recorded below.", agent_a: `${reviews.length} pattern reviews recorded. Open the AI review to inspect evidence and challenges.`, agent_b: `${findings.length} additional hypotheses recorded. This does not establish an absence of fraud.`, handoff: stage.status === "skipped" ? "No related evidence was transferred." : "Related evidence was transferred between investigators.", compiler: `${current?.proposals.length ?? 0} proposals recorded for human review.`, persist: "Results and activity saved. Human approval remains separate."} as Record<string, string>)[stage.id] ?? stage.detail, label: ({load: "Load evidence", context: "Industry context", sample: "Select review samples", agent_a: "A · Challenge", agent_b: "B · Discovery", handoff: "Connect related evidence", compiler: "Synthesize proposals", persist: "Save for review"} as Record<string, string>)[stage.id] ?? stage.label })),
  ];
  const traces = current?.traces ?? [];
  const filteredTraces = traces.filter((event) => traceFilter === "all" || event.actor === traceFilter);
  const context = current?.brief?.playbook_excerpt;
  const hasDataset = Boolean(corridaId);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh(first = false) {
      if (first) setLoading(true);
      try {
        const response = await fetch(`/api/laboratorio/${selectedId}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "This investigation is not available to your account." : "Could not refresh the investigation.");
        const updated = await response.json() as LabDetail;
        if (controller.signal.aborted) return;
        setDetail(updated);
        setRuns((previous) => [updated, ...previous.filter((item) => item.launch.run_id !== selectedId)].sort((a, b) => b.launch.started_at.localeCompare(a.launch.started_at)));
        if (isActive(updated)) timer = setTimeout(() => void refresh(), 3000);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load the investigation.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void refresh(true);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [selectedId, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setDeliveries({ submission: false, expediente: false, motor: false });
    async function checkFiles() {
      attempts += 1;
      try {
        const response = await fetch(`/api/laboratorio/${selectedId}/entrega?tipo=estado`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const files = await response.json() as DeliveryStatus;
        if (controller.signal.aborted) return;
        setDeliveries({ submission: files.submission === true, expediente: files.expediente === true, motor: files.motor === true });
        if (!files.expediente && attempts < 120) timer = setTimeout(() => void checkFiles(), 5000);
      } catch { /* Report generation may finish after the last agent summary; retry while mounted. */
        if (!controller.signal.aborted && attempts < 120) timer = setTimeout(() => void checkFiles(), 5000);
      }
    }
    void checkFiles();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [selectedId, refreshKey]);

  function selectRun(id: string) {
    setSelectedId(id); setDetail(null); setError("");
    const url = new URL(window.location.href); url.searchParams.set("run", id); window.history.replaceState({}, "", url);
  }

  async function rerun() {
    if (!run || active || starting) return;
    setStarting(run.launch.provider); setError("");
    try {
      const response = await fetch("/api/laboratorio", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corrida_id: run.launch.corrida_id, mensaje: run.launch.mensaje ?? "", ...(run.launch.filtros ? { filtros: run.launch.filtros } : {}), provider: run.launch.provider }) });
      const next = await response.json() as LabRun & { detalle?: string };
      if (!response.ok || !next.launch?.run_id) throw new Error(next.detalle ?? "Could not start a new investigation.");
      setRuns(previous => [next, ...previous]); selectRun(next.launch.run_id); setTab("overview");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not restart the investigation."); }
    finally { setStarting(null); }
  }

  async function start(provider: LabProvider) {
    if (!corridaId || giro.trim().length < 3 || starting) return;
    setStarting(provider); setError("");
    try {
      const response = await fetch("/api/laboratorio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ corrida_id: corridaId, giro: giro.trim(), provider }) });
      const body = await response.json() as LabRun & { detalle?: string; error?: string };
      if (!response.ok) throw new Error(body.detalle || "Could not start the investigation.");
      setRuns((previous) => [body, ...previous]); selectRun(body.launch.run_id); setTab("overview");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not start the investigation."); }
    finally { setStarting(null); }
  }

  function download() {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `forense-bitacora-${selectedId}.json`; link.click(); URL.revokeObjectURL(url);
  }

  return <div className={`${styles.page} ${embedded ? styles.embedded : ""}`}>
    {!embedded && <header className={styles.header}>
      <div><div className={styles.eyebrow}><span className={styles.brandMark}><FlaskConical size={14}/></span> FORENSE LAB <span className={styles.separator}>/</span> ASSISTED INVESTIGATION</div><h1>From signals to evidence.</h1><p>Review signals, discover connections and trace every conclusion.</p></div>
      <span className={`${styles.sourceBadge} ${source === "fixture" ? styles.demoBadge : ""}`}><span/>{source === "fixture" ? "Demo data" : "Connected source · Supabase"}</span>
    </header>}

    {error && <div className={styles.errorBanner} role="alert"><span>{error}</span><button type="button" aria-label="Dismiss notice" onClick={() => setError("")}><X size={16}/></button></div>}

    <div className={`${styles.workspace} ${embedded ? styles.embeddedWorkspace : ""}`}>
      {!embedded && <aside className={styles.sidebar}>
        <section className={styles.setup} aria-labelledby="new-lab-heading">
          <div className={styles.sectionEyebrow}><span>01</span> NEW INVESTIGATION</div><h2 id="new-lab-heading">Start with your data.</h2><p>Review the evidence behind the rule-engine results.</p>
          <form onSubmit={(event) => { event.preventDefault(); void start("codex"); }}>
            <label htmlFor="lab-dataset">Dataset</label><AppSelect id="lab-dataset" aria-label="Dataset" className={styles.datasetSelect} value={corridaId} onValueChange={setCorridaId} disabled={!corridas.length || Boolean(starting)} placeholder="No datasets available" options={corridas.map(corrida => ({ value: corrida.id, label: corrida.nombre }))} />
            <label htmlFor="lab-giro">Company industry</label><input id="lab-giro" value={giro} onChange={(event) => setGiro(event.target.value)} placeholder="E.g. medical supplies distribution" minLength={3} maxLength={120} required autoComplete="off" disabled={Boolean(starting)}/>
            <p className={styles.fieldHelp}>Both investigators consult industry context before reviewing the data.</p>
            <button className={styles.primaryButton} type="submit" disabled={!hasDataset || giro.trim().length < 3 || Boolean(starting) || source === "fixture"}>{starting === "codex" ? <LoaderCircle size={16} className={styles.spinner}/> : <Sparkles size={16}/>}Investigate with Codex<ArrowRight size={16}/></button>
            <span className={styles.providerHint}>Uses the server’s Codex session and allowance.</span>
            <button className={styles.demoButton} type="button" onClick={() => void start("mock")} disabled={!hasDataset || giro.trim().length < 3 || Boolean(starting)}>{starting === "mock" ? <LoaderCircle size={14} className={styles.spinner}/> : <Play size={13}/>}Run demo</button>
          </form>
          <div className={styles.safeNote}><ShieldCheck size={15}/><span>Proposals await human review before rules change.</span></div>
        </section>
        <section className={styles.history} aria-labelledby="history-heading"><div className={styles.historyTitle}><h2 id="history-heading">Investigations</h2><span>{runs.length}</span></div>{runs.length === 0 ? <p className={styles.historyEmpty}>Your investigations and their results will appear here.</p> : <div className={styles.runList}>{runs.map((item) => <button type="button" key={item.launch.run_id} className={`${styles.runItem} ${selectedId === item.launch.run_id ? styles.runSelected : ""}`} onClick={() => selectRun(item.launch.run_id)} aria-pressed={selectedId === item.launch.run_id}><span className={styles.runTop}><strong>{item.launch.giro}</strong>{isActive(item) ? <LoaderCircle className={styles.spinner} size={13}/> : <ArrowUpRight size={13}/>}</span><span>{item.launch.corrida_nombre}</span><span className={styles.runMeta}><span>{item.launch.provider === "mock" ? "Demo · " : ""}{STATUS_LABEL[effectiveStatus(item)]}</span><time dateTime={item.launch.started_at}>{date(item.launch.started_at)}</time></span></button>)}</div>}</section>
      </aside>}

      <section className={styles.main} aria-label="Investigation details" aria-busy={loading}>
        {!run ? embedded ? <div className={styles.empty}><LoaderCircle size={16} className={loading ? styles.spinner : ""}/><p>{error ? "Investigation unavailable. Refresh to try again." : "Loading the investigation and its evidence…"}</p></div> : <>
          <section className={styles.emptyHero}><span className={styles.heroIcon}><Workflow size={34} strokeWidth={1.2}/></span><div className={styles.sectionEyebrow}>EVIDENCE BEFORE CONCLUSIONS</div><h2>One investigation.<br/><span>Every step traceable.</span></h2><p>Follow each query, evidence check and proposal.</p></section>
          <div className={styles.methodCards}>{STEPS.map((step, index) => <article key={step.key}><span className={styles.methodNumber}>0{index + 1}</span><step.icon size={20} strokeWidth={1.5}/><h3>{step.title}</h3><p>{step.subtitle}</p><span className={styles.methodDescription}>{["Known fraud methods and legitimate industry practices.", "A challenges flagged activity and tests alternative explanations.", "B explores a sample of unflagged entities.", "Synthesis turns evidence into proposals for review."][index]}</span></article>)}</div>
          <div className={styles.emptyFooter}><CheckCheck size={17}/><p>Supported dismissals are useful results too.</p></div>
        </> : <>
          <section className={styles.runHeader}>
            <div><div className={styles.sectionEyebrow}>INVESTIGATION <code>{selectedId.slice(0, 8)}</code></div><h2>Investigation</h2><p>{run.launch.corrida_nombre}</p><div className={styles.executionTimes}><span>Started <time dateTime={run.launch.started_at}>{date(run.launch.started_at)}</time></span>{run.launch.completed_at && <span>Finished <time dateTime={run.launch.completed_at}>{date(run.launch.completed_at)}</time></span>}<span>{active ? "Elapsed" : "Duration"} <strong>{duration(elapsed)}</strong></span><small>Mexico City time</small></div></div><div className={styles.runActions}><span className={`${styles.status} ${styles[`status_${effectiveStatus(run) === "partial" ? "completed" : effectiveStatus(run)}`]}`}>{active ? <LoaderCircle size={13} className={styles.spinner}/> : effectiveStatus(run) === "failed" ? <X size={13}/> : <Check size={13}/>} {STATUS_LABEL[effectiveStatus(run)]}</span><button type="button" title="Refresh investigation" aria-label="Refresh investigation" onClick={() => setRefreshKey((key) => key + 1)}><RefreshCw size={15} className={loading ? styles.spinner : ""}/></button>{!active && <button type="button" className={styles.deliverySecondary} onClick={() => void rerun()} disabled={Boolean(starting)} title="Start a new investigation with the same dataset and focus"><RefreshCw size={14}/>{starting ? "Starting…" : "Run again"}</button>}{deliveries.expediente && <a href={`/api/laboratorio/${selectedId}/entrega?tipo=expediente`} target="_blank" rel="noopener noreferrer" className={styles.deliveryPrimary}><FileSearch size={14}/>Full report<ArrowUpRight size={13}/></a>}{deliveries.submission && <a href={`/api/laboratorio/${selectedId}/entrega?tipo=submission`} download className={styles.deliverySecondary}><ArrowDownToLine size={14}/>Judge submission</a>}</div>
          </section>
          {run.launch.provider === "mock" && <div className={styles.demoNotice}><FlaskConical size={16}/><strong>Demo without AI.</strong> Simulated responses to test the workflow. This is not a real AI investigation.</div>}
          {run.launch.error && <div className={styles.notice} role="status">{run.launch.error}</div>}
          <div className={styles.processMap}><MapaLogico mode={active ? "en_curso" : "historico"} senales={[]} fases={processStages} onSeleccionarFase={(id) => { if (id === "engine") setTab("overview"); else if (id === "compiler" || id === "persist") setTab("proposals"); else if (id === "context") setTab("evidence"); else { setTab("trace"); setTraceFilter(id === "agent_a" || id === "agent_b" ? id : "all"); } }}/></div>
          <nav className={styles.tabs} aria-label="Investigation details">{([{ id: "overview", label: "Results", icon: Layers3 }, { id: "evidence", label: "Evidence & context", icon: FileSearch }, { id: "trace", label: "Activity log", icon: Workflow, count: traces.length }, { id: "proposals", label: "Proposals", icon: GitBranch, count: current?.proposals.length ?? 0 }] as const).map((item) => <button type="button" key={item.id} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)} className={tab === item.id ? styles.tabActive : ""}><item.icon size={15}/>{item.label}{"count" in item && <span>{item.count}</span>}</button>)}</nav>

          {tab === "overview" && <div className={styles.content}>
            {(run.launch.mensaje || run.launch.filtros) && <details className={styles.technicalDisclosure}><summary>Context & filters<ChevronDown size={14}/></summary><div className={styles.padded}>{run.launch.mensaje && <p className="whitespace-pre-wrap">{run.launch.mensaje}</p>}{run.launch.filtros && <p>{run.launch.filtros.desde} → {run.launch.filtros.hasta}</p>}</div></details>}
            <EngineResult engine={current?.engine} active={active} reviews={reviews}/>
            <details className={styles.supportingWork}><summary><span>What the AI review found</span><small>{number(counts?.a_reviews)} reviews · {number(counts?.b_findings)} hypotheses · {number(counts?.proposals)} proposals</small><ChevronDown size={15}/></summary><div className={styles.content}>
            <div className={styles.metrics}><Metric label="A's challenges" value={number(counts?.a_reviews)} detail="Review of known signals"/><Metric label="B's hypotheses" value={number(counts?.b_findings)} detail="Not yet validated"/><Metric label="Proposals" value={number(counts?.proposals)} detail="Require human review"/><Metric label={run.launch.total_duration_ms == null ? "AI review time" : "Total time"} value={duration(run.launch.total_duration_ms ?? summary?.total_duration_ms)} detail={active ? "Running" : "Recorded duration"}/></div>
            <div className={styles.overviewGrid}><section className={styles.panel}><div className={styles.panelTitle}><span className={styles.letter}>A</span><div><h3>Challenge known signals</h3><p>Do the flagged findings stand up to scrutiny?</p></div><span>{number(counts?.a_reviews)}</span></div>{reviews.length ? reviews.map((item, index) => <Finding item={item} index={index} actor="A" key={index}/>) : <Empty text={active ? "No recorded challenges yet." : "No recorded challenges."}/>}</section><section className={styles.panel}><div className={styles.panelTitle}><span className={`${styles.letter} ${styles.letterB}`}>B</span><div><h3>Independent discovery</h3><p>What might the rules have missed?</p></div><span>{number(counts?.b_findings)}</span></div>{findings.length ? findings.map((item, index) => <Finding item={item} index={index} actor="B" key={index}/>) : <Empty text={active ? "Discovery is still in progress." : "No additional findings recorded. This does not prove an absence of fraud."}/>}</section></div>
            <section className={styles.panel}><div className={styles.panelTitle}><Layers3 size={18}/><div><h3>Review scope</h3><p>What was reviewed and what remains outside the sample.</p></div></div><div className={styles.coverage}><Coverage label="Pattern groups reviewed by A" done={coverage?.a_groups_sampled} total={coverage?.a_groups_total}/><Coverage label="Entities sampled by B" done={coverage?.residual_sampled} total={coverage?.residual_total}/></div>{coverage?.limitations?.length ? <ul className={styles.limitations}>{coverage.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className={styles.panelHint}>Scope limitations will appear when the review is recorded.</p>}</section>
            <section className={styles.panel}><div className={styles.panelTitle}><Clock3 size={18}/><div><h3>Usage & timing</h3><p>Recorded usage for this run.</p></div></div><div className={styles.consumption}><Metric label={run.launch.provider === "mock" ? "Simulated calls" : "Codex calls"} value={number(trackedInvocations)} detail="AI review and industry context"/><Metric label="Input tokens" value={tokens(summary?.total_tokens_in, usageIncomplete)} detail={usageIncomplete ? "Usage report incomplete" : summary?.tokens_estimated ? "Estimated" : "Recorded by the workflow"}/><Metric label="Output tokens" value={tokens(summary?.total_tokens_out, usageIncomplete)} detail={usageIncomplete ? "Usage report incomplete" : summary?.tokens_estimated ? "Estimated" : "Recorded by the workflow"}/></div><div className={styles.consumptionFooter}><span>{run.launch.provider === "codex" ? "Codex · local session" : "Mock · no AI calls"}</span><span>{run.launch.provider === "mock" ? "No provider usage" : "Codex cost in MXN: unavailable"}</span></div>{summary?.sector_research && <div className={styles.sectorBudget}><BookOpen size={14}/><span>Industry research · separate budget</span><strong>{number(summary.sector_research.calls)} calls · {tokens(summary.sector_research.tokens_in + summary.sector_research.tokens_out, Boolean(summary.sector_research.usage_unknown || summary.sector_research.usage_incomplete))} tokens</strong></div>}{summary?.by_actor && <details className={styles.actorBreakdown}><summary>Usage by participant<ChevronDown size={14}/></summary><Value value={summary.by_actor}/></details>}</section>
            {summary?.errors && summary.errors.length > 0 && <section className={styles.panel}><div className={styles.panelTitle}><X size={18}/><h3>Recorded issues</h3></div><div className={styles.padded}><Value value={summary.errors}/></div></section>}
            <div className={styles.technicalActions}><button type="button" onClick={download} disabled={!current}><ArrowDownToLine size={13}/>Download technical log (.json)</button>{deliveries.motor && <a href={`/api/laboratorio/${selectedId}/entrega?tipo=motor`} target="_blank" rel="noopener noreferrer">Rule-check report<ArrowUpRight size={13}/></a>}</div>
            </div></details>
          </div>}

          {tab === "evidence" && <div className={styles.content}><section className={styles.panel}><div className={styles.panelTitle}><BookOpen size={18}/><div><h3>Industry context</h3><p>Industry cases guide the questions. Dataset evidence supports the conclusions.</p></div><span className={styles.pill}>{coverage?.context_status ? human(coverage.context_status) : "Sin contexto registrado"}</span></div><div className={styles.padded}>{context ? <Value value={context}/> : <Empty text="Industry context appears once researched and saved. Missing sources are not invented."/>}</div></section><section className={styles.panel}><div className={styles.panelTitle}><FileSearch size={18}/><div><h3>Starting point & sample</h3><p>Entities, signals and evidence supplied to the investigators.</p></div><button type="button" className={styles.textButton} onClick={() => setTab("overview")}>View results<ArrowUpRight size={14}/></button></div><div className={styles.padded}>{current?.brief ? <Value value={Object.fromEntries(Object.entries(current.brief).filter(([key]) => key !== "playbook_excerpt"))}/> : <Empty text="The evidence package has not been saved yet."/>}</div></section><section className={styles.panel}><div className={styles.panelTitle}><Layers3 size={18}/><div><h3>Full investigator outputs</h3><p>Explore all recorded fields and original outputs.</p></div></div><div className={styles.padded}><JsonDetails value={current?.agent_a} label="Full output from A"/><JsonDetails value={current?.agent_b} label="Full output from B"/><JsonDetails value={current?.summary} label="Full workflow summary"/></div></section></div>}

          {tab === "trace" && <div className={styles.content}><section className={styles.panel}><div className={styles.panelTitle}><Workflow size={18}/><div><h3>Every step, backed by evidence</h3><p>Recorded actions, evidence and review notes.</p></div>{active && <span className={styles.live}><span/>Updating</span>}</div><div className={styles.traceToolbar}><span>{filteredTraces.length} events</span><label htmlFor="trace-actor">Participant <AppSelect id="trace-actor" aria-label="Participant" size="sm" className={styles.actorSelect} value={traceFilter} onValueChange={setTraceFilter} options={[{ value: "all", label: "All" }, ...Array.from(new Set(traces.map(event => event.actor))).map(actor => ({ value: actor, label: ACTORS[actor] ?? human(actor) }))]} /></label></div><div className={styles.timeline}>{filteredTraces.length ? filteredTraces.map((event, index) => <Trace trace={event} index={index} runId={selectedId} key={`${event.span_id}-${index}`}/>) : <Empty text={active ? "Waiting for the first recorded event." : "No events match this filter."}/>}</div></section></div>}

          {tab === "proposals" && <div className={styles.content}><div className={styles.reviewNotice}><span className={styles.heroIcon}><GitBranch size={23}/></span><div><h3>Aprendizaje que puedes revisar.</h3><p>Proposed changes require validation and human approval before the rules change.</p></div><span className={styles.pill}>Human approval required</span></div><section className={styles.panel}><div className={styles.panelTitle}><GitBranch size={18}/><h3>Propuestas pendientes</h3><span>{current?.proposals.length ?? 0}</span></div>{current?.proposals.length ? current.proposals.map((item, index) => <Finding item={item} index={index} actor="P" key={index}/>) : <Empty text={active ? "No proposals have been recorded yet." : "No testable rule proposals were generated in this run."}/>}</section><section className={styles.panel}><div className={styles.panelTitle}><FileSearch size={18}/><div><h3>Notas y oportunidades abiertas</h3><p>Observations needing more evidence before they can become rules.</p></div></div><div className={styles.padded}>{current?.notes.length ? <Value value={current.notes}/> : <Empty text="Sin notas adicionales registradas."/>}<JsonDetails value={current?.compiler} label="Full synthesis output"/></div></section></div>}
        </>}
      </section>
    </div>
    {!embedded && <footer className={styles.footer}><span><Circle size={7} fill="currentColor"/> RASTRO PERSISTIDO · EVIDENCIA DESGLOSABLE</span><span>AI hypotheses require rule-based validation.</span></footer>}
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Empty({ text: message }: { text: string }) { return <div className={styles.empty}><Circle size={16}/><p>{message}</p></div>; }
function Coverage({ label, done, total }: { label: string; done?: number; total?: number }) { return <div className={styles.coverageItem}><div><span>{label}</span><strong>{number(done)}<small> / {number(total)}</small></strong></div><div className={styles.progressTrack}><div style={{ width: typeof done === "number" && total ? `${Math.min(100, done / total * 100)}%` : "0%" }}/></div><small>{total === 0 ? "No entities in this group" : typeof done === "number" && typeof total === "number" ? `${number(Math.max(0, total - done))} outside the sample` : "Scope not yet recorded"}</small></div>; }
