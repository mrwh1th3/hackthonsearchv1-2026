import type { AuditorHallazgo, AuditorResultado } from "@/lib/data/source";

/**
 * "Cadena de explicación" (CLAUDE.md regla 12, docs/21): no existe tabla ni
 * RPC que la persista todavía (columna faltante — ver solicitudes_coordinador
 * de este corte). Mientras tanto, si el caso viene del auditor determinista
 * (`forense.auditor_resultados`, docs/23), se DERIVA de su propia evidencia
 * — nunca se redacta prosa nueva — y se etiqueta como derivada, para que
 * nadie la confunda con una sección propia del pipeline de agentes.
 */
export interface EslabonCadena {
  id: string;
  tipo: "hipotesis" | "evidencia";
  texto: string;
  /** IDs citables (`exhibit_id`/`amount@date`) que respaldan este eslabón. */
  referencias: string[];
}

export interface CadenaExplicacion {
  origen: "auditor_derivada";
  hallazgo: string;
  eslabones: EslabonCadena[];
}

function encontrarHallazgo(resultado: AuditorResultado, rfc: string): AuditorHallazgo | null {
  return resultado.findings.find((f) => f.entities.includes(rfc) || f.subject_name === rfc) ?? null;
}

/**
 * Hipótesis (tipo de esquema + narrativa) seguida de la evidencia en el
 * orden del `money_trail` (la ruta del dinero tal como la reconstruyó el
 * auditor) — cada paso cita su `exhibit_id`. Si no hay `money_trail`, cae a
 * la lista plana `evidence` (siempre en el mismo orden que trae el hallazgo,
 * nunca reordenada por relevancia inventada).
 */
export function derivarCadenaExplicacion(resultado: AuditorResultado | null, rfc: string): CadenaExplicacion | null {
  if (!resultado) return null;
  const hallazgo = encontrarHallazgo(resultado, rfc);
  if (!hallazgo) return null;

  const eslabones: EslabonCadena[] = [
    {
      id: "hipotesis",
      tipo: "hipotesis",
      texto: `${hallazgo.scheme_type.replaceAll("_", " ")} — ${hallazgo.narrative}`,
      referencias: [],
    },
  ];

  if (hallazgo.money_trail.length > 0) {
    hallazgo.money_trail.forEach((paso, i) => {
      eslabones.push({
        id: `paso-${i}`,
        tipo: "evidencia",
        texto: `${paso.from} → ${paso.to}: ${paso.amount.toLocaleString("es-MX")} el ${paso.date}`,
        referencias: [paso.exhibit_id],
      });
    });
  } else {
    hallazgo.evidence.forEach((ref, i) => {
      eslabones.push({ id: `ev-${i}`, tipo: "evidencia", texto: ref, referencias: [ref] });
    });
  }

  return { origen: "auditor_derivada", hallazgo: hallazgo.rule_broken, eslabones };
}
