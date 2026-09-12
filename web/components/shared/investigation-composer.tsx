"use client";

import { Search, Sparkle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PistasScope } from "./pistas-scope";
import type { Corrida } from "@/lib/data";
import { ZONA_POR_OMISION } from "@/lib/date/formato";
import { resolveDateRangePreset } from "@/lib/date/range";
import { cn } from "@/lib/utils";

export interface InvestigationComposerProps {
  corrida: Corrida;
  clusterId?: string;
  rfcsDisponibles: string[];
  /** docs/22 "dataset seleccionado + composer": el pill "Cambiar dataset" regresa al picker. */
  onChangeDataset?: () => void;
  className?: string;
}

/** Fecha wall-clock `YYYY-MM-DD` de un instante, sin `toLocale*` a pelo. */
function diaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Un día wall-clock como `Date` cuyos getters UTC llevan ese día (lo que espera `lib/date/range`). */
function desdeDiaISO(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

/**
 * Composer del diseño Inspector (`design-ref/Agents.dc.html`, bloque
 * `showComposer`, líneas 107-166), **idéntico**: pill del dataset con
 * "Cambiar dataset", tarjeta de radio 24px con sombra `0 1px 3px`, el
 * conmutador "Contexto | Filtros" (con su separador vertical de 1px) a la
 * izquierda y el botón oscuro "Inspeccionar" con la lupa invertida a la
 * derecha, y al expandir: textarea de 8 filas sobre `--surface-raised`, las
 * dos fechas con su "a", el botón "Todo el rango" y, tras el separador, el
 * picker de alcance.
 *
 * Las sugerencias/chips que había aquí **se quitaron** a pedido del usuario
 * (2026-09-12: "el prompt bar elimina las sugerencias… identico al design"),
 * igual que los chips de RFC y el atajo de evidencia, que el diseño tampoco
 * tiene. Consecuencia que hay que saber: `directriz_id` es **obligatorio** en
 * `product.investigar` y era justo lo que esos chips elegían; sin ellos el
 * envío va con la directriz neutra `resumen` y el alcance real lo fija el
 * texto libre del usuario, que entra como `mensaje` (trazado, y que nunca
 * fija ni sube el `nivel` — reglas 4 y 6).
 *
 * Las fechas sí son los dos `<input type="date">` del original, pero el
 * periodo se resuelve con `lib/date/range` (preset `personalizado`): el
 * usuario ve el día que espera y la conversión a `hasta_exclusivo` en la zona
 * declarada la hace el código (H11-g), nunca aritmética sobre ISO.
 */
export function InvestigationComposer({
  corrida,
  clusterId,
  rfcsDisponibles,
  onChangeDataset,
  className,
}: InvestigationComposerProps) {
  const limites = useMemo(() => {
    const desde = diaISO(new Date(corrida.inicio));
    const hasta = diaISO(new Date(corrida.fin ?? corrida.fecha_corte));
    return { desde, hasta };
  }, [corrida.inicio, corrida.fin, corrida.fecha_corte]);

  const [expandido, setExpandido] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [desde, setDesde] = useState(limites.desde);
  const [hasta, setHasta] = useState(limites.hasta);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  async function investigar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    try {
      // Corrida cargada desde un estate de jueces: la auditoría por fases corre de fondo
      // (determinista primero, agentes sobre esa base) y el canvas la dibuja en vivo.
      if (corrida.version_reglas === "forensic-auditor-v1") {
        const r = await fetch("/api/auditoria", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ corrida_id: corrida.id }),
        });
        const b = await r.json().catch(() => ({}));
        if (r.status === 202 && typeof b.caso_id === "string") {
          router.push(`/analisis/${encodeURIComponent(b.caso_id)}`);
          return;
        }
        toast.error(`No se pudo iniciar la auditoría (${b.detalle ?? b.error ?? r.status}).`, { duration: Infinity });
        return;
      }

      const periodo = resolveDateRangePreset({
        preset: "personalizado",
        timezone: ZONA_POR_OMISION,
        referencia: new Date(corrida.fecha_corte),
        personalizado: {
          desde: desdeDiaISO(desde),
          // `hasta` es el último día que el usuario espera incluir; el
          // contrato quiere la frontera EXCLUSIVA, que es el día siguiente.
          hastaExclusivo: new Date(desdeDiaISO(hasta).getTime() + 24 * 60 * 60 * 1000),
        },
      });

      const res = await fetch("/api/investigaciones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mensaje: mensaje.trim() || `Inspeccionar ${corrida.nombre}`,
          directriz_id: "resumen",
          directriz_version: 1,
          contexto: {
            corrida_id: corrida.id,
            cluster_id: clusterId,
            rfcs: rfcsDisponibles.slice(0, 40),
            evidencia_ids: [],
            periodo,
          },
          investigacion_padre_id: null,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 202 || res.ok) {
        // `FORENSE_investigar_cluster` responde `{caso_id, cluster_id,
        // corrida_id, estado}`: con caso se entra al canvas "Análisis en
        // proceso" (`/analisis/[casoId]`); sin él (cluster ocupado, en cola)
        // no hay nada persistido que dibujar todavía y se avisa como antes.
        if (typeof body.caso_id === "string" && body.caso_id) {
          router.push(`/analisis/${encodeURIComponent(body.caso_id)}`);
          return;
        }
        toast.success("Investigación aceptada. Aparecerá en la cola cuando se persista.");
      } else if (res.status === 503 && body.error === "backend_no_configurado") {
        toast.error("El backend de investigación no está configurado en este entorno todavía.", { duration: Infinity });
      } else if (res.status === 401) {
        toast.error("Sesión expirada. Vuelve a entrar.", { duration: Infinity });
      } else {
        toast.error(`No se pudo enviar la investigación (${body.error ?? res.status}).`, { duration: Infinity });
      }
    } catch {
      toast.error("No se pudo conectar con el servidor.", { duration: Infinity });
    } finally {
      setEnviando(false);
    }
  }

  const rangoInvalido = hasta < desde;

  return (
    <form onSubmit={investigar} className={cn("flex w-full flex-col gap-2.5", className)}>
      <div className="flex items-center justify-center gap-2">
        <span className="flex h-[30px] max-w-[280px] items-center gap-1.5 truncate rounded-[var(--radius-pill)] border border-border-strong bg-surface-raised px-3 text-[12.5px] text-text">
          <span
            aria-hidden
            className="h-1.5 w-1.5 flex-none bg-primary"
            style={{ borderRadius: corrida.corrida_origen_id != null ? "50%" : "2px" }}
          />
          {corrida.nombre}
        </span>
        {onChangeDataset && (
          <button
            type="button"
            onClick={onChangeDataset}
            className="h-[30px] rounded-[var(--radius-pill)] border border-border bg-surface px-3 text-[12.5px] text-text-muted transition-colors duration-150 hover:bg-surface-hover"
          >
            Cambiar dataset
          </button>
        )}
      </div>

      <div className="flex flex-col rounded-[var(--radius-composer)] border border-border-strong bg-surface p-3.5 shadow-[0_1px_3px_rgba(20,20,19,.05)]">
        <div className="flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={expandido}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-[var(--radius-pill)] border border-border px-3.5 text-[12.5px] text-text-muted transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover",
              expandido ? "bg-surface-muted" : "bg-surface",
            )}
          >
            Contexto
            <span aria-hidden className="h-3.5 w-px bg-border-strong" />
            Filtros
          </button>
          <button
            type="submit"
            disabled={enviando || (rangoInvalido && corrida.version_reglas !== "forensic-auditor-v1")}
            className="group flex h-[34px] items-center gap-1.5 rounded-[var(--radius-pill)] bg-primary px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-40"
          >
            <span className="relative flex h-3.5 w-3.5 flex-none items-center justify-center">
              <Search size={14} aria-hidden className="-scale-x-100 transition-transform duration-150 group-hover:-rotate-45" />
              <Sparkle
                size={9}
                aria-hidden
                fill="currentColor"
                className="absolute -right-1 -top-1 scale-0 text-white opacity-0 transition-all duration-300 delay-150 ease-out group-hover:scale-100 group-hover:opacity-100"
              />
            </span>
            {enviando ? "Enviando…" : "Inspeccionar"}
          </button>
        </div>

        <div
          className="overflow-y-auto overflow-x-hidden"
          style={{
            maxHeight: expandido ? "64vh" : "0px",
            opacity: expandido ? 1 : 0,
            transition: "max-height .7s cubic-bezier(.22,.7,.3,1), opacity .5s ease",
          }}
        >
          <div className="mt-3.5 flex flex-col gap-3 border-t border-border pt-3.5">
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              rows={8}
              maxLength={4000}
              placeholder="Agrega contexto para esta inspección…"
              className="max-h-[40vh] min-h-[180px] w-full resize-none rounded-[var(--radius-card-sm)] border border-border bg-surface-raised px-3.5 py-2.5 text-[13.5px] leading-relaxed text-text outline-none transition-colors focus:border-primary focus:bg-surface"
            />

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={desde}
                min={limites.desde}
                max={hasta}
                onChange={(e) => setDesde(e.target.value)}
                aria-label="Desde"
                className="h-[30px] rounded-[var(--radius-input)] border border-border bg-surface px-2.5 text-[12.5px] text-text outline-none focus:border-primary"
              />
              <span className="text-[12.5px] text-text-subtle">a</span>
              <input
                type="date"
                value={hasta}
                min={desde}
                max={limites.hasta}
                onChange={(e) => setHasta(e.target.value)}
                aria-label="Hasta"
                className="h-[30px] rounded-[var(--radius-input)] border border-border bg-surface px-2.5 text-[12.5px] text-text outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => {
                  setDesde(limites.desde);
                  setHasta(limites.hasta);
                }}
                className="h-[30px] rounded-[var(--radius-input)] border border-border bg-surface px-2.5 text-[12px] text-text-muted transition-colors duration-150 hover:bg-surface-hover"
              >
                Todo el rango
              </button>
              <span aria-hidden className="h-[18px] w-px bg-border" />
              <PistasScope familiasEvaluables={corrida.familias_evaluables} className="ml-2" />
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
