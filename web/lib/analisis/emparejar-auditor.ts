import type { AuditorHallazgo, AuditorLead, AuditorResultado } from "@/lib/data/source";
import type { Caso } from "@/lib/data/types";

/**
 * Emparejamiento determinista caso ↔ hallazgo/lead de `forense.auditor_resultados`
 * (feedback 2026-09-12: "toda esta info esté segmentada... dentro de cada caso
 * solo con la info de su caso"). Se basa en lo que escribe
 * `loaders/auditor_to_investigaciones.py`:
 *
 * - Cada caso de un hallazgo se crea con `idempotency_key = 'auditor:' + caso_id`,
 *   `origen = 'auditor'`, `origen_valor = scheme_type` del hallazgo, y
 *   `rfc_principal` / `rfcs_satelite` = las `entities` del hallazgo (sin el
 *   prefijo `RFC:`, incluyendo entidades no-RFC tal cual, p.ej. `EMPLOYEE:x`).
 * - Cada caso de un lead cerrado usa `origen_valor = signal` (no
 *   `investigated_as`) y una sola entidad en `rfc_principal` — pero esos
 *   casos-lead casi nunca entran al manifiesto de la investigación (el
 *   loader sólo hace `casos.append(cs)` para hallazgos), así que un lead se
 *   asocia a los casos existentes **por intersección de RFC/entidad**, no
 *   por búsqueda de un caso propio. Un lead puede tocar 0, 1 o varios casos.
 *
 * No hay `idempotency_key`/`corrida_id`+índice expuestos en el tipo `Caso`
 * que lee la webapp (no se seleccionan hoy en `lib/data`), así que el
 * emparejamiento de hallazgos usa la clave explícita que sí es pública:
 * `origen_valor` (tipo de esquema) + el conjunto exacto de entidades. Sigue
 * siendo determinista y explícito: mismo input, mismo resultado, sin
 * heurística de texto libre.
 */

export interface EmparejamientoAuditor {
  /** Un hallazgo por caso, cuando el caso es de origen `auditor` y coincide exactamente. */
  porCaso: Map<string, { hallazgo: AuditorHallazgo | null; leads: AuditorLead[] }>;
  /** Hallazgos que no coinciden con ningún caso del listado (p.ej. el caso no está en `inv.caso_ids`). */
  hallazgosSinCaso: AuditorHallazgo[];
  /** Leads que no tocan ningún caso del listado por RFC/entidad. */
  leadsSinCaso: AuditorLead[];
}

function entidadSinPrefijo(e: string): string {
  return e.startsWith("RFC:") ? e.slice(4) : e;
}

function rfcsDeHallazgo(f: AuditorHallazgo): Set<string> {
  return new Set(f.entities.map(entidadSinPrefijo));
}

function rfcsDeCaso(c: Caso): Set<string> {
  return new Set([c.rfc_principal, ...(c.rfcs_satelite ?? [])].filter(Boolean));
}

function mismoConjunto(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Reparte `findings` entre los `casos` de origen `auditor`: cada hallazgo
 * termina en como máximo un caso, y cada caso recibe como máximo un
 * hallazgo (partición 1-a-1, nunca dos casos reclaman el mismo hallazgo).
 * Recorre los hallazgos en su orden original y consume el primer caso libre
 * que calce exactamente en `origen_valor` + conjunto de entidades, para que
 * el resultado sea estable ante duplicados de esquema+entidades.
 */
export function emparejarHallazgos(casos: Caso[], findings: AuditorHallazgo[]): { asignados: Map<string, AuditorHallazgo>; sinCaso: AuditorHallazgo[] } {
  const asignados = new Map<string, AuditorHallazgo>();
  const casosLibres = new Set(casos.filter((c) => c.origen === "auditor").map((c) => c.id));
  const sinCaso: AuditorHallazgo[] = [];

  for (const f of findings) {
    const rfcsHallazgo = rfcsDeHallazgo(f);
    const candidato = casos.find(
      (c) => casosLibres.has(c.id) && c.origen === "auditor" && c.origen_valor === f.scheme_type && mismoConjunto(rfcsDeCaso(c), rfcsHallazgo),
    );
    if (candidato) {
      asignados.set(candidato.id, f);
      casosLibres.delete(candidato.id);
    } else {
      sinCaso.push(f);
    }
  }
  return { asignados, sinCaso };
}

/**
 * Asocia cada lead a todos los casos cuyo RFC principal/satélite incluya la
 * entidad del lead (relacional, no partición: un lead puede describir una
 * entidad que participa en varios casos, o en ninguno de los que se muestran
 * en esta investigación).
 */
export function emparejarLeads(casos: Caso[], leads: AuditorLead[]): { porCaso: Map<string, AuditorLead[]>; sinCaso: AuditorLead[] } {
  const porCaso = new Map<string, AuditorLead[]>();
  const sinCaso: AuditorLead[] = [];

  for (const l of leads) {
    const rfc = entidadSinPrefijo(l.entity);
    const tocados = casos.filter((c) => rfcsDeCaso(c).has(rfc));
    if (tocados.length === 0) {
      sinCaso.push(l);
      continue;
    }
    for (const c of tocados) {
      const lista = porCaso.get(c.id) ?? [];
      lista.push(l);
      porCaso.set(c.id, lista);
    }
  }
  return { porCaso, sinCaso };
}

/** Combina hallazgos y leads en un único mapa por caso más el residuo de "Corrida". */
export function emparejarAuditor(casos: Caso[], resultado: AuditorResultado | null): EmparejamientoAuditor {
  if (!resultado) {
    return { porCaso: new Map(), hallazgosSinCaso: [], leadsSinCaso: [] };
  }
  const { asignados, sinCaso: hallazgosSinCaso } = emparejarHallazgos(casos, resultado.findings);
  const { porCaso: leadsPorCaso, sinCaso: leadsSinCaso } = emparejarLeads(casos, resultado.leads);

  const porCaso = new Map<string, { hallazgo: AuditorHallazgo | null; leads: AuditorLead[] }>();
  for (const c of casos) {
    porCaso.set(c.id, { hallazgo: asignados.get(c.id) ?? null, leads: leadsPorCaso.get(c.id) ?? [] });
  }
  return { porCaso, hallazgosSinCaso, leadsSinCaso };
}
