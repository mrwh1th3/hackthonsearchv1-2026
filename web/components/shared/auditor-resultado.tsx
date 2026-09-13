import Link from "next/link";
import type { AuditorHallazgo, AuditorLead, AuditorResultado } from "@/lib/data/source";
import { RastroDinero } from "./rastro-dinero";
import { clavesNoMapeadas, textoValorGenerico } from "@/lib/analisis/claves-no-mapeadas";

/**
 * Todo el contenido de `forense.auditor_resultados` para una corrida, sin
 * filtrar: lo mismo que ven los jueces en `submission.json`/`run_log.json`
 * (docs/23). Extraído de `/auditoria/[corridaId]/page.tsx` para reutilizarlo
 * DENTRO de `/documentos/[id]` (feedback 2026-09-12: "que /documentos no
 * filtre nada") en vez de duplicar el JSX — ambas rutas pintan exactamente
 * este componente. Server-safe a propósito (sin hooks, `<details>` nativo)
 * porque `/auditoria/[corridaId]/page.tsx` es un Server Component; el árbol
 * cliente de `/documentos` lo monta igual de bien.
 *
 * "Sin filtrar" también significa las claves que `src/auditor` escribe y
 * que `AuditorHallazgo`/`AuditorLead`/el objeto raíz todavía no tipan: esas
 * se listan aparte con `ClavesNoMapeadas`, tomadas de `resultado.run_log`
 * crudo (nunca inventadas, nunca omitidas).
 */
export const ESQUEMA: Record<string, string> = {
  phantom_vendor: "Phantom vendor",
  kickback: "Kickback",
  round_tripping: "Round-tripping",
  threshold_splitting: "Split purchases",
  revenue_inflation: "Inflated revenue",
};
export const CERRADO_POR: Record<AuditorLead["closed_by"], string> = {
  investigator: "Investigador",
  challenger: "Revisor adversarial",
  validator: "Validador",
};

export function mxn(v: number) {
  return `MXN ${v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Confianza({ valor }: { valor: AuditorHallazgo["confidence"] }) {
  const estilo = valor === "proven" ? "bg-red-100 text-red-800 border-red-300" : "bg-amber-50 text-amber-800 border-amber-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${estilo}`}>
      {valor === "proven" ? "Proven" : "Probable"}
    </span>
  );
}

