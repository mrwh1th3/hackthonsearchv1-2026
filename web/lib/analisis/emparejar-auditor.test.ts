import { describe, expect, it } from "vitest";
import { emparejarAuditor, emparejarHallazgos, emparejarLeads } from "./emparejar-auditor";
import type { AuditorHallazgo, AuditorLead, AuditorResultado } from "@/lib/data/source";
import type { Caso } from "@/lib/data/types";

function caso(id: string, rfc_principal: string, rfcs_satelite: string[], origen_valor: string): Caso {
  return {
    id,
    corrida_id: "corrida-1",
    cluster_id: `cl-${id}`,
    rfc_principal,
    rfcs_satelite,
    estado: "dictaminado",
    nivel: "presuncion_alta",
    tipologia: null,
    origen: "auditor",
    origen_valor,
    familias_confirmadas: [],
    monto_en_riesgo: "1000",
    moneda: "MXN",
    cobertura_completa: true,
    n_reintentos: 0,
    presupuesto_agotado: false,
    creado: "2026-01-01T00:00:00Z",
    terminado: "2026-01-01T00:00:00Z",
  };
}

function hallazgo(scheme_type: string, entities: string[]): AuditorHallazgo {
  return {
    scheme_type,
    entities,
    subject_name: entities[0] ?? "",
    rule_broken: "regla",
    narrative: "narrativa",
    peso_amount: 1000,
    confidence: "proven",
    evidence: ["ev1"],
    exhibits: [],
    money_trail: [],
    reconciliation: { table: "t", items: [] },
    defense: [],
  };
}

function lead(entity: string, signal: string, investigated_as: string): AuditorLead {
  return { entity, signal, signal_detail: "detalle", investigated_as, reason: "no se sostiene", tool_calls_made: [], closed_by: "validator" };
}

describe("emparejarHallazgos", () => {
  it("asigna un hallazgo a exactamente un caso cuando coincide esquema + entidades", () => {
    const casos = [caso("c1", "RFC000101ABC", [], "phantom_vendor")];
    const findings = [hallazgo("phantom_vendor", ["RFC:RFC000101ABC"])];
    const { asignados, sinCaso } = emparejarHallazgos(casos, findings);
    expect(asignados.get("c1")).toBe(findings[0]);
    expect(sinCaso).toHaveLength(0);
  });

  it("particiona: cada hallazgo va a lo más a un caso, ninguno se reclama dos veces", () => {
    // dos hallazgos con mismo scheme_type y mismas entidades (duplicado real, comentado en el loader)
    const casos = [
      caso("c1", "RFC000101ABC", [], "kickback"),
      caso("c2", "RFC000101ABC", [], "kickback"),
    ];
    const findings = [hallazgo("kickback", ["RFC:RFC000101ABC"]), hallazgo("kickback", ["RFC:RFC000101ABC"])];
    const { asignados, sinCaso } = emparejarHallazgos(casos, findings);
    expect(asignados.size).toBe(2);
    expect(new Set(asignados.values()).size).toBe(2); // ambos hallazgos usados, ninguno repetido
    expect(asignados.get("c1")).toBe(findings[0]);
    expect(asignados.get("c2")).toBe(findings[1]);
    expect(sinCaso).toHaveLength(0);
  });

  it("hallazgo sin caso correspondiente en la lista queda en sinCaso (no se pierde, no se inventa)", () => {
    const casos: Caso[] = [];
    const findings = [hallazgo("round_tripping", ["RFC:XXX"])];
    const { asignados, sinCaso } = emparejarHallazgos(casos, findings);
    expect(asignados.size).toBe(0);
    expect(sinCaso).toEqual(findings);
  });

  it("cobertura total: todo hallazgo termina asignado o en sinCaso, conteo exacto", () => {
    const casos = [caso("c1", "A", [], "phantom_vendor"), caso("c2", "B", [], "kickback")];
    const findings = [hallazgo("phantom_vendor", ["RFC:A"]), hallazgo("kickback", ["RFC:B"]), hallazgo("revenue_inflation", ["RFC:Z"])];
    const { asignados, sinCaso } = emparejarHallazgos(casos, findings);
    expect(asignados.size + sinCaso.length).toBe(findings.length);
  });
});

describe("emparejarLeads", () => {
  it("asocia un lead a todos los casos que comparten su entidad", () => {
    const casos = [caso("c1", "A", ["B"], "phantom_vendor"), caso("c2", "B", [], "kickback")];
    const leads = [lead("RFC:B", "monto_atipico", "kickback")];
    const { porCaso, sinCaso } = emparejarLeads(casos, leads);
    expect(porCaso.get("c1")).toEqual(leads);
    expect(porCaso.get("c2")).toEqual(leads);
    expect(sinCaso).toHaveLength(0);
  });

  it("lead que no toca ningún caso listado va a sinCaso", () => {
    const casos = [caso("c1", "A", [], "phantom_vendor")];
    const leads = [lead("RFC:Z", "monto_atipico", "kickback")];
    const { porCaso, sinCaso } = emparejarLeads(casos, leads);
    expect(porCaso.size).toBe(0);
    expect(sinCaso).toEqual(leads);
  });

  it("cobertura: cada lead aparece en algún caso o en sinCaso", () => {
    const casos = [caso("c1", "A", [], "phantom_vendor")];
    const leads = [lead("RFC:A", "s1", "phantom_vendor"), lead("RFC:Z", "s2", "kickback")];
    const { porCaso, sinCaso } = emparejarLeads(casos, leads);
    const cubiertos = new Set([...porCaso.values()].flat());
    for (const l of leads) {
      expect(cubiertos.has(l) || sinCaso.includes(l)).toBe(true);
    }
  });
});

describe("emparejarAuditor", () => {
  it("combina hallazgos y leads por caso, y deja el residuo de la corrida aparte", () => {
    const casos = [caso("c1", "A", [], "phantom_vendor")];
    const resultado: AuditorResultado = {
      corrida_id: "corrida-1",
      seed: 1,
      fingerprint: "f",
      estate_sha256: "s",
      generado_at: "2026-01-01T00:00:00Z",
      company_rfc: "A",
      period: ["2026-01-01", "2026-01-31"],
      detector_hits: 2,
      leads_investigated: 1,
      findings: [hallazgo("phantom_vendor", ["RFC:A"]), hallazgo("kickback", ["RFC:NOCASO"])],
      leads: [lead("RFC:A", "s1", "phantom_vendor"), lead("RFC:NOCASO", "s2", "kickback")],
      run_metadata: { llm_calls: 0, mxn_cost: 0, wall_clock_seconds: 0, deterministic: true },
      run_log: {},
    };
    const { porCaso, hallazgosSinCaso, leadsSinCaso } = emparejarAuditor(casos, resultado);
    expect(porCaso.get("c1")?.hallazgo).toBe(resultado.findings[0]);
    expect(porCaso.get("c1")?.leads).toEqual([resultado.leads[0]]);
    expect(hallazgosSinCaso).toEqual([resultado.findings[1]]);
    expect(leadsSinCaso).toEqual([resultado.leads[1]]);
  });

  it("resultado null: mapa vacío, nada en sinCaso", () => {
    const { porCaso, hallazgosSinCaso, leadsSinCaso } = emparejarAuditor([caso("c1", "A", [], "x")], null);
    expect(porCaso.size).toBe(0);
    expect(hallazgosSinCaso).toHaveLength(0);
    expect(leadsSinCaso).toHaveLength(0);
  });
});
