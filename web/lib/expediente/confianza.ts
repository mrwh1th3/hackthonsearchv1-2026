import type { CasoDetalle } from "@/lib/data/source";

/**
 * Índice de confianza del análisis de un caso: qué tan sólido es el
 * razonamiento que llevó al resultado, no la probabilidad de fraude.
 *
 * Es aritmética transparente sobre datos persistidos — nunca lo estima un LLM
 * y no altera el nivel del dictamen (CLAUDE.md regla 4). Cada factor se
 * muestra con su valor para que el auditor vea de dónde sale el número. Un
 * factor sin datos no cuenta, en vez de suponerse en 100 %.
 */
export interface FactorConfianza {
  nombre: string;
  valor: number;
  explica: string;
}

export interface ConfianzaAnalisis {
  porcentaje: number | null;
  factores: FactorConfianza[];
}

const CERTEZA: Record<string, number> = { alta: 1, media: 2 / 3, baja: 1 / 3 };
const DEFENSA: Record<string, number> = { no_refuta: 1, parcial: 0.5, refuta: 0 };

export function confianzaAnalisis(detalle: CasoDetalle): ConfianzaAnalisis {
  const { caso, evidencia, pistas, senales, defensa } = detalle;
  const factores: FactorConfianza[] = [];

  if (evidencia.length > 0) {
    const validas = evidencia.filter((e) => e.valida_tecnica && !e.refutada).length;
    factores.push({ nombre: "Pruebas verificadas", valor: validas / evidencia.length, explica: `${validas} de ${evidencia.length} pruebas se pudieron verificar` });
  }

  const evaluadas = pistas.filter((p) => p.estado !== "no_evaluable");
  if (evaluadas.length > 0) {
    const sostenidas = evaluadas.filter((p) => !(p.evaluacion_caso?.estado ?? "").startsWith("refutada")).length;
    factores.push({ nombre: "Señales de alerta confirmadas", valor: sostenidas / evaluadas.length, explica: `${sostenidas} de ${evaluadas.length} señales se sostuvieron al revisarlas` });
  }

  const conCerteza = senales.filter((s) => !s.refuta && CERTEZA[s.confianza] !== undefined);
  if (conCerteza.length > 0) {
    const promedio = conCerteza.reduce((a, s) => a + CERTEZA[s.confianza], 0) / conCerteza.length;
    factores.push({ nombre: "Certeza de los especialistas", valor: promedio, explica: `promedio de ${conCerteza.length} hallazgo${conCerteza.length === 1 ? "" : "s"}` });
  }

  if (defensa.length > 0) {
    const resiste = defensa.reduce((a, d) => a + (DEFENSA[d.resultado] ?? 0.5), 0) / defensa.length;
    factores.push({ nombre: "Resistió explicaciones legítimas", valor: resiste, explica: `${defensa.length} explicación${defensa.length === 1 ? "" : "es"} alternativa${defensa.length === 1 ? "" : "s"} evaluada${defensa.length === 1 ? "" : "s"}` });
  }

  factores.push({
    nombre: "Cobertura del periodo",
    valor: caso.presupuesto_agotado ? 0.5 : caso.cobertura_completa ? 1 : 0.5,
    explica: caso.presupuesto_agotado ? "se agotó el tiempo antes de terminar" : caso.cobertura_completa ? "se revisó todo el periodo" : "faltó revisar parte del periodo",
  });

  // Sólo con cobertura no hay análisis que calificar.
  const porcentaje = factores.length > 1 ? Math.round((factores.reduce((a, f) => a + f.valor, 0) / factores.length) * 100) : null;
  return { porcentaje, factores };
}
