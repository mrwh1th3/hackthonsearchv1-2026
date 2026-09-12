"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { FAMILIA_NOMBRE, FamiliaChip, NivelBadge } from "@/components/shared/badges";
import { ClusterForceGraph } from "@/components/shared/force-graph";
import type { CasoDetalle, ClusterResumen, ContrasteCaso, EventoForense, GrafoCluster, Senal, TrayectoriaPunto } from "@/lib/data";
import { mapEventoBitacora, mapSenal } from "@/lib/data/supabase";
import { soloHora } from "@/lib/date/formato";
import { useCanalForense } from "@/lib/realtime/usar-canal";
import { cn } from "@/lib/utils";

/**
 * Columna izquierda de la pantalla de resultados del diseño
 * (`design-ref/Agents.dc.html`, bloque `resultsOpen`, líneas 254-314):
 * tarjeta `#f5f4f1` de radio 18px con el botón "Full investigation", la
 * rejilla de stats `repeat(auto-fit,minmax(120px,1fr))`, la tarjeta Timeline
 * con su `Expand/Collapse` y los pasos anidados, y las tarjetas de finding.
 *
 * Lo que cambia respecto del original, y es obligatorio (docs/22 "Lo que el
 * diseño NO tiene y aquí es obligatorio"):
 *
 *   * Los stats del diseño (`48,210`, barras al 45/68/82 %) son **inventados**.
 *     Aquí cada número sale del caso y **la barra sólo existe cuando hay
 *     denominador real** (pistas sostenidas sobre pistas evaluadas, evidencia
 *     válida sobre evidencia). El monto y los reintentos no llevan barra.
 *   * Un finding del diseño es `{title, detail}`. Aquí lleva familia, código
 *     de pista, score, sus **citas por ID** y su **estado de descarte** con el
 *     motivo — sostenida o descartada, nunca una fila muda.
 *   * Se añaden Contraste ("por qué esta sí y aquella no") y Trayectoria, que
 *     el diseño no contempla y el juez pidió (21).
 */
// Módulo, no default inline: `senales = []` en la firma crea un array nuevo
// en cada render cuando el llamador no pasa la prop (p.ej. desde
// `investigacion-vista.tsx`), y ese array "distinto" entraba como dependencia
// del `useEffect` de abajo — setState en cada render, re-render, nuevo `[]`,
// loop infinito ("Maximum update depth exceeded").
const SENALES_VACIAS: Senal[] = [];

