import type { CasoDetalle } from "@/lib/data/source";
import type { EventoForense, Familia, Nivel, PistaCodigo } from "@/lib/data/types";

/**
 * Traduce la bitácora técnica de un caso a una línea de tiempo de decisiones
 * en lenguaje llano, para un auditor que no conoce el sistema.
 *
 * Determinista y sin LLM (CLAUDE.md regla 4): cada frase se arma con datos ya
 * persistidos — la bitácora (regla 2), las pistas, las notas de los
 * especialistas, la defensa, la réplica y el dictamen. Si un evento no tiene
 * traducción clara o es mecánica interna (checkpoints, reintentos de
 * transporte, validación de JSON), no se muestra: no aporta a "qué se decidió".
 */

export type Tono = "normal" | "alerta" | "descarte" | "conclusion";

export interface PasoNarrado {
  id: string;
  ts: string;
  titulo: string;
  detalle?: string;
  tono: Tono;
}

/** Nombre llano y qué revisa cada pista (docs/02-factores-correlaciones.md). */
export const PISTA_LLANA: Record<PistaCodigo, { nombre: string; revisa: string }> = {
  D1: { nombre: "Invoices do not match the business activity", revisa: "whether invoiced items match the registered business activity" },
  D2: { nombre: "Capacity to deliver", revisa: "whether invoice volume is supported by staff, purchases and expenses" },
  D3: { nombre: "Montos y conceptos sospechosos", revisa: "whether invoices show unusual amount patterns" },
  D4: { nombre: "Invoice cancellations", revisa: "whether cancellations are frequent or cluster around key dates" },
  F1: { nombre: "Invoices without bank settlement", revisa: "whether collected invoices have matching bank deposits" },
  F2: { nombre: "Pass-through payments", revisa: "whether incoming funds are quickly transferred out" },
  F3: { nombre: "Third-party payments", revisa: "whether the payer differs from the invoice recipient" },
  F4: { nombre: "Dinero que regresa", revisa: "whether funds cycle through accounts and return to their origin" },
  R1: { nombre: "Shared company details", revisa: "whether companies share an address, representative, phone or account" },
  R2: { nombre: "Invoice cycles & chains", revisa: "whether companies invoice each other in cycles or chains" },
  R3: { nombre: "Pocos clientes o proveedores", revisa: "whether business volume is concentrated among a few counterparties" },
  T1: { nombre: "Short-lived company", revisa: "whether a new company quickly invoices large amounts and then stops operating" },
  T2: { nombre: "Fechas sospechosas", revisa: "whether invoice bursts depart from historical activity" },
  E1: { nombre: "Tax-authority watchlists", revisa: "whether the company or its counterparties appear on the SAT 69-B list" },
};

export const FAMILIA_LLANA: Record<Familia, string> = {
  D: "documentos y facturas",
  F: "dinero y bancos",
  R: "relaciones entre empresas",
  T: "dates and behavior over time",
  E: "official SAT lists",
};

export const NIVEL_LLANO: Record<Nivel, { titulo: string; explica: string }> = {
  sin_hallazgos: { titulo: "Sin hallazgos", explica: "No unusual activity was found." },
  anomalia_explicada: { titulo: "Unusual but explained", explica: "Unusual activity was supported by a legitimate explanation." },
  no_concluyente: { titulo: "Inconclusive", explica: "The available information cannot confirm or dismiss the concern." },
  presuncion: {
    titulo: "Suspected simulated transactions",
    explica: "Evidence raises a suspicion that transactions may not be genuine. Final determination belongs to the tax authority.",
  },
  presuncion_alta: {
    titulo: "Strong suspicion of simulated transactions",
    explica: "Multiple sources strongly suggest the transactions may not be genuine. Final determination belongs to the tax authority.",
  },
};

const RECURSO: Array<[RegExp, string]> = [
  [/factura|cfdi/i, "invoices (CFDI)"],
  [/movimiento|banc|flujo/i, "bank transactions"],
  [/nomina/i, "payroll"],
  [/69b|lista/i, "SAT lists"],
  [/grafo|relacion|vincul|atribut/i, "connections with other companies"],
  [/contribuyente|padron|entidad|perfil/i, "taxpayer registry data"],
  [/pago|complemento/i, "payment receipts"],
];

