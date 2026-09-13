// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { labDirectory } from "./server";
import { readHypothesesIndex } from "./hypotheses-server";

const created: string[] = [];
afterEach(async () => { await Promise.all(created.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function saved(owner: string, title: string) {
  const id = randomUUID(); const dir = labDirectory(id); created.push(dir); await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "launch.json"), JSON.stringify({ run_id: id, perfil_id: owner, corrida_id: randomUUID(), corrida_nombre: title, provider: "mock", status: "completed", started_at: "2026-09-13T08:46:07Z" }));
  await writeFile(path.join(dir, "notes.json"), JSON.stringify([{ title, reason: "Persisted observation", evidence_ids: [], api_key: "should never reach client" }]));
  return id;
}
describe("private hypotheses index", () => {
  it("returns only current-profile artifacts and removes server-only data", async () => {
    const owner = randomUUID(); const id = await saved(owner, "My private idea");
    await saved(randomUUID(), "Another user's private idea");
    const result = await readHypothesesIndex(owner);
    expect(result.runs.map(run => run.launch.run_id)).toEqual([id]);
    expect(result.entries.map(entry => entry.title)).toEqual(["My private idea"]);
    expect(JSON.stringify(result)).not.toContain("Another user's");
    expect(JSON.stringify(result)).not.toContain("api_key");
    expect(JSON.stringify(result)).not.toContain("perfil_id");
  });
  it("includes older investigations beyond the navigation's 100-run limit", async () => {
    const owner = randomUUID();
    await Promise.all(Array.from({ length: 101 }, (_, i) => saved(owner, `Saved idea ${i + 1}`)));
    const result = await readHypothesesIndex(owner);
    expect(result.runs).toHaveLength(101);
    expect(result.entries).toHaveLength(101);
  });
});
