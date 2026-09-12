"use client";

import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { FamiliaChip } from "@/components/shared/badges";
import type { CasoDetalle } from "@/lib/data";

/**
 * 09 §3, derecha: paneles en acordeón Pistas/Evidencia/Defensa/Dictamen.
 * `no_evaluable` se muestra tachada con el motivo; la evidencia distingue
 * validez técnica de refutación; el dictamen nunca dice "definitivo"
 * (CLAUDE.md regla 7 — el tipo `Nivel` ya lo excluye).
 */
export function CasoPanels({ detalle }: { detalle: CasoDetalle }) {
  return (
    <Accordion.Root type="multiple" defaultValue={["pistas", "dictamen"]} className="space-y-2">
      <Panel value="pistas" titulo={`Pistas (${detalle.pistas.length})`}>
        {detalle.pistas.length === 0 ? (
          <Vacio />
        ) : (
          <ul className="space-y-2">
            {detalle.pistas.map((p) => (
              <li key={p.id} className={p.estado === "no_evaluable" ? "opacity-70" : undefined}>
                <div className="flex items-center gap-1.5">
                  <FamiliaChip familia={p.familia} />
                  <span className={p.estado === "no_evaluable" ? "font-mono text-xs line-through" : "font-mono text-xs"} title={p.motivo_no_evaluable}>
                    {p.codigo}
                  </span>
                  <span className="text-xs text-text-subtle">score {p.score.toFixed(2)}</span>
                  <span className="ml-auto rounded-full border border-border px-1.5 text-[10px] text-text-muted">
                    {p.evaluacion_caso?.estado ?? p.estado}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-text-subtle">{p.resumen}</p>
                {p.motivo_no_evaluable && <p className="text-[11px] text-text-subtle">Motivo: {p.motivo_no_evaluable}</p>}
                {p.evaluacion_caso?.motivo && <p className="text-[11px] text-text-subtle">Veredicto del caso: {p.evaluacion_caso.motivo}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel value="evidencia" titulo={`Evidencia (${detalle.evidencia.length})`}>
        {detalle.evidencia.length === 0 ? (
          <Vacio />
        ) : (
          <ul className="space-y-2">
            {detalle.evidencia.map((e) => (
              <li key={e.id} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <FamiliaChip familia={e.familia} />
                  <span>{e.pista_codigo}</span>
                  <span className="text-text-subtle">{e.tipo}</span>
                  <span className="ml-auto font-mono text-text-subtle">{e.ref_id.slice(0, 8)}…</span>
                </div>
                <p className="mt-0.5 text-text-subtle">
                  Técnica: {e.valida_tecnica ? "válida" : "no válida"} · Refutada: {e.refutada ? "sí" : "no"} · {e.validada ? "validada" : "sin validar"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel value="defensa" titulo={`Defensa (${detalle.defensa.length})`}>
        {detalle.defensa.length === 0 ? (
          <Vacio />
        ) : (
          <ul className="space-y-2">
            {detalle.defensa.map((a, i) => {
              const resolucion = detalle.replica?.resoluciones[i];
              return (
                <li key={`${a.trampa_codigo}-${i}`} className="text-xs">
                  <p className="font-medium text-text">{a.trampa_codigo}</p>
                  <p className="text-text-subtle">{a.argumento}</p>
                  <p className="mt-0.5">
                    Resultado: <span className="font-medium">{a.resultado}</span>
                  </p>
                  {resolucion && (
                    <p className="mt-0.5 text-text-subtle">
                      Réplica: <span className={resolucion.decision === "acepta" ? "text-ok" : "text-error"}>{resolucion.decision}</span> — {resolucion.razon}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel value="dictamen" titulo="Dictamen">
        {!detalle.dictamen ? (
          <Vacio />
        ) : (
          <div className="text-xs">
            <div className="mb-1.5 flex flex-wrap gap-1">
              {detalle.dictamen.familias.map((f) => (
                <FamiliaChip key={f} familia={f} />
              ))}
            </div>
            <p className="text-text">{detalle.dictamen.regla}</p>
            <p className="mt-1 text-text-subtle">
              Monto en riesgo: {detalle.dictamen.moneda} {(Number(detalle.dictamen.monto_en_riesgo_centavos) / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
            </p>
            {detalle.dictamen.limitaciones.length > 0 && (
              <p className="mt-1 text-text-subtle">{detalle.dictamen.limitaciones.length} limitación(es) registrada(s).</p>
            )}
            <Link href={`/casos/${detalle.caso.id}/expediente`} className="mt-2 inline-block text-focus hover:underline">
              Ver expediente completo →
            </Link>
          </div>
        )}
      </Panel>
    </Accordion.Root>
  );
}

function Panel({ value, titulo, children }: { value: string; titulo: string; children: React.ReactNode }) {
  return (
    <Accordion.Item value={value} className="rounded-[var(--radius-card)] border border-border bg-surface">
      <Accordion.Header>
        <Accordion.Trigger className="flex w-full items-center justify-between p-3 text-left text-sm font-medium text-text [&[data-state=open]>svg]:rotate-180">
          {titulo}
          <ChevronDown size={16} className="transition-transform" />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="border-t border-border p-3">{children}</Accordion.Content>
    </Accordion.Item>
  );
}

function Vacio() {
  return <p className="text-xs text-text-subtle">Sin datos todavía para este caso.</p>;
}
