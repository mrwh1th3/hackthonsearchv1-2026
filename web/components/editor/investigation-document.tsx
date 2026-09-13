"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, FileText, LoaderCircle, MessageSquare, MoreHorizontal, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { AppSelect } from "@/components/shared/app-select";
import { ReportChat } from "./report-chat";
import { AmountProof, EvidenceTrail, InvestigationJourney, PATTERN_LABELS, PatternOverview, ReportSnapshot, ReviewScope, RunTiming, TraceabilityPreview } from "./report-visuals";
import { formatRunDuration, reportMetrics, runTiming } from "@/lib/laboratorio/report-metrics";
import { Trace, Value } from "@/app/(app)/laboratorio/laboratorio";
import { isActive, STATUS_LABEL, effectiveStatus, type JsonObject, type LabDetail } from "@/lib/laboratorio/types";
import type { ReportAnswer } from "@/lib/laboratorio/assistant";
import { groupClosedLeads } from "@/lib/laboratorio/closed-leads";
import styles from "./investigation-document.module.css";

const rows = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter((v): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v)) : [];
const text = (v: unknown) => typeof v === "string" ? v : "";
const amount = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? new Intl.NumberFormat("en-US", {style:"currency",currency:"MXN",maximumFractionDigits:2}).format(v) : "Not recorded";
const patterns = PATTERN_LABELS;
const when = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"America/Mexico_City"}).format(new Date(value)) : "Not recorded";
type Section = "summary" | "findings" | "dismissed" | "review" | "activity" | "method";
const sections: Array<[Section,string]> = [["summary","Overview"],["findings","Findings"],["dismissed","Dismissed leads"],["review","AI review"],["activity","Activity & sources"],["method","Method & limits"]];

