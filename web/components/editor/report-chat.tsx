"use client";

import { AlertTriangle, Loader2, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { Propuesta, Reporte } from "@/lib/document/tipos";
import { cn } from "@/lib/utils";

import { aplicarPropuesta, descartarPropuesta, pedirEdicion, uuid, type ErrorBFF } from "./cliente";
import type { EvidenciaCita } from "./cita-drawer";
import { VersionDiff } from "./version-diff";

/**
 * `ReportChat` (15 §10, 09 §8). Columna derecha de 360 px con tabs
 * Chat/Evidencia.
 *
 * Reglas que implementa:
 * - **Pregunta** (sin selección) devuelve un mensaje y NO altera el documento.
 * - **Propuesta** (con selección) devuelve diff con Aplicar/Descartar. Aplicar
 *   crea versión; Descartar conserva el documento.
 * - La `idempotency_key` de Aplicar se genera UNA vez por propuesta, no por
 *   click: un doble click aplica una sola vez y devuelve la misma versión.
 * - Conflicto de `version_base`: se conserva el borrador y se pide reconfirmar
 *   explícitamente; no hay reintento automático.
 * - El indicador de escritura se basa en el request activo, no en una
 *   animación ficticia.
 */

export interface SeleccionUI {
  from: number;
  to: number;
  block_ids: string[];
  texto_hash: string;
  texto: string;
}

const SUGERENCIAS = [
  "Summarize this section",
  "Explain the evidence",
  "Make this clearer",
  "Add the limitations",
  "Suggest next steps",
];

type Mensaje =
  | { id: string; autor: "humano"; texto: string; versionBase: number }
  | {
      id: string;
      autor: "editor";
      texto: string;
      versionBase: number;
      origen: string;
      references?: string[];
      /** `false` explícito: el servidor no pudo comprobar la selección. */
      seleccionVerificada?: boolean;
    }
  | { id: string; autor: "sistema"; texto: string; tono: "aviso" | "error" }
  | {
      id: string;
      autor: "propuesta";
      propuesta: Propuesta;
      claveAplicar: string;
      advertencias: Array<{ codigo: string; detalle: string }>;
      estado: "pendiente" | "aplicando" | "descartando" | "aplicada" | "descartada" | "conflicto";
      versionCreada?: number;
      origen: string;
      seleccionVerificada?: boolean;
      /** `false` explícito: aplicar/descartar no dejó evento en la bitácora. */
      bitacora?: boolean;
    };

/**
 * `seleccion_verificada: false` (15 §10, 07 §4 nodo 6): el servidor NO pudo
 * demostrar que el texto seleccionado siga en la versión base. No es un
 * rechazo —un 409 falso bloquearía una propuesta legítima—, pero la persona
 * que va a aplicar tiene derecho a saber contra qué se editó. Se pinta solo
 * con el `false` explícito: `undefined` significa "no había selección".
 */
function AvisoSeleccion() {
  return (
    <p
      className="mt-1 flex items-start gap-1 rounded-[var(--radius-input)] border border-warn/40 bg-warn/5 px-2 py-1 text-[11px] text-warn"
      role="status"
      data-testid="seleccion-no-verificada"
    >
      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
      Unverified selection. Review the differences before applying changes.
    </p>
  );
}

export function ReportChat({
  casoId,
  version,
  seleccion,
  evidencia,
  modoLectura,
  onAplicado,
  onLimpiarSeleccion,
  onAbrirCita,
  onAsk,
  initialAnswers = [],
  contextLabel,
}: {
  onAsk?: (question: string) => Promise<{answer: string; references: string[]}>;
  initialAnswers?: Array<{request_id: string; question: string; answer: string; references: string[]}>;
  contextLabel?: string;
  casoId: string;
  version: number;
  seleccion: SeleccionUI | null;
  evidencia: EvidenciaCita[];
  /** Se recibe por contrato con `DocumentWorkspace`; ya no se rotula en la UI. */
  origen?: "fixture" | "supabase";
  modoLectura: boolean;
  onAplicado: (reporte: Reporte, revisarCitas: boolean) => void;
  onLimpiarSeleccion: () => void;
  onAbrirCita: (referencia: string) => void;
}) {
  const [mensajes, setMensajes] = useState<Mensaje[]>(() => initialAnswers.flatMap((entry): Mensaje[] => [{id: `${entry.request_id}-q`, autor: "humano", texto: entry.question, versionBase: version}, {id: entry.request_id, autor: "editor", texto: entry.answer, references: entry.references, versionBase: version, origen: "codex"}]));
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [modoEnvio, setModoEnvio] = useState<"propuesta" | "pregunta">("propuesta");
  const [evidenciaElegida, setEvidenciaElegida] = useState<string[]>([]);
  const finMensajesRef = useRef<HTMLDivElement>(null);

  const agregar = useCallback((mensaje: Mensaje) => setMensajes((previos) => [...previos, mensaje]), []);

  // Feedback 2026-09-13: el hilo debe bajar solo al mensaje más reciente
  // cuando se envía o contesta, en vez de dejar al usuario scrolleando.
  useEffect(() => {
    finMensajesRef.current?.scrollIntoView({ block: "end" });
  }, [mensajes.length, enviando]);

  const describirError = (error: ErrorBFF): string => {
    switch (error.error) {
      case "backend_no_configurado":
        return "The editing service is not configured in this environment.";
      case "conflicto_version":
        return `The report changed to version ${error.version_actual}. Your draft is preserved. Select the text and request the change again.`;
      case "seleccion_desplazada":
        return "The selection no longer exists in this version. Select the text again.";
      case "citas_no_autorizadas":
        return error.detalle ?? "The proposal was rejected because it introduced unsupported citations.";
      case "cambio_de_nivel":
        return "The proposal tried to change the rule-based confidence level. The editor cannot change it.";
      case "seccion_protegida":
        return error.detalle ?? "The proposal removes a required section.";
      case "no_autenticado":
        return "Your session expired. Sign in to continue editing.";
      default:
        return error.detalle ?? `Could not complete the operation (${error.error}).`;
    }
  };

  async function enviar(mensajeTexto: string) {
    const limpio = mensajeTexto.trim();
    if (limpio.length === 0 || enviando || modoLectura) return;
    const modo: "pregunta" | "propuesta" = seleccion ? modoEnvio : "pregunta";

    agregar({ id: uuid(), autor: "humano", texto: limpio, versionBase: version });
    setTexto("");
    setEnviando(true);

    if (onAsk) {
      try {
        const reply = await onAsk(limpio);
        agregar({id: uuid(), autor: "editor", texto: reply.answer, references: reply.references, versionBase: version, origen: "codex"});
      } catch (error) { agregar({id: uuid(), autor: "sistema", texto: error instanceof Error ? error.message : "Could not answer. Please retry.", tono: "error"}); }
      finally { setEnviando(false); }
      return;
    }

    const resultado = await pedirEdicion({
      caso_id: casoId,
      version_base: version,
      modo,
      seleccion: seleccion
        ? { from: seleccion.from, to: seleccion.to, block_ids: seleccion.block_ids, texto_hash: seleccion.texto_hash }
        : undefined,
      mensaje: limpio,
      evidencia_ids: evidenciaElegida,
      idempotency_key: uuid(),
    });
    setEnviando(false);

    if (!resultado.ok) {
      agregar({ id: uuid(), autor: "sistema", texto: describirError(resultado.error), tono: "error" });
      return;
    }
    if (resultado.datos.modo === "pregunta") {
      agregar({
        id: uuid(),
        autor: "editor",
        texto: resultado.datos.mensaje,
        versionBase: version,
        origen: resultado.datos.origen,
        seleccionVerificada: resultado.datos.seleccion_verificada,
      });
      return;
    }
    agregar({
      id: uuid(),
      autor: "propuesta",
      propuesta: resultado.datos.propuesta,
      // Una sola clave por propuesta: el doble click no crea dos versiones.
      claveAplicar: uuid(),
      advertencias: resultado.datos.advertencias ?? [],
      estado: "pendiente",
      origen: resultado.datos.origen,
      seleccionVerificada: resultado.datos.seleccion_verificada,
    });
  }

  function actualizarPropuesta(id: string, cambios: Partial<Extract<Mensaje, { autor: "propuesta" }>>) {
    setMensajes((previos) =>
      previos.map((m) => (m.id === id && m.autor === "propuesta" ? { ...m, ...cambios } : m)),
    );
  }

  async function aplicar(mensaje: Extract<Mensaje, { autor: "propuesta" }>) {
    if (mensaje.estado !== "pendiente") return; // doble click: se aplica una vez
    actualizarPropuesta(mensaje.id, { estado: "aplicando" });

    const resultado = await aplicarPropuesta(casoId, {
      propuesta_id: mensaje.propuesta.propuesta_id,
      version_base: mensaje.propuesta.version_base,
      idempotency_key: mensaje.claveAplicar,
    });

    if (!resultado.ok) {
      actualizarPropuesta(mensaje.id, { estado: resultado.error.error === "conflicto_version" ? "conflicto" : "pendiente" });
      agregar({ id: uuid(), autor: "sistema", texto: describirError(resultado.error), tono: "error" });
      toast.error("The proposal was not applied");
      return;
    }

    actualizarPropuesta(mensaje.id, {
      estado: "aplicada",
      versionCreada: resultado.datos.version,
      bitacora: resultado.datos.bitacora,
    });
    onAplicado(resultado.datos.reporte, resultado.datos.revisar_citas);
    onLimpiarSeleccion();
    toast.success(`Version ${resultado.datos.version} created`);
    // CLAUDE.md regla 2: si la escritura no dejó evento en `forense.bitacora`,
    // la UI lo dice. Solo el `false` explícito; `undefined` es "no informado".
    if (resultado.datos.bitacora === false) {
      agregar({
        id: uuid(),
        autor: "sistema",
        texto: `Version ${resultado.datos.version} has no activity record, so this change cannot be audited.`,
        tono: "aviso",
      });
    }
    if (resultado.datos.revisar_citas) {
      agregar({
        id: uuid(),
        autor: "sistema",
        texto: `Version ${resultado.datos.version} has unvalidated citations (${resultado.datos.citas_invalidas.join(", ")}): citations need review before publishing.`,
        tono: "aviso",
      });
    }
  }

  /**
   * Descartar solo se marca cuando el BFF lo confirma. Antes se pintaba
   * "descartada" de inmediato y, si la escritura fallaba, la UI mostraba un
   * estado que no existía en el servidor: la propuesta seguía viva y podía
   * aplicarse desde otra sesión. Ahora el estado intermedio es `descartando`
   * y el error devuelve la propuesta a `pendiente`.
   */
  async function descartar(mensaje: Extract<Mensaje, { autor: "propuesta" }>) {
    if (mensaje.estado !== "pendiente" && mensaje.estado !== "conflicto") return;
    const estadoPrevio = mensaje.estado;
    actualizarPropuesta(mensaje.id, { estado: "descartando" });
    const resultado = await descartarPropuesta({
      caso_id: casoId,
      propuesta_id: mensaje.propuesta.propuesta_id,
      idempotency_key: uuid(),
    });
    if (!resultado.ok) {
      actualizarPropuesta(mensaje.id, { estado: estadoPrevio });
      agregar({ id: uuid(), autor: "sistema", texto: describirError(resultado.error), tono: "error" });
      return;
    }
    actualizarPropuesta(mensaje.id, { estado: "descartada", bitacora: resultado.datos.bitacora });
  }

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col bg-surface px-3.5 print:hidden"
      aria-label="Report chat"
    >
      {/*
        La pestaña "Evidencia" se ocultó a pedido (feedback 2026-09-13): el
        chat ya no tiene tabs, es un solo panel. `evidenciaElegida` queda sin
        una UI que la alimente por ahora — adjuntar evidencia a una propuesta
        necesitará otra entrada cuando se pida de vuelta.
      */}
      {onAsk && <div className="border-b border-border px-3 py-4"><div className="text-[13px] font-medium">Investigation assistant</div><p className="mt-1 truncate text-[11px] text-text-subtle">{contextLabel || "Reading this investigation"}</p></div>}
      <div className="flex min-h-0 flex-1 flex-col pt-1">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3" data-testid="chat-mensajes">
            {onAsk && mensajes.length === 0 && <div className="py-8 text-[13px] leading-6 text-text-muted"><span className="mb-3 block text-xl">✧</span>Follow a finding, question its evidence, or ask for a plain-English explanation.</div>}
            <ul className="flex flex-col gap-3">
              {mensajes.map((m) => (
                <li key={m.id}>
                  {m.autor === "humano" && (
                    <div className="ml-auto max-w-[92%] rounded-[14px_14px_4px_14px] bg-primary px-[11px] py-2 text-[12.5px] leading-relaxed text-white">
                      {m.texto}
                      <span className="mt-1 block text-[10px] text-white/70">{onAsk ? "Report question" : `on version ${m.versionBase}`}</span>
                    </div>
                  )}

                  {m.autor === "editor" && (
                    <div className="mr-auto max-w-[92%] rounded-[14px_14px_14px_4px] border border-border bg-surface-raised px-[11px] py-2 text-[12.5px] leading-relaxed text-text">
                      <span className="whitespace-pre-wrap">{m.texto}</span>
                      {m.references && <div className="mt-2 flex flex-wrap gap-1">{m.references.map(ref => <button key={ref} onClick={() => onAbrirCita(ref)} className="rounded border border-border bg-surface px-1.5 py-1 text-[10px] underline">{ref}</button>)}</div>}
                      <span className="mt-1 block text-[10px] text-text-subtle">
                        {onAsk ? "Codex · saved answer" : "Editor · changes require approval"}
                      </span>
                      {m.seleccionVerificada === false && <AvisoSeleccion />}
                    </div>
                  )}

                  {m.autor === "sistema" && (
                    <div
                      className={cn(
                        "rounded-[var(--radius-card)] border px-3 py-2 text-xs",
                        m.tono === "error" ? "border-error/40 bg-error/5 text-error" : "border-warn/40 bg-warn/5 text-warn",
                      )}
                      role="status"
                    >
                      {m.texto}
                    </div>
                  )}

                  {m.autor === "propuesta" && (
                    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-2">
                      <p className="text-sm text-text">{m.propuesta.mensaje}</p>
                      {m.seleccionVerificada === false && <AvisoSeleccion />}
                      <VersionDiff diff={m.propuesta.diff} titulo={`Proposal for version ${m.propuesta.version_base}`} maxAltura={200} />

                      {m.propuesta.citas.length > 0 && (
                        <p className="flex flex-wrap gap-1 text-[11px] text-text-subtle">
                          Citas:
                          {m.propuesta.citas.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => onAbrirCita(c)}
                              className="rounded-full border border-border bg-surface-muted px-1.5 font-mono hover:bg-surface-hover"
                            >
                              {c}
                            </button>
                          ))}
                        </p>
                      )}

                      {m.advertencias.map((a, i) => (
                        <p key={i} className="rounded-[var(--radius-input)] bg-warn/5 px-2 py-1 text-[11px] text-warn">
                          {a.detalle}
                        </p>
                      ))}

                      {m.estado === "pendiente" || m.estado === "aplicando" || m.estado === "descartando" ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={m.estado !== "pendiente"}
                            onClick={() => aplicar(m)}
                            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-input)] bg-primary px-2.5 text-xs text-white hover:bg-primary-hover disabled:opacity-60"
                          >
                            {m.estado === "aplicando" && <Loader2 size={12} className="animate-spin" aria-hidden />}
                            Apply
                          </button>
                          <button
                            type="button"
                            disabled={m.estado !== "pendiente"}
                            onClick={() => descartar(m)}
                            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-input)] border border-border px-2.5 text-xs text-text-muted hover:bg-surface-hover disabled:opacity-60"
                          >
                            {m.estado === "descartando" && <Loader2 size={12} className="animate-spin" aria-hidden />}
                            Dismiss
                          </button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-text-subtle">
                          {m.estado === "aplicada" && `Applied: version ${m.versionCreada} created.`}
                          {m.estado === "descartada" && "Dismissed: the document is unchanged."}
                          {m.estado === "conflicto" && "Conflict: a newer report version exists. Request the proposal again."}
                          {m.bitacora === false && (m.estado === "aplicada" || m.estado === "descartada") && (
                            <span className="ml-1 text-warn" data-testid="sin-bitacora">
                              No activity record.
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {enviando && (
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-text-subtle" role="status">
                <Loader2 size={12} className="animate-spin" aria-hidden /> Consultando al Editor…
              </p>
            )}
            <div ref={finMensajesRef} />
          </div>

          <div className="shrink-0 pt-3">
            <div className="mb-2 flex gap-[7px] overflow-x-auto pb-0.5 [scrollbar-width:thin]">
              {(onAsk ? ["What matters most?", "Explain this finding", "What evidence is missing?", "Could this be legitimate?"] : SUGERENCIAS).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={modoLectura || enviando}
                  onClick={() => enviar(s)}
                  className="h-[26px] flex-none whitespace-nowrap rounded-[var(--radius-pill)] bg-surface-muted px-2.5 text-[11.5px] text-text-muted transition-colors duration-150 hover:bg-surface-hover disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>

            {(evidenciaElegida.length > 0 || seleccion) && (
              <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
                {evidenciaElegida.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setEvidenciaElegida([])}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-text-muted hover:bg-surface-hover"
                  >
                    {evidenciaElegida.length} evidencias <X size={10} aria-hidden />
                  </button>
                )}
                {seleccion && (
                  <button
                    type="button"
                    onClick={onLimpiarSeleccion}
                    className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-focus/40 bg-focus/10 px-2 py-0.5 text-focus"
                    title={seleccion.texto}
                  >
                    selection: {seleccion.texto.slice(0, 28) || `${seleccion.block_ids.length} bloque(s)`} <X size={10} aria-hidden />
                  </button>
                )}
              </div>
            )}

            {seleccion && (
              <div className="mb-2 inline-flex rounded-[var(--radius-input)] border border-border p-0.5 text-[11px]">
                {(["propuesta", "pregunta"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModoEnvio(m)}
                    aria-pressed={modoEnvio === m}
                    className={cn("rounded-[6px] px-2 py-0.5", modoEnvio === m ? "bg-surface-muted text-text" : "text-text-muted")}
                  >
                    {m === "propuesta" ? "Edit" : "Preguntar"}
                  </button>
                ))}
              </div>
            )}

            <form
              className="flex flex-col gap-1.5 rounded-[16px] border border-border bg-surface p-2.5 transition-colors focus-within:border-border-stronger"
              onSubmit={(e) => {
                e.preventDefault();
                enviar(texto);
              }}
            >
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={2}
                disabled={modoLectura}
                aria-label={onAsk ? "Question for the investigation assistant" : "Instruction for the editor"}
                placeholder={modoLectura ? "Read-only" : seleccion ? "How should this selection change?" : "Ask about the report…"}
                className="w-full resize-none border-none bg-transparent text-[12.5px] leading-relaxed text-text outline-none disabled:opacity-50"
                onKeyDown={(e) => {
                  // Feedback 2026-09-13: Enter envía (como en cualquier chat);
                  // Shift+Enter sigue insertando un salto de línea.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    enviar(texto);
                  }
                }}
              />
              <button
                type="submit"
                disabled={enviando || modoLectura || texto.trim().length === 0}
                aria-label="Send"
                className="ml-auto inline-flex h-[26px] w-[26px] items-center justify-center rounded-full bg-primary text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-40"
              >
                <Send size={13} aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
