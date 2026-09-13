import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { esUuid, RAIZ_REPO, rutaEstate } from "@/lib/auditoria/runner";
import type { Corrida, DataSource } from "@/lib/data";
import type { JsonObject, LabDetail, LabLaunch, LabProvider, LabRun, LabSummary, LabTrace } from "./types";

const RUNS = path.join(RAIZ_REPO, "data", "labs", "runs");
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_RUN_MS = 31 * 60_000;

export class LabError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

export function labDirectory(id: string): string {
  if (!esUuid(id)) throw new LabError("id_invalido", 422, "Invalid investigation ID.");
  return path.join(RUNS, id);
}

async function jsonFile<T>(file: string): Promise<T | null> {
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES) return null;
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch { return null; }
}

async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}

function publicLaunch(launch: LabLaunch): LabRun["launch"] {
  return {
    run_id: launch.run_id, corrida_id: launch.corrida_id, corrida_nombre: launch.corrida_nombre,
    data_source: launch.data_source, giro: launch.giro, mensaje: launch.mensaje, filtros: launch.filtros, provider: launch.provider, status: launch.status,
    started_at: launch.started_at, completed_at: launch.completed_at, error: launch.error, phase: launch.phase, total_duration_ms: launch.total_duration_ms, seed_provenance: launch.seed_provenance,
    timing_scope: launch.timing_scope, report_completed_at: launch.report_completed_at,
  };
}

/** Local artifacts are private to the signed-in profile, including cached lists. */
export async function readLab(id: string, perfilId: string, detail = false): Promise<LabRun | LabDetail | null> {
  const directory = labDirectory(id);
  const launch = await jsonFile<LabLaunch>(path.join(directory, "launch.json"));
  if (!launch || launch.perfil_id !== perfilId) return null;
  const summary = await jsonFile<LabSummary>(path.join(directory, "summary.json"));
  const active = ["running", "queued"].includes(launch.status) || ["running", "queued"].includes(summary?.status ?? launch.status);
  const elapsed = Date.now() - Date.parse(launch.started_at);
  if (active && elapsed > MAX_RUN_MS) {
    launch.status = "failed";
    launch.error = "This run exceeded its time limit. Start a new investigation to retry.";
  }
  const run: LabRun = { launch: publicLaunch(launch), summary };
  if (!detail) return run;
  const [brief, agent_a, agent_b, compiler, proposals, notes, engine, engineTraces] = await Promise.all([
    jsonFile<JsonObject>(path.join(directory, "brief.json")),
    jsonFile<JsonObject>(path.join(directory, "agent_a.json")),
    jsonFile<JsonObject>(path.join(directory, "agent_b.json")),
    jsonFile<JsonObject>(path.join(directory, "compiler.json")),
    jsonFile<JsonObject[]>(path.join(directory, "proposals.json")),
    jsonFile<unknown[]>(path.join(directory, "notes.json")),
    jsonFile<JsonObject>(path.join(directory, "engine", "run_log.json")),
    jsonFile<LabTrace[]>(path.join(directory, "engine_trace.json")),
  ]);
  let traces: LabTrace[] = [];
  try {
    const file = path.join(directory, "traces.jsonl");
    if ((await stat(file)).size <= MAX_FILE_BYTES) {
      // A last line may still be being written; the next poll will pick it up.
      traces = (await readFile(file, "utf8")).split("\n").flatMap((line) => {
        try { return line.trim() ? [JSON.parse(line) as LabTrace] : []; } catch { return []; }
      });
    }
  } catch { /* No persisted spans yet. */ }
  traces = [...(Array.isArray(engineTraces) ? engineTraces : []), ...traces];
  return { ...run, brief, agent_a, agent_b, compiler, engine, proposals: Array.isArray(proposals) ? proposals : [], notes: Array.isArray(notes) ? notes : [], traces };
}

