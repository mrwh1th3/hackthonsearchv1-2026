// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { labDirectory, publicArtifacts, readLab, readLabArtifact } from "./server";
import { effectiveStatus } from "./types";
import type { LabLaunch, LabRun } from "./types";

const created: string[] = [];
const owner = "00000000-0000-4000-8000-000000000100";
async function fixture() {
  const id = randomUUID();
  const directory = labDirectory(id);
  created.push(directory);
  await mkdir(directory, { recursive: true });
  const launch: LabLaunch = { run_id: id, perfil_id: owner, corrida_id: randomUUID(), corrida_nombre: "Prueba privada", data_source: "fixture", giro: "Comercio", provider: "mock", status: "completed", started_at: new Date().toISOString() };
  await writeFile(path.join(directory, "launch.json"), JSON.stringify(launch));
  return { id, directory, launch };
}

afterEach(async () => { await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("artefactos privados del laboratorio", () => {
  it("rechaza traversal y nombres de corrida arbitrarios antes de leer disco", () => {
    expect(() => labDirectory("../../.env")).toThrow("ID");
    expect(() => labDirectory("foo")).toThrow("ID");
  });

  it("filtra por perfil y no serializa el propietario", async () => {
    const { id } = await fixture();
    expect(await readLab(id, "otro-perfil", true)).toBeNull();
    const run = await readLab(id, owner, true);
    expect(run?.launch.corrida_nombre).toBe("Prueba privada");
    expect(run?.launch).not.toHaveProperty("perfil_id");
  });

  it("exposes measured report completion without exposing the profile", async () => {
    const { id, directory, launch } = await fixture();
    await writeFile(path.join(directory, "launch.json"), JSON.stringify({ ...launch, phase: "report", timing_scope: "through_report", total_duration_ms: 12345, report_completed_at: "2026-09-13T12:00:00Z" }));
    const run = await readLab(id, owner);
    expect(run?.launch).toMatchObject({ timing_scope: "through_report", total_duration_ms: 12345, report_completed_at: "2026-09-13T12:00:00Z" });
    expect(run?.launch).not.toHaveProperty("perfil_id");
  });

  it("solo permite abrir artefactos referenciados por las trazas de esa investigación", async () => {
    const { id, directory } = await fixture();
    await mkdir(path.join(directory, "tools"));
    await writeFile(path.join(directory, "tools", "001_lookup.json"), JSON.stringify({ rows: [{ record_id: "INV-01" }] }));
    await writeFile(path.join(directory, "tools", "002_unreferenced.json"), JSON.stringify({ private: true }));
    await writeFile(path.join(directory, "traces.jsonl"), JSON.stringify({ span_id: "span-1", output_ref: "tools/001_lookup.json" }) + "\n{incomplete");
    expect(await readLabArtifact(id, owner, "tools/001_lookup.json")).toEqual({ rows: [{ record_id: "INV-01" }] });
    expect(await readLabArtifact(id, "otro-perfil", "tools/001_lookup.json")).toBeNull();
    expect(await readLabArtifact(id, owner, "tools/002_unreferenced.json")).toBeNull();
    expect(await readLabArtifact(id, owner, "../../../../.env")).toBeNull();
    expect(await readLabArtifact(id, owner, "worker.json")).toBeNull();
  });

  it("incluye el motor de la misma ejecución y permite su artefacto sólo al propietario", async () => {
    const { id, directory } = await fixture();
    await mkdir(path.join(directory, "engine"));
    await writeFile(path.join(directory, "engine", "run_log.json"), JSON.stringify({ findings: [{ scheme_type: "phantom_vendor" }] }));
    await writeFile(path.join(directory, "engine_trace.json"), JSON.stringify([{ span_id: "motor", actor: "deterministic", step: "engine.run", output_ref: "engine/run_log.json" }]));
    const run = await readLab(id, owner, true);
    expect(run).toHaveProperty("engine.findings.0.scheme_type", "phantom_vendor");
    expect(await readLabArtifact(id, owner, "engine/run_log.json")).toEqual({ findings: [{ scheme_type: "phantom_vendor" }] });
    expect(await readLabArtifact(id, "other-profile", "engine/run_log.json")).toBeNull();
    expect(await readLabArtifact(id, owner, "engine/../../worker.json")).toBeNull();
  });

  it("distingue una ejecución interrumpida del último summary running", async () => {
    const { id, directory, launch } = await fixture();
    await writeFile(path.join(directory, "launch.json"), JSON.stringify({ ...launch, status: "failed" }));
    await writeFile(path.join(directory, "summary.json"), JSON.stringify({ status: "running" }));
    const run = await readLab(id, owner) as LabRun;
    expect(effectiveStatus(run)).toBe("failed");
  });

  it("no muestra una ejecución abandonada como activa indefinidamente", async () => {
    const { id, directory, launch } = await fixture();
    await writeFile(path.join(directory, "launch.json"), JSON.stringify({ ...launch, status: "running", started_at: new Date(Date.now() - 60 * 60_000).toISOString() }));
    const run = await readLab(id, owner) as LabRun;
    expect(effectiveStatus(run)).toBe("failed");
    expect(run.launch.error).toContain("time limit");
  });

  it("oculta secretos y rutas locales conservando métricas y evidencia", () => {
    expect(publicArtifacts({ total_tokens_in: 103, records: [{ record_id: "INV-01", api_key: "hidden", input_ref: "/private/data/input.json" }], estate_path: "/private/data.db" })).toEqual({ total_tokens_in: 103, records: [{ record_id: "INV-01", input_ref: "snapshot local" }] });
  });
});
