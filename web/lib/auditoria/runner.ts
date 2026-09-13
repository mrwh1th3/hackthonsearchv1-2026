import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Puente local al auditor determinista (Python: `src/auditor` + `loaders/`). Solo corre en
 * el servidor Node de este repo, porque el estate subido y el runner viven en disco. Nada
 * del cliente se interpola en la línea de comandos salvo uuids validados y rutas que arma
 * este módulo; se usa `spawn` con argumentos, nunca un shell.
 */
export const RAIZ_REPO = path.resolve(process.cwd(), "..");
export const DIR_ESTATES = path.join(RAIZ_REPO, "data", "forensic", "estates");
export const DIR_UPLOADS = path.join(RAIZ_REPO, "data", "forensic", "uploads");
const PYTHON = process.env.FORENSE_PYTHON ?? "python3";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function rutaEstate(datasetHash: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(datasetHash)) return null;
  const ruta = path.join(DIR_ESTATES, `${datasetHash}.db`);
  return existsSync(ruta) ? ruta : null;
}

/** `structure_report` que dejó `loaders/ingestar_estate.py` junto al estate canónico. */
export function rutaEstructura(datasetHash: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(datasetHash)) return null;
  const ruta = path.join(DIR_ESTATES, `${datasetHash}.structure.json`);
  return existsSync(ruta) ? ruta : null;
}

export function ejecutarPython(args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const hijo = spawn(PYTHON, args, { cwd: RAIZ_REPO, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => hijo.kill("SIGTERM"), timeoutMs);
    hijo.stdout.on("data", (d) => (stdout += d));
    hijo.stderr.on("data", (d) => (stderr += d));
    hijo.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    hijo.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: String(e) });
    });
  });
}

/** Lanza el runner en vivo desacoplado del request: se responde de inmediato y la auditoría sigue en segundo plano. */
export function lanzarAuditoria(args: string[]): void {
  const hijo = spawn(PYTHON, ["loaders/auditoria_en_vivo.py", ...args], {
    cwd: RAIZ_REPO,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  hijo.unref();
}