export async function listLabs(perfilId: string): Promise<LabRun[]> {
  let entries: string[];
  try { entries = await readdir(RUNS); } catch { return []; }
  const runs = await Promise.all(entries.filter(esUuid).map((id) => readLab(id, perfilId)));
  return runs.filter((run): run is LabRun => run !== null)
    .sort((a, b) => b.launch.started_at.localeCompare(a.launch.started_at)).slice(0, 100);
}

export async function readLabArtifact(id: string, perfilId: string, reference: string): Promise<unknown | null> {
  // The request must name an artifact the runner actually recorded, never an arbitrary path.
  if (!/^(?:(?:prompts|tools|responses|validated|rejected)\/[a-zA-Z0-9_.-]+\.(?:json|txt)|(?:memory_snapshot|sampling)\.json|engine\/(?:run_log|submission|triage)\.json)$/.test(reference)) return null;
  const run = await readLab(id, perfilId, true) as LabDetail | null;
  if (!run || !run.traces.some((trace) => trace.input_ref === reference || trace.output_ref === reference)) return null;
  const directory = labDirectory(id);
  try {
    const file = await realpath(path.join(directory, reference));
    if (!file.startsWith(`${await realpath(directory)}${path.sep}`) || (await stat(file)).size > MAX_FILE_BYTES) return null;
    const content = await readFile(file, "utf8");
    return publicArtifacts(reference.endsWith(".json") ? JSON.parse(content) : { prompt: content });
  } catch { return null; }
}

type StartArgs = { corrida: Corrida; giro: string; mensaje?: string; filtros?: { desde: string; hasta: string }; provider: LabProvider; perfilId: string; source: DataSource };

async function codexPreflight(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FORENSE_PYTHON ?? "python3", ["-c", "import json; from labs.provider import preflight; print(json.dumps(preflight()))"], { cwd: RAIZ_REPO, env: process.env, shell: false });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new LabError("codex_no_disponible", 503, "Codex did not respond to the connection check.")); }, 20_000);
    child.stdout.on("data", (data: Buffer) => { if (output.length < 16_384) output += data.toString(); });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(new LabError("python_no_disponible", 503, "Could not start Python to check Codex.")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output) as { available?: boolean; authenticated?: boolean; auth_mode?: string };
        if (code === 0 && result.available && result.authenticated && result.auth_mode === "chatgpt") { resolve(); return; }
      } catch { /* Non-JSON output or a missing provider is unavailable, never success. */ }
      reject(new LabError("codex_sin_sesion", 503, "Codex needs an active ChatGPT session on this server. Sign in to Codex and try again."));
    });
  });
}

/** Atomic dispatch lock closes the race between simultaneous POST requests. */
export async function startLab(args: StartArgs): Promise<LabRun> {
  const startedAt = new Date().toISOString();
  await mkdir(RUNS, { recursive: true, mode: 0o700 });
  const lock = path.join(RUNS, ".dispatch.lock");
  try {
    const information = await stat(lock);
    if (Date.now() - information.mtimeMs > 120_000) await unlink(lock);
  } catch { /* No existing dispatch. */ }
  let handle;
  try { handle = await open(lock, "wx", 0o600); }
  catch { throw new LabError("inicio_en_curso", 409, "Another investigation is being prepared. Try again shortly."); }
  try {
    if (args.provider === "codex") {
      const ids = (await readdir(RUNS)).filter(esUuid);
      const launches = await Promise.all(ids.map((id) => jsonFile<LabLaunch>(path.join(RUNS, id, "launch.json"))));
      if (launches.some((launch) => launch?.provider === "codex" && ["queued", "running"].includes(launch.status) && Date.now() - Date.parse(launch.started_at) < MAX_RUN_MS)) {
        throw new LabError("codex_ocupado", 409, "A Codex investigation is already running. Wait for it to finish before starting another.");
      }
      await codexPreflight();
    }
    return await dispatchLab(args, startedAt);
  } finally { await handle.close(); await unlink(lock).catch(() => undefined); }
}

