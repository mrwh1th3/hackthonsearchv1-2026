import { readdir } from "node:fs/promises";
import path from "node:path";
import { esUuid, RAIZ_REPO } from "@/lib/auditoria/runner";
import { publicArtifacts, readLab } from "./server";
import { ideasFromRun, type HypothesesIndex } from "./hypotheses";
import type { LabDetail } from "./types";

/** Unlike the navigation's 100-run list, this reads every owner-authorized saved run. */
export async function readHypothesesIndex(perfilId: string): Promise<HypothesesIndex> {
  const result: HypothesesIndex = { entries: [], runs: [], unreadableRuns: 0 };
  let ids: string[];
  try { ids = (await readdir(path.join(RAIZ_REPO, "data", "labs", "runs"))).filter(esUuid); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return result; throw error; }
  // Keep disk concurrency bounded. readLab verifies ownership before any detail read.
  for (let offset = 0; offset < ids.length; offset += 8) {
    const batch = await Promise.all(ids.slice(offset, offset + 8).map(async id => {
      const owned = await readLab(id, perfilId);
      if (!owned) return null;
      try { return await readLab(id, perfilId, true) as LabDetail | null; }
      catch { result.unreadableRuns++; result.runs.push(owned); return null; }
    }));
    for (const run of batch) if (run) {
      result.runs.push({ launch: run.launch, summary: run.summary });
      result.entries.push(...ideasFromRun(run));
    }
  }
  result.runs.sort((a, b) => b.launch.started_at.localeCompare(a.launch.started_at));
  result.entries.sort((a, b) => b.date.localeCompare(a.date));
  return publicArtifacts(result) as HypothesesIndex;
}
