import { FixtureBadge } from "@/components/shared/fixture-badge";
import { getDataSource } from "@/lib/data";
import { CoberturaPanel, RecallPorTipologiaPanel } from "./estadisticas-charts";

export const metadata = { title: "Forense · Estadísticas" };
export const dynamic = "force-dynamic";

/**
 * 09 §7 / 21 §2: métricas contra ground truth, con la FPR sobre la cohorte
 * de trampas legítimas destacada aparte (la métrica del pitch). Todo sale de
 * `forense.v_metricas_corrida` (SQL, nunca calculado ad hoc por el LLM,
 * CLAUDE.md regla 4). La vista SQL es hoy una IMPLEMENTACIÓN PARCIAL
 * (db/002_views.sql §8): cuando `parcial: true`, esta página lo muestra
 * arriba de todo con la lista exacta de lo que falta — nunca lo oculta ni
 * completa un número que la vista no calculó (CLAUDE.md regla 10).
 */
export default async function EstadisticasPage() {
  const ds = getDataSource();
  const corridas = await ds.listCorridas();
  const corrida = corridas[0] ?? null;
  const stats = corrida ? await ds.getEstadisticas(corrida.id) : null;

  if (!corrida || !stats) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-text">Estadísticas</h1>
          <FixtureBadge />
        </div>
        <p className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-sm text-text-subtle">Sin estadísticas todavía para ninguna corrida.</p>
      </div>
    );
  }

  const { selectivas, fpr_trampas: fprTrampas, cohorte, cobertura, operacion } = stats;
  const fprPct = fprTrampas.fpr_concluyentes !== null ? fprTrampas.fpr_concluyentes * 100 : null;

  const etapasCobertura = [
    { etapa: "Universo (ground truth)", cantidad: cohorte.total_ground_truth, denominador: cohorte.total_ground_truth },
    { etapa: "Investigados con conclusión", cantidad: cobertura.concluyentes, denominador: cohorte.total_ground_truth },
    { etapa: "Trampas legítimas investigadas", cantidad: cobertura.trampas_investigadas, denominador: cohorte.total_trampas },
  ];

  const recallFilas = Object.entries(stats.recall_por_tipologia).map(([tipologia, v]) => ({ tipologia, ...v }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Estadísticas</h1>
          <p className="text-xs text-text-subtle">
            {corrida.nombre} · dataset {stats.dataset} · corte {new Date(stats.fecha_corte).toLocaleDateString("es-MX")}
          </p>
        </div>
        <FixtureBadge />
      </div>

      {stats.parcial && (
        <div className="rounded-[var(--radius-card)] border border-warn/40 bg-warn/5 p-4 text-sm">
          <p className="font-medium text-warn">Métricas parciales</p>
          <p className="mt-1 text-xs text-text-subtle">
            `forense.v_metricas_corrida` todavía no calcula todo (db/002_views.sql §8). Lo que falta, tal cual lo declara la vista:
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-text-subtle">
            {stats.no_implementado.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* FPR sobre trampas — la métrica del pitch */}
      <div className="rounded-[var(--radius-card)] border-2 border-primary bg-surface p-6 text-center">
        <p className="text-xs uppercase tracking-wide text-text-subtle">Tasa de falsos positivos sobre trampas legítimas</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums text-text">{fprPct !== null ? `${fprPct.toFixed(1)}%` : "—"}</p>
        <p className="mt-1 text-sm text-text-subtle">{fprTrampas.texto} trampas marcadas por error{fprTrampas.sin_conclusion > 0 ? ` · ${fprTrampas.sin_conclusion} sin conclusión` : ""}</p>
        {fprTrampas.n > 0 && (
          <p className="mt-1 text-[11px] text-text-subtle">Con {fprTrampas.n} trampas, cada FP cambia la FPR en {(100 / fprTrampas.n).toFixed(1)} puntos porcentuales.</p>
        )}
      </div>

      <CoberturaPanel etapas={etapasCobertura} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-text">Selectivas (contra ground truth)</h2>
          <table className="w-full border-collapse text-center text-sm">
            <thead>
              <tr>
                <th />
                <th className="p-2 text-xs text-text-subtle">Predicho positivo</th>
                <th className="p-2 text-xs text-text-subtle">Predicho negativo</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="p-2 text-left text-xs text-text-subtle">Real positivo</th>
                <td className="rounded border border-border bg-ok/10 p-3 font-semibold text-ok">{selectivas.tp}</td>
                <td className="rounded border border-border bg-warn/10 p-3 font-semibold text-warn">{selectivas.fn_selectivo}</td>
              </tr>
              <tr>
                <th className="p-2 text-left text-xs text-text-subtle">Real negativo</th>
                <td className="rounded border border-border bg-error/10 p-3 font-semibold text-error">{selectivas.fp}</td>
                <td className="rounded border border-border bg-surface-muted p-3 font-semibold text-text">{selectivas.tn}</td>
              </tr>
            </tbody>
          </table>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Metric label="Precisión" value={selectivas.precision} />
            <Metric label="Recall" value={selectivas.recall} />
            <Metric label="F1" value={selectivas.f1} />
          </dl>
        </section>

        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-text">Operación</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Casos" value={String(operacion.casos)} />
            <Stat label="Reintentos" value={String(operacion.reintentos)} />
            <Stat label="Tool calls" value={String(operacion.tool_calls)} />
            <Stat label="Tokens totales" value={operacion.tokens_total.toLocaleString("es-MX")} />
            <Stat label="Duración p50" value={operacion.duracion_ms_p50 !== null ? `${Math.round(operacion.duracion_ms_p50 / 1000)}s` : "—"} />
            <Stat label="Duración p95" value={operacion.duracion_ms_p95 !== null ? `${Math.round(operacion.duracion_ms_p95 / 1000)}s` : "—"} />
            <Stat label="Presupuesto agotado" value={String(operacion.presupuesto_agotado)} />
            <Stat label="Extremo a extremo (recall)" value={stats.extremo_a_extremo.recall_conservador !== null ? `${Math.round(stats.extremo_a_extremo.recall_conservador * 100)}%` : "—"} />
          </dl>
          {Object.keys(operacion.casos_por_nivel).length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-xs font-medium text-text-muted">Casos por nivel</h3>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(operacion.casos_por_nivel).map(([nivel, n]) => (
                  <Stat key={nivel} label={nivel} value={String(n)} />
                ))}
              </dl>
            </>
          )}
        </section>
      </div>

      {recallFilas.length > 0 && <RecallPorTipologiaPanel filas={recallFilas} />}

      <p className="text-xs text-text-subtle">
        Evolución de precisión/recall/FPR entre corridas por `version_prompts` y comparación de dos corridas lado a lado: pendiente.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded border border-border p-2 text-center">
      <p className="text-text-subtle">{label}</p>
      <p className="font-semibold text-text">{value !== null ? `${Math.round(value * 100)}%` : "—"}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-subtle">{label}</dt>
      <dd className="text-sm font-medium text-text">{value}</dd>
    </div>
  );
}
