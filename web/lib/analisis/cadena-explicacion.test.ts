import { describe, expect, it } from "vitest";
import { derivarCadenaExplicacion } from "./cadena-explicacion";
import type { AuditorResultado } from "@/lib/data/source";

const resultadoBase: AuditorResultado = {
  corrida_id: "c1",
  seed: 1,
  fingerprint: "f",
  estate_sha256: "s",
  generado_at: "2026-01-01T00:00:00Z",
  company_rfc: "RFC1",
  period: ["2026-01-01", "2026-01-31"],
  detector_hits: 1,
  leads_investigated: 1,
  findings: [
    {
      scheme_type: "carousel",
      entities: ["RFC1", "RFC2"],
      subject_name: "RFC1",
      rule_broken: "69-B",
      narrative: "Facturación circular entre RFC1 y RFC2.",
      peso_amount: 1000,
      confidence: "proven",
      evidence: ["CFDI:1", "CFDI:2"],
      exhibits: [],
      money_trail: [{ from: "RFC1", to: "RFC2", amount: 500, date: "2026-01-05", exhibit_id: "EX1" }],
      reconciliation: { table: "cfdi", items: [] },
      defense: [],
    },
  ],
  leads: [],
  run_metadata: { llm_calls: 0, mxn_cost: 0, wall_clock_seconds: 0, deterministic: true },
  run_log: {},
};

describe("derivarCadenaExplicacion", () => {
  it("null sin resultado del auditor: no se inventa", () => {
    expect(derivarCadenaExplicacion(null, "RFC1")).toBeNull();
  });

  it("null si el rfc no aparece en ningún hallazgo", () => {
    expect(derivarCadenaExplicacion(resultadoBase, "RFC-AUSENTE")).toBeNull();
  });

  it("deriva hipótesis + evidencia del money_trail, etiquetada como derivada del auditor", () => {
    const cadena = derivarCadenaExplicacion(resultadoBase, "RFC1");
    expect(cadena?.origen).toBe("auditor_derivada");
    expect(cadena?.eslabones[0].tipo).toBe("hipotesis");
    expect(cadena?.eslabones[1]).toEqual({
      id: "paso-0",
      tipo: "evidencia",
      texto: "RFC1 → RFC2: 500 el 2026-01-05",
      referencias: ["EX1"],
    });
  });

  it("sin money_trail, cae a la lista `evidence` en el mismo orden", () => {
    const sinTrail: AuditorResultado = { ...resultadoBase, findings: [{ ...resultadoBase.findings[0], money_trail: [] }] };
    const cadena = derivarCadenaExplicacion(sinTrail, "RFC1");
    expect(cadena?.eslabones.slice(1).map((e) => e.texto)).toEqual(["CFDI:1", "CFDI:2"]);
  });
});
