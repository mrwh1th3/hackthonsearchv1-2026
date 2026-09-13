"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Fingerprint, Search } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NIVEL_LABEL, NivelBadge } from "./badges";
import { BoardTimeline } from "./board-timeline";
import { CasoDetalleCompleto } from "./caso-detalle-completo";
import { HallazgoCard, SeccionCorridaAuditor, TablaLeads } from "./auditor-resultado";
import { emparejarAuditor } from "@/lib/analisis/emparejar-auditor";
import { ChartPanel } from "./chart-panel";
import { ClusterForceGraph } from "./force-graph";
import { MapaLogico } from "./mapa-logico";
import { construirArbol } from "@/lib/analisis/arbol";
import type { AuditorHallazgo, AuditorLead, AuditorResultado, CasoDetalle, ClusterResumen, ContrasteCaso, Corrida, EventoForense, GrafoArista, GrafoCluster, GrafoNodo, TrayectoriaPunto } from "@/lib/data";
import type { AnotacionAgenteIA, EjecucionesCaso } from "@/lib/data/privado";
import { derivarCadenaExplicacion } from "@/lib/analisis/cadena-explicacion";
import { costoMostrado } from "@/lib/analisis/costo";
import { nombreAgente } from "@/lib/analisis/arbol";
import { soloFecha, soloHora } from "@/lib/date/formato";
import { dividirEnSecciones, partirEnCitas } from "@/lib/expediente/citas";
import { confianzaAnalisis } from "@/lib/expediente/confianza";
import { narrarInvestigacion, type PasoNarrado } from "@/lib/expediente/narrativa";
import { cn } from "@/lib/utils";
import { AgentesChart } from "./agentes-chart";
import { AppSelect } from "./app-select";

export interface CasoConContexto {
  detalle: CasoDetalle;
  cluster: ClusterResumen | null;
  grafo: GrafoCluster | null;
  bitacora: EventoForense[];
  /** Contraste/Trayectoria de ESTE caso (regla 12): antes sólo se traían del primer caso de la investigación. */
  contraste: ContrasteCaso | null;
  trayectoria: TrayectoriaPunto[];
  /** Runtime de agentes de este caso (BFF privado, `obtenerEjecucionesPrivadas`): `ejecuciones: []` cuando la fuente no tiene runtime configurado (fixture) o el caso todavía no registró ninguna. */
  ejecuciones: EjecucionesCaso;
  /** Resultado del auditor determinista de la corrida, si aplica — único origen hoy para derivar "Cadena de explicación" (ver `lib/analisis/cadena-explicacion.ts`) y para el bloque "sin filtrar" (`AuditorResultadoCompleto`). */
  auditorResultado: AuditorResultado | null;
}

