"use client";

import { useState } from "react";
import Link from "next/link";
import { FAMILIA_NOMBRE, FamiliaChip, NivelBadge } from "./badges";
import type { CasoDetalle, ContrasteCaso, EventoForense, TrayectoriaPunto } from "@/lib/data";
import { soloHora } from "@/lib/date/formato";
import { cn } from "@/lib/utils";

/**
 * Timeline + hallazgos (citados por ID) + defensa + dictamen + Contraste +
 * Trayectoria de UN caso — extraído de `ResultadosCaso` (docs/22, bloque
 * `resultsOpen`) para poder repetirlo dentro de CADA fila colapsable de
 * `ResumenInvestigacion` sin duplicar JSX (feedback del coordinador
 * 2026-09-12: "/documentos sin filtrar, secciones colapsables"). Nada nuevo
 * se inventa aquí: son los mismos campos de `CasoDetalle`/`ContrasteCaso`/
 * `TrayectoriaPunto` que ya pintaba `ResultadosCaso`.
 */
export function CasoDetalleCompleto({
  detalle,
  bitacora,
  contraste,
  trayectoria,
}: {
  detalle: CasoDetalle;
  bitacora: EventoForense[];
  contraste: ContrasteCaso | null;
  trayectoria: TrayectoriaPunto[];
}) {
  const [expandido, setExpandido] = useState(false);
  const { caso, pistas, evidencia, defensa, dictamen } = detalle;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2.5 rounded-[var(--radius-card-sm)] border border-border bg-surface p-3.5">
        <div className="flex items-center justify-between gap-2.5">
          <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Timeline</span>
          <button
            type="button"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={expandido}
            className="h-[26px] rounded-lg border border-border bg-surface px-2.5 text-[11.5px] text-text-muted transition-colors duration-150 hover:bg-surface-hover"
          >
            {expandido ? "Colapsar" : "Expandir"}
          </button>
        </div>
        <div className="flex flex-col">
          {bitacora.map((e, i) => (
            <div key={e.id} className="grid grid-cols-[74px_14px_minmax(0,1fr)] items-start gap-2.5">
              <span className="pt-px text-[11.5px] text-text-subtle">{soloHora(e.ts)}</span>
              <span className="flex h-full flex-col items-center gap-0.5">
                <span
                  className={cn("mt-[3px] box-border h-2 w-2 rounded-full border-[1.5px] border-primary", i === 0 || i === bitacora.length - 1 ? "bg-primary" : "bg-surface")}
                />
                <span className="min-h-[14px] w-px flex-1 bg-border" />
              </span>
              <span className="flex flex-col gap-0.5 pb-3">
                <span className="text-[13px] text-text">{e.tipo_evento}</span>
                <span className="text-[11.5px] text-text-subtle">{e.payload.resumen}</span>
                {expandido && (
                  <span className="mt-[5px] flex flex-col gap-[3px] rounded-[10px] border border-border bg-surface-raised px-[11px] py-[9px]">
                    <Paso k="Referencias" v={e.payload.referencias.join(", ") || "—"} />
                    <Paso k="Operación" v={e.payload.operacion_id ?? "—"} />
                    <Paso k="Tarea" v={e.tarea_id ?? "—"} />
                  </span>
                )}
              </span>
            </div>
          ))}
          {bitacora.length === 0 && (
            <p className="m-0 py-3 text-[12.5px] text-text-subtle">
              Sin eventos persistidos para este caso: si un paso no escribió en la bitácora, no se pinta.
            </p>
          )}
        </div>
      </div>

      {pistas.map((p) => {
        const veredicto = p.evaluacion_caso?.estado ?? (p.estado === "no_evaluable" ? "no evaluable" : "sin evaluar");
        const descartada = veredicto.startsWith("refutada") || p.estado === "no_evaluable";
        const citas = evidencia.filter((e) => e.pista_codigo === p.codigo).slice(0, 6);
        return (
          <div key={p.id} className="flex flex-col gap-1 rounded-[var(--radius-card-sm)] border border-border bg-surface-raised px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <NombreFamilia familia={p.familia} />
              <span className={cn("font-mono text-[13.5px] font-medium text-text", descartada && "line-through")}>{p.codigo}</span>
              {caso.nivel && <NivelBadge nivel={caso.nivel} />}
              <span className="text-[11.5px] text-text-subtle" title="puntaje de riesgo calculado por el sistema">puntaje de riesgo {p.score.toFixed(2)}</span>
              <span
                className={cn(
                  "ml-auto rounded-[var(--radius-pill)] border px-2 py-0.5 text-[10.5px] uppercase tracking-wide",
                  descartada ? "border-border bg-surface text-text-subtle" : "border-live-border bg-live-bg text-live-fg",
                )}
              >
                {descartada ? "descartada" : "sostenida"}
              </span>
            </div>
            <span className="text-[12.5px] leading-relaxed text-text-subtle">{p.resumen}</span>
            {p.motivo_no_evaluable && <span className="text-[11.5px] text-text-subtle">Motivo: {p.motivo_no_evaluable}</span>}
            {p.evaluacion_caso?.motivo && <span className="text-[11.5px] text-text-subtle">Veredicto del caso: {p.evaluacion_caso.motivo}</span>}
            {(citas.length > 0 || p.referencias.length > 0) && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {citas.length > 0
                  ? citas.map((c) => (
                      <span
                        key={c.id}
                        title={`Técnica: ${c.valida_tecnica ? "válida" : "no válida"} · Refutada: ${c.refutada ? "sí" : "no"} · ${c.validada ? "validada" : "sin validar"}`}
                        className={cn(
                          "rounded-[6px] border px-1.5 py-0.5 font-mono text-[10.5px]",
                          c.valida_tecnica && !c.refutada ? "border-border bg-surface text-text-muted" : "border-border bg-surface-muted text-text-subtle line-through",
                        )}
                      >
                        {c.tipo.toUpperCase()}:{c.ref_id}
                      </span>
                    ))
                  : p.referencias.map((ref) => (
                      <span key={ref} className="rounded-[6px] border border-border bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-text-muted">
                        {ref}
                      </span>
                    ))}
              </div>
            )}
          </div>
        );
      })}
      {pistas.length === 0 && (
        <p className="m-0 rounded-[var(--radius-card-sm)] border border-border bg-surface px-3.5 py-4 text-[12.5px] text-text-subtle">
          Este caso todavía no tiene pistas evaluadas. Ausencia de datos no es «sin hallazgos».
        </p>
      )}

      {defensa.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-card-sm)] border border-border bg-surface px-3.5 py-3">
          <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Defensa — descarte de falsos positivos</span>
          {defensa.map((d) => (
            <p key={`${d.trampa_codigo}-${d.pista_objetivo}`} className="m-0 text-[12.5px] leading-relaxed text-text-muted">
              <span className="font-mono text-text-subtle">{d.pista_objetivo}</span> · {d.resultado.replaceAll("_", " ")} — {d.argumento}
            </p>
          ))}
        </div>
      )}

      {dictamen && (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-card-sm)] border border-border bg-surface px-3.5 py-3">
          <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Dictamen</span>
          <div className="flex items-center gap-2">
            <NivelBadge nivel={dictamen.nivel} />
            <span className="text-[12.5px] text-text">{dictamen.familias.join(" · ") || "sin familias"}</span>
          </div>
          <p className="m-0 text-[12.5px] leading-relaxed text-text-muted">Regla aplicada: {dictamen.regla}</p>
        </div>
      )}

      {contraste && (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-card-sm)] border border-border bg-surface px-3.5 py-3">
          <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Contraste — por qué esta sí y aquella no</span>
          <p className="m-0 text-[12.5px] leading-relaxed text-text">
            Comparable{" "}
            <Link href={`/entidades/${encodeURIComponent(contraste.rfc_comparable)}`} className="font-mono text-focus hover:underline">
              {contraste.rfc_comparable}
            </Link>{" "}
            ({contraste.giro_compartido}) compartió {contraste.pistas_solapadas.join(", ")} y cerró en{" "}
            <NivelBadge nivel={contraste.resultado_comparable} className="align-middle" />.
          </p>
          <p className="m-0 text-[11.5px] text-text-subtle">
            Razón: {contraste.razon_tipificada.replaceAll("_", " ")}. {contraste.explicacion}
          </p>
        </div>
      )}

      {trayectoria.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-card-sm)] border border-border bg-surface px-3.5 py-3">
          <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Trayectoria de {caso.rfc_principal}</span>
          <ul className="m-0 flex flex-col gap-1 p-0">
            {trayectoria.map((t) => (
              <li key={t.periodo} className="flex items-center justify-between gap-3 text-[12px] text-text-muted">
                <span className="font-mono text-text-subtle">{t.periodo}</span>
                <span className="min-w-0 flex-1 truncate">{t.eventos.join(", ") || "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NombreFamilia({ familia }: { familia: Parameters<typeof FamiliaChip>[0]["familia"] }) {
  return (
    <span className="inline-flex items-center gap-1">
      <FamiliaChip familia={familia} />
      <span className="text-[11px] text-text-subtle">{FAMILIA_NOMBRE[familia]}</span>
    </span>
  );
}

function Paso({ k, v }: { k: string; v: string }) {
  return (
    <span className="flex gap-2 text-[11.5px] leading-normal text-text-muted">
      <span className="flex-none text-text-subtle">{k}</span>
      <span className="min-w-0 flex-1">{v}</span>
    </span>
  );
}
