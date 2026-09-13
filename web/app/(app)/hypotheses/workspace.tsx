"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, FileText, Fingerprint, FlaskConical, GitBranch, Lightbulb, RefreshCw, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { AppSelect } from "@/components/shared/app-select";
import { IDEA_STATUS_NAMES, KIND_NAMES, RULE_NAMES, investigationLink, type HypothesesIndex, type InvestigationIdea, type IdeaKind } from "@/lib/laboratorio/hypotheses";
import { isActive } from "@/lib/laboratorio/types";
import styles from "./workspace.module.css";

type View = "all" | "reviews" | "hypotheses" | "proposals" | "notes";
const VIEWS: Array<{ id: View; label: string; kinds?: IdeaKind[] }> = [
  { id: "all", label: "All outputs" }, { id: "reviews", label: "A · Reviews", kinds: ["review"] },
  { id: "hypotheses", label: "B · Hypotheses", kinds: ["hypothesis"] }, { id: "proposals", label: "Proposals", kinds: ["proposal"] },
  { id: "notes", label: "Notes & leads", kinds: ["note", "duplicate", "journal", "lead"] },
];
const PAGE_SIZE = 12;
const dateLabel = (date: string) => { const parsed = new Date(date); return Number.isNaN(parsed.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Mexico_City" }).format(parsed); };

export function HypothesesWorkspace({ index, initialRunId }: { index: HypothesesIndex; initialRunId?: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const initialRun = index.runs.find(run => run.launch.run_id === initialRunId);
  const [provider, setProvider] = useState(initialRun?.launch.provider ?? (index.runs.some(run => run.launch.provider === "codex") ? "codex" : "all"));
  const [runId, setRunId] = useState(initialRunId ?? "all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scoped = useMemo(() => index.entries.filter(item => (provider === "all" || item.provider === provider) && (runId === "all" || item.runId === runId)), [index.entries, provider, runId]);
  const matching = useMemo(() => {
    const kinds = VIEWS.find(v => v.id === view)?.kinds;
    const search = query.trim().toLocaleLowerCase();
    return scoped.filter(item => (!kinds || kinds.includes(item.kind)) && (!search || [item.title, item.summary, item.dataset, item.rule, RULE_NAMES[item.rule], item.actor, item.status, IDEA_STATUS_NAMES[item.status], KIND_NAMES[item.kind], ...item.evidence, ...item.subjects].join(" ").toLocaleLowerCase().includes(search)));
  }, [scoped, view, query]);
  const scopedRuns = index.runs.filter(run => (provider === "all" || run.launch.provider === provider) && (runId === "all" || run.launch.run_id === runId));
  const hasActiveRuns = scopedRuns.some(isActive);
  const missingRun = runId !== "all" && !index.runs.some(run => run.launch.run_id === runId);
  useEffect(() => {
    if (!hasActiveRuns) return;
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [hasActiveRuns, router]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matching.length / PAGE_SIZE) - 1));
  const visible = matching.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selected = matching.find(item => item.id === selectedId) ?? null;
  const counts = { reviews: scoped.filter(item => item.kind === "review").length, hypotheses: scoped.filter(item => item.kind === "hypothesis").length, proposals: scoped.filter(item => item.kind === "proposal").length };
  function chooseView(value: View) { setView(value); setPage(0); setSelectedId(null); }
  function clearFilters() { setQuery(""); setView("all"); setRunId("all"); setProvider("all"); setPage(0); setSelectedId(null); }

  return <main className={styles.workspace}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}><GitBranch size={14} aria-hidden /> Investigation intelligence</div><h1>Hypotheses</h1><p>Ideas that improve the rules.</p></div>
      <button className={styles.refresh} onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} aria-label="Refresh saved outputs"><RefreshCw size={15} className={refreshing ? styles.spinning : ""} aria-hidden />{refreshing ? "Refreshing" : "Refresh"}</button>
    </header>

    <section className={styles.flow} aria-label="How investigation ideas improve the rules">
      <button className={styles.flowNode} onClick={() => chooseView("reviews")}><span className={styles.actorA}>A</span><div><strong>{counts.reviews}<span>Pattern reviews</span></strong><small>Challenge existing signals</small></div></button>
      <button className={styles.flowNode} onClick={() => chooseView("hypotheses")}><span className={styles.actorB}>B</span><div><strong>{counts.hypotheses}<span>New hypotheses</span></strong><small>Explore the remaining data</small></div></button>
      <span className={styles.flowArrow} aria-hidden><ArrowRight size={20} /></span>
      <button className={`${styles.flowNode} ${styles.proposalNode}`} onClick={() => chooseView("proposals")}><span className={styles.compilerIcon}><SlidersHorizontal size={20} aria-hidden /></span><div><strong>{counts.proposals}<span>Rule proposals</span></strong><small>Saved for human review</small></div></button>
      <span className={styles.flowArrow} aria-hidden><ArrowRight size={20} /></span>
      <div className={styles.humanNode}><ShieldCheck size={23} aria-hidden /><div><strong>Review & test</strong><small>Before any rule changes</small></div></div>
    </section>

    <div className={styles.scopeBar}>
      <div className={styles.scopeMeta}><span className={styles.scopeDot} aria-hidden />{scopedRuns.length} saved {scopedRuns.length === 1 ? "investigation" : "investigations"}<span>·</span>{scoped.length} outputs{hasActiveRuns && <span className={styles.activeLabel}>Research in progress</span>}</div>
      <div className={styles.selects}>
        <AppSelect aria-label="Output source" size="sm" className={styles.scopeSelect} value={provider} onValueChange={value => { setProvider(value); setRunId("all"); setPage(0); setSelectedId(null); }} options={[{ value: "all", label: "All sources" }, { value: "codex", label: "Codex runs" }, { value: "mock", label: "Demo runs" }]} />
        <AppSelect aria-label="Investigation" size="sm" className={styles.scopeSelect} value={runId} onValueChange={value => { setRunId(value); setPage(0); setSelectedId(null); }} options={[{ value: "all", label: "All investigations" }, ...(missingRun ? [{ value: runId, label: "Investigation unavailable" }] : []), ...index.runs.filter(run => provider === "all" || run.launch.provider === provider).map(run => ({ value: run.launch.run_id, label: `${run.launch.corrida_nombre} · ${dateLabel(run.launch.started_at)} · ${run.launch.run_id.slice(0, 6)}` }))]} />
      </div>
    </div>
    {index.unreadableRuns > 0 && <p role="status" className={styles.warning}>{index.unreadableRuns} saved investigations could not be read. Refresh to try again.</p>}
    {missingRun && <p role="status" className={styles.warning}>This investigation is unavailable in this workspace. Choose another saved investigation.</p>}

    <section className={styles.board} aria-label="Improvement matrix">
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="group" aria-label="Output type">{VIEWS.map(item => <button key={item.id} aria-pressed={view === item.id} onClick={() => chooseView(item.id)}>{item.label}</button>)}</div>
        <label className={styles.search}><Search size={16} aria-hidden /><input aria-label="Search hypotheses, evidence or subjects" placeholder="Search ideas, evidence…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); setSelectedId(null); }} /></label>
      </div>
      <div className={`${styles.content} ${selected ? styles.hasSelection : ""}`}>
        <div className={styles.listPane}>
          <div className={styles.listHeading}><span>{matching.length} {matching.length === 1 ? "output" : "outputs"}</span><span>Newest investigation first</span></div>
          {visible.map(item => <button key={item.id} className={`${styles.ideaRow} ${selected?.id === item.id ? styles.selectedRow : ""}`} onClick={() => setSelectedId(item.id)} aria-pressed={selected?.id === item.id} aria-label={`Open ${KIND_NAMES[item.kind]}: ${item.title}`}>
            <span className={item.actor === "A" ? styles.smallA : item.actor === "B" ? styles.smallB : styles.smallCompiler}>{item.actor === "Compiler" ? <SlidersHorizontal size={15} aria-hidden /> : item.actor}</span>
            <span className={styles.rowBody}><span className={styles.rowMeta}>{KIND_NAMES[item.kind]}{item.provider === "mock" && <span className={styles.demo}>Demo</span>}<span className={styles.rowDate}>{dateLabel(item.date)}</span></span><strong>{item.title}</strong><span className={styles.rowSummary}>{item.summary || "Open the saved record for details."}</span><span className={styles.rowFooter}><span className={item.kind === "proposal" ? styles.pending : styles.status}>{IDEA_STATUS_NAMES[item.status] ?? "Recorded"}</span><span className={styles.dataset}>{item.dataset}</span>{item.evidence.length > 0 && <span className={styles.evidenceCount}><Fingerprint size={12} aria-hidden />{item.evidence.length}</span>}</span></span><ArrowUpRight size={15} className={styles.rowArrow} aria-hidden />
          </button>)}
          {!matching.length && <div className={styles.empty}><span><Lightbulb size={26} aria-hidden /></span><h2>{index.runs.length ? "No outputs in this view" : "The next idea starts with an investigation"}</h2><p>{index.runs.length ? "Try another type or investigation. Only saved agent outputs appear here." : "Reviews, hypotheses and proposals will appear here as the agents complete their work."}</p>{index.runs.length ? <button onClick={clearFilters}>Clear filters</button> : <Link href="/">Start an investigation <ArrowRight size={14} aria-hidden /></Link>}</div>}
          {matching.length > PAGE_SIZE && <div className={styles.pagination}><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, matching.length)} of {matching.length}</span><div><button disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelectedId(null); }}>Previous</button><button disabled={(currentPage + 1) * PAGE_SIZE >= matching.length} onClick={() => { setPage(currentPage + 1); setSelectedId(null); }}>Next</button></div></div>}
        </div>
        {selected ? <IdeaDetail key={selected.id} idea={selected} onClose={() => setSelectedId(null)} /> : <aside className={styles.placeholder}><div className={styles.placeholderGraphic} aria-hidden><span>A</span><i /><GitBranch size={30} /><i /><span>B</span></div><h2>Follow an idea to its source.</h2><p>Select an output to see the evidence, the open questions and what it would take to improve a rule.</p><span className={styles.humanNote}><ShieldCheck size={15} aria-hidden />Rule proposals require review.</span></aside>}
      </div>
    </section>
  </main>;
}

