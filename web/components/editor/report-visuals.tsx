"use client";

import { AppSelect } from "@/components/shared/app-select";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, Check, CircleHelp, Clock3, FileCheck2, Landmark, RotateCcw } from "lucide-react";
import { effectiveStatus, type JsonObject, type LabDetail, type LabRun } from "@/lib/laboratorio/types";
import { formatRunDuration, runTiming, timingBreakdown } from "@/lib/laboratorio/report-metrics";
import s from "./report-visuals.module.css";

export const objects = (v: unknown): JsonObject[] => Array.isArray(v) ? v.filter((x): x is JsonObject => !!x && typeof x === "object" && !Array.isArray(x)) : [];
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : 0;
const label = (v: unknown) => typeof v === "string" ? v : "";
export const pesos = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(v);
export const sumPesos = (values: unknown[]) => values.reduce<number>((total, value) => total + Math.round(number(value) * 100), 0) / 100;
export const PATTERN_LABELS: Record<string, string> = { phantom_vendor: "Phantom vendors", kickback: "Employee kickbacks", round_tripping: "Circular payments", threshold_splitting: "Split purchases", revenue_inflation: "Inflated revenue" };
const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Mexico_City" });

/** The same whole-investigation clock is used by the report and investigation history. */
export function RunTiming({ run, compact = false, nowMs }: { run: LabRun; compact?: boolean; nowMs?: number }) {
  const [clock, setClock] = useState(Date.now);
  const timing = runTiming(run, nowMs ?? clock);
  useEffect(() => {
    if (!timing.active || nowMs !== undefined) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [timing.active, nowMs]);
  const duration = formatRunDuration(timing.elapsedMs);
  const stages = timingBreakdown(run, nowMs ?? clock);
  const precise = (ms: number | null) => ms === null ? "Not recorded" : `${(ms / 1000).toLocaleString("en-US", {maximumFractionDigits: 3})}s`;
  if (compact) return <span className={s.timingCompact} title={timing.includesReport ? "Whole investigation, through report preparation" : "Saved investigation duration; older runs may exclude report preparation"}>
    <Clock3 size={12} aria-hidden="true"/><span>{timing.active ? "Elapsed" : "Investigation time"}</span><strong>{duration}</strong>
  </span>;
  return <div className={s.timing} aria-label="Whole-investigation timing">
    <div className={s.timingMain}>
      <span className={s.timingLabel}><Clock3 size={14} aria-hidden="true"/>{timing.active ? "Investigation elapsed" : "Total · engine + AI"}</span>
      <strong>{duration}</strong>
      <small>{timing.elapsedMs === null ? "No valid whole-run measurement saved" : `${(timing.elapsedMs / 1_000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} wall-clock seconds`}</small>
    </div>
    <dl className={s.timingDates}>
      <div><dt>Started</dt><dd>{timing.startedAt ? <time dateTime={timing.startedAt}>{dateTime.format(new Date(timing.startedAt))}</time> : "Not recorded"}</dd></div>
      <div><dt>{timing.active ? "Status" : "Finished"}</dt><dd>{timing.active ? "In progress" : timing.completedAt ? <time dateTime={timing.completedAt}>{dateTime.format(new Date(timing.completedAt))}</time> : "Not recorded"}</dd></div>
      <small>Mexico City time</small>
    </dl>
    <div className={s.timingStages} aria-label="Execution time breakdown"><div><small>Rule engine</small><strong>{precise(stages.engineMs)}</strong></div><span>+</span><div><small>{run.launch.provider === "mock" ? "AI · simulated" : "AI workflow"}</small><strong>{precise(stages.aiMs)}</strong></div>{stages.otherMs !== null && <><span>+</span><div><small>Other workflow time</small><strong>{precise(stages.otherMs)}</strong></div></>}</div>
    <details className={s.timingScope}><summary>{timing.includesReport ? "Whole workflow · including report preparation" : "What this duration includes"}</summary><p>{timing.includesReport ? "Source data, rule checks, industry context, A/B review, compilation and report preparation." : "The saved investigation duration, measured across the workflow. Older runs may exclude report preparation."} The total includes the engine and AI workflow. Parallel A/B reviews count once in elapsed time. Other workflow time is the difference between the saved total and these stages, including orchestration and report preparation when measured.</p></details>
  </div>;
}

export function ReportSnapshot({ findings, onFindings, closedCount, hypothesesCount, onDismissed, onReview, available = true }: { findings: JsonObject[]; onFindings: () => void; closedCount?: number | null; hypothesesCount?: number | null; onDismissed?: () => void; onReview?: () => void; available?: boolean }) {
  const proven = findings.filter(f => f.confidence === "proven").length;
  const probable = findings.filter(f => f.confidence === "probable").length;
  const other = findings.length - proven - probable;
  const share = findings.length ? proven / findings.length : 0;
  const completeAmounts = findings.every(f => typeof f.peso_amount === "number" && Number.isFinite(f.peso_amount) && f.peso_amount >= 0);
  const total = available && completeAmounts ? sumPesos(findings.map(f => f.peso_amount)) : null;
  return <div className={s.snapshot}>
    <div className={s.exposure}><span className={s.eyebrow}>TOTAL EXPOSURE · SUM BY FINDING</span><strong>{total === null ? "Not recorded" : pesos(total)}</strong><p>Amounts can overlap across findings. This is not a deduplicated loss estimate.</p><button onClick={onFindings}>Explore the findings <ArrowRight size={13} /></button></div>
    <div className={s.confidence}>
      <svg viewBox="0 0 110 110" role="img" aria-label={available ? `${proven} proven, ${probable} probable${other ? `, ${other} unrated` : ""} findings` : "Finding confidence not available"}>
        <circle cx="55" cy="55" r="43" fill="none" stroke="#edf0e9" strokeWidth="9" />
        <circle cx="55" cy="55" r="43" fill="none" stroke="#c5ad7c" strokeWidth="9" pathLength="100" strokeDasharray={`${findings.length ? (proven + probable) / findings.length * 100 : 0} 100`} transform="rotate(-90 55 55)" />
        <circle cx="55" cy="55" r="43" fill="none" stroke="#66866f" strokeWidth="9" pathLength="100" strokeDasharray={`${share * 100} 100`} transform="rotate(-90 55 55)" className={s.ring} />
        <text x="55" y="55" dominantBaseline="central" textAnchor="middle" fontSize="26" fill="#34493a">{available ? findings.length : "—"}</text><text x="55" y="74" textAnchor="middle" fontSize="8" fill="#797f73">FINDINGS</text>
      </svg>
      <div>{available ? <><span><i />{proven} proven</span><span><i />{probable} probable</span>{other > 0 && <span>{other} unrated</span>}</> : <span>Results not saved yet</span>}<small>Rule-engine confidence</small></div>
    </div>
    {(onDismissed || onReview) && <div className={s.outcomes}>
      <button onClick={onDismissed} disabled={!onDismissed}><span className={s.outcomeNumber}>{closedCount ?? "—"}</span><span><strong>Leads investigated & closed</strong><small>Evidence supported closing the lead</small></span><ArrowRight size={14} aria-hidden="true"/></button>
      <button onClick={onReview} disabled={!onReview}><span className={s.outcomeNumber}>{hypothesesCount ?? "—"}</span><span><strong>Additional AI hypotheses</strong><small>Require review · separate from findings</small></span><ArrowRight size={14} aria-hidden="true"/></button>
    </div>}
  </div>;
}

export function InvestigationJourney({ run, delivered, onNavigate }: { run: LabDetail; delivered: boolean; onNavigate?: (section: "findings" | "review" | "activity" | "method") => void }) {
  const status = (id: string) => run.summary?.stages?.find(stage => stage.id === id)?.status;
  const aiDone = status("agent_a") === "completed" && status("agent_b") === "completed";
  const terminal = !["queued", "running"].includes(effectiveStatus(run));
  const context = run.summary?.coverage?.context_status;
  const steps = [
    { title: "Rule checks", detail: run.engine ? `${objects(run.engine.findings).length} findings` : "Waiting for results", done: !!run.engine, section: "findings" },
    { title: "Context", detail: context === "ready" || context === "verified" ? "Sources saved" : context === "partial" ? "Limited context" : context === "pending" ? "Research pending" : "Not recorded", done: status("context") === "completed" && (context === "ready" || context === "verified"), section: "method" },
    { title: "A/B review", detail: aiDone ? "Saved review" : run.launch.status === "failed" ? "Interrupted" : terminal ? "Review incomplete" : "Awaiting completion", done: aiDone, section: "review" },
    { title: "Compiler", detail: status("compiler") === "completed" ? "Decisions saved" : terminal ? "Not completed" : "Awaiting review", done: status("compiler") === "completed", section: "review" },
    { title: "Report", detail: delivered ? "Saved report" : terminal ? "Not available" : "Preparing", done: delivered, section: "activity" },
  ] as const;
  return <ol className={s.journey} aria-label="Investigation flow">{steps.map((step, index) => <li key={step.title} data-done={step.done}>
    <button onClick={() => onNavigate?.(step.section)} disabled={!onNavigate} aria-label={`${step.title}: ${step.detail}`}><span className={s.stepNumber}>{step.done ? <Check size={13} aria-hidden="true"/> : index + 1}</span><strong>{step.title}</strong><small>{step.detail}</small></button>{index < steps.length - 1 && <ArrowRight className={s.stepArrow} size={14} aria-hidden="true"/>}
  </li>)}</ol>;
}

export function PatternOverview({ findings, onPattern }: { findings: JsonObject[]; onPattern: (pattern: string) => void }) {
  const grouped = new Map<string, number>();
  findings.forEach(finding => { const key = label(finding.scheme_type) || "unclassified"; grouped.set(key, (grouped.get(key) ?? 0) + 1); });
  const ranked = [...grouped].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!ranked.length) return <p className={s.emptyPreview}>No finding patterns have been recorded.</p>;
  return <div className={s.patternChart} aria-label="Findings by pattern">{ranked.map(([key, count]) => <button key={key} onClick={() => onPattern(key)} aria-label={`${PATTERN_LABELS[key] || key.replaceAll("_", " ")}: ${count} findings`}>
    <span>{PATTERN_LABELS[key] || key.replaceAll("_", " ")}</span><div aria-hidden="true"><i style={{ width: `${count / ranked[0][1] * 100}%` }}/></div><strong>{count}</strong><ArrowRight size={13} aria-hidden="true"/>
  </button>)}</div>;
}

