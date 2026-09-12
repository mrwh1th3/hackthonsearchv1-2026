"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { NivelBadge } from "./badges";
import { ClusterForceGraph } from "./force-graph";
import type { CasoDetalle, ClusterResumen, Corrida, EventoForense, GrafoArista, GrafoCluster, GrafoNodo } from "@/lib/data";
import { soloFecha, soloHora } from "@/lib/date/formato";
import { dividirEnSecciones, partirEnCitas } from "@/lib/expediente/citas";
import { confianzaAnalisis } from "@/lib/expediente/confianza";
import { narrarInvestigacion, type PasoNarrado } from "@/lib/expediente/narrativa";
import { cn } from "@/lib/utils";

export interface CasoConContexto {
  detalle: CasoDetalle;
  cluster: ClusterResumen | null;
  grafo: GrafoCluster | null;
  bitacora: EventoForense[];
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
}: {
  corrida: Corrida | null;
  casos: CasoConContexto[];
  tokensCorrida: number | null;
}) {
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
        <div className="flex flex-col gap-2 rounded-[var(--radius-card-sm)] border border-border bg-surface p-3.5">
          <span className="text-[11px] uppercase tracking-[0.05em] text-text-subtle">Casos encontrados ({casos.length})</span>
          <div className="flex flex-col gap-1.5">
            {casos.map((c, i) => (
              <CasoFila key={c.detalle.caso.id} caso={c} duracionMs={duraciones[i]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CasoFila({ caso, duracionMs }: { caso: CasoConContexto; duracionMs: number | null }) {
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
