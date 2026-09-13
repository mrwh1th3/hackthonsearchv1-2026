import { describe, expect, it } from "vitest";
import { FixtureDataSource } from "@/lib/data/fixture";
import { narrarInvestigacion } from "./narrativa";

const CASO = "00000000-0000-4000-8000-000000000100";

async function pasosDemo() {
  const ds = new FixtureDataSource();
  const detalle = await ds.getCasoDetalle(CASO);
  const bitacora = await ds.getBitacoraCaso(CASO);
  return { pasos: narrarInvestigacion(bitacora, detalle!), bitacora };
}

describe("narrarInvestigacion — timeline de decisiones en lenguaje llano", () => {
  it("no expone jerga técnica ni nombres de funciones", async () => {
    const { pasos } = await pasosDemo();
    const texto = pasos.map((p) => `${p.titulo}\n${p.detalle ?? ""}`).join("\n");
    for (const jerga of ["tool_call", "tool_result", "forense_", "senal_escrita", "ronda_inicio", "caché", " ms", "barrera", "despierta"]) {
      expect(texto).not.toContain(jerga);
    }
  });

  it("une la consulta con su resultado en un solo paso legible", async () => {
    const { pasos } = await pasosDemo();
    const consulta = pasos.find((p) => p.titulo.startsWith("Reviewed invoices"));
    expect(consulta?.titulo).toContain("January 2026");
    expect(consulta?.detalle).toBe("Found 12 invoices.");
    expect(pasos.some((p) => p.titulo === "A check returned its result")).toBe(false);
  });

  it("explica por qué se abrió el caso con los criterios reales de sus pistas", async () => {
    const { pasos } = await pasosDemo();
    expect(pasos[0].titulo).toMatch(/^Review opened for /);
    expect(pasos[0].detalle).toContain("Capacity to deliver");
  });

  it("termina en la conclusión del dictamen, nunca 'definitivo' (regla 7)", async () => {
    const { pasos } = await pasosDemo();
    const ultimo = pasos.at(-1)!;
    expect(ultimo.tono).toBe("conclusion");
    expect(ultimo.titulo).toBe("Conclusion: Suspected simulated transactions");
    expect(pasos.map((p) => `${p.titulo} ${p.detalle ?? ""}`).join(" ").toLowerCase()).not.toContain("definitiv");
  });

  it("omite eventos de mecánica interna sin traducción", async () => {
    const { pasos } = await pasosDemo();
    const ruido = { id: "x", schema_version: "bitacora.v1" as const, corrida_id: "c", caso_id: CASO, tarea_id: null, seq: 99, ts: "2026-01-31T13:00:00Z", tipo_evento: "checkpoint_guardado", payload: { resumen: "ckpt v3", referencias: [], operacion_id: null } };
    const ds = new FixtureDataSource();
    const conRuido = narrarInvestigacion([...(await ds.getBitacoraCaso(CASO)), ruido], (await ds.getCasoDetalle(CASO))!);
    expect(conRuido).toHaveLength(pasos.length);
  });
});