const MESES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function periodoLlano(texto: string): string {
  const m = texto.match(/periodo\s*=\s*(\d{4})-(\d{2})/i);
  if (!m) return "";
  return ` in ${MESES[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

function recursoLlano(texto: string): string {
  const fn = texto.match(/forense_([a-z0-9_]+)/i)?.[1] ?? texto;
  return RECURSO.find(([re]) => re.test(fn))?.[1] ?? "taxpayer information";
}

function hallazgosLlanos(texto: string): string | undefined {
  const m = texto.match(/(\d+)\s+(CFDI|facturas?|movimientos?|cuentas?|contribuyentes?|RFC|registros?)/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const tipo = m[2].toLowerCase();
  const nombre = tipo.startsWith("cfdi") || tipo.startsWith("factura") ? "invoice" : tipo.startsWith("movimiento") ? "transaction" : tipo.startsWith("cuenta") ? "account" : tipo.startsWith("registro") ? "record" : "taxpayer";
  return n === 0 ? `No matching ${nombre}s.` : `Found ${n} ${nombre}${n === 1 ? "" : "s"}.`;
}

const RESULTADO_DEFENSA: Record<string, string> = {
  refuta: "explains the signal",
  parcial: "partly explains the signal",
  no_refuta: "does not explain the signal",
};

function capitalizar(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function narrarInvestigacion(eventos: EventoForense[], detalle: CasoDetalle): PasoNarrado[] {
  const { caso, pistas, senales, defensa, replica, dictamen } = detalle;
  const pasos: PasoNarrado[] = [];
  const orden = [...eventos].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const resultadoPorOperacion = new Map(
    orden.filter((e) => e.tipo_evento === "tool_result" && e.payload.operacion_id).map((e) => [e.payload.operacion_id as string, e]),
  );
  const consumidos = new Set<string>();
  let ronda = 0;
  let senalIdx = 0;

  const add = (e: EventoForense, titulo: string, tono: Tono = "normal", det?: string) =>
    pasos.push({ id: e.id, ts: e.ts, titulo, detalle: det, tono });

  for (const e of orden) {
    if (consumidos.has(e.id)) continue;
    const texto = e.payload.resumen ?? "";

    switch (e.tipo_evento) {
      case "caso_creado":
      case "cluster_armado": {
        const criterios = [...pistas]
          .sort((a, b) => b.score - a.score)
          .map((p) => `${PISTA_LLANA[p.codigo]?.nombre ?? p.codigo}: se revisa ${PISTA_LLANA[p.codigo]?.revisa ?? p.resumen}.`);
        const vinculados = caso.rfcs_satelite.length > 0 ? ` along with ${caso.rfcs_satelite.length} contribuyente${caso.rfcs_satelite.length === 1 ? "" : "s"} vinculado${caso.rfcs_satelite.length === 1 ? "" : "s"}` : "";
        add(
          e,
          `Review opened for ${caso.rfc_principal}${vinculados}`,
          "alerta",
          criterios.length > 0 ? `Se eligió por estas señales de alerta:\n${criterios.join("\n")}` : undefined,
        );
        break;
      }
      case "cluster_expandido":
        add(e, "Review expanded to related companies");
        break;
      case "ronda_inicio":
        ronda += 1;
        add(
          e,
          ronda === 1 ? "Specialist review started" : `Empezó una ${ronda}ª vuelta de análisis`,
          "normal",
          "Reviewing invoices, bank records, company relationships, dates and SAT lists.",
        );
        break;
      case "tool_call": {
        const resultado = e.payload.operacion_id ? resultadoPorOperacion.get(e.payload.operacion_id) : undefined;
        if (resultado) consumidos.add(resultado.id);
        add(e, `Reviewed ${recursoLlano(texto)}${periodoLlano(texto)}`, "normal", resultado ? hallazgosLlanos(resultado.payload.resumen) : undefined);
        break;
      }
      case "tool_result": {
        const encontrado = hallazgosLlanos(texto);
        if (encontrado) add(e, "A check returned its result", "normal", encontrado);
        break;
      }
      case "tool_denegada":
        add(e, "A query was blocked because it was outside the case scope", "descarte");
        break;
      case "senal_escrita": {
        const s = senales[senalIdx++];
        if (s) {
          add(
            e,
            s.refuta ? `The specialist in ${FAMILIA_LLANA[s.familia]} dismissed a suspicion` : `The specialist in ${FAMILIA_LLANA[s.familia]} found a signal`,
            s.refuta ? "descarte" : "alerta",
            `${s.titular}. Certeza: ${s.confianza}.`,
          );
        } else {
          const m = texto.match(/^([DFRTE])\b.*?\b([DFRTE]\d)\b/);
          const fam = m?.[1] as Familia | undefined;
          const pista = m?.[2] as PistaCodigo | undefined;
          add(
            e,
            fam ? `The specialist in ${FAMILIA_LLANA[fam]} found a signal` : "An investigator recorded a finding",
            "alerta",
            pista && PISTA_LLANA[pista] ? `Related to: ${PISTA_LLANA[pista].nombre.toLowerCase()}.` : undefined,
          );
        }
        break;
      }
      case "despertar": {
        const m = texto.match(/\b([DFRTE]\d)\b.*?\ba\s+([DFRTE])\b/);
        const pista = m?.[1] as PistaCodigo | undefined;
        const fam = m?.[2] as Familia | undefined;
        add(
          e,
          fam ? `Requested a specialist review of ${FAMILIA_LLANA[fam]}` : "Another investigator was asked to review",
          "normal",
          pista && PISTA_LLANA[pista] ? `Lo encontrado sobre "${PISTA_LLANA[pista].nombre.toLowerCase()}" needed independent verification.` : undefined,
        );
        break;
      }
      case "ronda_fin":
        add(e, ronda > 1 ? `Terminó la ${ronda}ª vuelta de análisis` : "Specialist review finished");
        break;
      case "frontera_detectada":
        add(e, "Related companies were found outside the reviewed group", "alerta");
        break;
      case "evidencia_descartada":
        add(e, "Unverifiable evidence was excluded", "descarte");
        break;
      case "defensa_inicio": {
        const lineas = defensa.map((d) => {
          // `pista_objetivo` es el id de la pista (a veces su código).
          const codigo = pistas.find((p) => p.id === d.pista_objetivo)?.codigo ?? (d.pista_objetivo as PistaCodigo);
          const nombre = PISTA_LLANA[codigo]?.nombre ?? "this signal";
          return `¿"${nombre}" have a legitimate explanation? ${d.argumento} Resultado: ${RESULTADO_DEFENSA[d.resultado] ?? d.resultado}.`;
        });
        add(e, "Legitimate explanations were tested before concluding", "normal", lineas.join("\n") || undefined);
        break;
      }
      case "replica": {
        const lineas = (replica?.resoluciones ?? []).map((r) => `${r.decision === "acepta" ? "Accepted" : "Not accepted"} the explanation: ${r.razon}`);
        const respaldo = texto.includes(":") ? capitalizar(texto.split(":").slice(1).join(":").trim()) : undefined;
        const rechaza = (replica?.resoluciones ?? []).some((r) => r.decision === "rechaza") || /rechaza/i.test(texto);
        add(e, rechaza ? "The explanation was insufficient" : "The explanation was evaluated", rechaza ? "alerta" : "normal", lineas.join("\n") || respaldo);
        break;
      }
      case "auditoria":
        add(e, "An auditor checked that each conclusion has supporting evidence");
        break;
      case "reintento_inicio":
        add(e, "Review retried with additional information");
        break;
      case "presupuesto_agotado":
        add(e, "This review reached its time limit", "descarte", "The available evidence does not support a stronger conclusion.");
        break;
      case "inyeccion":
        add(e, "New data triggered a fresh review", "alerta");
        break;
      case "dictamen": {
        const nivel = dictamen?.nivel ?? caso.nivel;
        if (!nivel) break;
        const fams = (dictamen?.familias ?? caso.familias_confirmadas).map((f) => FAMILIA_LLANA[f]);
        const base = fams.length > 0 ? `The signals come from ${fams.length} fuente${fams.length === 1 ? "" : "s"} independiente${fams.length === 1 ? "" : "s"}: ${fams.join(" y ")}. ` : "";
        const veredictos = pistas
          .filter((p) => p.evaluacion_caso?.motivo)
          .map((p) => {
            const estado = p.evaluacion_caso!.estado;
            const verbo = estado.startsWith("refutada") ? "was dismissed" : estado.includes("parcial") ? "was partly supported" : "was supported";
            return `${PISTA_LLANA[p.codigo]?.nombre ?? p.codigo}: ${verbo}. ${p.evaluacion_caso!.motivo}`;
          });
        add(e, `Conclusion: ${NIVEL_LLANO[nivel].titulo}`, "conclusion", [`${base}${NIVEL_LLANO[nivel].explica}`, ...veredictos].join("\n"));
        break;
      }
      default:
        break;
    }
  }
  return pasos;
}
