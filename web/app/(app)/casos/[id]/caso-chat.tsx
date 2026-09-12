"use client";

import { History, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { Investigacion, Periodo } from "@/lib/data";
import type { InvestigarPayload } from "@/lib/data";
import { soloFecha } from "@/lib/date/formato";
import { cn } from "@/lib/utils";

/**
 * Columna derecha del diseño Inspector (`design-ref/Agents.dc.html`, bloque
 * `resultsOpen`, líneas 316-360): nombre del chat editable, botón de
 * historial con su desplegable, hilo de burbujas (usuario a la derecha en
 * `#141413` con radio `14/14/4/14`, agente a la izquierda sobre
 * `--surface-raised` con `14/14/14/4`), chips de sugerencia y el compositor
 * de radio 16px con el `+` y el botón circular de envío.
 *
 * **El chat no inventa respuestas.** `sendChat()` del original contesta con
 * una frase enlatada ("the effect concentrates in the last three weeks…");
 * eso en un producto forense es un número medido de mentira (docs/22 trampa
 * 1, reglas 4 y 10). Aquí cada pregunta se manda como lo que realmente es:
 * una **investigación** más (`product.investigar`) por el BFF — con el mismo
 * contrato y la misma traza que el composer del home; el encadenamiento por
 * `investigacion_padre_id` queda para cuando la UI conozca el id de la
 * investigación que produjo este caso, y hasta entonces va en `null` en vez
 * de inventarse un padre. La burbuja del agente dice
 * únicamente lo que el sistema confirma — aceptada y en cola, o el error. La
 * respuesta aparece cuando la investigación se persiste, y el historial de
 * abajo son las investigaciones reales de este caso, no un listado de
 * ejemplo.
 */
export interface CasoChatProps {
  corridaId: string;
  clusterId: string;
  rfcs: string[];
  periodo: Periodo;
  tituloInicial: string;
  /** Investigaciones reales ligadas a esta corrida (persistidas). */
  investigaciones: Investigacion[];
}

type Burbuja = { id: string; rol: "usuario" | "agente"; texto: string };

const CHIPS: Array<{ label: string; directriz: InvestigarPayload["directriz_id"] }> = [
  { label: "Explicar esta cadena", directriz: "explicar_cadena" },
  { label: "Intentar refutar", directriz: "intentar_refutar" },
  { label: "Comparar con sus pares", directriz: "comparar_pares" },
  { label: "Resumen ejecutivo", directriz: "resumen" },
];

export function CasoChat({ corridaId, clusterId, rfcs, periodo, tituloInicial, investigaciones }: CasoChatProps) {
  const [nombre, setNombre] = useState(tituloInicial);
  const [historial, setHistorial] = useState(false);
  const [borrador, setBorrador] = useState("");
  const [directriz, setDirectriz] = useState<InvestigarPayload["directriz_id"]>("resumen");
  const [enviando, setEnviando] = useState(false);
  const [mensajes, setMensajes] = useState<Burbuja[]>([]);

  async function enviar() {
    const texto = borrador.trim();
    if (!texto || enviando) return;
    setEnviando(true);
    setBorrador("");
    setMensajes((m) => [...m, { id: crypto.randomUUID(), rol: "usuario", texto }]);
    try {
      const res = await fetch("/api/investigaciones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mensaje: texto,
          directriz_id: directriz,
          directriz_version: 1,
          // `cluster_id` es uuid en el contrato: si no hay cluster (una
          // investigación sin caso dictaminado todavía), se omite en vez de
          // mandar cadena vacía, que el gate rechazaría con 422.
          contexto: { corrida_id: corridaId, ...(clusterId ? { cluster_id: clusterId } : {}), rfcs, evidencia_ids: [], periodo },
          investigacion_padre_id: null,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      const ok = res.status === 202 || res.ok;
      setMensajes((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          rol: "agente",
          texto: ok
            ? "Seguimiento aceptado y en cola. La respuesta aparece aquí cuando la investigación se persiste; nada se contesta antes de medirlo."
            : body.error === "backend_no_configurado"
              ? "El backend de investigación no está configurado en este entorno todavía."
              : `No se pudo enviar el seguimiento (${body.error ?? res.status}).`,
        },
      ]);
      if (!ok) toast.error("No se pudo enviar el seguimiento.");
    } catch {
      setMensajes((m) => [
        ...m,
        { id: crypto.randomUUID(), rol: "agente", texto: "No se pudo conectar con el servidor." },
      ]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent pl-3.5">
      <div className="flex flex-none items-center justify-between gap-2.5 px-0.5 pb-3 pt-0.5">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          aria-label="Nombre del hilo"
          className="-ml-[7px] h-[26px] min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-[7px] text-[12.5px] font-medium text-text outline-none transition-colors duration-150 focus:border-border-strong focus:bg-surface"
        />
        <button
          type="button"
          onClick={() => setHistorial((v) => !v)}
          aria-label="Historial de investigaciones"
          aria-expanded={historial}
          className={cn(
            "flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:bg-surface-hover",
            historial && "bg-surface-muted",
          )}
        >
          <History size={14} aria-hidden />
        </button>
      </div>

      {historial && (
        <div className="mb-2.5 flex flex-none flex-col gap-0.5 rounded-[var(--radius-card-sm)] border border-border bg-surface-raised p-2">
          <span className="px-1.5 pb-1.5 pt-0.5 text-[10.5px] uppercase tracking-[0.05em] text-text-subtle">
            Investigaciones de esta corrida
          </span>
          {investigaciones.map((inv) => (
            <Link
              key={inv.id}
              href={`/documentos/${inv.id}`}
              className="flex items-center justify-between gap-2 rounded-[9px] px-2 py-[7px] text-left transition-colors duration-150 hover:bg-surface-muted"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-text">{inv.titulo ?? inv.mensaje ?? "Investigación"}</span>
              <span className="flex-none text-[11px] text-text-subtle">{soloFecha(inv.completada_at ?? inv.creado)}</span>
            </Link>
          ))}
          {investigaciones.length === 0 && (
            <p className="m-0 px-2 py-3 text-center text-[11.5px] text-text-subtle">Todavía no hay investigaciones de esta corrida.</p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-0.5">
        {mensajes.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[92%] px-[11px] py-2 text-[12.5px] leading-relaxed text-balance",
              m.rol === "usuario"
                ? "self-end rounded-[14px_14px_4px_14px] bg-primary text-white"
                : "self-start rounded-[14px_14px_14px_4px] border border-border bg-surface-raised text-text",
            )}
          >
            {m.texto}
          </div>
        ))}
      </div>

      <div className="flex flex-none flex-col gap-2 pt-3">
        <div className="flex gap-[7px] overflow-x-auto pb-0.5 [scrollbar-width:thin]">
          {CHIPS.map((c) => (
            <button
              key={c.directriz}
              type="button"
              onClick={() => {
                setDirectriz(c.directriz);
                setBorrador(c.label);
              }}
              aria-pressed={directriz === c.directriz}
              className={cn(
                "h-[26px] flex-none whitespace-nowrap rounded-[var(--radius-pill)] px-2.5 text-[11.5px] transition-colors duration-150",
                directriz === c.directriz ? "bg-primary text-white" : "bg-surface-muted text-text-muted hover:bg-surface-hover",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 rounded-[16px] border border-border bg-surface p-2.5 transition-colors focus-within:border-border-stronger">
          <textarea
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Pregunta lo que sea sobre esta corrida…"
            className="w-full resize-none border-none bg-transparent text-[12.5px] leading-relaxed text-text outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <Link
              href={`/corridas/${corridaId}`}
              aria-label="Volver al board de la corrida"
              className="flex h-6 w-6 items-center justify-center rounded-full text-text-subtle transition-colors duration-150 hover:bg-surface-hover"
            >
              <Plus size={15} aria-hidden />
            </Link>
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando || !borrador.trim()}
              aria-label="Enviar seguimiento"
              className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-primary text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-40"
            >
              <Search size={13} aria-hidden style={{ transform: "scaleX(-1)" }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
