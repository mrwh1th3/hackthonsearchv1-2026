"use client";

import { FileBraces, FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { FAMILIA_NOMBRE, FamiliaChip, NivelBadge } from "@/components/shared/badges";
import { CasoDetalleCompleto } from "@/components/shared/caso-detalle-completo";
import { ClusterForceGraph } from "@/components/shared/force-graph";
import type { CasoDetalle, ClusterResumen, ContrasteCaso, EventoForense, GrafoCluster, Senal, TrayectoriaPunto } from "@/lib/data";
import { mapEventoBitacora, mapSenal } from "@/lib/data/supabase";
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
  descargaSubmission = null,
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
  /**
   * `submission.json` del auditor para la corrida, junto a "Reporte completo": se descarga directo, sin editor.
   * `ruta` es dónde quedó escrito en disco, si de ahí salen los bytes de la descarga.
   */
  descargaSubmission?: { href: string; ruta: string | null } | null;
}) {
  const { caso, pistas, evidencia } = detalle;

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
      nota: `de ${evaluadas.length} revisada${evaluadas.length === 1 ? "" : "s"}${pistas.length > evaluadas.length ? ` · ${pistas.length - evaluadas.length} not reviewed` : ""}`,
      barra: evaluadas.length > 0 ? sostenidas.length / evaluadas.length : undefined,
    },
    {
      label: "Pruebas confiables",
      valor: `${evidenciaValida.length}`,
      nota: `de ${evidencia.length} documento${evidencia.length === 1 ? "" : "s"} revisado${evidencia.length === 1 ? "" : "s"}`,
      barra: evidencia.length > 0 ? evidenciaValida.length / evidencia.length : undefined,
    },
    {
      label: "Flagged amount",
      valor: `${caso.moneda} ${Number(caso.monto_en_riesgo).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`,
      nota: caso.cobertura_completa ? "Entire period reviewed" : "Part of the period remains unreviewed",
    },
    {
      label: "Investigation attempts",
      valor: `${caso.n_reintentos}`,
      nota: caso.presupuesto_agotado ? "Time limit reached" : "Time remains",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-card-lg border border-border bg-surface-raised p-3 sm:p-5">
      {onAbrirReporte ? (
        <button type="button" onClick={onAbrirReporte} className="sticky top-0 z-[1] flex w-full flex-none items-center justify-between gap-2.5 rounded-[13px] border border-border-strong bg-surface px-3.5 py-2.5 text-left shadow-sm transition-colors duration-150 hover:border-border-stronger hover:bg-surface-hover">
        <span className="flex min-w-0 items-center gap-2.5">
          <FileText size={15} strokeWidth={1.8} className="flex-none text-text" aria-hidden />
          <span className="text-[12.5px] font-medium text-text">Reporte completo</span>
        </span>
        <span className="flex-none rounded-control bg-primary px-3 py-1 text-[11.5px] font-medium text-white">Open</span>
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
        <span className="flex-none rounded-control bg-primary px-3 py-1 text-[11.5px] font-medium text-white">Open</span>
      </Link>
      )}

      {descargaSubmission && (
        <a
          href={descargaSubmission.href}
          download
          className="flex w-full flex-none items-center justify-between gap-2.5 rounded-[13px] border border-border-strong bg-surface px-3.5 py-2.5 text-left shadow-sm transition-colors duration-150 hover:border-border-stronger hover:bg-surface-hover"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <FileBraces size={15} strokeWidth={1.8} className="flex-none text-text" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="text-[12.5px] font-medium text-text">submission.json</span>
              {descargaSubmission.ruta && (
                <span className="truncate font-mono text-[11px] text-text-muted" title={descargaSubmission.ruta}>
                  {descargaSubmission.ruta}
                </span>
              )}
            </span>
          </span>
          <span className="flex-none rounded-control bg-primary px-3 py-1 text-[11.5px] font-medium text-white">Download</span>
        </a>
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
          <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Investigation</span>
          <Link href={`/clusters/${caso.cluster_id}`} className="text-[11.5px] text-focus hover:underline">
            Expand view
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
          <span className="font-mono text-[12px] text-text" title="Investigation identifier">
            {caso.cluster_id.slice(0, 8)}…
          </span>
          {cluster && (
            <>
              <span>{cluster.n_rfc} contribuyente{cluster.n_rfc === 1 ? "" : "s"} relacionado{cluster.n_rfc === 1 ? "" : "s"}</span>
              <span title="Review round">· review {cluster.ronda_actual}</span>
              <span title="Calculated risk score">· risk score {cluster.score.toFixed(2)}</span>
              {cluster.nivel && <NivelBadge nivel={cluster.nivel} />}
            </>
          )}
          {caso.rfcs_satelite.length > 0 && (
            <span>· {caso.rfcs_satelite.length} adicional{caso.rfcs_satelite.length === 1 ? "" : "es"} vinculado{caso.rfcs_satelite.length === 1 ? "" : "s"}</span>
          )}
        </div>

        <ClusterForceGraph nodos={grafo?.nodos ?? []} aristas={grafo?.aristas ?? []} height={260} />

        <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Team notes ({senalesEnVivo.length})</span>
        {senalesEnVivo.length === 0 ? (
          <p className="m-0 text-[12px] text-text-subtle">No notes have been written yet.</p>
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
                  <span className="ml-auto rounded-[var(--radius-pill)] border border-border px-1.5 text-[10px] text-text-subtle" title="Confidence in this note">
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
                <span className="text-[10.5px] text-text-subtle">{s.ids.length} documento{s.ids.length === 1 ? "" : "s"} supporting</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Timeline + hallazgos (citados por ID) + defensa + dictamen + Contraste
          + Trayectoria: extraído a `CasoDetalleCompleto` para reutilizarse tal
          cual dentro de cada fila de `ResumenInvestigacion` (docs/22). */}
      <CasoDetalleCompleto detalle={detalle} bitacora={bitacora} contraste={contraste} trayectoria={trayectoria} />
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

