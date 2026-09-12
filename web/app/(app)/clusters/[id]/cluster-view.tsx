"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { FamiliaChip } from "@/components/shared/badges";
import { ClusterForceGraph } from "@/components/shared/force-graph";
import { cn } from "@/lib/utils";
import { familiaDeAgente, FAMILIAS_ORDEN } from "@/lib/agents/familia";
import type { Familia, GrafoCluster, Senal, Tarea } from "@/lib/data";

// Tailwind escanea literales estáticos: una clase construida con template
// string (`bg-fam-${x}`) nunca se genera. Este mapa evita ese error.
const PUNTO_CLASE: Record<Familia, string> = { D: "bg-fam-d", F: "bg-fam-f", R: "bg-fam-r", T: "bg-fam-t", E: "bg-fam-e" };
const BORDE_CLASE: Record<Familia, string> = {
  D: "border-l-fam-d",
  F: "border-l-fam-f",
  R: "border-l-fam-r",
  T: "border-l-fam-t",
  E: "border-l-fam-e",
};

/**
 * 09 §2 — vista estrella del demo: carriles de especialistas, pizarrón y
 * grafo. Los puntos de carril son tareas/señales realmente persistidas en
 * el fixture, nunca inventadas: un cluster sin tareas (201/202 en este
 * fixture) muestra sus cinco carriles vacíos, no puntos fabricados.
 */
export function ClusterView({ tareas, senales, grafo }: { tareas: Tarea[]; senales: Senal[]; grafo: GrafoCluster | null }) {
  const [senalAbierta, setSenalAbierta] = useState<Senal | null>(null);

  const tiempos = tareas.map((t) => new Date(t.iniciado).getTime());
  const min = tiempos.length ? Math.min(...tiempos) : 0;
  const max = tiempos.length ? Math.max(...tiempos) : 1;
  const rango = max - min || 1;

  const tareasPorFamilia = useMemo(() => {
    const m = new Map<Familia, Tarea[]>(FAMILIAS_ORDEN.map((f) => [f, []]));
    for (const t of tareas) {
      const fam = familiaDeAgente(t.agente);
      if (fam) m.get(fam)!.push(t);
    }
    return m;
  }, [tareas]);

  const presupuestoAgotadoPorFamilia = new Set(
    tareas.filter((t) => t.estado === "presupuesto_agotado" || t.estado === "error").map((t) => familiaDeAgente(t.agente)),
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Carriles */}
      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-text">Carriles de especialistas</h2>
        <div className="space-y-2">
          {FAMILIAS_ORDEN.map((fam) => {
            const ts = tareasPorFamilia.get(fam) ?? [];
            return (
              <div key={fam} className="flex items-center gap-2">
                <FamiliaChip familia={fam} />
                <div className="relative h-8 flex-1 rounded-md bg-surface-muted">
                  {ts.map((t) => {
                    const pos = tiempos.length > 1 ? ((new Date(t.iniciado).getTime() - min) / rango) * 92 + 4 : 48;
                    return (
                      <span
                        key={t.id}
                        title={`${t.agente} · ronda ${t.ronda} · intento ${t.intento} · ${t.estado}`}
                        style={{ left: `${pos}%` }}
                        className={cn(
                          "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface",
                          PUNTO_CLASE[fam],
                        )}
                      />
                    );
                  })}
                  {presupuestoAgotadoPorFamilia.has(fam) && (
                    <span className="absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-error" title="Presupuesto agotado" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-text-subtle">
          Puntos = tareas persistidas de este cluster (agente/ronda/intento/estado al pasar el mouse). Este fixture no incluye eventos
          `tool_call` granulares por especialista todavía.
        </p>
      </section>

      {/* Pizarrón */}
      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-text">Pizarrón</h2>
        {senales.length === 0 ? (
          <p className="text-sm text-text-subtle">Sin señales escritas todavía en este cluster.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {senales.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSenalAbierta(s)}
                  className={cn(
                    "w-full rounded-[var(--radius-input)] border-l-4 bg-surface-muted p-2.5 text-left text-xs hover:bg-surface-hover",
                    s.refuta ? "border-l-info" : BORDE_CLASE[s.familia],
                  )}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <FamiliaChip familia={s.familia} />
                    {s.refuta && <span className="rounded-full bg-info/10 px-1.5 text-[10px] text-info">refuta</span>}
                    <span className="ml-auto rounded-full border border-border px-1.5 text-[10px] text-text-subtle">{s.confianza}</span>
                  </div>
                  <p className="line-clamp-2 text-text">{s.titular}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.rfcs.map((rfc) => (
                      <span key={rfc} className="rounded-full border border-border px-1.5 font-mono text-[10px] text-text-subtle">
                        {rfc}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-text-subtle">{s.ids.length} ID(s) referenciado(s)</p>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-text-subtle">
          Sin señales de ronda 2 en este fixture: no hay flechas de &quot;despertar&quot; que dibujar honestamente todavía.
        </p>
      </section>

      {/* Grafo */}
      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-text">Grafo del cluster</h2>
        <ClusterForceGraph nodos={grafo?.nodos ?? []} aristas={grafo?.aristas ?? []} />
      </section>

      {/* Radix Dialog: Escape cierra, foco atrapado y devuelto al disparador (15 §12) */}
      <Dialog.Root open={Boolean(senalAbierta)} onOpenChange={(open) => !open && setSenalAbierta(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
            <Dialog.Title className="mb-2 font-medium text-text">{senalAbierta?.titular}</Dialog.Title>
            <pre className="overflow-x-auto rounded border border-border bg-surface-muted p-2 text-xs">{JSON.stringify(senalAbierta?.detalle, null, 2)}</pre>
            <Dialog.Close asChild>
              <button type="button" className="mt-3 h-8 rounded-[var(--radius-input)] border border-border px-3 text-xs hover:bg-surface-hover">
                Cerrar
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
