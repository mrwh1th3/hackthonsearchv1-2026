import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { esUuid } from "@/lib/auditoria/runner";
import { labDirectory, readLab } from "./server";

const FILES = {
  submission: { path: "engine/submission.json", filename: "submission", extension: "json", mime: "application/json; charset=utf-8" },
  expediente: { path: "delivery/case_file.html", filename: "expediente-completo", extension: "html", mime: "text/html; charset=utf-8" },
  motor: { path: "engine/case_file.html", filename: "expediente-motor", extension: "html", mime: "text/html; charset=utf-8" },
} as const;

export type DeliveryKind = keyof typeof FILES;
export type DeliveryStatus = Record<DeliveryKind, boolean>;
export interface LabDelivery { content: string; filename: string; mime: string; inline: boolean }
const MAX_BYTES = 16 * 1024 * 1024;

export function isDeliveryKind(value: unknown): value is DeliveryKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FILES, value);
}

async function safeFile(directory: string, kind: DeliveryKind): Promise<string | null> {
  try {
    const file = await realpath(path.join(directory, FILES[kind].path));
    if (!file.startsWith(`${await realpath(directory)}${path.sep}`)) return null;
    const info = await stat(file);
    return info.isFile() && info.size > 0 && info.size <= MAX_BYTES ? file : null;
  } catch { return null; }
}

export async function inspectDeliveries(runId: string, perfilId: string): Promise<DeliveryStatus | null> {
  if (!esUuid(runId) || !(await readLab(runId, perfilId))) return null;
  const directory = labDirectory(runId);
  const [submission, expediente, motor] = await Promise.all([
    safeFile(directory, "submission"), safeFile(directory, "expediente"), safeFile(directory, "motor"),
  ]);
  return { submission: Boolean(submission), expediente: Boolean(expediente), motor: Boolean(motor) };
}

/** Serve the chosen run's immutable artifact; never fall back to another run or Supabase. */
export async function readDelivery(runId: string, perfilId: string, kind: DeliveryKind): Promise<LabDelivery | null> {
  if (!esUuid(runId) || !isDeliveryKind(kind) || !(await readLab(runId, perfilId))) return null;
  const file = await safeFile(labDirectory(runId), kind);
  if (!file) return null;
  const target = FILES[kind];
  try {
    return {
      content: await readFile(file, "utf8"),
      filename: `${target.filename}-${runId.slice(0, 8)}.${target.extension}`,
      mime: target.mime,
      inline: target.extension === "html",
    };
  } catch { return null; }
}
