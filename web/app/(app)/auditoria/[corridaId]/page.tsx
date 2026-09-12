import Link from "next/link";
import { getDataSource } from "@/lib/data";
import { requerirSesionServidor } from "@/lib/auth/session";
import { RastroDinero } from "@/components/shared/rastro-dinero";
import type { AuditorHallazgo, AuditorLead } from "@/lib/data/source";

export const metadata = { title: "Forense · Resultados del auditor" };
export const dynamic = "force-dynamic";

const ESQUEMA: Record<string, string> = {
  phantom_vendor: "Proveedor fantasma",
  kickback: "Kickback",
  round_tripping: "Round-tripping",
  threshold_splitting: "Fraccionamiento de compras",
  revenue_inflation: "Ingresos inflados",
};
const CERRADO_POR: Record<AuditorLead["closed_by"], string> = {
  investigator: "Investigador",
  challenger: "Revisor adversarial",
  validator: "Validador",
};

function mxn(v: number) {
  return `MXN ${v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Confianza({ valor }: { valor: AuditorHallazgo["confidence"] }) {
  const estilo = valor === "proven" ? "bg-red-100 text-red-800 border-red-300" : "bg-amber-50 text-amber-800 border-amber-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${estilo}`}>
      {valor === "proven" ? "Probado" : "Probable"}
    </span>
  );
}

function Tarjeta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-border bg-surface p-5 ${className ?? ""}`}>{children}</div>;
}

/**
 * Resultados del auditor determinista (docs/23) para una corrida: lo mismo
 * que se entrega a los jueces — resumen con costos, un bloque por hallazgo
 * (regla, monto, narrativa, rastro del dinero, exhibits, conciliación,
 * revisión adversarial) y los leads cerrados en el cuerpo, no en un anexo.
 * Todo valor sale de `forense.auditor_resultados`; si la corrida no se ha
 * auditado se dice así, nunca "sin hallazgos".
 */
export default async function AuditoriaPage({ params }: { params: Promise<{ corridaId: string }> }) {
  const { corridaId } = await params;
  await requerirSesionServidor();
  const ds = getDataSource();
  const [corrida, r] = await Promise.all([ds.getCorrida(corridaId), ds.getAuditorResultado(corridaId)]);

  const encabezado = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <Link href={`/?corrida=${corridaId}`} className="text-[12.5px] text-text-muted hover:underline">
          ← Volver a la corrida
        </Link>
        <h1 className="mt-1 text-[24px] font-medium tracking-tight text-text">{corrida?.nombre ?? "Corrida"}</h1>
      </div>
      {r && (
        <a
          href={`/auditoria/${corridaId}/expediente`}
          target="_blank"
          rel="noreferrer"
          className="rounded-[10px] border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-text hover:bg-surface-hover"
        >
          Abrir expediente entregable ↗
        </a>
      )}
    </div>
  );

  if (!r) {
    return (
      <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-6 py-10">
        {encabezado}
        <Tarjeta>
          <p className="text-[14px] text-text">Esta corrida todavía no ha sido auditada.</p>
          <p className="mt-1 text-[13px] text-text-muted">
            No es lo mismo que “sin hallazgos”: no hay resultado guardado. Se genera con{" "}
            <code className="font-mono text-[12px]">python3 loaders/auditor_to_forense.py &lt;estate.db&gt;</code>.
          </p>
        </Tarjeta>
      </main>
    );
  }

  const total = r.findings.reduce((s, f) => s + f.peso_amount, 0);
  const probados = r.findings.filter((f) => f.confidence === "proven").length;
  const md = r.run_metadata;

  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 px-6 py-10">
      {encabezado}

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
      </Tarjeta>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-text">Hallazgos</h2>
        {r.findings.length === 0 && (
          <Tarjeta>
            <p className="text-[14px] text-text">Ningún esquema sobrevivió investigación y validación.</p>
          </Tarjeta>
        )}
        {r.findings.map((f, i) => {
          const etiquetas: Record<string, string> = { COMPANY: "Empresa auditada" };
          for (const e of f.entities) etiquetas[e] = e.startsWith("RFC:") ? f.subject_name.split(" / ")[0] : "Empleado";
          return (
            <details key={`${f.scheme_type}-${f.entities.join()}`} open={i === 0} className="group rounded-[14px] border border-border bg-surface">
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
                        <span className="text-green-700">El hallazgo se sostiene:</span> <span className="text-text-muted">{d.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </details>
          );
        })}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-medium text-text">Leads investigados y cerrados ({r.leads.length})</h2>
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
                    <div className="text-[12px] text-text-muted">como {ESQUEMA[l.investigated_as]?.toLowerCase()}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div>{l.signal}</div>
                    <div className="text-[12px] text-text-muted">{l.signal_detail}</div>
                  </td>
                  <td className="min-w-[360px] px-4 py-2 text-text">{l.reason}</td>
                  <td className="px-4 py-2 text-[12px] text-text-muted">{l.tool_calls_made.join(", ")}</td>
                  <td className="whitespace-nowrap px-4 py-2">{CERRADO_POR[l.closed_by]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
