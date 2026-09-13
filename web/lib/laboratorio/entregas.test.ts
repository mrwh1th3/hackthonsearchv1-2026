// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { labDirectory } from "./server";
import { inspectDeliveries, readDelivery } from "./entregas";

const directories: string[] = [];
const owner = "00000000-0000-4000-8000-000000000100";
async function fixture() {
  const id = randomUUID();
  const directory = labDirectory(id); directories.push(directory);
  await mkdir(path.join(directory, "engine"), { recursive: true });
  await mkdir(path.join(directory, "delivery"));
  await writeFile(path.join(directory, "launch.json"), JSON.stringify({ run_id: id, perfil_id: owner, status: "completed", started_at: new Date().toISOString() }));
  return { id, directory };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("entregables del run seleccionado", () => {
  it("conserva los bytes del submission del motor, sin envolverlos en JSON del laboratorio", async () => {
    const { id, directory } = await fixture();
    const body = '{"seed":4,"findings":[],"leads_not_pursued":[],"run_metadata":{"llm_calls":0,"mxn_cost":0.0,"wall_clock_seconds":0.12}}\n';
    await writeFile(path.join(directory, "engine", "submission.json"), body);
    const delivery = await readDelivery(id, owner, "submission");
    expect(delivery?.content).toBe(body);
    expect(delivery?.inline).toBe(false);
    expect(await inspectDeliveries(id, owner)).toEqual({ submission: true, expediente: false, motor: false });
  });

  it("distingue el expediente completo del expediente del motor", async () => {
    const { id, directory } = await fixture();
    await writeFile(path.join(directory, "engine", "case_file.html"), "<html>Motor</html>");
    await writeFile(path.join(directory, "delivery", "case_file.html"), "<html>Motor y agentes</html>");
    expect((await readDelivery(id, owner, "expediente"))?.content).toContain("Motor y agentes");
    expect((await readDelivery(id, owner, "motor"))?.content).toBe("<html>Motor</html>");
    expect(await readDelivery(id, "otro-perfil", "expediente")).toBeNull();
    expect(await inspectDeliveries(id, "otro-perfil")).toBeNull();
  });

  it("bloquea rutas arbitrarias y symlinks fuera de la investigación", async () => {
    expect(await readDelivery("../../private", owner, "submission")).toBeNull();
    const one = await fixture(); const two = await fixture();
    await writeFile(path.join(two.directory, "engine", "submission.json"), '{"seed":2}');
    await symlink(path.join(two.directory, "engine", "submission.json"), path.join(one.directory, "engine", "submission.json"));
    expect(await readDelivery(one.id, owner, "submission")).toBeNull();
  });
});
