// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leerSubmissionEntregable, mismoJson } from "./submission";
import { dirSalidas, RAIZ_REPO, rutaLegible } from "./runner";

const CORRIDA = "68e5ecc1-e506-533f-936e-ec53d833076f";

// Como lo escribe `src/auditor/pipeline.py`: orden de claves de Python y floats con `.0`.
const EN_DISCO = `{
  "seed": 0,
  "findings": [
    {
      "scheme_type": "phantom_vendor",
      "peso_amount": 638000.0,
      "fraud_flag": true
    }
  ],
  "leads_not_pursued": [],
  "run_metadata": {
    "llm_calls": 0,
    "mxn_cost": 0.0,
    "wall_clock_seconds": 0.254
  }
}`;
// Lo mismo tras pasar por jsonb: claves reordenadas, números normalizados.
const PERSISTIDA = {
  seed: 0,
  findings: [{ fraud_flag: true, peso_amount: 638000, scheme_type: "phantom_vendor" }],
  run_metadata: { mxn_cost: 0, llm_calls: 0, wall_clock_seconds: 0.254 },
  leads_not_pursued: [],
};

function fuente(submission: Record<string, unknown> | null | Error) {
  return {
    getAuditorSubmission: async () => {
      if (submission instanceof Error) throw submission;
      return submission;
    },
  };
}

describe("mismoJson", () => {
  it("ignora el orden de claves pero no el de los arreglos ni los valores", () => {
    expect(mismoJson(JSON.parse(EN_DISCO), PERSISTIDA)).toBe(true);
    expect(mismoJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(mismoJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(mismoJson({ a: null }, { a: 0 })).toBe(false);
    expect(mismoJson([], {})).toBe(false);
  });
});

describe("carpeta de salida", () => {
  it("por defecto data/forensic/runs; FORENSE_SALIDA_DIR con ~ o relativa al repo", () => {
    expect(dirSalidas({})).toBe(path.join(RAIZ_REPO, "data", "forensic", "runs"));
    expect(dirSalidas({ FORENSE_SALIDA_DIR: "~/Documents/Forense" })).toBe(path.join(os.homedir(), "Documents", "Forense"));
    expect(dirSalidas({ FORENSE_SALIDA_DIR: "out/entregas" })).toBe(path.join(RAIZ_REPO, "out", "entregas"));
  });

  it("muestra la ruta relativa al repo o con ~", () => {
    expect(rutaLegible(path.join(RAIZ_REPO, "data", "forensic", "runs", CORRIDA, "submission.json"))).toBe(
      path.join("data", "forensic", "runs", CORRIDA, "submission.json"),
    );
    expect(rutaLegible(path.join(os.homedir(), "Documents", "Forense", "x.json"))).toBe(path.join("~", "Documents", "Forense", "x.json"));
  });
});

describe("leerSubmissionEntregable", () => {
  let dir: string;
  const previa = process.env.FORENSE_SALIDA_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "forense-salidas-"));
    process.env.FORENSE_SALIDA_DIR = dir;
  });
  afterEach(async () => {
    if (previa === undefined) delete process.env.FORENSE_SALIDA_DIR;
    else process.env.FORENSE_SALIDA_DIR = previa;
    await rm(dir, { recursive: true, force: true });
  });

  async function escribirEnDisco(texto = EN_DISCO) {
    await mkdir(path.join(dir, CORRIDA), { recursive: true });
    await writeFile(path.join(dir, CORRIDA, "submission.json"), texto);
  }

  it("sirve los bytes exactos del disco cuando dicen lo mismo que lo persistido", async () => {
    await escribirEnDisco();
    const r = await leerSubmissionEntregable(CORRIDA, fuente(PERSISTIDA));
    expect(r).toEqual({
      texto: EN_DISCO,
      origen: "disco",
      ruta: path.join(dir, CORRIDA, "submission.json"),
      nombre: "submission-seed0-68e5ecc1.json",
    });
  });

  it("si el disco no coincide con lo persistido, sirve lo persistido (lo que pinta la UI)", async () => {
    await escribirEnDisco(EN_DISCO.replace("638000.0", "1.0"));
    const r = await leerSubmissionEntregable(CORRIDA, fuente(PERSISTIDA));
    expect(r?.origen).toBe("supabase");
    expect(JSON.parse(r!.texto)).toEqual(PERSISTIDA);
    expect(r?.ruta).toBeNull();
  });

  it("sin archivo en disco sirve lo persistido; sin fila no hay submission aunque exista el archivo", async () => {
    expect((await leerSubmissionEntregable(CORRIDA, fuente(PERSISTIDA)))?.origen).toBe("supabase");
    await escribirEnDisco();
    expect(await leerSubmissionEntregable(CORRIDA, fuente(null))).toBeNull();
  });

  it("si la base falla, el archivo en disco basta; sin ninguno de los dos, null", async () => {
    expect(await leerSubmissionEntregable(CORRIDA, fuente(new Error("caída")))).toBeNull();
    await escribirEnDisco();
    expect((await leerSubmissionEntregable(CORRIDA, fuente(new Error("caída"))))?.origen).toBe("disco");
  });

  it("rechaza ids que no son uuid sin tocar disco ni base", async () => {
    let consultada = false;
    const r = await leerSubmissionEntregable("../../etc/passwd", {
      getAuditorSubmission: async () => {
        consultada = true;
        return PERSISTIDA;
      },
    });
    expect(r).toBeNull();
    expect(consultada).toBe(false);
  });
});
