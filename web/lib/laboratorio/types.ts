export type LabStatus = "queued" | "running" | "completed" | "partial" | "failed";
export type LabProvider = "codex" | "mock";
export type JsonObject = Record<string, unknown>;

export interface LabLaunch {
  run_id: string;
  perfil_id: string;
  corrida_id: string;
  corrida_nombre: string;
  data_source: "supabase" | "fixture";
  giro: string;
  mensaje?: string;
  filtros?: { desde: string; hasta: string };
  provider: LabProvider;
  status: LabStatus;
  phase?: "engine" | "agents" | "report";
  started_at: string;
  completed_at?: string;
  total_duration_ms?: number;
  timing_scope?: "through_report";
  report_completed_at?: string;
  seed_provenance?: "filename" | "unknown";
  error?: string;
}

export interface LabSummary {
  schema_version: number;
  run_id: string;
  status: LabStatus;
  provider: LabProvider;
  giro: string;
  started_at: string;
  completed_at?: string | null;
  total_duration_ms?: number;
  llm_calls?: number;
  max_llm_calls?: number;
  total_tokens_in?: number;
  total_tokens_out?: number;
  tokens_estimated?: boolean;
  usage_unknown?: boolean;
  usage_incomplete?: boolean;
  cost_usd_est?: number | null;
  by_actor?: Record<string, { calls: number; tokens_in: number; tokens_out: number; duration_ms: number }>;
  sector_research?: { calls: number; tokens_in: number; tokens_out: number; cost_usd_est: number | null; budget_separate: boolean; tokens_estimated?: boolean; usage_unknown?: boolean; usage_incomplete?: boolean };
  counts?: Record<string, number>;
  coverage?: {
    a_groups_total?: number;
    a_groups_sampled?: number;
    residual_total?: number;
    residual_sampled?: number;
    unexplored_groups?: number | string[];
    context_status?: string;
    limitations?: string[];
  };
  stages?: Array<{ id: string; label: string; status: string; detail?: string }>;
  errors?: unknown[];
}

export interface LabTrace {
  span_id: string;
  actor: string;
  step: string;
  action?: string;
  status?: string;
  thought?: string;
  rationale?: string;
  ts_start: string;
  ts_end?: string;
  duration_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  tokens_estimated?: boolean;
  usage_unknown?: boolean;
  usage_incomplete?: boolean;
  model?: string;
  error?: unknown;
  input_ref?: unknown;
  output_ref?: unknown;
  evidence_ids?: string[];
  [key: string]: unknown;
}

export interface LabRun {
  launch: Omit<LabLaunch, "perfil_id">;
  summary: LabSummary | null;
}

export interface LabDetail extends LabRun {
  engine?: JsonObject | null;
  brief: JsonObject | null;
  agent_a: JsonObject | null;
  agent_b: JsonObject | null;
  compiler: JsonObject | null;
  proposals: JsonObject[];
  notes: unknown[];
  traces: LabTrace[];
}

export const STATUS_LABEL: Record<LabStatus, string> = {
  queued: "Queued", running: "Investigating", completed: "Completed", partial: "Finished", failed: "Interrupted",
};

export function effectiveStatus(run: LabRun): LabStatus {
  // A supervisor failure (including timeout) must override a stale running summary.
  if (run.launch.status === "failed") return "failed";
  // A/B can finish before the supervisor advances phase, builds and verifies the report.
  if (run.launch.status === "running" || run.launch.status === "queued") return run.launch.status;
  return run.summary?.status ?? run.launch.status;
}

export function isActive(run: LabRun): boolean {
  return ["queued", "running"].includes(effectiveStatus(run));
}
