"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NivelBadge } from "./badges";
import { CasoDetalleCompleto } from "./caso-detalle-completo";
import { HallazgoCard, SeccionCorridaAuditor, TablaLeads } from "./auditor-resultado";
import { emparejarAuditor } from "@/lib/analisis/emparejar-auditor";
import { ChartPanel } from "./chart-panel";
import { ClusterForceGraph } from "./force-graph";
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

  const duraciones = casos.map(duracionCaso);
  const duracionTotal = duraciones.some((d) => d !== null) ? duraciones.reduce<number>((a, d) => a + (d ?? 0), 0) : null;

  const tokensBitacora = casos.flatMap((c) => c.bitacora).reduce((a, e) => a + (e.tokens_in ?? 0) + (e.tokens_out ?? 0), 0);
  const tokens =
    tokensBitacora > 0
      ? { valor: numero(tokensBitacora), nota: "entrada + salida de los agentes" }
      : tokensCorrida != null
        ? { valor: numero(tokensCorrida), nota: "total de la corrida" }
        : { valor: "—", nota: "La bitácora no reporta tokens" };

  const aristas = new Map(casos.flatMap((c) => c.grafo?.aristas ?? []).map((a) => [a.id, a]));
  const documentos = [...aristas.values()].reduce((a, x) => a + (x.n_registros ?? 1), 0);
  const montoAnalizado = [...aristas.values()].reduce((a, x) => a + Number(x.monto || 0), 0);
  const nodos = new Set(casos.flatMap((c) => (c.grafo?.nodos ?? []).map((n) => n.id)));

  // Tokens por agente (rol) agregados de TODAS las ejecuciones de runtime de
  // la investigación (BFF privado, `obtenerEjecucionesPrivadas` por caso).
  // `null`/ausente en un caso simplemente no aporta a la suma — nunca se
  // rellena con 0 para que aparezca en la gráfica.
  const tokensPorAgenteInvestigacion = Object.values(
    casos
      .flatMap((c) => c.ejecuciones.ejecuciones)
      .reduce<Record<string, { agente: string; tokens_in: number; tokens_out: number }>>((acc, e) => {
        const k = e.rol;
        if (!acc[k]) acc[k] = { agente: nombreAgente(k), tokens_in: 0, tokens_out: 0 };
        acc[k].tokens_in += e.tokens_in ?? 0;
        acc[k].tokens_out += e.tokens_out ?? 0;
        return acc;
      }, {}),
  );


  const stats: Array<{ label: string; valor: string; nota?: string }> = [
    { label: "Casos encontrados", valor: `${casos.length}`, nota: corrida ? `${corrida.dataset} · corte ${soloFecha(corrida.fecha_corte)}` : undefined },
    {
      label: "Volumen analizado",
      valor: `${numero(documentos)} doc${documentos === 1 ? "" : "s"}`,
      nota: `${numero(nodos.size)} entidades · MXN ${numero(montoAnalizado)}`,
    },
    { label: "Tokens gastados", valor: tokens.valor, nota: tokens.nota },
    { label: "Duración de ejecución", valor: formatoDuracion(duracionTotal), nota: `suma de ${casos.length} caso${casos.length === 1 ? "" : "s"}` },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2.5 rounded-[var(--radius-card-sm)] border border-border bg-surface p-3.5">
        <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Resumen de la investigación</span>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
          {stats.map((s) => (
            <div key={s.label} title={s.nota} className="flex flex-col gap-3 rounded-[13px] border border-border bg-surface-raised px-4 py-3.5">
              <span className="text-[11px] uppercase tracking-[0.03em] text-text-subtle">{s.label}</span>
              <span className="truncate text-[40px] font-semibold leading-none tracking-[-0.03em] text-text tabular-nums">{s.valor}</span>
            </div>
          ))}
        </div>
      </div>

      {casos.length > 0 && (
        <div className="grid gap-2.5 lg:grid-cols-2">
          <ChartPanel
            title="Monto en riesgo por caso"
            unidad="MXN"
            columns={[
              { key: "rfc", header: "RFC" },
              { key: "monto", header: "Monto", align: "right", render: (r) => numero(r.monto) },
              { key: "nivel", header: "Nivel" },
            ]}
            rows={casos.map((c) => ({ rfc: c.detalle.caso.rfc_principal, monto: Number(c.detalle.caso.monto_en_riesgo), nivel: c.detalle.caso.nivel ?? "en curso" }))}
            getRowKey={(r) => r.rfc}
            csvFilename="monto-por-caso"
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={casos.map((c) => ({ rfc: c.detalle.caso.rfc_principal, monto: Number(c.detalle.caso.monto_en_riesgo) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="rfc" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => (typeof v === "number" ? v.toLocaleString("es-MX") : String(v ?? ""))} />
                <Bar dataKey="monto" fill="var(--primary)" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>
          <ChartPanel
            title="Casos por nivel"
            columns={[
              { key: "nivel", header: "Nivel" },
              { key: "n", header: "Casos", align: "right" },
            ]}
            rows={Object.entries(
              casos.reduce<Record<string, number>>((acc, c) => {
                const k = c.detalle.caso.nivel ?? "en curso";
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
                    const k = c.detalle.caso.nivel ?? "en curso";
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

      {tokensPorAgenteInvestigacion.length > 0 && (
        <ChartPanel
          title="Tokens por agente (toda la investigación)"
          unidad="tokens"
          columns={[
            { key: "agente", header: "Agente" },
            { key: "tokens_in", header: "Entrada", align: "right" },
            { key: "tokens_out", header: "Salida", align: "right" },
          ]}
          rows={tokensPorAgenteInvestigacion}
          getRowKey={(r) => r.agente}
          csvFilename="tokens-por-agente"
        >
          <AgentesChart datos={tokensPorAgenteInvestigacion} />
        </ChartPanel>
      )}

      {casos.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-card-sm)] border border-border bg-surface p-3.5">
          <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Casos encontrados ({casos.length})</span>
          <div className="flex flex-col gap-1.5">
            {casos.map((c, i) => (
              <CasoFila
                key={c.detalle.caso.id}
                caso={c}
                duracionMs={duraciones[i]}
                auditor={emparejamiento.porCaso.get(c.detalle.caso.id) ?? { hallazgo: null, leads: [] }}
              />
            ))}
          </div>
        </div>
      )}

      {/*
        Lo que NO pertenece a ningún caso mostrado (feedback 2026-09-12: la
        info del auditor va segmentada DENTRO de cada caso; aquí sólo queda
        el residuo de la corrida — run_metadata, métricas globales, y
        hallazgos/leads que no emparejaron con ningún `caso_id` de esta
        investigación). El resto ya se ve en cada `CasoFila` de abajo.
      */}
      <SeccionColapsable titulo="Corrida (fuera de los casos de esta investigación)" abiertaPorDefecto={false}>
        {() => (
          <SeccionCorridaAuditor
            resultado={auditorResultado}
            hallazgosSinCaso={emparejamiento.hallazgosSinCaso}
            leadsSinCaso={emparejamiento.leadsSinCaso}
          />
        )}
      </SeccionColapsable>

      {/*
        Pizarrón de los 5 agentes IA de la investigación (no por caso: el
        caso `origen='ia_complemento'` no está en `inv.caso_ids`, ver
        `leerAnotacionesAgenteInvestigacion`). `anotacionesIA.length === 0`
        no distingue "sin complemento IA todavía" de "028 no aplicada en
        remoto" — ambos caen a `[]` en el BFF hoy (`.catch`), así que el
        texto de abajo se queda deliberadamente neutro.
      */}
      <SeccionColapsable titulo={`Pizarrón de los agentes IA (${anotacionesIA.length})`} abiertaPorDefecto={false}>
        {() => <SeccionPizarronIA anotaciones={anotacionesIA} />}
      </SeccionColapsable>
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
    <div className="flex flex-col rounded-[13px] border border-border bg-surface">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full flex-wrap items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <span className="font-mono text-[13px] font-medium text-text">{c.rfc_principal}</span>
        <NivelBadge nivel={c.nivel} />
        {caso.cluster && (
          <span
            className="ml-auto inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-border-strong bg-surface-raised py-0.5 pl-2.5 pr-1"
            title="Puntaje de riesgo calculado por el sistema (0 a 1)"
          >
            <span className="text-[11.5px] text-text-muted">Riesgo</span>
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
        <div className="flex flex-col gap-3 border-t border-border px-3.5 py-3">
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]">
            <MiniStat label="Pistas confirmadas" valor={`${sostenidas.length}`} nota={`de ${evaluadas.length} revisadas`} />
            <MiniStat
              label="Confianza del análisis"
              valor={confianza.porcentaje === null ? "—" : `${confianza.porcentaje}%`}
              nota={confianza.factores.map((f) => `${f.nombre}: ${Math.round(f.valor * 100)}%`).join("\n")}
              barra={confianza.porcentaje === null ? undefined : confianza.porcentaje / 100}
            />
            <MiniStat label="Monto en riesgo" valor={`${c.moneda} ${numero(Number(c.monto_en_riesgo))}`} nota={c.cobertura_completa ? "periodo completo" : "cobertura parcial"} />
            <MiniStat
              label="Ejecución de este caso"
              valor={formatoDuracion(duracionMs)}
              nota={tramo ? `${soloHora(tramo.desde)} → ${soloHora(tramo.hasta)} · ${tramo.pasos} pasos` : `${c.n_reintentos} reintentos`}
            />
          </div>

          <div className="grid min-w-0 gap-4 rounded-[10px] border border-border bg-surface px-3 py-2.5 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-[11px] uppercase tracking-[0.03em] text-text-subtle">Confianza del análisis</span>
              <DesgloseConfianza confianza={confianza} />
            </div>
            <div className="flex min-w-0 flex-col gap-2 border-border max-lg:border-t max-lg:pt-3 lg:border-l lg:pl-4">
              <span className="text-[11px] uppercase tracking-[0.03em] text-text-subtle">Resumen de la investigación</span>
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
                  <span className="text-[11px] text-text-subtle">Haz clic en un punto para ver sus transacciones en la tabla.</span>
                </>
              ) : (
                <p className="m-0 text-[12px] text-text-subtle">Sin grafo persistido para este caso.</p>
              )}
            </Seccion>

            <Seccion titulo="Transacciones usadas en la investigación">
              <FilasUsadas grafo={caso.grafo} evidencia={caso.detalle.evidencia} seleccion={seleccion} onLimpiar={() => setSeleccion(null)} />
            </Seccion>
          </div>

          <Seccion titulo="Cómo se investigó este caso">
            <LineaDecisiones pasos={narrarInvestigacion(caso.bitacora, caso.detalle)} />
          </Seccion>

          <SeccionColapsable titulo="Hallazgos completos, defensa, dictamen, Contraste y Trayectoria" abiertaPorDefecto={false}>
            {() => <CasoDetalleCompleto detalle={caso.detalle} bitacora={caso.bitacora} contraste={caso.contraste} trayectoria={caso.trayectoria} />}
          </SeccionColapsable>

          {(auditor.hallazgo || auditor.leads.length > 0) && (
            <SeccionColapsable
              titulo={`Hallazgo del auditor determinista${auditor.hallazgo ? "" : " (sin hallazgo propio)"} y leads relacionados (${auditor.leads.length})`}
              abiertaPorDefecto={false}
            >
              {() => (
                <div className="flex flex-col gap-4">
                  {auditor.hallazgo ? (
                    <HallazgoCard f={auditor.hallazgo} />
                  ) : (
                    <p className="text-[13px] text-text-subtle">
                      Este caso no tiene un hallazgo propio en <code className="font-mono">forense.auditor_resultados</code>; sólo leads relacionados por RFC.
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

          <SeccionColapsable titulo="Cadena de explicación" abiertaPorDefecto={false}>
            {() => <CadenaExplicacionVista auditorResultado={caso.auditorResultado} rfc={c.rfc_principal} />}
          </SeccionColapsable>

          <SeccionColapsable titulo="Agentes IA (runtime + telemetría real)" abiertaPorDefecto={false}>
            {() => <SeccionAgentesRuntime ejecuciones={caso.ejecuciones} />}
          </SeccionColapsable>

          <SeccionColapsable titulo={`Pizarrón (${caso.detalle.senales.length})`} abiertaPorDefecto={false}>
            {() => <SeccionPizarron senales={caso.detalle.senales} />}
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

  if (aristas.length === 0) return <p className="m-0 text-[12px] text-text-subtle">No hay transacciones registradas para este caso.</p>;
  const citadas = new Set(evidencia.flatMap((e) => [e.ref_id, `${e.tipo.toUpperCase()}:${e.ref_id}`]));
  const irA = (id: string) => filasRef.current.get(id)?.scrollIntoView({ block: "center", behavior: "smooth" });

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-[20px] items-center justify-between gap-2 text-[11.5px]">
        {seleccion ? (
          <>
            <span className="text-text-muted">
              {activas.length} de {aristas.length} transacciones de <span className="font-mono text-text">{etiquetaNodo(seleccion, grafo?.nodos ?? [])}</span>
            </span>
            <button type="button" onClick={onLimpiar} className="text-focus hover:underline">
              Quitar selección
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
                <th className="px-2.5 py-1.5 font-normal">Tipo</th>
                <th className="px-2.5 py-1.5 font-normal">De</th>
                <th className="px-2.5 py-1.5 font-normal">Para</th>
                <th className="px-2.5 py-1.5 text-right font-normal">Monto</th>
                <th className="px-2.5 py-1.5 font-normal">Fecha</th>
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
          <div className="relative w-[10px] flex-none border-l border-border bg-surface-raised" aria-label="Mapa de filas marcadas">
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
                  title="Ir a esta transacción"
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
    return <p className="m-0 text-[12px] text-text-subtle">Todavía no hay pruebas, señales ni defensa suficientes para calificar este análisis.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2" title="Mide qué tan sólido es el análisis, no la probabilidad de fraude.">
        <span className="text-[22px] font-semibold leading-none tracking-tight text-text">{confianza.porcentaje}%</span>
        <span className="text-[11.5px] text-text-subtle">promedio de {confianza.factores.length} factores</span>
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
  if (!markdown) return <p className="m-0 text-[12px] text-text-subtle">El agente redactor todavía no escribió el resumen de este caso.</p>;
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
                title={`${seg.cruda}${seg.valida ? "" : " · no está en evidencia validada"}`}
                className={cn("ml-0.5 rounded-[4px] px-1 text-[9.5px] font-medium", seg.valida ? "bg-surface-muted text-text-muted" : "bg-red-50 text-red-600")}
              >
                {citas.indexOf(seg.cruda) + 1}
              </sup>
            );
          })}
        </p>
      ))}
      <span className="text-[11px] text-text-subtle">Escrito por el agente redactor · {citas.length} cita{citas.length === 1 ? "" : "s"} a evidencia</span>
    </div>
  );
}

function LineaDecisiones({ pasos }: { pasos: PasoNarrado[] }) {
  if (pasos.length === 0) return <p className="m-0 text-[12px] text-text-subtle">Todavía no hay pasos registrados para este caso.</p>;
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
      <span className="text-[11px] uppercase tracking-[0.03em] text-text-subtle">{titulo}</span>
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
        <span className="text-[11px] uppercase tracking-[0.03em] text-text-subtle">{titulo}</span>
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
      <span className="text-[10.5px] uppercase tracking-[0.03em] text-text-subtle" title="Derivada de forense.auditor_resultados, no de una tabla de cadena de explicación (no existe todavía)">
        Derivada del auditor · regla: {cadena.hallazgo}
      </span>
      <ol className="m-0 flex flex-col gap-1.5 p-0">
        {cadena.eslabones.map((e, i) => (
          <li key={e.id} className="flex list-none gap-2 text-[12.5px] text-text">
            <span className={cn("flex-none rounded-[6px] px-1.5 py-0.5 text-[10px] uppercase", e.tipo === "hipotesis" ? "bg-primary text-white" : "bg-surface-muted text-text-subtle")}>
              {e.tipo === "hipotesis" ? "hipótesis" : `evidencia ${i}`}
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
    return <p className="m-0 text-[12px] text-text-subtle">Sin ejecuciones de runtime registradas para este caso todavía.</p>;
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
              {e.toolEnCurso && <span className="rounded-[6px] border border-border bg-surface px-1.5 text-[10.5px] text-text-muted">tool: {e.toolEnCurso.nombre ?? "en curso"}</span>}
              <span className="ml-auto font-mono text-[10.5px] text-text-subtle">paso {e.paso}</span>
            </span>
            <span className="text-[11px] text-text-subtle">
              {e.tokens_in != null || e.tokens_out != null ? `${numero(e.tokens_in ?? 0)} in / ${numero(e.tokens_out ?? 0)} out` : "tokens no disp."} ·{" "}
              {e.duracion_ms != null ? `${numero(e.duracion_ms)} ms` : "duración no disp."} · {e.tools.length} tool call{e.tools.length === 1 ? "" : "s"} ·{" "}
              {costo.texto}
            </span>
            <span className={cn("text-[11px]", e.erroresContrato && e.erroresContrato.length > 0 ? "text-red-600" : "text-text-subtle")}>
              {e.erroresContrato == null
                ? "errores de contrato: no reportado"
                : e.erroresContrato.length === 0
                  ? "errores de contrato: 0"
                  : `errores de contrato: ${e.erroresContrato.join("; ")}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SeccionPizarron({ senales }: { senales: CasoDetalle["senales"] }) {
  const ordenadas = [...senales].sort((a, b) => (a.creado || "").localeCompare(b.creado || ""));
  if (ordenadas.length === 0) return <p className="m-0 text-[12px] text-text-subtle">Todavía no hay anotaciones de agentes en este caso.</p>;
  return (
    <ul className="m-0 flex flex-col gap-1.5 p-0">
      {ordenadas.map((s) => (
        <li key={s.id} className="flex flex-col gap-0.5 rounded-[8px] border border-border bg-surface-raised px-2.5 py-1.5">
          <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-text">
            <span className="font-medium capitalize">{nombreAgente(s.agente)}</span>
            <span className="text-text-subtle">ronda {s.ronda} · intento {s.intento + 1}</span>
            {s.refuta && <span className="rounded-[var(--radius-pill)] border border-border px-1.5 text-[10px] text-text-subtle">descarta</span>}
          </span>
          <span className="text-[12px] leading-snug text-text-muted">{s.titular}</span>
        </li>
      ))}
    </ul>
  );
}

const TIPO_ANOTACION: Record<AnotacionAgenteIA["tipo"], string> = {
  razonamiento: "razonamiento",
  consulta: "consulta",
  salida: "salida",
  error: "error",
};

/**
 * Pizarrón de los 5 agentes IA (`forense.anotaciones_agente`, migración 028):
 * lo que cada especialista razonó, consultó o entregó, con sus tokens y
 * costo real por turno. Distinto del "Pizarrón" ya existente (`senales`,
 * `SeccionPizarron`) — ese es el pizarrón determinista del pipeline
 * original; este es el complemento IA de 5 subagentes tras el auditor.
 */
function SeccionPizarronIA({ anotaciones }: { anotaciones: AnotacionAgenteIA[] }) {
  if (anotaciones.length === 0) return <p className="m-0 text-[12px] text-text-subtle">Sin anotaciones del complemento IA para este caso todavía.</p>;
  const ordenadas = [...anotaciones].sort((a, b) => a.turno - b.turno || a.creado.localeCompare(b.creado));
  return (
    <ul className="m-0 flex flex-col gap-1.5 p-0">
      {ordenadas.map((a) => (
        <li
          key={a.id}
          className={cn(
            "flex flex-col gap-0.5 rounded-[8px] border px-2.5 py-1.5",
            a.tipo === "error" ? "border-red-200 bg-red-50" : "border-border bg-surface-raised",
          )}
        >
          <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-text">
            <span className="font-medium capitalize">{nombreAgente(a.rol)}</span>
            {a.familia && <span className="font-mono text-[10.5px] text-text-subtle">familia {a.familia}</span>}
            <span className="text-text-subtle">turno {a.turno}</span>
            <span
              className={cn(
                "rounded-[var(--radius-pill)] border px-1.5 text-[10px] uppercase",
                a.tipo === "error" ? "border-red-300 text-red-700" : "border-border text-text-subtle",
              )}
            >
              {TIPO_ANOTACION[a.tipo]}
            </span>
            {a.herramientas.length > 0 && <span className="font-mono text-[10.5px] text-text-subtle">{a.herramientas.join(", ")}</span>}
            <span className="ml-auto text-[10.5px] text-text-subtle">{soloHora(a.creado)}</span>
          </span>
          {a.texto && <span className="text-[12px] leading-snug text-text-muted">{a.texto}</span>}
          <span className="text-[10.5px] text-text-subtle">
            {a.tokens_in != null || a.tokens_out != null ? `${numero(a.tokens_in ?? 0)} in / ${numero(a.tokens_out ?? 0)} out` : "tokens no disp."}
            {a.costo_usd != null ? ` · $${a.costo_usd.toFixed(4)}` : ""}
            {a.senal_ids.length > 0 ? ` · señales ${a.senal_ids.join(", ")}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MiniStat({ label, valor, nota, barra }: { label: string; valor: string; nota?: string; barra?: number }) {
  return (
    <div title={nota} className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface px-3.5 py-3">
      <span className="text-[10.5px] uppercase tracking-[0.03em] text-text-subtle">{label}</span>
      <span className="truncate text-[32px] font-semibold leading-none tracking-[-0.03em] text-text tabular-nums">{valor}</span>
      {barra != null && (
        <span className="block h-[4px] overflow-hidden rounded-[3px] bg-surface-muted">
          <span className={cn("block h-full rounded-[3px]", barra >= 0.75 ? "bg-green-600" : barra >= 0.5 ? "bg-red-400" : "bg-red-600")} style={{ width: `${Math.round(barra * 100)}%` }} />
        </span>
      )}
    </div>
  );
}