function formatoDuracion(ms: number | null): string {
  if (ms === null || Number.isNaN(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const numero = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 0 });

/**
 * Tiempo real que tomó investigar un caso: el tramo entre su primer y último
 * evento persistido en bitácora (regla 2), o creado→terminado si eso es mayor.
 */
function duracionCaso(c: CasoConContexto): number | null {
  const ts = c.bitacora.map((e) => new Date(e.ts).getTime()).filter((t) => !Number.isNaN(t));
  const tramoBitacora = ts.length > 1 ? Math.max(...ts) - Math.min(...ts) : 0;
  const { creado, terminado } = c.detalle.caso;
  const tramoCaso = terminado ? new Date(terminado).getTime() - new Date(creado).getTime() : 0;
  const ms = Math.max(tramoBitacora, tramoCaso);
  return ms > 0 ? ms : null;
}

/** Tramo de ejecución de un caso: primer y último evento propios. */
function tramoCaso(c: CasoConContexto): { desde: string; hasta: string; pasos: number } | null {
  if (c.bitacora.length === 0) return null;
  const orden = [...c.bitacora].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return { desde: orden[0].ts, hasta: orden[orden.length - 1].ts, pasos: orden.length };
}

/**
 * Vista auditor de la investigación. Todo número sale de lo persistido
 * (bitácora, grafo `v_grafo`, métricas de corrida); el nivel y el puntaje los
 * calcula SQL (regla 4). Los textos de "por qué" son los que escribieron los
 * agentes (señales, veredictos, defensa), citados tal cual.
 */
export function ResumenInvestigacion({
  corrida,
  casos,
  tokensCorrida,
  anotacionesIA = [],
}: {
  corrida: Corrida | null;
  casos: CasoConContexto[];
  tokensCorrida: number | null;
  /** Pizarrón de los 5 agentes IA de TODA la investigación (`obtenerAnotacionesAgenteIAPrivadas`, migración 028). `[]` en fixture o sin complemento IA todavía. */
  anotacionesIA?: AnotacionAgenteIA[];
}) {
  // Emparejamiento determinista caso↔hallazgo/lead del auditor (feedback
  // 2026-09-12): `casos[i].auditorResultado` es el mismo objeto de
  // `forense.auditor_resultados` repetido por caso (una fila por corrida),
  // así que basta tomar el del primer caso. Lo que no calza con ningún caso
  // de esta investigación queda en "Corrida" (`SeccionCorridaAuditor`), no
  // se pierde ni se repite.
  const auditorResultado = casos[0]?.auditorResultado ?? null;
  const emparejamiento = useMemo(
    () => emparejarAuditor(casos.map((c) => c.detalle.caso), auditorResultado),
    [casos, auditorResultado],
  );

  const [vista, setVista] = useState<"casos" | "metricas" | "traza">("casos");
  const [buscarCaso, setBuscarCaso] = useState("");
  const [nivelFiltro, setNivelFiltro] = useState("todos");
  const casosVisibles = casos.filter(({ detalle: { caso } }) =>
    (nivelFiltro === "todos" || (caso.nivel ?? "en_curso") === nivelFiltro) &&
    (!buscarCaso.trim() || [caso.rfc_principal, caso.id, ...caso.rfcs_satelite].join(" ").toLowerCase().includes(buscarCaso.trim().toLowerCase())),
  );
  const eventosUnicos = [...new Map(casos.flatMap((c) => c.bitacora).map((e) => [e.id, e])).values()];
  const evidenciasUnicas = new Set(casos.flatMap((c) => c.detalle.evidencia.map((e) => e.ref_id || e.id)));
  const coberturaParcial = casos.filter((c) => !c.detalle.caso.cobertura_completa).length;
  const monedas = new Set(casos.map((c) => c.detalle.caso.moneda));
  const monedaUnica = monedas.size === 1 ? [...monedas][0] : null;
  const duraciones = casos.map(duracionCaso);
  const duracionTotal = duraciones.some((d) => d !== null) ? duraciones.reduce<number>((a, d) => a + (d ?? 0), 0) : null;

  const tokensBitacora = eventosUnicos.reduce((a, e) => a + (e.tokens_in ?? 0) + (e.tokens_out ?? 0), 0);
  const tokens =
    tokensBitacora > 0
      ? { valor: numero(tokensBitacora), nota: "AI input + output" }
      : tokensCorrida != null
        ? { valor: numero(tokensCorrida), nota: "dataset total" }
        : { valor: "—", nota: "No token usage recorded" };

  const nodos = new Set(casos.flatMap((c) => (c.grafo?.nodos ?? []).map((n) => n.id)));

  // Tokens por agente (rol) agregados de TODAS las ejecuciones de runtime de
  // la investigación (BFF privado, `obtenerEjecucionesPrivadas` por caso).
  // `null`/ausente en un caso simplemente no aporta a la suma — nunca se
  // rellena con 0 para que aparezca en la gráfica.
  const tokensPorAgenteInvestigacion = Object.values(
    casos
      .flatMap((c) => c.ejecuciones.ejecuciones)
      .filter((e) => e.tokens_in != null || e.tokens_out != null)
      .reduce<Record<string, { agente: string; tokens_in: number; tokens_out: number }>>((acc, e) => {
        const k = e.rol;
        if (!acc[k]) acc[k] = { agente: nombreAgente(k), tokens_in: 0, tokens_out: 0 };
        acc[k].tokens_in += e.tokens_in ?? 0;
        acc[k].tokens_out += e.tokens_out ?? 0;
        return acc;
      }, {}),
  );


  const stats: Array<{ label: string; valor: string; nota?: string }> = [
    { label: "Cases under review", valor: `${casos.length}`, nota: corrida ? `${corrida.dataset} · corte ${soloFecha(corrida.fecha_corte)}` : undefined },
    {
      label: "Evidence references",
      valor: numero(evidenciasUnicas.size),
      nota: `${numero(nodos.size)} entities in the available graphs`,
    },
    { label: "Recorded usage", valor: tokens.valor, nota: tokens.nota },
    { label: "Execution time", valor: formatoDuracion(duracionTotal), nota: `sum of ${casos.length} caso${casos.length === 1 ? "" : "s"}` },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="insp-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-5 sm:p-6">
          <span className="insp-eyebrow">LECTURA DE LA INVESTIGACIÓN</span>
          <h1 className="font-display text-[28px] font-medium leading-tight tracking-[-0.035em] text-text sm:text-[34px]">Start with the conclusion.<br /><span className="text-text-subtle">Then explore the evidence.</span></h1>
          <p className="max-w-[600px] text-[12.5px] leading-relaxed text-text-subtle">Open a case to see what was flagged, what was challenged and which records support the conclusion.</p>
          {coberturaParcial > 0 && <details className="text-[11.5px] text-text-subtle"><summary>Review notes</summary><p className="mt-2">{coberturaParcial} caso{coberturaParcial === 1 ? " tiene" : "s tienen"} recorded scope limits. Open a case for details.</p></details>}
        </div>
        <dl className="grid grid-cols-2 divide-x divide-border lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col gap-2 p-4 sm:p-5">
              <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-subtle">{s.label}</dt>
              <dd className="break-words font-display text-[30px] font-medium leading-none tracking-[-0.04em] text-text tabular-nums">{s.valor}</dd>
              <p className="text-[10.5px] leading-relaxed text-text-subtle">{s.nota}</p>
            </div>
          ))}
        </dl>
      </section>

      <nav aria-label="Investigation view" className="flex flex-wrap items-center gap-1 rounded-card-sm border border-border bg-surface-raised p-1">
        {([{ id: "casos", label: "Casos y evidencia", count: casos.length }, { id: "metricas", label: "Metrics", count: null }, { id: "traza", label: "Trazabilidad", count: eventosUnicos.length }] as const).map((item) => <button key={item.id} type="button" aria-pressed={vista === item.id} onClick={() => setVista(item.id)} className={cn("flex items-center gap-2 rounded-control px-3.5 py-2.5 text-[12px] transition-colors", vista === item.id ? "bg-primary font-medium text-white" : "text-text-subtle hover:bg-surface hover:text-text")}>{item.label}{item.count !== null && <span className={cn("rounded-pill px-1.5 text-[10px] tabular-nums", vista === item.id ? "bg-white/15 text-white" : "bg-surface-muted")}>{item.count}</span>}</button>)}
      </nav>

      {vista === "traza" && <section className="insp-surface p-4 sm:p-5"><div className="mb-5 flex items-start gap-3"><Fingerprint size={18} className="mt-0.5 text-text-subtle" aria-hidden /><div><h2 className="text-sm font-medium">El rastro completo</h2><p className="mt-1 text-xs leading-relaxed text-text-subtle">Recorded events, newest first. Open any event to inspect its sources.</p></div></div><BoardTimeline eventos={eventosUnicos} limite={20} /></section>}

      {vista === "metricas" && casos.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartPanel
            title="Flagged amount by case"
            unidad={monedaUnica ?? "Multiple currencies · view data"}
            columns={[
              { key: "rfc", header: "RFC" },
              { key: "monto", header: "Monto", align: "right", render: (r) => numero(r.monto) },
              { key: "moneda", header: "Moneda" },
              { key: "nivel", header: "Nivel" },
            ]}
            rows={casos.map((c) => ({ id: c.detalle.caso.id, rfc: c.detalle.caso.rfc_principal, monto: Number(c.detalle.caso.monto_en_riesgo), moneda: c.detalle.caso.moneda, nivel: c.detalle.caso.nivel ? NIVEL_LABEL[c.detalle.caso.nivel] : "Running" }))}
            getRowKey={(r) => r.id}
            csvFilename="monto-por-caso"
          >
            {monedaUnica ? <ResponsiveContainer width="100%" height={220}>
              <BarChart data={casos.map((c) => ({ rfc: c.detalle.caso.rfc_principal, monto: Number(c.detalle.caso.monto_en_riesgo) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="rfc" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => (typeof v === "number" ? v.toLocaleString("es-MX") : String(v ?? ""))} />
                <Bar dataKey="monto" fill="var(--primary)" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer> : <p className="p-6 text-xs leading-relaxed text-text-subtle">These cases use different currencies. View the data to inspect amounts separately.</p>}
          </ChartPanel>
          <ChartPanel
            title="Cases by confidence"
            columns={[
              { key: "nivel", header: "Nivel" },
              { key: "n", header: "Casos", align: "right" },
            ]}
            rows={Object.entries(
              casos.reduce<Record<string, number>>((acc, c) => {
                const k = c.detalle.caso.nivel ?? "in progress";
                acc[k] = (acc[k] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([nivel, n]) => ({ nivel, n }))}
            getRowKey={(r) => r.nivel}
            csvFilename="casos-por-nivel"
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={Object.entries(
                  casos.reduce<Record<string, number>>((acc, c) => {
                    const k = c.detalle.caso.nivel ?? "in progress";
                    acc[k] = (acc[k] ?? 0) + 1;
                    return acc;
                  }, {}),
                ).map(([nivel, n]) => ({ nivel, n }))}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="nivel" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="n" fill="var(--border-strong)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>
        </div>
      )}

      {vista === "metricas" && tokensPorAgenteInvestigacion.length > 0 && (
        <ChartPanel
          title="Tokens by investigator"
          unidad="tokens"
          columns={[
            { key: "agente", header: "Agente" },
            { key: "tokens_in", header: "Input", align: "right" },
            { key: "tokens_out", header: "Output", align: "right" },
          ]}
          rows={tokensPorAgenteInvestigacion}
          getRowKey={(r) => r.agente}
          csvFilename="tokens-por-agente"
        >
          <AgentesChart datos={tokensPorAgenteInvestigacion} />
        </ChartPanel>
      )}

      {vista === "casos" && (
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-control border border-border bg-surface px-3 py-2.5"><Search size={14} className="text-text-subtle" aria-hidden /><input aria-label="Search by tax ID or case ID" placeholder="Buscar RFC, entidad relacionada o ID…" value={buscarCaso} onChange={(e) => setBuscarCaso(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" /></div>
            <AppSelect aria-label="Filter cases by confidence" value={nivelFiltro} onValueChange={setNivelFiltro} options={[{ value: "todos", label: "All levels" }, ...Object.entries(NIVEL_LABEL).map(([value, label]) => ({ value, label })), { value: "en_curso", label: "Running" }]} />
          </div>
          <p className="text-[11px] text-text-subtle">{casosVisibles.length} of {casos.length} cases · open a row to explore</p>
          <div className="flex flex-col gap-2.5">
            {casosVisibles.map((c) => (
              <CasoFila
                key={c.detalle.caso.id}
                caso={c}
                duracionMs={duracionCaso(c)}
                auditor={emparejamiento.porCaso.get(c.detalle.caso.id) ?? { hallazgo: null, leads: [] }}
              />
            ))}
          </div>
          {casosVisibles.length === 0 && <p className="rounded-card-sm border border-dashed border-border p-8 text-center text-xs text-text-subtle">{casos.length === 0 ? "No cases are available yet. This is not a finding of no fraud." : "No cases match. Change the tax ID or confidence filter."}</p>}
        </section>
      )}

      {/*
        Lo que NO pertenece a ningún caso mostrado (feedback 2026-09-12: la
        info del auditor va segmentada DENTRO de cada caso; aquí sólo queda
        el residuo de la corrida — run_metadata, métricas globales, y
        hallazgos/leads que no emparejaron con ningún `caso_id` de esta
        investigación). El resto ya se ve en cada `CasoFila` de abajo.
      */}
      {vista === "metricas" && <SeccionColapsable titulo="Dataset totals and other findings" abiertaPorDefecto={false}>
        {() => (
          <SeccionCorridaAuditor
            resultado={auditorResultado}
            hallazgosSinCaso={emparejamiento.hallazgosSinCaso}
            leadsSinCaso={emparejamiento.leadsSinCaso}
          />
        )}
      </SeccionColapsable>}

      {/*
        Pizarrón de los 5 agentes IA de la investigación (no por caso: el
        caso `origen='ia_complemento'` no está en `inv.caso_ids`, ver
        `leerAnotacionesAgenteInvestigacion`). `anotacionesIA.length === 0`
        no distingue "sin complemento IA todavía" de "028 no aplicada en
        remoto" — ambos caen a `[]` en el BFF hoy (`.catch`), así que el
        texto de abajo se queda deliberadamente neutro.
      */}
      {vista === "traza" && <SeccionColapsable titulo="Investigation map · saved history" abiertaPorDefecto={false}>
        {() => <MapaLogico mode="historico" senales={[]} anotaciones={anotacionesIA} />}
      </SeccionColapsable>}
    </div>
  );
}

function CasoFila({
  caso,
  duracionMs,
  auditor,
}: {
  caso: CasoConContexto;
  duracionMs: number | null;
  /** Hallazgo y leads del auditor determinista que emparejan con ESTE caso (`lib/analisis/emparejar-auditor.ts`). */
  auditor: { hallazgo: AuditorHallazgo | null; leads: AuditorLead[] };
}) {
  const [abierto, setAbierto] = useState(false);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const { caso: c, pistas } = caso.detalle;
  const evaluadas = pistas.filter((p) => p.estado !== "no_evaluable");
  const sostenidas = evaluadas.filter((p) => !(p.evaluacion_caso?.estado ?? "").startsWith("refutada"));
  const confianza = confianzaAnalisis(caso.detalle);
  const tramo = tramoCaso(caso);

  return (
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-card-sm border bg-surface transition-colors", abierto ? "border-border-stronger" : "border-border hover:border-border-strong")}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-4 text-left hover:bg-surface-raised"
      >
        <span className="min-w-0 flex-1"><span className="block break-all font-mono text-[13px] font-medium text-text">{c.rfc_principal}</span><span className="mt-1 block text-[11px] text-text-subtle">{caso.detalle.evidencia.length} evidencias · {caso.bitacora.length} eventos</span></span>
        <NivelBadge nivel={c.nivel} />
        {caso.cluster && (
          <span
            className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-border-strong bg-surface-raised py-0.5 pl-2.5 pr-1"
            title="Rule-based risk score (0–1)"
          >
            <span className="text-[11.5px] text-text-muted">Risk</span>
            <span className="block h-[5px] w-14 overflow-hidden rounded-[3px] bg-surface-muted">
              <span
                className={cn("block h-full rounded-[3px]", caso.cluster.score >= 0.75 ? "bg-red-600" : caso.cluster.score >= 0.5 ? "bg-red-400" : "bg-green-600")}
                style={{ width: `${Math.round(caso.cluster.score * 100)}%` }}
              />
            </span>
            <span className="rounded-[var(--radius-pill)] bg-primary px-2 py-px text-[13px] font-semibold tabular-nums text-white">
              {caso.cluster.score.toFixed(2)}
            </span>
          </span>
        )}
        <ChevronDown
          size={15}
          strokeWidth={1.8}
          className={cn("text-text-subtle transition-transform duration-150", abierto && "rotate-180", !caso.cluster && "ml-auto")}
          aria-hidden
        />
      </button>

      {abierto && (
        <div className="flex min-w-0 flex-col gap-4 border-t border-border px-3.5 py-3">
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]">
            <MiniStat label="Pistas confirmadas" valor={`${sostenidas.length}`} nota={`de ${evaluadas.length} revisadas`} />
            <MiniStat
              label="Review confidence"
              valor={confianza.porcentaje === null ? "—" : `${confianza.porcentaje}%`}
              nota={confianza.factores.map((f) => `${f.nombre}: ${Math.round(f.valor * 100)}%`).join("\n")}
              barra={confianza.porcentaje === null ? undefined : confianza.porcentaje / 100}
            />
            <MiniStat label="Flagged amount" valor={`${c.moneda} ${numero(Number(c.monto_en_riesgo))}`} nota={c.cobertura_completa ? "periodo completo" : "see case scope"} />
            <MiniStat
              label="Case execution"
              valor={formatoDuracion(duracionMs)}
              nota={tramo ? `${soloHora(tramo.desde)} → ${soloHora(tramo.hasta)} · ${tramo.pasos} pasos` : `${c.n_reintentos} reintentos`}
            />
          </div>

          <div className="grid min-w-0 gap-4 rounded-[10px] border border-border bg-surface px-3 py-2.5 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-[11px] uppercase tracking-[0.03em] text-text-subtle">Review confidence</span>
              <DesgloseConfianza confianza={confianza} />
            </div>
            <div className="flex min-w-0 flex-col gap-2 border-border max-lg:border-t max-lg:pt-3 lg:border-l lg:pl-4">
              <span className="text-[11px] uppercase tracking-[0.03em] text-text-subtle">Investigation summary</span>
              <ResumenEscrito detalle={caso.detalle} />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Seccion titulo="Relaciones entre transacciones">
              {caso.grafo && caso.grafo.nodos.length > 0 ? (
                <>
                  <ClusterForceGraph
                    nodos={caso.grafo.nodos}
                    aristas={caso.grafo.aristas}
                    height={260}
                    resaltado={seleccion}
                    onNodeClick={(n) => setSeleccion((actual) => (actual === n.id ? null : n.id))}
                  />
                  <span className="text-[11px] text-text-subtle">Select a point to see the underlying transactions.</span>
                </>
              ) : (
                <p className="m-0 text-[12px] text-text-subtle">No saved graph for this case.</p>
              )}
            </Seccion>

            <Seccion titulo="Transactions used in this investigation">
              <FilasUsadas grafo={caso.grafo} evidencia={caso.detalle.evidencia} seleccion={seleccion} onLimpiar={() => setSeleccion(null)} />
            </Seccion>
          </div>

          <Seccion titulo="How this case was investigated">
            <LineaDecisiones pasos={narrarInvestigacion(caso.bitacora, caso.detalle)} />
          </Seccion>
          <SeccionColapsable titulo={`Open activity log and source references (${caso.bitacora.length})`} abiertaPorDefecto={false}>
            {() => <BoardTimeline eventos={caso.bitacora} />}
          </SeccionColapsable>

          <SeccionColapsable titulo="Hallazgos completos, defensa, dictamen, Contraste y Trayectoria" abiertaPorDefecto={false}>
            {() => <CasoDetalleCompleto detalle={caso.detalle} bitacora={caso.bitacora} contraste={caso.contraste} trayectoria={caso.trayectoria} />}
          </SeccionColapsable>

          {(auditor.hallazgo || auditor.leads.length > 0) && (
            <SeccionColapsable
              titulo={`Rule-engine finding${auditor.hallazgo ? "" : " (no standalone finding)"} y leads relacionados (${auditor.leads.length})`}
              abiertaPorDefecto={false}
            >
              {() => (
                <div className="flex flex-col gap-4">
                  {auditor.hallazgo ? (
                    <HallazgoCard f={auditor.hallazgo} />
                  ) : (
                    <p className="text-[13px] text-text-subtle">
                      This case has no standalone finding in <code className="font-mono">forense.auditor_resultados</code>; only related leads linked by tax ID.
                    </p>
                  )}
                  {auditor.leads.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11.5px] uppercase tracking-wide text-text-muted">Leads cerrados relacionados (mismo RFC)</div>
                      <TablaLeads leads={auditor.leads} />
                    </div>
                  )}
                </div>
              )}
            </SeccionColapsable>
          )}

          <SeccionColapsable titulo="Evidence chain" abiertaPorDefecto={false}>
            {() => <CadenaExplicacionVista auditorResultado={caso.auditorResultado} rfc={c.rfc_principal} />}
          </SeccionColapsable>

          <SeccionColapsable titulo="AI investigators · recorded activity" abiertaPorDefecto={false}>
            {() => <SeccionAgentesRuntime ejecuciones={caso.ejecuciones} />}
          </SeccionColapsable>

          <SeccionColapsable titulo={`Investigation map · history (${caso.detalle.senales.length})`} abiertaPorDefecto={false}>
            {() => (
              <MapaLogico
                mode="historico"
                senales={caso.detalle.senales}
                etapas={construirArbol(caso.detalle.caso, caso.detalle.tareas, caso.bitacora, caso.ejecuciones.ejecuciones).etapas}
              />
            )}
          </SeccionColapsable>
        </div>
      )}
    </div>
  );
}

