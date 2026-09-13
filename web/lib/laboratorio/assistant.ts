import { spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { RAIZ_REPO } from "@/lib/auditoria/runner";
import { labDirectory } from "./server";
import type { JsonObject, LabDetail } from "./types";

export interface ReportAnswer { request_id: string; question: string; finding_index: number | null; answer: string; references: string[]; created_at: string; usage?: JsonObject }
const records = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter((v): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v)) : [];
export function reportContext(run: LabDetail, index: number | null) {
  const findings = records(run.engine?.findings);
  const selected = index === null ? [] : findings.slice(index, index + 1);
  const references = selected.flatMap(f => records(f.exhibits).map(e => `${e.source_table}:${e.record_id}`));
  return { run_id: run.launch.run_id, dataset: run.launch.corrida_nombre, focus: run.launch.mensaje,
    scope: index === null ? "Summary only; select a finding for its detailed records." : "Selected finding and its saved exhibits; no direct database access.",
    totals: {findings: findings.length, dismissed: records(run.engine?.leads).length},
    finding_index: index, selected_findings: selected,
    finding_index_summary: findings.slice(0, 50).map((f,i) => ({index: i, subject: f.subject_name, pattern: f.scheme_type, amount: f.peso_amount, confidence: f.confidence})),
    ai_reviews: records(run.agent_a?.reviews).filter(r => selected.some(f => f.scheme_type === r.rule_id)).slice(0, 2),
    limitations: run.summary?.coverage?.limitations ?? [], allowed_references: references };
}
export async function readReportAnswers(id: string): Promise<ReportAnswer[]> {
  const dir = path.join(labDirectory(id), "assistant");
  try {
    const files = (await readdir(dir)).filter(f => /^[0-9a-f-]{36}\.json$/.test(f)).sort();
    const results = await Promise.all(files.map(async name => {
      try { const raw = await readFile(path.join(dir,name), "utf8"); return raw.length < 50000 ? JSON.parse(raw) as ReportAnswer : null; } catch { return null; }
    }));
    return results.filter((r): r is ReportAnswer => !!r && typeof r.answer === "string").sort((a,b) => a.created_at.localeCompare(b.created_at)).slice(-100);
  } catch { return []; }
}
export async function askReport(run: LabDetail, question: string, index: number | null, requestId: string): Promise<ReportAnswer> {
  const dir = path.join(labDirectory(run.launch.run_id), "assistant");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const existing = (await readReportAnswers(run.launch.run_id)).find(r => r.request_id === requestId);
  if (existing) { if(existing.question !== question || existing.finding_index !== index) throw new Error("Request ID belongs to a different question."); return existing; }
  const lock = path.join(dir,"active.lock");
  const handle = await open(lock, "wx", 0o600).catch(() => {throw new Error("An answer is already being prepared for this report.");});
  try {
    const context = reportContext(run, index);
    const history = (await readReportAnswers(run.launch.run_id)).slice(-4).map(r => ({question:r.question, answer:r.answer.slice(0,1800), finding_index:r.finding_index}));
    const payload = JSON.stringify({question, context, history});
    if (Buffer.byteLength(payload) > 120000) throw new Error("This finding has too much evidence for one answer. Ask about a smaller finding.");
    await writeFile(path.join(dir, `${requestId}.input.json`), payload, {mode:0o600});
    const result = await new Promise<{answer:string;references:string[];usage:JsonObject}>((resolve,reject) => {
      const child = spawn(process.env.FORENSE_PYTHON ?? "python3", ["-m","labs.report_assistant"], {cwd:RAIZ_REPO, stdio:["pipe","pipe","pipe"]});
      let output = "";
      child.stdout.on("data", (data: Buffer) => { output += data.toString(); if(output.length > 100000) child.kill("SIGTERM"); });
      child.stderr.resume();
      child.once("error", reject);
      child.once("close", code => { try { const body = JSON.parse(output); if(code || !body.answer) throw new Error(body.error || "The assistant could not answer."); resolve(body); } catch(error) {reject(error);} });
      child.stdin.on("error", () => {}); child.stdin.end(payload);
    });
    const answer = {request_id:requestId,question,finding_index:index,...result,created_at:new Date().toISOString()};
    const temp = path.join(dir,`${requestId}.tmp`);
    await writeFile(temp,JSON.stringify(answer),{mode:0o600}); await rename(temp,path.join(dir,`${requestId}.json`));
    return answer;
  } finally { await handle.close(); await unlink(lock); }
}