export function InvestigationDocument({runId,onBack}:{runId:string;onBack?:()=>void}) {
  const [run,setRun] = useState<LabDetail|null>(null);
  const [error,setError] = useState("");
  const [section,setSection] = useState<Section>("summary");
  const [selected,setSelected] = useState<number|null>(null);
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState("");
  const [page,setPage] = useState(0);
  const [chatOpen,setChatOpen] = useState(false);
  const [evidence,setEvidence] = useState<JsonObject|null>(null);
  const [answers,setAnswers] = useState<ReportAnswer[]|null>(null);
  const [starting,setStarting] = useState(false);
  const [clock,setClock] = useState(Date.now());
  const [downloads,setDownloads] = useState(false);
  const reader = useRef<HTMLElement>(null);
  useEffect(() => { if(reader.current) reader.current.scrollTop=0; },[section,selected,page]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let deliveryChecks=0;
    const load = async () => {
      try {
        const response = await fetch(`/api/laboratorio/${runId}`,{signal:controller.signal,cache:"no-store"});
        if(!response.ok) throw new Error("This investigation is unavailable for your account.");
        const data: LabDetail = await response.json();
        if(controller.signal.aborted) return;
        setRun(data); setError("");
        if(isActive(data)) timer=setTimeout(load,2500);
        else {
          const delivery=await fetch(`/api/laboratorio/${runId}/entrega?tipo=estado`,{signal:controller.signal});
          if(delivery.ok) {
            const ready=Boolean((await delivery.json()).expediente);
            if(controller.signal.aborted)return;
            setDownloads(ready);
            // The supervisor can seal final metrics just before the validated export is published.
            if(!ready&&!data.launch.error&&deliveryChecks++<8)timer=setTimeout(load,1000);
          }
        }
      } catch(err) {if(!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load this report.");}
    };
    void load();
    void fetch(`/api/laboratorio/${runId}/assistant`,{signal:controller.signal,cache:"no-store"}).then(async response => { if(!response.ok) throw new Error("History unavailable"); const body=await response.json(); setAnswers(body.messages ?? []); }).catch(() => {if(!controller.signal.aborted)setAnswers([]);});
    return () => {controller.abort();clearTimeout(timer);};
  },[runId]);
  const active=!!run && isActive(run);
  useEffect(() => {if(!active)return;const t=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(t);},[active]);
  const findings=rows(run?.engine?.findings), leads=rows(run?.engine?.leads), reviews=rows(run?.agent_a?.reviews);
  const entityNames:Record<string,string>=Object.fromEntries(Object.entries((run?.engine?.entity_names as JsonObject)||{}).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
  const finding=selected===null ? null : findings[selected];
  const matched=findings.map((item,index)=>({item,index})).filter(({item})=>(!filter||item.scheme_type===filter)&&JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  const dismissed=leads.filter(item=>(JSON.stringify(item)+" "+(entityNames[text(item.entity)]||"")).toLowerCase().includes(query.toLowerCase()));
  function navigate(next: Section) {setSection(next);setQuery("");setFilter("");setPage(0);setSelected(null);}
  function openFinding(index:number) {setSelected(index);setSection("findings");}
  function openReference(ref:string) {
    for(const item of findings) {const exhibit=rows(item.exhibits).find(e=>`${e.source_table}:${e.record_id}`===ref);if(exhibit){setEvidence(exhibit);return;}}
  }
  async function ask(question:string) {
    const response=await fetch(`/api/laboratorio/${runId}/assistant`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question,finding_index:selected,request_id:crypto.randomUUID()})});
    const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not answer. Try again.");setAnswers(previous => [...(previous ?? []), body as ReportAnswer]);return body as ReportAnswer;
  }
  async function rerun() {
    if(!run||starting)return;setStarting(true);
    try {const response=await fetch("/api/laboratorio",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({corrida_id:run.launch.corrida_id,mensaje:run.launch.mensaje??"",...(run.launch.filtros?{filtros:run.launch.filtros}:{}),provider:run.launch.provider})}); const body=await response.json();if(!response.ok||!body.launch?.run_id)throw new Error(body.detalle||body.error||"Could not restart.");window.location.assign(`/?corrida=${run.launch.corrida_id}&run=${body.launch.run_id}`);}
    catch(err){setError(err instanceof Error?err.message:"Could not restart.");setStarting(false);}
  }
  if(!run)return <div className={styles.loading}>{error?<p role="alert">{error}</p>:<><FileText size={24}/><p>Opening your investigation…</p></>}</div>;
  const timing=runTiming(run,clock);
  const milliseconds=timing.elapsedMs;
  const metrics=reportMetrics(run);
  const period=Array.isArray(run.engine?.period)?run.engine.period.filter((value):value is string=>typeof value==="string"&&!!value):[];
  const company=text(run.engine?.company_name)||text((run.engine?.metadata as JsonObject|undefined)?.company_name);
  const proven=findings.filter(f=>f.confidence==="proven").length;
  const probable=findings.filter(f=>f.confidence==="probable").length;
  const unrated=findings.length-proven-probable;
  const engineAvailable=!!run.engine && Array.isArray(run.engine.findings);
  const hypothesisCount=Array.isArray(run.agent_b?.findings)?rows(run.agent_b?.findings).length:null;
  const status=effectiveStatus(run);
  const statusText=run.launch.phase==="report"&&active?"Preparing report":STATUS_LABEL[status];
  const summaryText=!engineAvailable?active?"The investigation is running. Results appear as each stage is saved.":"The rule engine did not save a result. Review the recorded activity before drawing a conclusion.":active?`${findings.length} findings and ${leads.length} closed leads are saved. The full investigation is still running.`:findings.length?`${findings.length} findings remain after rule checks: ${proven} proven, ${probable} probable${unrated?`, ${unrated} unrated`:""}. ${leads.length} other leads were investigated and closed.`:`The rule checks retained no findings. ${leads.length} leads were investigated and closed; this does not establish an absence of fraud.`;
  const tokenLabel=metrics.usageIncomplete?(metrics.tokensEstimated?"Estimated token subtotal":"Recorded token subtotal"):metrics.tokensEstimated?"Estimated tokens":"Recorded tokens";
  const confidence=finding?.confidence==="proven"?"Proven by rule checks":finding?.confidence==="probable"?"Probable · needs review":"Not rated";
  return <div className={styles.workspace}>
    <header className={styles.header}>
      <button type="button" className={styles.mobileChatButton} onClick={()=>setChatOpen(!chatOpen)} aria-pressed={chatOpen}><MessageSquare size={15} aria-hidden="true"/>{chatOpen?"Document":"Assistant"}</button>
      <div className={styles.headerTitleGroup}>
        <button type="button" className={styles.backButton} onClick={onBack} aria-label="Back to dataset"><ArrowLeft size={16} aria-hidden="true"/></button>
        <div className={styles.documentTitle}><FileText size={16} aria-hidden="true"/><span>{run.launch.corrida_nombre}</span><small>{statusText}</small></div>
      </div>
    </header>
    {error&&<p className={styles.error} role="alert">{error}<button onClick={()=>setError("")} aria-label="Dismiss error"><X size={14}/></button></p>}
    <div className={styles.layout}>
      <nav className={styles.outline} aria-label="Report contents"><span>CONTENTS</span>{sections.map(([id,label],index)=><button key={id} aria-current={section===id?"page":undefined} onClick={()=>navigate(id)}><small>0{index+1}</small>{label}{id==="findings"&&<em>{engineAvailable?findings.length:"—"}</em>}</button>)}<div className={styles.runMeta}><Check size={13}/><span>{active?"Investigation running":"Saved investigation"}<small>{when(run.launch.started_at)}<br/>{formatRunDuration(milliseconds)} · investigation</small></span></div></nav>
      <main ref={reader} className={`${styles.reader} ${chatOpen?styles.hideOnMobile:""}`}>
        <div className={styles.readerToolbar}>
          <div className={styles.mobileContents}><AppSelect aria-label="Report section" value={section} onValueChange={value=>navigate(value as Section)} options={sections.map(([value,label])=>({value,label}))} className={styles.sectionSelect}/></div>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className={styles.actionsTrigger} aria-label={starting?"Starting new investigation":"Report actions"} disabled={starting}>
                {starting?<LoaderCircle size={17} className={styles.actionSpinner} aria-hidden="true"/>:<MoreHorizontal size={19} aria-hidden="true"/>}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={styles.actionsMenu} align="end" sideOffset={7} collisionPadding={12} loop>
                <DropdownMenu.Label className={styles.actionsLabel}>Report actions</DropdownMenu.Label>
                {downloads&&<>
                  <DropdownMenu.Item asChild className={styles.actionItem}><a href={`/api/laboratorio/${runId}/entrega?tipo=expediente`} target="_blank" rel="noreferrer"><Download size={14} aria-hidden="true"/><span>Download full report</span></a></DropdownMenu.Item>
                  <DropdownMenu.Item asChild className={styles.actionItem}><a href={`/api/laboratorio/${runId}/entrega?tipo=submission`} download><FileText size={14} aria-hidden="true"/><span>Judge submission</span></a></DropdownMenu.Item>
                </>}
                {!active&&<DropdownMenu.Item className={styles.actionItem} disabled={starting} onSelect={()=>void rerun()}><RefreshCw size={14} aria-hidden="true"/><span>Run again</span></DropdownMenu.Item>}
                {!downloads&&<DropdownMenu.Label className={styles.actionsNotice}>{active?"Downloads appear after the report is saved.":"No saved downloads are available."}</DropdownMenu.Label>}
                <DropdownMenu.Separator className={styles.actionsSeparator}/>
                <DropdownMenu.Label className={styles.actionsMeta}>Run {runId.slice(0,8)}</DropdownMenu.Label>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        <div className={styles.readerBody}>
        <article className={styles.paper} key={`${section}-${selected}`}>
          <div className={styles.paperTop}><span>INSPECTOR / INVESTIGATION REPORT</span><span>{String(sections.findIndex(([id])=>id===section)+1).padStart(2,"0")}</span></div>
          {section==="summary"&&<>
            <div className={styles.overviewHeading}><div><span className={styles.kicker}>THE COMPLETE INVESTIGATION</span><h1>Investigation overview</h1></div><span className={styles.overviewStatus} data-status={status}>{statusText}</span></div>
            {run.launch.error&&<p className={styles.runNotice} role="status">{run.launch.error}</p>}
            <dl className={styles.overviewIdentity}>
              <div><dt>Audited company</dt><dd>{company||text(run.engine?.company_rfc)||"Not supplied"}</dd><small>{company?text(run.engine?.company_rfc):"Company name not supplied"}</small></div>
              <div><dt>Source dataset</dt><dd>{run.launch.corrida_nombre||"Not supplied"}</dd><small>{metrics.mock?"A/B demonstration":"Recorded investigation"}</small></div>
              <div><dt>Audit period</dt><dd>{period.length===2?`${period[0]} — ${period[1]}`:"Not supplied"}</dd></div>
              <div><dt>Estate seed</dt><dd>{run.launch.seed_provenance==="filename"&&typeof run.engine?.seed==="number"&&Number.isFinite(run.engine.seed)?String(run.engine.seed):"Not supplied"}</dd></div>
            </dl>
            <RunTiming run={run} nowMs={clock}/>
            <div className={styles.overviewUsage} aria-label="Whole-workflow usage">
              <div><span>AI calls</span><strong>{metrics.calls?.toLocaleString("en-US")??"Not recorded"}</strong><small>Whole workflow</small></div>
              <div><span>MXN cost</span><strong>{metrics.mxnCost===null?"Not itemized":amount(metrics.mxnCost)}</strong><small>{metrics.mock?"Recorded engine cost · A/B simulated":"Subscription cost is not allocated per run"}</small></div>
              <div><span>{tokenLabel}</span><strong>{metrics.totalTokens===null||(metrics.usageIncomplete&&metrics.totalTokens===0)?"Not available":`${metrics.usageIncomplete?"≥ ":""}${metrics.totalTokens.toLocaleString("en-US")}`}</strong><small>{metrics.tokensIn?.toLocaleString("en-US")??"—"} input / {metrics.tokensOut?.toLocaleString("en-US")??"—"} output</small></div>
            </div>
            <details className={styles.usageExplanation}><summary>What these measurements cover</summary><p>{metrics.mock?"A/B responses are simulated and do not count as model usage.":"Provider invocations include sector selection, A/B review, compilation and any new sector research. Codex internal model requests and a numeric subscription allocation are not exposed."} Cached input is part of input tokens. Follow-up chat is recorded separately.{metrics.usageIncomplete?" Some usage is missing; the recorded token subtotal is incomplete.":""}{metrics.tokensEstimated?" Some token counts are estimated.":""}</p></details>
            <div className={styles.methodStrip}><span>Deterministic rule checks</span><span>{metrics.mock?"Simulated AI review":"Fresh AI review may vary"}</span><button onClick={()=>navigate("method")}>Method & replay <ArrowRight size={12}/></button></div>
            <section className={styles.executiveSummary}><h2>Executive summary</h2><p>{summaryText}</p><ReportSnapshot findings={findings} available={engineAvailable} onFindings={()=>navigate("findings")} closedCount={engineAvailable?leads.length:null} hypothesesCount={hypothesisCount} onDismissed={()=>navigate("dismissed")} onReview={()=>navigate("review")}/></section>
            <InvestigationJourney run={run} delivered={downloads} onNavigate={navigate}/>
            <section className={styles.overviewSection}><div className={styles.sectionHeader}><h2>Finding patterns</h2><span className={styles.caption}>Count by pattern</span></div><PatternOverview findings={findings} onPattern={key=>{navigate("findings");setFilter(key);}}/></section>
            <section className={styles.overviewSection}><div className={styles.sectionHeader}><h2>Follow the evidence</h2><button onClick={()=>navigate("findings")}>View all findings <ArrowRight size={13}/></button></div>{findings.length?<><TraceabilityPreview finding={findings[0]} index={0} onFinding={()=>openFinding(0)} onEvidence={setEvidence}/>{findings.slice(1,3).map((item,index)=><button key={index} className={styles.findingLink} onClick={()=>openFinding(index+1)}><span className={styles.caseNumber}>{String(index+2).padStart(2,"0")}</span><span><strong>{text(item.subject_name)||text(item.scheme_type)}</strong><small>{patterns[text(item.scheme_type)]} · {amount(item.peso_amount)}</small></span><ArrowRight size={16}/></button>)}</>:<p className={styles.caption}>{engineAvailable?"No finding evidence to preview. Closed leads remain available for inspection.":"An evidence preview appears when the rule engine saves its results."}</p>}</section>
            <details className={styles.disclosure}><summary>Investigation focus & scope<ChevronDown size={13}/></summary><p>{run.launch.mensaje||"No additional focus supplied."}</p>{run.launch.filtros&&<p>Focus period: {run.launch.filtros.desde} → {run.launch.filtros.hasta}. Evidence outside this focus remains in the audit.</p>}<p>AI hypotheses do not alter the rule findings. Saved replay requires the complete run folder and its matching renderer version.</p></details>
          </>}
          {section==="findings"&&!finding&&<><span className={styles.kicker}>FOLLOW EACH CASE</span><h1>Findings</h1><p className={styles.lead}>Open a finding to read what happened and inspect the evidence.</p><label className={styles.search}><Search size={15}/><input aria-label="Search report findings" placeholder="Company, record or amount" value={query} onChange={e=>setQuery(e.target.value)}/></label>{filter&&<button className={styles.clear} onClick={()=>setFilter("")}>{patterns[filter]} ×</button>}{matched.map(({item,index})=><button key={index} className={styles.findingLink} onClick={()=>openFinding(index)}><span className={styles.caseNumber}>{String(index+1).padStart(2,"0")}</span><span><strong>{text(item.subject_name)||"Unnamed entity"}</strong><small>{patterns[text(item.scheme_type)]} · {amount(item.peso_amount)}</small></span><ArrowRight size={16}/></button>)}{!matched.length&&<p>No matching findings.</p>}</>}
          {section==="findings"&&finding&&<>
            <div className={styles.sectionHeader}><button onClick={()=>setSelected(null)}><ArrowLeft size={13}/>All findings</button><span className={styles.caption}>Finding {selected!+1} of {findings.length}</span></div><span className={styles.kicker}>{patterns[text(finding.scheme_type)]}</span><h1 className={styles.caseTitle}>{text(finding.subject_name)||"Entity under review"}</h1><p className={styles.caption}>{Array.isArray(finding.entities)?finding.entities.join(" · "):""}</p><div className={styles.caseFacts}><div><small>Flagged amount</small><strong>{amount(finding.peso_amount)}</strong></div><div><small>Rule-engine confidence</small><span>{confidence}</span></div></div>
            <section><h2>What happened</h2><p className={styles.narrative}>{text(finding.narrative)}</p><details className={styles.disclosure}><summary>Why the rule flagged this<ChevronDown size={13}/></summary><p>{text(finding.rule_broken)}</p></details></section>
            <section><h2>Follow the money</h2><EvidenceTrail key={selected} finding={finding} onEvidence={setEvidence} names={entityNames}/></section>
            <section><h2>The supporting records</h2><p className={styles.caption}>Open a citation to see its source and what it supports.</p><div className={styles.exhibits}>{rows(finding.exhibits).map((e,i)=><button key={i} onClick={()=>setEvidence(e)}><span>{text(e.exhibit_id)||`E${i+1}`}</span><div><strong>{text(e.source_table)} · {text(e.record_id)}</strong><p>{text(e.note)}</p></div><ArrowRight size={14}/></button>)}</div></section>
            <section><h2>Could it be legitimate?</h2>{rows(finding.defense).map((d,i)=><div className={styles.defense} key={i}><span>{d.held?"?":"✓"}</span><div><strong>{text(d.argument)}</strong><p>{text(d.why)}</p></div></div>)}{!rows(finding.defense).length&&<p>No alternative explanations were saved for this finding.</p>}</section>
            {reviews.some(r=>r.rule_id===finding.scheme_type)&&<details className={styles.disclosure}><summary><Sparkles size={13}/>A’s review of this pattern<ChevronDown size={13}/></summary><Value value={reviews.filter(r=>r.rule_id===finding.scheme_type)}/></details>}
            <section><h2>Check the amount</h2><AmountProof key={selected} finding={finding} onReference={openReference}/></section><details className={styles.disclosure}><summary>Original finding & validation<ChevronDown size={13}/></summary><Value value={finding.reconciliation}/><pre>{JSON.stringify(finding,null,2)}</pre></details><div className={styles.pager}><button disabled={selected===0} onClick={()=>openFinding(selected!-1)}>Previous finding</button><button disabled={selected===findings.length-1} onClick={()=>openFinding(selected!+1)}>Next finding <ArrowRight size={13}/></button></div>
          </>}
          {section==="dismissed"&&<><span className={styles.kicker}>THE OTHER SIDE OF THE EVIDENCE</span><h1>Why these leads<br/>were dismissed.</h1><p className={styles.lead}>Grouped by original signal priority, from combined triggers to routine coincidences. All remain closed; expand a group to follow the evidence.</p><label className={styles.search}><Search size={15}/><input aria-label="Search dismissed leads" placeholder="Search an entity or supporting record" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>{groupClosedLeads(dismissed).map((group,index)=><details className={styles.leadGroup} key={group.id} open={query ? true : undefined}><summary><span className={styles.groupOrder}>{String(index+1).padStart(2,"0")}</span><span><strong>{group.title}</strong><small>{group.hint}</small></span><em>{group.leads.length} closed</em><ChevronDown size={16}/></summary><div>{group.leads.map((lead,i)=><details className={styles.disclosure} key={`${group.id}-${i}`}><summary><span><strong>{entityNames[text(lead.entity)]||text(lead.entity)}</strong>{entityNames[text(lead.entity)]&&<small>{text(lead.entity)}</small>}<small>{text(lead.signal_detail)||text(lead.signal)}</small></span><ChevronDown size={14}/></summary><p>{text(lead.reason)}</p><div className={styles.closedMeta}><span>Closed by <strong>{text(lead.closed_by)==="challenger"?"Adversarial reviewer":text(lead.closed_by)||"Not recorded"}</strong></span><span>Checked with <strong>{Array.isArray(lead.tool_calls_made)?lead.tool_calls_made.join(" · "):"Not recorded"}</strong></span></div><details><summary>Evidence & checks</summary><Value value={lead}/></details></details>)}</div></details>)}{!dismissed.length&&<p>No matching leads.</p>}</>}
          {section==="review"&&<><span className={styles.kicker}>QUESTION THE CONCLUSION</span><h1>The AI review</h1><p className={styles.lead}>A challenges known signals. B looks for additional leads in unflagged entities.</p><h2>A · {reviews.length} pattern reviews</h2>{reviews.map((r,i)=><details key={i} className={styles.disclosure}><summary>{patterns[text(r.rule_id)]||text(r.rule_id)}<ChevronDown size={14}/></summary><Value value={r}/></details>)}<h2>B · {rows(run.agent_b?.findings).length} additional hypotheses</h2>{rows(run.agent_b?.findings).length?<Value value={run.agent_b?.findings}/>:<p>No additional hypotheses were recorded. This does not establish an absence of fraud.</p>}<h2>What A/B reviewed</h2><ReviewScope run={run}/><a className={styles.replayLink} href={`/hypotheses?run=${runId}`}>Explore the improvement matrix<ArrowRight size={12}/></a><h2>Review limits</h2><ul>{run.summary?.coverage?.limitations?.map((limit,i)=><li key={i}>{limit}</li>)}</ul><details className={styles.disclosure}><summary>Proposals & investigation notes<ChevronDown size={13}/></summary><Value value={{proposals:run.proposals,notes:run.notes}}/></details></>}
          {section==="activity"&&<><span className={styles.kicker}>THE RECORDED PATH</span><h1>Every step<br/>has a source.</h1><p className={styles.lead}>Open an event to inspect its input, result and evidence references.</p>{[...run.traces].sort((a,b)=>a.ts_start.localeCompare(b.ts_start)).map((trace,i)=><Trace key={trace.span_id||i} trace={trace} index={i} runId={runId}/>)}<h2>Questions to the assistant</h2>{answers?.length ? answers.map(answer=><details className={styles.disclosure} key={answer.request_id}><summary>{answer.question}<ChevronDown size={13}/></summary><p>{answer.answer}</p><p>{when(answer.created_at)} · {answer.finding_index===null?"Overview":`Finding ${answer.finding_index+1}`}</p>{answer.references.map(ref=><button className={styles.clear} key={ref} onClick={()=>openReference(ref)}>{ref}</button>)}<details><summary>Answer usage</summary><Value value={answer.usage}/></details></details>):<p>No follow-up questions yet.</p>}<details className={styles.disclosure}><summary>Usage, context & original metadata<ChevronDown size={13}/></summary><Value value={{summary:run.summary,context:run.brief?.playbook_excerpt}}/></details></>}
          {section==="method"&&<><span className={styles.kicker}>HOW TO READ THE RESULT</span><h1>Method & limits</h1><p className={styles.lead}>Every conclusion has a defined scope. Saved evidence makes the result inspectable without running the agents again.</p><InvestigationJourney run={run} delivered={downloads}/><section><h2>How the investigation works</h2><p>Rule checks open leads. The investigator gathers records, tests legitimate explanations and validates citations and amounts before reporting a finding. A challenges known signals; B searches a bounded sample of other entities. A compiler records proposed improvements for human review.</p><p>Agent hypotheses do not change the validated findings or activate new rules automatically.</p></section><section><h2>What was reviewed</h2><ReviewScope run={run}/><ul>{run.summary?.coverage?.limitations?.map((limit,i)=><li key={i}>{limit}</li>)}</ul><p>Industry context: {run.summary?.coverage?.context_status==="verified"?"verified saved context":"see the saved source limitations"}.</p></section><section><h2>What this cannot establish</h2><p>The audit cannot verify physical delivery, off-record cash, forged supporting documents or accounts outside the dataset. No finding is not proof that fraud is absent. Sampled AI review is not an exhaustive audit.</p></section><section><h2>Reproduce this report</h2><div className={styles.reproduction}><Check size={16}/><div><strong>Replay the saved investigation</strong><p>Rebuilds the saved case file without network or model calls. Keep the complete investigation folder and the renderer version that produced it.</p></div></div><code className={styles.command}>python3 -m labs.delivery --run-dir RUN_DIRECTORY --check</code><p>With the matching renderer version, this command checks the saved bytes; without <code>--check</code> it rebuilds the HTML. Older reports may differ under a newer renderer even when their input hashes are unchanged. A new Codex investigation may return a different review. The rule engine uses fixed checks; measured duration and a new run ID can change between executions.</p></section><section><h2>Measured usage</h2><dl className={styles.measurements}><dt>Entire run · provider invocations</dt><dd>{metrics.calls??"Not available"}</dd><dt>Entire run · elapsed</dt><dd>{milliseconds===null?"Not recorded":`${(milliseconds/1000).toFixed(3)} seconds`}</dd><dt>Entire run · MXN cost</dt><dd>{metrics.mxnCost===null?"Not itemized by the subscription":amount(metrics.mxnCost)}</dd><dt>{metrics.usageIncomplete?"Recorded token subtotal":metrics.tokensEstimated?"Estimated tokens":"Recorded tokens"} · input / output</dt><dd>{metrics.tokensIn?.toLocaleString("en-US")??"—"} / {metrics.tokensOut?.toLocaleString("en-US")??"—"}</dd><dt>Rule engine only · invocations / cost</dt><dd>{metrics.engineCalls??"—"} / {metrics.engineCost===null?"Not available":amount(metrics.engineCost)}</dd><dt>Rule engine only · elapsed</dt><dd>{metrics.engineSeconds??"—"} seconds</dd></dl><p className={styles.caption}>The judge submission contains the rule engine’s validated findings and metrics. The full report includes A/B review and whole-run usage. Chat follow-ups are recorded separately under Activity & sources.</p></section></>}
          <footer className={styles.paperFooter}><span>INSPECTOR</span><span>{runId.slice(0,8)} · {text(run.engine?.company_rfc)}</span></footer>
        </article>
        </div>
      </main>
      <div className={`${styles.chat} ${chatOpen?styles.showChat:""}`}>{answers!==null?<ReportChat casoId={runId} version={1} seleccion={null} evidencia={[]} modoLectura={!run.engine} onAplicado={()=>{}} onLimpiarSeleccion={()=>{}} onAbrirCita={openReference} onAsk={ask} initialAnswers={answers} contextLabel={finding?`Finding ${selected!+1} · ${text(finding.subject_name)}`:"Investigation overview"}/>:<p>Loading saved conversation…</p>}</div>
    </div>
    <Dialog.Root open={!!evidence} onOpenChange={open=>{if(!open)setEvidence(null);}}><Dialog.Portal><Dialog.Overlay className={styles.overlay}/><Dialog.Content className={styles.evidenceDrawer}><Dialog.Title>Evidence reference</Dialog.Title><Dialog.Description>{text(evidence?.source_table)} · {text(evidence?.record_id)}</Dialog.Description><Dialog.Close className={styles.close} aria-label="Close evidence"><X size={17}/></Dialog.Close><span className={styles.kicker}>{text(evidence?.exhibit_id)}</span><h2>What this supports</h2><p>{text(evidence?.note)}</p><dl><dt>Source table</dt><dd>{text(evidence?.source_table)}</dd><dt>Record ID</dt><dd>{text(evidence?.record_id)}</dd><dt>Investigation</dt><dd>{runId}</dd></dl><p className={styles.caption}>Saved citation from this investigation’s evidence. This panel shows the exhibit, not a fresh database query.</p></Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
