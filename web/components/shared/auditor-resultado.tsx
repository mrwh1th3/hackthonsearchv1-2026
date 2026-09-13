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
  phantom_vendor: "Proveedor fantasma",
  kickback: "Kickback",
  round_tripping: "Round-tripping",
  threshold_splitting: "Fraccionamiento de compras",
  revenue_inflation: "Ingresos inflados",
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
      {valor === "proven" ? "Probado" : "Probable"}
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

/** Fila genérica para cualquier clave que la UI tipada no conoce todavía. */
export function ClavesNoMapeadas({ obj, conocidas, titulo }: { obj: unknown; conocidas: readonly string[]; titulo?: string }) {
  const extra = clavesNoMapeadas(obj, conocidas);
  if (extra.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1 rounded-[10px] border border-dashed border-border-strong bg-surface-muted p-2.5">
      <span className="text-[10.5px] uppercase tracking-wide text-text-subtle">{titulo ?? "Otros campos (no mapeados por la UI)"}</span>
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
        <p className="text-[14px] text-text">Esta corrida todavía no ha sido auditada.</p>
        <p className="mt-1 text-[13px] text-text-muted">
          No es lo mismo que “sin hallazgos”: no hay resultado guardado en <code className="font-mono text-[12px]">forense.auditor_resultados</code>.
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href={`/auditoria/${r.corrida_id}/expediente`}
          target="_blank"
          rel="noreferrer"
          className="rounded-[10px] border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-text hover:bg-surface-hover"
        >
          Abrir expediente entregable ↗
        </a>
        <Link href={`/auditoria/${r.corrida_id}`} className="text-[12.5px] text-text-muted hover:underline">
          Ver esta corrida en /auditoria ↗
        </Link>
      </div>

      <Tarjeta>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            ["Hallazgos", `${r.findings.length}`, `${probados} probados · ${r.findings.length - probados} probables`],
            ["Exposición total", mxn(total), "suma de montos conciliados"],
            ["Leads cerrados", `${r.leads.length}`, `${r.detector_hits} alertas de detectores`],
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
        <ClavesNoMapeadas obj={r.run_log} conocidas={CLAVES_RAIZ} titulo="Otros campos de run_log (raíz)" />
        <ClavesNoMapeadas obj={md} conocidas={["llm_calls", "mxn_cost", "wall_clock_seconds", "deterministic", "llm_mode"]} titulo="Otros campos de run_metadata" />
      </Tarjeta>

      <section className="flex flex-col gap-4">
        <h2 className="text-[16px] font-medium text-text">Hallazgos ({r.findings.length})</h2>
        {r.findings.length === 0 && (
          <Tarjeta>
            <p className="text-[14px] text-text">Ningún esquema sobrevivió investigación y validación.</p>
          </Tarjeta>
        )}
        {r.findings.map((f, i) => {
          const etiquetas: Record<string, string> = { COMPANY: "Empresa auditada" };
          for (const e of f.entities) etiquetas[e] = e.startsWith("RFC:") ? f.subject_name.split(" / ")[0] : "Empleado";
          return (
            <details key={`${f.scheme_type}-${f.entities.join()}`} className="group rounded-[14px] border border-border bg-surface">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-5">
                <span className="text-[12px] text-text-muted">#{i + 1}</span>
                <span className="text-[15px] font-medium text-text">{ESQUEMA[f.scheme_type] ?? f.scheme_type}</span>
                <span className="font-mono text-[12.5px] text-text-muted">{f.entities.join(", ")}</span>
                <span className="ml-auto text-[15px] font-medium tabular-nums text-text">{mxn(f.peso_amount)}</span>
                <Confianza valor={f.confidence} />
              </summary>
              <div className="flex flex-col gap-4 border-t border-border px-5 pb-5 pt-4">
                <div>
                  <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Regla incumplida</div>
                  <p className="mt-1 text-[13.5px] text-text">{f.rule_broken}</p>
                </div>
                <div>
                  <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Qué pasó</div>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-text">{f.narrative}</p>
                </div>
                <div>
                  <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Rastro del dinero</div>
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
                          <th className="py-1.5 pr-3 font-medium">Registro</th>
                          <th className="py-1.5 font-medium">Qué prueba</th>
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
                  <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Conciliación</div>
                  <p className="mt-1 text-[13px] tabular-nums text-text">
                    {f.reconciliation.items.map(([id, v]) => `${mxn(v)} (${id})`).join(" + ")} ={" "}
                    <b>{mxn(f.reconciliation.items.reduce((s, [, v]) => s + v, 0))}</b>
                  </p>
                  {f.reconciled_against && (
                    <p className="text-[12px] text-text-muted">
                      Validador: tabla más cercana <code className="font-mono">{f.reconciled_against.table}</code> ={" "}
                      {mxn(f.reconciled_against.sum)}, dentro de 2%. Todos los registros citados existen.
                    </p>
                  )}
                </div>
                <div>
                  <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Evidencia y revisión adversarial</div>
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
                        <span className={d.held ? "text-green-700" : "text-red-700"}>{d.held ? "El hallazgo se sostiene:" : "No se sostiene:"}</span>{" "}
                        <span className="text-text-muted">{d.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {(f.signals?.length || f.tool_calls?.length) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {f.signals && f.signals.length > 0 && (
                      <div>
                        <div className="text-[11.5px] uppercase tracking-wide text-text-muted">Señales</div>
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
        })}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[16px] font-medium text-text">Leads investigados y cerrados ({r.leads.length})</h2>
        <p className="text-[13px] text-text-muted">
          Cada alerta que no terminó en acusación, con la evidencia que la cerró y las herramientas que se consultaron.
        </p>
        <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="text-text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Entidad</th>
                <th className="px-4 py-2 font-medium">Señal</th>
                <th className="px-4 py-2 font-medium">Por qué se cerró</th>
                <th className="px-4 py-2 font-medium">Herramientas</th>
                <th className="px-4 py-2 font-medium">Cerró</th>
              </tr>
            </thead>
            <tbody>
              {r.leads.map((l) => (
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
        {r.leads.map((l) => {
          const extra = clavesNoMapeadas(l, CLAVES_LEAD);
          if (extra.length === 0) return null;
          return (
            <ClavesNoMapeadas key={`${l.entity}-extra`} obj={l} conocidas={CLAVES_LEAD} titulo={`Otros campos de ${l.entity}`} />
          );
        })}
      </section>
    </div>
  );
}