async function dispatchLab(args: StartArgs, startedAt: string): Promise<LabRun> {
  const { corrida, giro, provider, perfilId, source } = args;
  if (!esUuid(corrida.id) || !esUuid(perfilId)) throw new LabError("identificador_invalido", 422, "Invalid dataset or profile.");
  if (source.label === "fixture" && provider === "codex") throw new LabError("datos_demostracion", 409, "Select a connected data source before investigating with Codex.");
  // The same canonical estate feeds the motor and both investigators, in that order.
  const estate = rutaEstate(corrida.dataset_hash);
  const fixtureDemo = source.label === "fixture" && provider === "mock";
  if (!estate && !fixtureDemo) {
    throw new LabError("sin_estate", 409, "The dataset file is unavailable on this server. Upload it again to run the investigation.");
  }
  const id = randomUUID();
  const directory = labDirectory(id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const seedMatch = corrida.nombre.match(/seed\s*[-_:]?\s*(\d+)/i);
  const parsedSeed = seedMatch ? Number(seedMatch[1]) : 0;
  const seedKnown = Boolean(seedMatch) && Number.isSafeInteger(parsedSeed);
  const launch: LabLaunch = {
    run_id: id, perfil_id: perfilId, corrida_id: corrida.id, corrida_nombre: corrida.nombre,
    giro, mensaje: args.mensaje, filtros: args.filtros, provider, data_source: source.label, status: "queued", phase: estate ? "engine" : "agents", started_at: startedAt,
    seed_provenance: seedKnown ? "filename" : "unknown",
  };
  await atomicJson(path.join(directory, "launch.json"), launch);
  const engineDirectory = path.join(directory, "engine");
  const engineFile = estate ? path.join(engineDirectory, "run_log.json") : path.join(directory, "engine_input.json");
  if (!estate) {
    const fixture = await jsonFile<JsonObject>(path.join(RAIZ_REPO, "labs", "tests", "fixtures", "engine.json"));
    if (!fixture) throw new LabError("demo_no_disponible", 503, "Demo data is unavailable.");
    await atomicJson(engineFile, fixture);
  }
  const cli = ["-m", "labs.runner", "run", "--engine-output", engineFile, "--giro", giro, "--out", RUNS, "--run-id", id, "--provider", provider];
  if (estate) cli.push("--estate", estate);
  if (args.mensaje) cli.push(`--focus=${args.mensaje}`);
  if (args.filtros) cli.push("--focus-from", args.filtros.desde, "--focus-to", args.filtros.hasta);
  await atomicJson(path.join(directory, "worker.json"), {
    args: cli,
    engine: estate ? { estate, seed: seedKnown ? parsedSeed : 0, output: engineDirectory } : null,
  });
  try {
    const child = spawn(process.env.FORENSE_PYTHON ?? "python3", [path.join(RAIZ_REPO, "web", "lib", "laboratorio", "worker.py"), id], {
      cwd: RAIZ_REPO, env: process.env, detached: true, stdio: "ignore", shell: false,
    });
    child.on("error", () => {
      void atomicJson(path.join(directory, "launch.json"), { ...launch, status: "failed", completed_at: new Date().toISOString(), error: "Could not start Python. Check the server environment." }).catch(() => undefined);
    });
    child.unref();
  } catch {
    launch.status = "failed";
    launch.error = "Could not start the investigation process.";
    await atomicJson(path.join(directory, "launch.json"), launch);
  }
  return { launch: publicLaunch(launch), summary: null };
}

/** Never serialize service secrets or local file locations in an API response. */
export function publicArtifacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicArtifacts);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(perfil_id|estate_path|engine_output|api_key|service_role_key|password|secret|access_token|refresh_token)$/i.test(key)).map(([key, item]) => [key, key === "input_ref" && typeof item === "string" && item.startsWith("/") ? "snapshot local" : publicArtifacts(item)]));
  }
  return value;
}