export function TraceabilityPreview({ finding, index, onFinding, onEvidence }: { finding: JsonObject; index: number; onFinding: () => void; onEvidence: (exhibit: JsonObject) => void }) {
  const exhibits = objects(finding.exhibits);
  const uniqueReferences = new Set(exhibits.filter(exhibit => label(exhibit.source_table) && label(exhibit.record_id)).map(exhibit => `${exhibit.source_table}:${exhibit.record_id}`));
  const path = Array.isArray(finding.money_trails) && finding.money_trails.length ? objects(finding.money_trails[0]) : objects(finding.money_trail);
  const first = exhibits.find(exhibit => label(exhibit.source_table) && label(exhibit.record_id));
  return <div className={s.tracePreview}>
    <button className={s.traceSubject} onClick={onFinding}><span className={s.traceIndex}>{String(index + 1).padStart(2, "0")}</span><span><strong>{label(finding.subject_name) || "Entity under review"}</strong><small>{PATTERN_LABELS[label(finding.scheme_type)] || label(finding.scheme_type)} · {typeof finding.peso_amount === "number" && Number.isFinite(finding.peso_amount) ? pesos(finding.peso_amount) : "Amount not recorded"}</small></span><ArrowRight size={15} aria-hidden="true"/></button>
    <div className={s.traceRoute} aria-label="Finding traceability">
      <button onClick={onFinding}><Landmark size={15} aria-hidden="true"/><strong>{path.length ? `${path.length} saved movements` : "Read the finding"}</strong><small>{path.length ? "Follow the money trail" : "No money trail saved"}</small></button>
      <ArrowRight size={15} aria-hidden="true"/>
      <button onClick={() => first && onEvidence(first)} disabled={!first}><FileCheck2 size={15} aria-hidden="true"/><strong>{uniqueReferences.size} cited records</strong><small>{first ? `${first.source_table} · ${first.record_id}` : "No references saved"}</small></button>
    </div>
    <p>Trace this finding to its saved movements and source records.</p>
  </div>;
}

