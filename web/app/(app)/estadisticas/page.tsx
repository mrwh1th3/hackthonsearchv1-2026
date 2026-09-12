import { FixtureBadge } from "@/components/shared/fixture-badge";
import { getDataSource } from "@/lib/data";
import { EmbudoPanel, PorTipologiaPanel } from "./estadisticas-charts";

export const metadata = { title: "Forense · Estadísticas" };

/**
 * 09 §7 / 21 §2: métricas contra ground truth, con la FPR sobre la cohorte
 * de trampas legítimas destacada aparte (la métrica del pitch). Todo sale
 * del fixture/SQL, nunca calculado ad hoc por el LLM (CLAUDE.md regla 4).
 * Comparación entre corridas y evolución por `version_prompts` quedan
 * pendientes: este fixture solo trae una corrida (ver pendientes).
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

  const tp = cuenta(stats.confusion, "positivo", "positivo");
  const fn = cuenta(stats.confusion, "positivo", "negativo");
  const fp = cuenta(stats.confusion, "negativo", "positivo");
  const tn = cuenta(stats.confusion, "negativo", "negativo");
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const fprPct = stats.fpr_trampas.denominador > 0 ? (stats.fpr_trampas.numerador / stats.fpr_trampas.denominador) * 100 : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Estadísticas</h1>
          <p className="text-xs text-text-subtle">{corrida.nombre}</p>
        </div>
        <FixtureBadge />
      </div>

      {/* FPR sobre trampas — la métrica del pitch */}
      <div className="rounded-[var(--radius-card)] border-2 border-primary bg-surface p-6 text-center">
        <p className="text-xs uppercase tracking-wide text-text-subtle">Tasa de falsos positivos sobre trampas legítimas</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums text-text">{fprPct !== null ? `${fprPct.toFixed(1)}%` : "—"}</p>
        <p className="mt-1 text-sm text-text-subtle">
          {stats.fpr_trampas.numerador} / {stats.fpr_trampas.denominador} trampas marcadas por error
        </p>
        <p className="mt-1 text-[11px] text-text-subtle">Con {stats.fpr_trampas.denominador} trampas, cada FP cambia la FPR en {(100 / stats.fpr_trampas.denominador).toFixed(1)} puntos porcentuales.</p>
      </div>

      <EmbudoPanel etapas={stats.embudo} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-text">Matriz de confusión</h2>
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
                <td className="rounded border border-border bg-ok/10 p-3 font-semibold text-ok">{tp}</td>
                <td className="rounded border border-border bg-warn/10 p-3 font-semibold text-warn">{fn}</td>
              </tr>
              <tr>
                <th className="p-2 text-left text-xs text-text-subtle">Real negativo</th>
                <td className="rounded border border-border bg-error/10 p-3 font-semibold text-error">{fp}</td>
                <td className="rounded border border-border bg-surface-muted p-3 font-semibold text-text">{tn}</td>
              </tr>
            </tbody>
          </table>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Metric label="Precisión" value={precision} />
            <Metric label="Recall" value={recall} />
            <Metric label="F1" value={f1} />
          </dl>
        </section>

        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-text">Costo y latencia</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Tokens totales" value={stats.costo.tokens_totales.toLocaleString("es-MX")} />
            <Stat label="Duración total" value={`${Math.round(stats.costo.duracion_ms_total / 1000)}s`} />
            <Stat label="Llamadas totales" value={String(stats.costo.llamadas_totales)} />
            <Stat label="Acierto de caché" value={`${Math.round(stats.costo.tasa_acierto_cache * 100)}%`} />
          </dl>
          <h3 className="mb-2 mt-4 text-xs font-medium text-text-muted">Rondas</h3>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="% ronda 2" value={`${Math.round(stats.rondas.pct_ronda_2 * 100)}%`} />
            <Stat label="% frontera expandida" value={`${Math.round(stats.rondas.pct_frontera_expandida * 100)}%`} />
            <Stat label="% reintento" value={`${Math.round(stats.rondas.pct_reintento * 100)}%`} />
          </dl>
        </section>
      </div>

      <PorTipologiaPanel filas={stats.por_tipologia} />

      <p className="text-xs text-text-subtle">
        Evolución de precisión/recall/FPR entre corridas por `version_prompts` y comparación de dos corridas lado a lado: pendiente
        (este fixture solo trae una corrida).
      </p>
    </div>
  );
}

function cuenta(confusion: Array<{ real: string; predicho: string; cantidad: number }>, real: string, predicho: string): number {
  return confusion.find((c) => c.real === real && c.predicho === predicho)?.cantidad ?? 0;
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
