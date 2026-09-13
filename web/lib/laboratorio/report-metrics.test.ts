import { expect, it } from "vitest";
import { formatRunDuration, reportMetrics, runTiming, timingBreakdown } from "./report-metrics";
import { effectiveStatus, isActive, type LabDetail, type LabRun } from "./types";

const run = { launch: { provider: "codex" }, engine: { run_metadata: { llm_calls: 0, mxn_cost: 0, wall_clock_seconds: 1.08 } }, summary: { llm_calls: 6, total_tokens_in: 100, total_tokens_out: 30, sector_research: { calls: 1, tokens_in: 20, tokens_out: 10 } } } as unknown as LabDetail;
it("counts whole-run invocations including sector research without assigning subscription price", () => {
  expect(reportMetrics(run)).toMatchObject({ calls: 7, mxnCost: null, engineCalls: 0, engineCost: 0, tokensIn: 120, tokensOut: 40 });
});
it("does not count mock provider calls as model usage, while retaining real engine usage", () => {
  expect(reportMetrics({ ...run, launch: { ...run.launch, provider: "mock" }, engine: { run_metadata: { llm_calls: 2, mxn_cost: 3 } } })).toMatchObject({ calls: 2, mxnCost: 3 });
});
it("missing measurements stay unavailable", () => {
  expect(reportMetrics({ ...run, summary: null, engine: null })).toMatchObject({ calls: null, engineCost: null, engineSeconds: null, tokensIn: null });
});

it("marks sector estimates in the combined token count", () => {
  const result=reportMetrics({...run,summary:{...run.summary!,sector_research:{...run.summary!.sector_research!,tokens_estimated:true}}});
  expect(result).toMatchObject({tokensIn:120,tokensOut:40,totalTokens:160,tokensEstimated:true});
});

it("discloses a historical selector omission without rewriting recorded token totals",()=>{
  const selector={span_id:"selector",actor:"sector_selector",step:"think",ts_start:"2026-09-13T10:00:00Z"};
  const historical={...run,traces:[selector],summary:{...run.summary!,by_actor:{}}};
  expect(reportMetrics(historical)).toMatchObject({tokensIn:120,tokensOut:40,totalTokens:160,usageIncomplete:true});
  expect(reportMetrics({...historical,summary:{...historical.summary,by_actor:{sector_selector:{calls:1,tokens_in:10,tokens_out:2,duration_ms:50}}}}).usageIncomplete).toBe(false);
  expect(reportMetrics({...run,traces:[selector]}).usageIncomplete).toBe(false);
});

it("does not convert invalid token measurements into a recorded total",()=>{
  expect(reportMetrics({...run,summary:{...run.summary!,total_tokens_in:NaN}})).toMatchObject({tokensIn:null,totalTokens:null});
  expect(reportMetrics({...run,summary:{...run.summary!,sector_research:{...run.summary!.sector_research!,tokens_out:-1}}})).toMatchObject({tokensOut:null,totalTokens:null});
});

const timed={launch:{status:"completed",started_at:"2026-09-13T10:00:00Z",completed_at:"2026-09-13T10:05:00Z",total_duration_ms:301234,timing_scope:"through_report"},summary:{status:"completed",total_duration_ms:10}} as LabRun;
it("uses the measured whole-run duration rather than a stage timer",()=>{
  expect(runTiming(timed)).toMatchObject({elapsedMs:301234,source:"measured",includesReport:true,active:false});
  expect(formatRunDuration(runTiming(timed).elapsedMs)).toBe("5m 01s");
});

it("falls back only to valid launch start and end timestamps",()=>{
  expect(runTiming({...timed,launch:{...timed.launch,total_duration_ms:undefined}})).toMatchObject({elapsedMs:300000,source:"timestamps"});
  expect(runTiming({...timed,launch:{...timed.launch,total_duration_ms:-2,completed_at:undefined}})).toMatchObject({elapsedMs:null,source:"unavailable"});
  expect(runTiming({...timed,launch:{...timed.launch,total_duration_ms:NaN,completed_at:"not a date"}})).toMatchObject({elapsedMs:null,completedAt:null});
  expect(runTiming({...timed,launch:{...timed.launch,total_duration_ms:undefined,completed_at:"2026-09-13T09:00:00Z"}})).toMatchObject({elapsedMs:null,completedAt:null});
});

it("keeps unknown durations distinct from a measured zero",()=>{
  expect(formatRunDuration(null)).toBe("Not recorded");
  expect(formatRunDuration(NaN)).toBe("Not recorded");
  expect(formatRunDuration(0)).toBe("0.000s");
  expect(formatRunDuration(180)).toBe("0.180s");
});

it.each(["agents","report"] as const)("keeps timing and polling live while supervisor finishes %s",phase=>{
  const live={...timed,launch:{...timed.launch,status:"running" as const,phase}};
  expect(effectiveStatus(live)).toBe("running");
  expect(isActive(live)).toBe(true);
  expect(runTiming(live,Date.parse("2026-09-13T10:06:00Z"))).toMatchObject({elapsedMs:360000,active:true,source:"live",completedAt:null});
});

it("does not override a supervisor failure or invent a live time for invalid dates",()=>{
  const failed={...timed,launch:{...timed.launch,status:"failed" as const},summary:{...timed.summary!,status:"running" as const}};
  expect(effectiveStatus(failed)).toBe("failed");
  expect(isActive(failed)).toBe(false);
  expect(runTiming({...timed,launch:{...timed.launch,status:"running",started_at:"invalid"}})).toMatchObject({elapsedMs:null,startedAt:null});
});

it("breaks total into engine and AI pipeline once, with remaining workflow time", () => {
  const sample = { ...run, launch: { ...run.launch, status: "completed", total_duration_ms: 5000 }, summary: { ...run.summary!, status: "completed", total_duration_ms: 3000 } } as LabDetail;
  expect(timingBreakdown(sample)).toEqual({ engineMs: 1080, aiMs: 3000, otherMs: 920 });
  expect(timingBreakdown({ ...sample, engine: null }).otherMs).toBeNull();
  expect(timingBreakdown({ ...sample, summary: { ...sample.summary!, total_duration_ms: 6000 } }).otherMs).toBeNull();
});