type Movement = { from: string; to: string; amount: number; date: string; exhibit_id: string };
const movements = (v: unknown): Movement[] => objects(v).filter(p => typeof p.from === "string" && typeof p.to === "string" && typeof p.amount === "number") as Movement[];

/** A sequence of saved transfers, never an inferred link. Each arrow has its own citation. */
export function EvidenceTrail({ finding, onEvidence, names = {} }: { finding: JsonObject; onEvidence: (exhibit: JsonObject) => void; names?: Record<string, string> }) {
  const primary = movements(finding.money_trail);
  const paths = Array.isArray(finding.money_trails) ? finding.money_trails.map(movements).filter(p => p.length) : [];
  const choices = paths.length ? paths : [primary];
  const [pathIndex, setPathIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const steps = choices[pathIndex] ?? primary;
  const shown = expanded ? steps : steps.slice(0, 8);
  const name = (id: string) => id === "COMPANY" ? "Company under review" : names[id] || id;
  const circular = steps.length > 1 && steps[0].from === steps[steps.length - 1].to;
  if (!steps.length) return <p>No money trail was saved for this finding.</p>;
  return <div className={s.trail}>
    <div className={s.trailHeader}><span>{circular ? <RotateCcw size={14} /> : <Landmark size={14} />}{circular ? "Money returns to its source" : "A recorded payment path"}</span><small>{steps.length} movements</small></div>
    {choices.length > 1 && <div className={s.pathSelect}><span>Payment path</span><AppSelect aria-label="Payment path" size="sm" value={String(pathIndex)} onValueChange={value => { setPathIndex(Number(value)); setExpanded(false); }} options={choices.map((p, i) => ({ value: String(i), label: `Path ${i + 1} · ${p.length} movements` }))} /></div>}
    <ol className={s.movements} aria-label="Money movements">{shown.map((step, i) => {
      const exhibit = objects(finding.exhibits).find(e => e.exhibit_id === step.exhibit_id);
      const connected = i === 0 || steps[i - 1].to === step.from;
      return <li key={`${i}-${step.exhibit_id}`}><span className={s.movementNumber}>{String(i + 1).padStart(2, "0")}</span><div className={s.movementBody}>
        {!connected && <p className={s.break}>Separate transfer · no connecting movement recorded</p>}
        <div className={s.entity}><span className={s.entityIcon}><Landmark size={13} /></span><span>{name(step.from)}<small>Sender{names[step.from] ? ` · ${step.from}` : ""}</small></span></div>
        <div className={s.transfer}><div className={s.transferLine}><ArrowDown size={15} /></div><div><strong>{pesos(step.amount)}</strong><small>{step.date}</small></div><button disabled={!exhibit} onClick={() => exhibit && onEvidence(exhibit)} aria-label={`Open evidence ${step.exhibit_id} for movement ${i + 1}`}><FileCheck2 size={12} />{step.exhibit_id}<ArrowRight size={11} /></button></div>
        <div className={s.entity}><span className={`${s.entityIcon} ${step.to === "COMPANY" ? s.returned : ""}`}><Landmark size={13} /></span><span>{name(step.to)}<small>{step.to === "COMPANY" && circular ? "Returned to company" : "Recipient"}{names[step.to] ? ` · ${step.to}` : ""}</small></span></div>
      </div></li>;
    })}</ol>
    {steps.length > 8 && <button className={s.expand} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer movements" : `Show all ${steps.length} movements`}</button>}
  </div>;
}

export function AmountProof({ finding, onReference }: { finding: JsonObject; onReference: (ref: string) => void }) {
  const proof = finding.reconciliation as JsonObject | undefined;
  const table = label(proof?.table);
  const items: Array<[string, number]> = Array.isArray(proof?.items) ? proof.items.filter((i): i is [string, number] => Array.isArray(i) && i.length === 2 && typeof i[0] === "string" && typeof i[1] === "number") : [];
  const [all, setAll] = useState(false);
  if (!items.length) return <p>No saved arithmetic is available for this finding.</p>;
  const sum = sumPesos(items.map(i => i[1]));
  const claimed = number(finding.peso_amount);
  const difference = Math.round((sum - claimed) * 100) / 100;
  const reconciles = claimed > 0 && Math.abs(difference) / claimed <= .02;
  return <div className={s.proof}>
    <div className={s.proofTitle}><span>{reconciles ? <Check size={14} /> : <CircleHelp size={14} />}{reconciles ? "Amount reconciles" : "Amount needs review"}</span><small>{table} · {items.length} records</small></div>
    <p className={s.proofCaption}>One source table at a time. An invoice and its payment represent the same money.</p>
    {(all ? items : items.slice(0, 5)).map(([id, value], i) => <div className={s.proofRow} key={`${id}-${i}`}><button onClick={() => onReference(`${table}:${id}`)}>{id}<ArrowRight size={10} /></button><span>{pesos(value)}</span></div>)}
    {items.length > 5 && <button className={s.expand} onClick={() => setAll(!all)}>{all ? "Show fewer records" : `Show all ${items.length} records`}</button>}
    <div className={s.proofTotal}><div><small>Sum of all cited records</small><strong>{pesos(sum)}</strong></div><span>{difference === 0 ? "=" : reconciles ? "≈" : "≠"}</span><div><small>Claimed amount</small><strong>{pesos(claimed)}</strong></div></div>
    <p className={s.proofCaption}>Difference: {pesos(difference)} · allowed tolerance: 2%.</p>
  </div>;
}

export function ReviewScope({ run }: { run: LabDetail }) {
  const coverage = run.summary?.coverage;
  return <div className={s.scope}>{[
    { letter: "A", title: "Challenge the signals", count: coverage?.a_groups_sampled, total: coverage?.a_groups_total, unit: "pattern groups" },
    { letter: "B", title: "Explore other leads", count: coverage?.residual_sampled, total: coverage?.residual_total, unit: "eligible entities" },
  ].map(item => <div key={item.letter}><div className={s.scopeTitle}><b>{item.letter}</b><strong>{item.title}</strong></div><div className={s.scopeBar}><span style={{ width: `${item.total ? Math.min(100, (item.count ?? 0) / item.total * 100) : 0}%` }} /></div><p><strong>{item.count ?? "—"}</strong> / {item.total?.toLocaleString("en-US") ?? "—"} {item.unit} sampled</p></div>)}</div>;
}