function IdeaDetail({ idea, onClose }: { idea: InvestigationIdea; onClose: () => void }) {
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const top = panel.current?.getBoundingClientRect().top ?? 0;
    if (top < 16 || top > window.innerHeight / 2) panel.current?.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [idea.id]);
  return <aside ref={panel} className={styles.detail} aria-label="Selected output">
    <div className={styles.detailTop}><span>{KIND_NAMES[idea.kind]}</span><button onClick={onClose} aria-label="Close output details"><X size={16} aria-hidden /></button></div>
    <div className={styles.detailHeader}><span className={idea.actor === "A" ? styles.smallA : idea.actor === "B" ? styles.smallB : styles.smallCompiler}>{idea.actor === "Compiler" ? <SlidersHorizontal size={16} /> : idea.actor}</span><span>{idea.actor === "Compiler" ? "Rule compiler" : `Agent ${idea.actor}`}<small>{dateLabel(idea.date)}{idea.provider === "mock" ? " · Demo output" : " · Codex"}</small></span></div>
    <h2>{idea.title}</h2><span className={idea.kind === "proposal" ? styles.pending : styles.status}>{IDEA_STATUS_NAMES[idea.status] ?? "Recorded"}</span>
    {idea.kind === "proposal" && <p className={styles.reviewNote}><ShieldCheck size={16} aria-hidden />This is a candidate rule. Human review and separate validation are required before activation.</p>}
    {idea.summary && <p className={styles.detailSummary}>{idea.summary}</p>}
    {(idea.kind === "hypothesis" || idea.kind === "lead") && <p className={styles.reviewNote}><FlaskConical size={16} aria-hidden />A research lead, not a validated fraud finding.</p>}
    {idea.alternative && <div className={styles.insight}><span><ShieldCheck size={15} aria-hidden />Possible legitimate explanation</span><p>{idea.alternative}</p></div>}
    {idea.counterexample && <div className={styles.insight}><span><FlaskConical size={15} aria-hidden />What would disprove it</span><p>{idea.counterexample}</p></div>}
    {idea.missing && <div className={`${styles.insight} ${styles.missing}`}><span><Search size={15} aria-hidden />Still needed</span><p>{idea.missing}</p></div>}
    {idea.steps.length > 0 && <details className={styles.disclosure}><summary><GitBranch size={15} aria-hidden />Investigation trail <span>{idea.steps.length} steps</span></summary><ol className={styles.trail}>{idea.steps.map((step, i) => <li key={i}><span className={styles.stepNumber}>{i + 1}</span><div><strong>{step.action || "Observation"}</strong><p>{step.claim}</p>{step.question && <p className={styles.question}>{step.question}</p>}{step.evidence.length > 0 && <small>{step.evidence.join(" · ")}</small>}</div></li>)}</ol></details>}
    {idea.evidence.length > 0 ? <details className={styles.disclosure}><summary><Fingerprint size={15} aria-hidden />Evidence references <span>{idea.evidence.length}</span></summary><p className={styles.fine}>References retained in this output. Open the source investigation for the saved exhibits.</p><div className={styles.evidenceList}>{idea.evidence.map(reference => <button key={reference} onClick={() => setOpenEvidence(openEvidence === reference ? null : reference)} aria-expanded={openEvidence === reference}><Fingerprint size={12} aria-hidden />{reference}</button>)}</div>{openEvidence && <div className={styles.referenceCard}><span>Saved reference</span><strong>{openEvidence}</strong><small>Investigation {idea.runId.slice(0, 8)}</small><Link href={investigationLink(idea)}>Open source investigation <ArrowUpRight size={13} aria-hidden /></Link></div>}</details> : <p className={styles.noEvidence}><Fingerprint size={14} aria-hidden />No local evidence cited in this output.</p>}
    {idea.predicates.length > 0 && <details className={styles.disclosure}><summary><SlidersHorizontal size={15} aria-hidden />Proposed conditions <span>{idea.predicates.length}</span></summary><div className={styles.predicates}>{idea.predicates.map((condition, i) => <div key={i}><span>{i === 0 ? "WHEN" : "AND"}</span><code>{String(condition.field)} {String(condition.operator)} {JSON.stringify(condition.value)}</code>{typeof condition.description === "string" && <p>{condition.description}</p>}</div>)}</div></details>}
    <details className={styles.disclosure}><summary><FileText size={15} aria-hidden />Record details</summary><dl className={styles.metadata}><div><dt>Source</dt><dd>{idea.dataset}</dd></div>{idea.rule && <div><dt>Rule</dt><dd>{RULE_NAMES[idea.rule] || idea.rule}</dd></div>}<div><dt>Run ID</dt><dd>{idea.runId}</dd></div>{idea.confidence !== null && <div><dt>Agent confidence</dt><dd>{Math.round(idea.confidence * 100)}% · model assessment, not a fraud probability</dd></div>}{idea.subjects.length > 0 && <div><dt>Subjects</dt><dd>{idea.subjects.join(", ")}</dd></div>}</dl><details className={styles.raw}><summary>Saved JSON</summary><pre>{JSON.stringify(idea.raw, null, 2)}</pre></details></details>
    <Link className={styles.sourceLink} href={investigationLink(idea)}><span><FileText size={16} aria-hidden />Open investigation<small>{idea.dataset}</small></span><ArrowUpRight size={17} aria-hidden /></Link>
  </aside>;
}
