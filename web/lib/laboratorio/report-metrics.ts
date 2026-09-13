import { isActive, type JsonObject, type LabDetail, type LabRun } from "./types";

const measured = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const timestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface RunTimingMetrics {
  elapsedMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  active: boolean;
  source: "live" | "measured" | "timestamps" | "unavailable";
  includesReport: boolean;
}

/** Launch is the whole investigation. Engine and A/B durations are separate scopes. */
export function runTiming(run: LabRun, nowMs = Date.now()): RunTimingMetrics {
  const start = timestamp(run.launch.started_at);
  const finish = timestamp(run.launch.completed_at);
  const active = isActive(run);
  let elapsedMs: number | null = null;
  let source: RunTimingMetrics["source"] = "unavailable";
  if (active) {
    if (start !== null && Number.isFinite(nowMs) && nowMs >= start) {
      elapsedMs = nowMs - start;
      source = "live";
    }
  } else if (measured(run.launch.total_duration_ms) !== null) {
    elapsedMs = run.launch.total_duration_ms!;
    source = "measured";
  } else if (start !== null && finish !== null && finish >= start) {
    elapsedMs = finish - start;
    source = "timestamps";
  }
  return {
    elapsedMs, source, active,
    startedAt: start === null ? null : run.launch.started_at,
    completedAt: active || finish === null || (start !== null && finish < start) ? null : run.launch.completed_at!,
    includesReport: run.launch.timing_scope === "through_report",
  };
}

export function formatRunDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return "Not recorded";
  if (milliseconds < 1_000) return `${(milliseconds / 1_000).toFixed(3)}s`;
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3_600)}h ${String(Math.floor(seconds % 3_600 / 60)).padStart(2, "0")}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Keep the measured scope explicit; subscription usage is never assigned an invented price. */
export function reportMetrics(run: LabDetail) {
  const engine = run.engine?.run_metadata as JsonObject | undefined;
  const engineCalls = measured(engine?.llm_calls);
  const engineCost = measured(engine?.mxn_cost);
  const summaryCalls = measured(run.summary?.llm_calls);
  const sectorCalls = measured(run.summary?.sector_research?.calls) ?? 0;
  const mock = run.launch.provider === "mock";
  const calls = engineCalls === null || (!mock && summaryCalls === null) ? null : engineCalls + (mock ? 0 : summaryCalls! + sectorCalls);
  const summaryIn = measured(run.summary?.total_tokens_in);
  const summaryOut = measured(run.summary?.total_tokens_out);
  const sector = run.summary?.sector_research;
  const sectorIn = measured(sector?.tokens_in);
  const sectorOut = measured(sector?.tokens_out);
  const tokensIn = summaryIn === null || (sector && sectorIn === null) ? null : summaryIn + (sectorIn ?? 0);
  const tokensOut = summaryOut === null || (sector && sectorOut === null) ? null : summaryOut + (sectorOut ?? 0);
  // Historical summaries can omit the selector actor even though its saved trace exists.
  // Preserve those measurements and disclose the omission; do not reconstruct billing.
  const selectorOmitted = !mock && !!run.summary?.by_actor && !run.summary.by_actor.sector_selector
    && Boolean(run.traces?.some(trace => trace.actor === "sector_selector"));
  return {
    calls,
    mxnCost: mock ? engineCost : null,
    engineCalls,
    engineCost,
    engineSeconds: measured(engine?.wall_clock_seconds),
    tokensIn,
    tokensOut,
    totalTokens: tokensIn === null || tokensOut === null ? null : tokensIn + tokensOut,
    usageIncomplete: Boolean(run.summary?.usage_incomplete || run.summary?.usage_unknown || sector?.usage_incomplete || sector?.usage_unknown || selectorOmitted || (engineCalls !== null && engineCalls > 0)),
    tokensEstimated: Boolean(run.summary?.tokens_estimated || sector?.tokens_estimated),
    mock,
  };
}

/** AI duration is the pipeline clock, not the sum of parallel A/B calls. */
export function timingBreakdown(run: LabRun & Partial<LabDetail>, nowMs?: number) {
  const total = runTiming(run, nowMs);
  const seconds = measured((run.engine?.run_metadata as JsonObject | undefined)?.wall_clock_seconds);
  const engineMs = seconds === null ? null : seconds * 1000;
  const aiMs = measured(run.summary?.total_duration_ms);
  const remainder = total.elapsedMs !== null && engineMs !== null && aiMs !== null
    ? total.elapsedMs - engineMs - aiMs : null;
  return { engineMs, aiMs, otherMs: !total.active && remainder !== null && remainder >= 0 ? remainder : null };
}