export function ResultadosCaso({
  detalle,
  bitacora: bitacoraInicial,
  contraste,
  trayectoria,
  onAbrirReporte,
  cluster = null,
  grafo = null,
  senales = SENALES_VACIAS,
  extraSecciones = null,
  soloResumen = false,
}: {
  detalle: CasoDetalle;
  bitacora: EventoForense[];
  contraste: ContrasteCaso | null;
  trayectoria: TrayectoriaPunto[];
  razonSocialUntrusted?: string | null;
  /** Si viene, "Reporte completo" abre el documento en la misma vista. */
  onAbrirReporte?: () => void;
  /** Cluster del caso: el grafo y el pizarrón viven aquí dentro, no sólo en `/clusters/[id]`. */
  cluster?: ClusterResumen | null;
  grafo?: GrafoCluster | null;
  senales?: Senal[];
  /**
   * Secciones adicionales del mismo llamador (p.ej. el resumen de
   * investigación en `investigacion-vista.tsx`), pintadas dentro de esta
   * misma hoja — nunca en un contenedor aparte apilado encima. Una
   * investigación con varios casos no es una pantalla nueva, es más
   * contenido en la misma.
   */
  extraSecciones?: ReactNode;
  /**
   * Oculta el detalle de ESTE caso (cluster, timeline, findings, defensa,
   * dictamen, contraste, trayectoria) y deja sólo `extraSecciones` — pedido
   * explícito (2026-09-12) al abrir una investigación con varios casos: el
   * resumen ya lista y expande cada caso, repetir el detalle del primero
   * debajo era ruido, no información nueva.
   */
  soloResumen?: boolean;
}) {
  const [expandido, setExpandido] = useState(false);
  const { caso, pistas, evidencia, defensa, dictamen } = detalle;

  /*
   * Timeline **en vivo** (CLAUDE.md regla 2 y regla 12): suscrito a
   * `forense.bitacora` filtrado por `caso_id`, igual que el timeline anterior
   * de esta ruta. Sin esto, una inyección del juez con el sistema corriendo
   * sólo se vería recargando la página — y la reacción en vivo es justo la
   * prueba de 21. Nunca se anima nada que no haya llegado como fila real.
   */
  const [bitacora, setBitacora] = useState<EventoForense[]>(bitacoraInicial);
  useEffect(() => setBitacora(bitacoraInicial), [bitacoraInicial]);
  useCanalForense({
    tabla: "bitacora",
    filtro: `caso_id=eq.${caso.id}`,
    onCambio: (payload) => {
      if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
      const evento = mapEventoBitacora(payload.new as Record<string, unknown>);
      setBitacora((actual) => [...actual.filter((e) => e.id !== evento.id), evento].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)));
    },
  });

  /*
   * Pizarrón del cluster **en vivo** dentro del caso: misma suscripción que
   * `/clusters/[id]`, filtrada por `cluster_id`. Una señal escrita por un
   * especialista durante una inyección aparece aquí sin recargar (regla 2/12).
   */
  const [senalesEnVivo, setSenalesEnVivo] = useState<Senal[]>(senales);
  useEffect(() => setSenalesEnVivo(senales), [senales]);
  useCanalForense({
    tabla: "senales",
    filtro: `cluster_id=eq.${caso.cluster_id}`,
    onCambio: (payload) => {
      if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
      const senal = mapSenal(payload.new as Record<string, unknown>);
      setSenalesEnVivo((actual) => [...actual.filter((s) => s.id !== senal.id), senal]);
    },
  });

  const evaluadas = pistas.filter((p) => p.estado !== "no_evaluable");
  const sostenidas = evaluadas.filter((p) => !(p.evaluacion_caso?.estado ?? "").startsWith("refutada"));
  const evidenciaValida = evidencia.filter((e) => e.valida_tecnica && !e.refutada);

  // Copy en lenguaje llano (feedback 2026-09-12): nadie fuera del equipo sabe
  // qué es un "score" o una "ronda", y las letras D/F/R/T/E de familia no se
  // entienden sin pasar el mouse. Los términos técnicos siguen en el código y
  // en `title=` (para quien sí los conoce), pero el texto visible ya no los
  // usa desnudos.
  const stats: Array<{ label: string; valor: string; nota: string; barra?: number }> = [
    {
      label: "Pistas confirmadas",
      valor: `${sostenidas.length}`,
      nota: `de ${evaluadas.length} revisada${evaluadas.length === 1 ? "" : "s"}${pistas.length > evaluadas.length ? ` · ${pistas.length - evaluadas.length} sin poder revisar` : ""}`,
      barra: evaluadas.length > 0 ? sostenidas.length / evaluadas.length : undefined,
    },
    {
      label: "Pruebas confiables",
      valor: `${evidenciaValida.length}`,
      nota: `de ${evidencia.length} documento${evidencia.length === 1 ? "" : "s"} revisado${evidencia.length === 1 ? "" : "s"}`,
      barra: evidencia.length > 0 ? evidenciaValida.length / evidencia.length : undefined,
    },
    {
      label: "Monto en riesgo",
      valor: `${caso.moneda} ${Number(caso.monto_en_riesgo).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`,
      nota: caso.cobertura_completa ? "Se revisó todo el periodo" : "Falta revisar parte del periodo",
    },
    {
      label: "Intentos de la investigación",
      valor: `${caso.n_reintentos}`,
      nota: caso.presupuesto_agotado ? "Se acabó el tiempo asignado" : "Todavía hay tiempo disponible",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-[18px] border border-border-strong bg-surface-muted p-4">
      {onAbrirReporte ? (
        <button type="button" onClick={onAbrirReporte} className="sticky top-0 z-[1] flex w-full flex-none items-center justify-between gap-2.5 rounded-[13px] border border-border-strong bg-surface px-3.5 py-2.5 text-left shadow-sm transition-colors duration-150 hover:border-border-stronger hover:bg-surface-hover">
        <span className="flex min-w-0 items-center gap-2.5">
          <FileText size={15} strokeWidth={1.8} className="flex-none text-text" aria-hidden />
          <span className="text-[12.5px] font-medium text-text">Reporte completo</span>
        </span>
        <span className="flex-none rounded-[10px] bg-focus px-3 py-1 text-[11.5px] font-medium text-white">Abrir</span>
        </button>
      ) : (
      <Link
        href={`/casos/${caso.id}/expediente`}
        className="sticky top-0 z-[1] flex w-full flex-none items-center justify-between gap-2.5 rounded-[13px] border border-border-strong bg-surface px-3.5 py-2.5 text-left shadow-sm transition-colors duration-150 hover:border-border-stronger hover:bg-surface-hover"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <FileText size={15} strokeWidth={1.8} className="flex-none text-text" aria-hidden />
          <span className="text-[12.5px] font-medium text-text">Reporte completo</span>
        </span>
        <span className="flex-none rounded-[10px] bg-focus px-3 py-1 text-[11.5px] font-medium text-white">Abrir</span>
      </Link>
      )}

      {extraSecciones}

      {!soloResumen && (
      <>
      {/*
        Todo lo que se sabe de esta investigación vive en un solo bloque
        (feedback 2026-09-12): antes las cifras de arriba y el detalle del
        cluster eran dos tarjetas separadas. El texto evita jerga —
        "puntaje de riesgo" en vez de score, "revisión N" en vez de ronda,
        "contribuyentes relacionados" en vez de RFC/satélite, "notas del
        equipo" en vez de pizarrón— y las letras de familia (D/F/R/T/E) ya no
        van solas: cada una lleva su nombre al lado, no sólo en el `title`.
      */}
      <div className="flex flex-col gap-2.5 rounded-[var(--radius-card-sm)] border border-border bg-surface p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Investigación</span>
          <Link href={`/clusters/${caso.cluster_id}`} className="text-[11.5px] text-focus hover:underline">
            Ver en grande
          </Link>
        </div>

        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-1.5 rounded-[13px] border border-border bg-surface-raised px-3.5 py-[11px]">
              <span className="text-[11px] uppercase tracking-[0.03em] text-text-subtle">{s.label}</span>
              <span className="text-[19px] font-semibold tracking-tight text-text">{s.valor}</span>
              {s.barra != null && (
                <span className="block h-[5px] overflow-hidden rounded-[3px] bg-surface-muted">
                  <span className="block h-full rounded-[3px] bg-primary" style={{ width: `${Math.round(s.barra * 100)}%` }} />
                </span>
              )}
              <span className="text-[11.5px] text-text-subtle">{s.nota}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-text-subtle">
          <span className="font-mono text-[12px] text-text" title="identificador interno de la investigación">
            {caso.cluster_id.slice(0, 8)}…
          </span>
          {cluster && (
            <>
              <span>{cluster.n_rfc} contribuyente{cluster.n_rfc === 1 ? "" : "s"} relacionado{cluster.n_rfc === 1 ? "" : "s"}</span>
              <span title="número de vuelta de análisis">· revisión {cluster.ronda_actual}</span>
              <span title="puntaje de riesgo calculado por el sistema">· puntaje de riesgo {cluster.score.toFixed(2)}</span>
              {cluster.nivel && <NivelBadge nivel={cluster.nivel} />}
            </>
          )}
          {caso.rfcs_satelite.length > 0 && (
            <span>· {caso.rfcs_satelite.length} adicional{caso.rfcs_satelite.length === 1 ? "" : "es"} vinculado{caso.rfcs_satelite.length === 1 ? "" : "s"}</span>
          )}
        </div>

        <ClusterForceGraph nodos={grafo?.nodos ?? []} aristas={grafo?.aristas ?? []} height={260} />

        <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Notas del equipo ({senalesEnVivo.length})</span>
        {senalesEnVivo.length === 0 ? (
          <p className="m-0 text-[12px] text-text-subtle">Todavía no hay notas escritas en esta investigación.</p>
        ) : (
          <ul className="m-0 grid gap-1.5 p-0 sm:grid-cols-2">
            {senalesEnVivo.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "flex flex-col gap-1 rounded-[10px] border border-border bg-surface-raised px-2.5 py-2",
                  s.refuta && "border-dashed",
                )}
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <NombreFamilia familia={s.familia} />
                  {s.refuta && <span className="rounded-[var(--radius-pill)] border border-border px-1.5 text-[10px] text-text-subtle">descarta esta pista</span>}
                  <span className="ml-auto rounded-[var(--radius-pill)] border border-border px-1.5 text-[10px] text-text-subtle" title="qué tan seguro está el sistema de esta nota">
                    confianza: {s.confianza}
                  </span>
                </span>
                <span className="text-[12px] leading-snug text-text">{s.titular}</span>
                <span className="flex flex-wrap gap-1">
                  {s.rfcs.map((rfc) => (
                    <span key={rfc} className="rounded-[6px] border border-border bg-surface px-1.5 font-mono text-[10px] text-text-subtle">
                      {rfc}
                    </span>
                  ))}
                </span>
                <span className="text-[10.5px] text-text-subtle">{s.ids.length} documento{s.ids.length === 1 ? "" : "s"} de respaldo</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Timeline: bitácora real del caso (regla 2). El `Expand/Collapse` del
          diseño abre los pasos; aquí los pasos son la herramienta, la ronda y
          el agente del propio evento, no un guion escrito a mano. */}
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

      {/* Findings = pistas del caso, con nivel, familia, citas y descarte. */}
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
            {p.motivo_no_evaluable && (
              <span className="text-[11.5px] text-text-subtle">Motivo: {p.motivo_no_evaluable}</span>
            )}
            {p.evaluacion_caso?.motivo && (
              <span className="text-[11.5px] text-text-subtle">Veredicto del caso: {p.evaluacion_caso.motivo}</span>
            )}
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

      {/* Capa de descarte / Defensor: visible, no escondida en el expediente. */}
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
      </>
      )}

    </div>
  );
}

/**
 * La letra sola (D/F/R/T/E) sólo se entiende con el mouse encima (`title`
 * de `FamiliaChip`). Aquí, junto a la letra, va el nombre en texto plano
 * (feedback 2026-09-12: "nadie sabe qué es" sin pasar el cursor).
 */
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