export function Tarjeta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-border bg-surface p-5 ${className ?? ""}`}>{children}</div>;
}

const CLAVES_HALLAZGO = [
  "scheme_type", "entities", "subject_name", "rule_broken", "narrative", "peso_amount",
  "confidence", "evidence", "exhibits", "money_trail", "reconciliation", "reconciled_against",
  "defense", "signals", "tool_calls",
] as const;
const CLAVES_LEAD = ["entity", "signal", "signal_detail", "investigated_as", "reason", "tool_calls_made", "closed_by"] as const;
const CLAVES_RAIZ = [
  "corrida_id", "seed", "fingerprint", "estate_sha256", "generado_at", "company_rfc", "period",
  "detector_hits", "leads_investigated", "findings", "leads", "run_metadata", "case_file_html",
] as const;

/**
 * Los dos entregables de los jueces para la corrida: el expediente HTML (se abre) y `submission.json` (se descarga
 * directo, sin editor; `/auditoria/[corridaId]/submission`). Enlaces nativos: este archivo es server-safe.
 */
function AccionesEntregable({ corridaId }: { corridaId: string }) {
  const boton = "rounded-[10px] border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-text hover:bg-surface-hover";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`/auditoria/${corridaId}/expediente`} target="_blank" rel="noreferrer" className={boton}>
          Abrir expediente entregable ↗
        </a>
        <a href={`/auditoria/${corridaId}/submission`} download className={boton}>
          Descargar submission.json
        </a>
      </div>
      <Link href={`/auditoria/${corridaId}`} className="text-[12.5px] text-text-muted hover:underline">
        Open dataset audit ↗
      </Link>
    </div>
  );
}

/** Fila genérica para cualquier clave que la UI tipada no conoce todavía. */
export function ClavesNoMapeadas({ obj, conocidas, titulo }: { obj: unknown; conocidas: readonly string[]; titulo?: string }) {
  const extra = clavesNoMapeadas(obj, conocidas);
  if (extra.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1 rounded-[10px] border border-dashed border-border-strong bg-surface-muted p-2.5">
      <span className="text-[10.5px] uppercase tracking-wide text-text-subtle">{titulo ?? "Other recorded fields"}</span>
      {extra.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-2 text-[11.5px]">
          <span className="truncate font-mono text-text-muted">{k}</span>
          <span className="min-w-0 break-words font-mono text-text">{textoValorGenerico(v)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Componente usado por `/auditoria/[corridaId]` (la corrida completa) Y por
 * `/documentos/[id]` (dentro de una investigación, misma corrida). `resultado
 * === null` no es "sin hallazgos": es "esta corrida no se auditó todavía"
 * (docs/23, mismo criterio que la página de `/auditoria`).
 */
export function AuditorResultadoCompleto({ resultado }: { resultado: AuditorResultado | null }) {
  if (!resultado) {
    return (
      <Tarjeta>
        <p className="text-[14px] text-text">This dataset has not been audited yet.</p>
        <p className="mt-1 text-[13px] text-text-muted">
          This is not a finding of no fraud. No result is saved in <code className="font-mono text-[12px]">forense.auditor_resultados</code>.
        </p>
      </Tarjeta>
    );
  }
  const r = resultado;
  const total = r.findings.reduce((s, f) => s + f.peso_amount, 0);
  const probados = r.findings.filter((f) => f.confidence === "proven").length;
  const md = r.run_metadata;

  return (
    <div className="flex flex-col gap-4">
      <AccionesEntregable corridaId={r.corrida_id} />

      <Tarjeta>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            ["Findings", `${r.findings.length}`, `${probados} probados · ${r.findings.length - probados} probables`],
            ["Total flagged amount", mxn(total), "sum of reconciled finding amounts"],
            ["Leads cerrados", `${r.leads.length}`, `${r.detector_hits} detector alerts`],
            ["Llamadas LLM · costo", `${md.llm_calls} · MXN ${md.mxn_cost.toFixed(2)}`, `modo ${md.llm_mode ?? "off"}`],
            ["Tiempo", `${md.wall_clock_seconds.toFixed(2)} s`, md.deterministic ? "determinista" : "no determinista"],
          ].map(([t, v, s]) => (
            <div key={t}>
              <div className="text-[11.5px] uppercase tracking-wide text-text-muted">{t}</div>
              <div className="mt-1 text-[18px] font-medium tabular-nums text-text">{v}</div>
              <div className="text-[12px] text-text-muted">{s}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-text-muted">
          Empresa {r.company_rfc} · periodo {r.period?.[0]} a {r.period?.[1]} · seed {r.seed} · huella{" "}
          <code className="font-mono">{r.fingerprint.slice(0, 16)}</code>
        </p>
        <ClavesNoMapeadas obj={r.run_log} conocidas={CLAVES_RAIZ} titulo="Other run-log fields" />
        <ClavesNoMapeadas obj={md} conocidas={["llm_calls", "mxn_cost", "wall_clock_seconds", "deterministic", "llm_mode"]} titulo="Other run metadata" />
      </Tarjeta>

      <section className="flex flex-col gap-4">
        <h2 className="text-[16px] font-medium text-text">Hallazgos ({r.findings.length})</h2>
        {r.findings.length === 0 && (
          <Tarjeta>
            <p className="text-[14px] text-text">No pattern survived investigation and validation.</p>
          </Tarjeta>
        )}
        {r.findings.map((f, i) => (
          <HallazgoCard key={`${f.scheme_type}-${f.entities.join()}`} f={f} indice={i} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[16px] font-medium text-text">Leads investigados y cerrados ({r.leads.length})</h2>
        <p className="text-[13px] text-text-muted">
          Dismissed alerts with supporting evidence and checks performed.
        </p>
        <TablaLeads leads={r.leads} />
      </section>
    </div>
  );
}

/**
 * Un hallazgo del auditor determinista, con toda su evidencia — usado tanto
 * por el volcado completo (`AuditorResultadoCompleto`, `/auditoria`) como
 * por la card de un caso individual en `/documentos/[id]` (feedback
 * 2026-09-12: la misma info, pero solo la del caso al que pertenece).
 */
export function HallazgoCard({ f, indice }: { f: AuditorHallazgo; indice?: number }) {
  const etiquetas: Record<string, string> = { COMPANY: "Empresa auditada" };
  for (const e of f.entities) etiquetas[e] = e.startsWith("RFC:") ? f.subject_name.split(" / ")[0] : "Empleado";
  return (
    <details className="group rounded-[14px] border border-border bg-surface" open={indice === undefined}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-5">
        {indice !== undefined && <span className="text-[12px] text-text-muted">#{indice + 1}</span>}
        <span className="text-[15px] font-medium text-text">{ESQUEMA[f.scheme_type] ?? f.scheme_type}</span>
        <span className="font-mono text-[12.5px] text-text-muted">{f.entities.join(", ")}</span>
        <span className="ml-auto text-[15px] font-medium tabular-nums text-text">{mxn(f.peso_amount)}</span>
        <Confianza valor={f.confidence} />
      </summary>
      <div className="flex flex-col gap-4 border-t border-border px-5 pb-5 pt-4">
        <div>
          <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Rule violated</div>
          <p className="mt-1 text-[13.5px] text-text">{f.rule_broken}</p>
        </div>
        <div>
          <div className="text-[11.5px] uppercase tracking-wide text-text-muted">What happened</div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-text">{f.narrative}</p>
        </div>
        <div>
          <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Follow the money</div>
          <div className="mt-2 rounded-[10px] border border-border bg-white p-3">
            <RastroDinero pasos={f.money_trail} etiquetas={etiquetas} />
          </div>
        </div>
        <div>
          <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Exhibits</div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-text-muted">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Exhibit</th>
                  <th className="py-1.5 pr-3 font-medium">Tabla</th>
                  <th className="py-1.5 pr-3 font-medium">Record</th>
                  <th className="py-1.5 font-medium">What this proves</th>
                </tr>
              </thead>
              <tbody>
                {f.exhibits.map((x) => (
                  <tr key={x.exhibit_id} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3 font-mono">{x.exhibit_id}</td>
                    <td className="py-1.5 pr-3 font-mono text-text-muted">{x.source_table}</td>
                    <td className="py-1.5 pr-3 font-mono">{x.record_id}</td>
                    <td className="py-1.5 text-text">{x.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Reconciliation</div>
          <p className="mt-1 text-[13px] tabular-nums text-text">
            {f.reconciliation.items.map(([id, v]) => `${mxn(v)} (${id})`).join(" + ")} ={" "}
            <b>{mxn(f.reconciliation.items.reduce((s, [, v]) => s + v, 0))}</b>
          </p>
          {f.reconciled_against && (
            <p className="text-[12px] text-text-muted">
              Validator: closest reconciling table <code className="font-mono">{f.reconciled_against.table}</code> ={" "}
              {mxn(f.reconciled_against.sum)}, within 2%. All cited records exist.
            </p>
          )}
        </div>
        <div>
          <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Evidence & adversarial review</div>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-text">
            {f.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
            {f.defense.map((d) => (
              <li key={d.argument} className="rounded-[10px] bg-surface-muted px-3 py-2">
                <span className="font-medium text-text">{d.by === "llm" ? "Defensa (LLM)" : "Revisor"}:</span>{" "}
                <span className="text-text">{d.argument}</span>{" "}
                <span className={d.held ? "text-green-700" : "text-red-700"}>{d.held ? "El hallazgo se sostiene:" : "Not supported:"}</span>{" "}
                <span className="text-text-muted">{d.why}</span>
              </li>
            ))}
          </ul>
        </div>
        {(f.signals?.length || f.tool_calls?.length) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {f.signals && f.signals.length > 0 && (
              <div>
                <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Signals</div>
                <p className="mt-1 text-[12.5px] text-text-muted">{f.signals.join(", ")}</p>
              </div>
            )}
            {f.tool_calls && f.tool_calls.length > 0 && (
              <div>
                <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Herramientas consultadas</div>
                <p className="mt-1 text-[12.5px] text-text-muted">{f.tool_calls.join(", ")}</p>
              </div>
            )}
          </div>
        )}
        <ClavesNoMapeadas obj={f} conocidas={CLAVES_HALLAZGO} />
      </div>
    </details>
  );
}

/** Tabla de leads cerrados (uno o varios), reutilizada por caso y por la sección "Corrida". */
export function TablaLeads({ leads }: { leads: AuditorLead[] }) {
  if (leads.length === 0) return <p className="text-[13px] text-text-subtle">Sin leads relacionados.</p>;
  return (
    <>
      <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
        <table className="w-full text-left text-[13px]">
          <thead className="text-text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Entity</th>
              <th className="px-4 py-2 font-medium">Signal</th>
              <th className="px-4 py-2 font-medium">Why it was closed</th>
              <th className="px-4 py-2 font-medium">Herramientas</th>
              <th className="px-4 py-2 font-medium">Closed by</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={`${l.investigated_as}-${l.entity}-${l.signal}`} className="border-t border-border align-top">
                <td className="px-4 py-2">
                  <div className="font-mono">{l.entity}</div>
                  <div className="text-[12px] text-text-muted">como {ESQUEMA[l.investigated_as]?.toLowerCase() ?? l.investigated_as}</div>
                </td>
                <td className="px-4 py-2">
                  <div>{l.signal}</div>
                  <div className="text-[12px] text-text-muted">{l.signal_detail}</div>
                </td>
                <td className="min-w-[360px] px-4 py-2 text-text">{l.reason}</td>
                <td className="px-4 py-2 text-[12px] text-text-muted">{l.tool_calls_made.join(", ")}</td>
                <td className="whitespace-nowrap px-4 py-2">{CERRADO_POR[l.closed_by] ?? l.closed_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {leads.map((l) => {
        const extra = clavesNoMapeadas(l, CLAVES_LEAD);
        if (extra.length === 0) return null;
        return <ClavesNoMapeadas key={`${l.entity}-extra`} obj={l} conocidas={CLAVES_LEAD} titulo={`Other fields in ${l.entity}`} />;
      })}
    </>
  );
}

/**
 * Lo que sobra de la corrida y NO pertenece a ningún caso mostrado (feedback
 * 2026-09-12): `run_metadata`/stats globales, y los hallazgos/leads que no
 * emparejaron con ningún caso de `inv.caso_ids` (`lib/analisis/emparejar-auditor.ts`).
 * Nada se pierde: lo que no cae dentro de un caso cae aquí.
 */
export function SeccionCorridaAuditor({
  resultado,
  hallazgosSinCaso,
  leadsSinCaso,
}: {
  resultado: AuditorResultado | null;
  hallazgosSinCaso: AuditorHallazgo[];
  leadsSinCaso: AuditorLead[];
}) {
  if (!resultado) {
    return (
      <Tarjeta>
        <p className="text-[14px] text-text">This dataset has not been audited yet.</p>
      </Tarjeta>
    );
  }
  const r = resultado;
  const total = r.findings.reduce((s, f) => s + f.peso_amount, 0);
  const probados = r.findings.filter((f) => f.confidence === "proven").length;
  const md = r.run_metadata;
  return (
    <div className="flex flex-col gap-4">
      <AccionesEntregable corridaId={r.corrida_id} />
      <Tarjeta>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            ["Hallazgos (corrida)", `${r.findings.length}`, `${probados} probados · ${r.findings.length - probados} probables`],
            ["Total flagged amount", mxn(total), "sum of reconciled finding amounts"],
            ["Leads cerrados (corrida)", `${r.leads.length}`, `${r.detector_hits} detector alerts`],
            ["Llamadas LLM · costo", `${md.llm_calls} · MXN ${md.mxn_cost.toFixed(2)}`, `modo ${md.llm_mode ?? "off"}`],
            ["Tiempo", `${md.wall_clock_seconds.toFixed(2)} s`, md.deterministic ? "determinista" : "no determinista"],
          ].map(([t, v, s]) => (
            <div key={t}>
              <div className="text-[11.5px] uppercase tracking-wide text-text-muted">{t}</div>
              <div className="mt-1 text-[18px] font-medium tabular-nums text-text">{v}</div>
              <div className="text-[12px] text-text-muted">{s}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-text-muted">
          Empresa {r.company_rfc} · periodo {r.period?.[0]} a {r.period?.[1]} · seed {r.seed} · huella{" "}
          <code className="font-mono">{r.fingerprint.slice(0, 16)}</code>
        </p>
        <ClavesNoMapeadas obj={r.run_log} conocidas={CLAVES_RAIZ} titulo="Other run-log fields" />
        <ClavesNoMapeadas obj={md} conocidas={["llm_calls", "mxn_cost", "wall_clock_seconds", "deterministic", "llm_mode"]} titulo="Other run metadata" />
      </Tarjeta>

      {hallazgosSinCaso.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[16px] font-medium text-text">
            Findings without a linked case ({hallazgosSinCaso.length})
          </h2>
          <p className="text-[13px] text-text-muted">
            Recorded in <code className="font-mono">forense.auditor_resultados</code> but not matched to a case in{" "}
            <code className="font-mono">inv.caso_ids</code> (pattern and entities do not match any listed case).
          </p>
          {hallazgosSinCaso.map((f) => (
            <HallazgoCard key={`${f.scheme_type}-${f.entities.join()}`} f={f} />
          ))}
        </section>
      )}

      {leadsSinCaso.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[16px] font-medium text-text">Leads without a linked case ({leadsSinCaso.length})</h2>
          <p className="text-[13px] text-text-muted">These leads share no entity with the displayed cases.</p>
          <TablaLeads leads={leadsSinCaso} />
        </section>
      )}
    </div>
  );
}