function etiquetaNodo(id: string, nodos: GrafoNodo[]) {
  const n = nodos.find((x) => x.id === id);
  if (n?.tipo === "cuenta" || id.startsWith("CTA:")) return `Cuenta ${id.replace(/^CTA:/, "")}`;
  return n?.rfc ?? id;
}

function FilasUsadas({
  grafo,
  evidencia,
  seleccion,
  onLimpiar,
}: {
  grafo: GrafoCluster | null;
  evidencia: CasoDetalle["evidencia"];
  seleccion: string | null;
  onLimpiar: () => void;
}) {
  const aristas = useMemo<GrafoArista[]>(() => grafo?.aristas ?? [], [grafo]);
  const scroll = useRef<HTMLDivElement>(null);
  const filasRef = useRef(new Map<string, HTMLTableRowElement>());
  const [desborda, setDesborda] = useState(false);
  const [vista, setVista] = useState({ top: 0, alto: 1 });
  const [posiciones, setPosiciones] = useState<Record<string, number>>({});

  const toca = (a: GrafoArista) => seleccion !== null && (a.origen === seleccion || a.destino === seleccion);
  const activas = aristas.filter(toca);

  // Mide dónde cae cada fila respecto al alto total del scroll: las marcas
  // del carril son esas proporciones, como los errores en la barra de un IDE.
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const medir = () => {
      const total = el.scrollHeight || 1;
      setDesborda(el.scrollHeight > el.clientHeight + 1);
      setVista({ top: el.scrollTop / total, alto: el.clientHeight / total });
      const pos: Record<string, number> = {};
      filasRef.current.forEach((tr, id) => {
        pos[id] = (tr.offsetTop + tr.offsetHeight / 2) / total;
      });
      setPosiciones(pos);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    el.addEventListener("scroll", medir, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", medir);
    };
  }, [aristas.length]);

  // Al seleccionar, lleva la vista a la primera fila marcada sin reordenar.
  useEffect(() => {
    if (!seleccion) return;
    const primera = aristas.find((a) => a.origen === seleccion || a.destino === seleccion);
    if (primera) filasRef.current.get(primera.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [seleccion, aristas]);

  if (aristas.length === 0) return <p className="m-0 text-[12px] text-text-subtle">No transactions recorded for this case.</p>;
  const citadas = new Set(evidencia.flatMap((e) => [e.ref_id, `${e.tipo.toUpperCase()}:${e.ref_id}`]));
  const irA = (id: string) => filasRef.current.get(id)?.scrollIntoView({ block: "center", behavior: "smooth" });

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-[20px] items-center justify-between gap-2 text-[11.5px]">
        {seleccion ? (
          <>
            <span className="text-text-muted">
              {activas.length} de {aristas.length} transactions from <span className="font-mono text-text">{etiquetaNodo(seleccion, grafo?.nodos ?? [])}</span>
            </span>
            <button type="button" onClick={onLimpiar} className="text-focus hover:underline">
              Clear selection
            </button>
          </>
        ) : (
          <span className="text-text-subtle">{aristas.length} transacciones</span>
        )}
      </div>
      <div className="flex overflow-hidden rounded-[8px] border border-border">
        <div ref={scroll} className="max-h-[260px] min-w-0 flex-1 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead className="sticky top-0 z-[1] bg-surface-raised text-[10px] uppercase tracking-[0.03em] text-text-subtle">
              <tr>
                <th className="px-2.5 py-1.5 font-normal">Type</th>
                <th className="px-2.5 py-1.5 font-normal">De</th>
                <th className="px-2.5 py-1.5 font-normal">Para</th>
                <th className="px-2.5 py-1.5 text-right font-normal">Monto</th>
                <th className="px-2.5 py-1.5 font-normal">Date</th>
              </tr>
            </thead>
            <tbody>
              {aristas.map((a) => {
                const activa = toca(a);
                const esPrueba = citadas.has(a.id) || (a.ref_id ? citadas.has(a.ref_id) : false);
                return (
                  <tr
                    key={a.id}
                    ref={(tr) => {
                      if (tr) filasRef.current.set(a.id, tr);
                      else filasRef.current.delete(a.id);
                    }}
                    className={cn(
                      "border-t border-border transition-[background-color,opacity] duration-150",
                      activa && "bg-green-50",
                      seleccion !== null && !activa && "opacity-45",
                    )}
                  >
                    <td className={cn("whitespace-nowrap border-l-2 px-2.5 py-1.5 text-text", activa ? "border-l-green-600" : "border-l-transparent")}>
                      {a.tipo === "factura" ? "Factura" : "Movimiento"}
                      {esPrueba && <span className="ml-1.5 rounded-[5px] border border-border px-1 text-[9.5px] text-text-subtle">prueba</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-text-muted">{etiquetaNodo(a.origen, grafo?.nodos ?? [])}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-text-muted">{etiquetaNodo(a.destino, grafo?.nodos ?? [])}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-text">{a.moneda ?? "MXN"} {numero(Number(a.monto || 0))}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-text-subtle">
                      {a.fecha ? soloFecha(a.fecha) : a.n_registros ? `${a.n_registros} docs` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {desborda && (
          <div className="relative w-[10px] flex-none border-l border-border bg-surface-raised" aria-label="Flagged-record map">
            <span
              aria-hidden
              className="absolute inset-x-[1px] rounded-[2px] bg-border"
              style={{ top: `${vista.top * 100}%`, height: `${Math.max(vista.alto * 100, 6)}%` }}
            />
            {activas.map((a) =>
              posiciones[a.id] === undefined ? null : (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => irA(a.id)}
                  title="Open this transaction"
                  className="absolute inset-x-0 h-[3px] -translate-y-1/2 bg-green-600 hover:h-[5px]"
                  style={{ top: `${posiciones[a.id] * 100}%` }}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Un tono por factor: aunque varios estén en 100 % se distinguen entre sí.
const VERDES = ["bg-green-700", "bg-emerald-500", "bg-green-500", "bg-emerald-700", "bg-lime-600"];

function DesgloseConfianza({ confianza }: { confianza: ReturnType<typeof confianzaAnalisis> }) {
  if (confianza.porcentaje === null) {
    return <p className="m-0 text-[12px] text-text-subtle">Not enough evidence or review activity to rate this analysis yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2" title="Measures the strength of the review, not the probability of fraud.">
        <span className="text-[22px] font-semibold leading-none tracking-tight text-text">{confianza.porcentaje}%</span>
        <span className="text-[11.5px] text-text-subtle">average of {confianza.factores.length} factores</span>
      </div>
      <ul className="m-0 flex flex-col gap-1.5 p-0">
        {confianza.factores.map((f, i) => {
          const pct = Math.round(f.valor * 100);
          return (
            <li key={f.nombre} title={f.explica} className="grid list-none grid-cols-[210px_minmax(0,1fr)_38px] items-center gap-2.5">
              <span className="whitespace-nowrap text-[12px] text-text">{f.nombre}</span>
              <span className="block h-[6px] overflow-hidden rounded-[3px] bg-surface-muted">
                <span className={cn("block h-full rounded-[3px]", pct >= 75 ? VERDES[i % VERDES.length] : pct >= 50 ? "bg-red-400" : "bg-red-600")} style={{ width: `${pct}%` }} />
              </span>
              <span className="text-right text-[12px] font-medium tabular-nums text-text">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Resumen escrito por el agente Redactor: la sección "Resumen" de su reporte
 * (08-prompts). Se muestra tal cual; las citas `[CFDI:uuid]` se reducen a
 * marcas numeradas y quedan en rojo si no están en evidencia validada (09 §8).
 */
function ResumenEscrito({ detalle }: { detalle: CasoDetalle }) {
  const markdown = detalle.redactor?.markdown;
  if (!markdown) return <p className="m-0 text-[12px] text-text-subtle">The case summary has not been written yet.</p>;
  const secciones = dividirEnSecciones(markdown);
  const resumen = secciones.find((x) => /resumen/i.test(x.titulo)) ?? secciones[0];
  const validadas = new Set(detalle.evidencia.filter((e) => e.validada).flatMap((e) => e.referencias));
  const citas: string[] = [];
  const parrafos = (resumen?.cuerpo ?? "").split(/\n{2,}/).map((p) => p.replace(/\*\*/g, "").trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-2">
      {parrafos.map((p, i) => (
        <p key={i} className="m-0 text-[13px] leading-relaxed text-text">
          {partirEnCitas(p, validadas).map((seg, j) => {
            if (seg.tipo === "texto") return <span key={j}>{seg.texto}</span>;
            if (!citas.includes(seg.cruda)) citas.push(seg.cruda);
            return (
              <sup
                key={j}
                title={`${seg.cruda}${seg.valida ? "" : " · not in validated evidence"}`}
                className={cn("ml-0.5 rounded-[4px] px-1 text-[9.5px] font-medium", seg.valida ? "bg-surface-muted text-text-muted" : "bg-red-50 text-red-600")}
              >
                {citas.indexOf(seg.cruda) + 1}
              </sup>
            );
          })}
        </p>
      ))}
      <span className="text-[11px] text-text-subtle">Written by the report agent · {citas.length} cita{citas.length === 1 ? "" : "s"} a evidencia</span>
    </div>
  );
}

function LineaDecisiones({ pasos }: { pasos: PasoNarrado[] }) {
  if (pasos.length === 0) return <p className="m-0 text-[12px] text-text-subtle">No steps have been recorded for this case yet.</p>;
  return (
    <ol className="m-0 flex flex-col p-0">
      {pasos.map((p, i) => (
        <li key={p.id} className="grid list-none grid-cols-[84px_14px_minmax(0,1fr)] items-start gap-2.5">
          <span className="whitespace-nowrap pt-px text-[11px] text-text-subtle">{soloHora(p.ts)}</span>
          <span className="flex h-full flex-col items-center gap-0.5">
            <span
              className={cn(
                "mt-[4px] box-border h-2.5 w-2.5 flex-none rounded-full border-[1.5px]",
                p.tono === "conclusion" && "border-primary bg-primary",
                p.tono === "alerta" && "border-red-600 bg-red-600",
                p.tono === "descarte" && "border-green-600 bg-green-100",
                p.tono === "normal" && "border-primary bg-surface",
              )}
            />
            {i < pasos.length - 1 && <span className="min-h-[14px] w-px flex-1 bg-border" />}
          </span>
          <span className="flex flex-col gap-1 pb-3.5">
            <span className={cn("text-[13px] leading-snug text-text", p.tono === "conclusion" && "font-semibold")}>{p.titulo}</span>
            {p.detalle && <span className="whitespace-pre-line text-[12px] leading-relaxed text-text-muted">{p.detalle}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-border bg-surface px-3 py-2.5">
      <span className="text-[12px] font-medium leading-relaxed text-text-muted">{titulo}</span>
      {children}
    </div>
  );
}

/**
 * Secciones colapsables (pedido del coordinador 2026-09-12): `/documentos` no
 * filtra nada, pero cada bloque grande arranca cerrado. `children` es una
 * función: para un `run_log` de 330 KB (`AuditorResultado`, corrida
 * 2b446f04-...), `{abierta && children}` seguía EVALUANDO el `.map()` de los
 * hallazgos en cada render del padre aunque no los pintara — el costo se
 * pagaba con la sección cerrada. Con `children()` invocada solo dentro del
 * `if (abierta)` ese trabajo no ocurre hasta que el usuario expande.
 */
function SeccionColapsable({ titulo, abiertaPorDefecto, children }: { titulo: string; abiertaPorDefecto: boolean; children: () => React.ReactNode }) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-border bg-surface px-3 py-2.5">
      <button type="button" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="text-[12px] font-medium leading-relaxed text-text-muted">{titulo}</span>
        <ChevronDown size={14} className={cn("flex-none text-text-subtle transition-transform duration-150", abierta && "rotate-180")} aria-hidden />
      </button>
      {abierta && children()}
    </div>
  );
}

/**
 * "Cadena de explicación" (docs/21/CLAUDE.md regla 12): no hay tabla/RPC que
 * la persista todavía. Si el caso viene del auditor determinista, se deriva
 * de su propia evidencia (`lib/analisis/cadena-explicacion.ts`) y se rotula
 * como derivada; si no hay resultado del auditor para este RFC, se dice
 * explícitamente que no hay fuente — nunca se redacta una cadena nueva.
 */
function CadenaExplicacionVista({ auditorResultado, rfc }: { auditorResultado: AuditorResultado | null; rfc: string }) {
  const cadena = derivarCadenaExplicacion(auditorResultado, rfc);
  if (!cadena) {
    return (
      <p className="m-0 text-[12px] text-text-subtle">
        No hay una fuente de &ldquo;Cadena de explicación&rdquo; para este caso todavía (no viene del auditor determinista, o el auditor no tiene un
        hallazgo para {rfc}). No se inventa una cadena sin evidencia que la respalde.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10.5px] uppercase tracking-[0.03em] text-text-subtle" title="Derived from the saved rule-engine result">
        Source rule: {cadena.hallazgo}
      </span>
      <ol className="m-0 flex flex-col gap-1.5 p-0">
        {cadena.eslabones.map((e, i) => (
          <li key={e.id} className="flex list-none gap-2 text-[12.5px] text-text">
            <span className={cn("flex-none rounded-[6px] px-1.5 py-0.5 text-[10px] uppercase", e.tipo === "hipotesis" ? "bg-primary text-white" : "bg-surface-muted text-text-subtle")}>
              {e.tipo === "hipotesis" ? "hypothesis" : `evidencia ${i}`}
            </span>
            <span className="min-w-0 flex-1">
              {e.texto}
              {e.referencias.length > 0 && (
                <span className="ml-1.5 font-mono text-[10.5px] text-text-subtle">[{e.referencias.join(", ")}]</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Runtime de agentes de este caso (BFF privado, `obtenerEjecucionesPrivadas`):
 * rol, estado interno, tokens, tool calls, duración y errores de contrato
 * (`checkpoint_json.errores_contrato`, jsonb libre — `null` = no reportado,
 * `[]` = cero real). `ejecuciones === null` distingue "fuente sin runtime"
 * (fixture) de "corrida sin ejecuciones registradas" (`[]`).
 */
function SeccionAgentesRuntime({ ejecuciones }: { ejecuciones: EjecucionesCaso }) {
  if (ejecuciones.ejecuciones.length === 0) {
    return <p className="m-0 text-[12px] text-text-subtle">No runtime executions recorded for this case yet.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {ejecuciones.ejecuciones.map((e) => {
        // `e.costo` es real (`ejecuciones_agente.costo_usd`, migración 028)
        // cuando la fila lo trae; si no, cae al estimado por tokens Y lo dice
        // ("estimado" en la etiqueta) — nunca se pinta un estimado sin marcar
        // (regla: no simular certeza que no hay).
        const costo = costoMostrado(e.model_id, e.tokens_in, e.tokens_out, e.costo);
        return (
          <div key={e.id} className="flex flex-col gap-1 rounded-[8px] border border-border bg-surface-raised px-2.5 py-2">
            <span className="flex flex-wrap items-center gap-2 text-[12px] text-text">
              <span className="font-medium capitalize">{nombreAgente(e.rol)}</span>
              <span className="text-text-subtle">{e.estado_interno.replaceAll("_", " ")}</span>
              {e.toolEnCurso && <span className="rounded-[6px] border border-border bg-surface px-1.5 text-[10.5px] text-text-muted">tool: {e.toolEnCurso.nombre ?? "in progress"}</span>}
              <span className="ml-auto font-mono text-[10.5px] text-text-subtle">paso {e.paso}</span>
            </span>
            <span className="text-[11px] text-text-subtle">
              {e.tokens_in != null || e.tokens_out != null ? `${numero(e.tokens_in ?? 0)} in / ${numero(e.tokens_out ?? 0)} out` : "tokens no disp."} ·{" "}
              {e.duracion_ms != null ? `${numero(e.duracion_ms)} ms` : "duration unavailable"} · {e.tools.length} tool call{e.tools.length === 1 ? "" : "s"} ·{" "}
              {costo.texto}
            </span>
            <span className={cn("text-[11px]", e.erroresContrato && e.erroresContrato.length > 0 ? "text-red-600" : "text-text-subtle")}>
              {e.erroresContrato == null
                ? "validation errors: not reported"
                : e.erroresContrato.length === 0
                  ? "validation errors: 0"
                  : `validation errors: ${e.erroresContrato.join("; ")}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MiniStat({ label, valor, nota, barra }: { label: string; valor: string; nota?: string; barra?: number }) {
  return (
    <div title={nota} className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface px-3.5 py-3">
      <span className="text-[10.5px] uppercase tracking-[0.03em] text-text-subtle">{label}</span>
      <span className="break-words font-display text-[25px] font-medium leading-tight tracking-[-0.03em] text-text tabular-nums">{valor}</span>
      {nota && <p className="whitespace-pre-line text-[10.5px] leading-relaxed text-text-subtle">{nota}</p>}
      {barra != null && (
        <span className="block h-[4px] overflow-hidden rounded-[3px] bg-surface-muted">
          <span className={cn("block h-full rounded-[3px]", barra >= 0.75 ? "bg-green-600" : barra >= 0.5 ? "bg-red-400" : "bg-red-600")} style={{ width: `${Math.round(barra * 100)}%` }} />
        </span>
      )}
    </div>
  );
}
