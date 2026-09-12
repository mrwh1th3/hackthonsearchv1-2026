"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { Loader2, Send, X } from "lucide-react";
import { useCallback, useState } from "react";
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
  "Resume esta sección",
  "Explica la evidencia",
  "Hazlo más claro",
  "Agrega las limitaciones",
  "Propón próximos pasos",
];

type Mensaje =
  | { id: string; autor: "humano"; texto: string; versionBase: number }
  | { id: string; autor: "editor"; texto: string; versionBase: number; origen: string }
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
    };

export function ReportChat({
  casoId,
  version,
  seleccion,
  evidencia,
  origen,
  modoLectura,
  onAplicado,
  onLimpiarSeleccion,
  onAbrirCita,
}: {
  casoId: string;
  version: number;
  seleccion: SeleccionUI | null;
  evidencia: EvidenciaCita[];
  origen: "fixture" | "supabase";
  modoLectura: boolean;
  onAplicado: (reporte: Reporte, revisarCitas: boolean) => void;
  onLimpiarSeleccion: () => void;
  onAbrirCita: (referencia: string) => void;
}) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [modoEnvio, setModoEnvio] = useState<"propuesta" | "pregunta">("propuesta");
  const [evidenciaElegida, setEvidenciaElegida] = useState<string[]>([]);

  const agregar = useCallback((mensaje: Mensaje) => setMensajes((previos) => [...previos, mensaje]), []);

  const describirError = (error: ErrorBFF): string => {
    switch (error.error) {
      case "backend_no_configurado":
        return "No hay backend de edición configurado. No se inventa una respuesta: configura N8N_WEBHOOK_BASE o usa la fuente de fixtures.";
      case "conflicto_version":
        return `El expediente cambió a la versión ${error.version_actual}. Tu borrador se conserva; vuelve a seleccionar el texto y pide la propuesta otra vez.`;
      case "seleccion_desplazada":
        return "La selección ya no existe en esta versión del documento. Selecciona de nuevo el fragmento.";
      case "citas_no_autorizadas":
        return error.detalle ?? "La propuesta introduce citas sin evidencia validada y fue rechazada.";
      case "cambio_de_nivel":
        return "La propuesta intentaba cambiar el nivel del dictamen. El nivel lo fija el código determinista, no el editor.";
      case "seccion_protegida":
        return error.detalle ?? "La propuesta elimina una sección que no puede faltar.";
      case "no_autenticado":
        return "Tu sesión expiró. Vuelve a entrar para seguir editando.";
      default:
        return error.detalle ?? `No se pudo completar la operación (${error.error}).`;
    }
  };

  async function enviar(mensajeTexto: string) {
    const limpio = mensajeTexto.trim();
    if (limpio.length === 0 || enviando || modoLectura) return;
    const modo: "pregunta" | "propuesta" = seleccion ? modoEnvio : "pregunta";

    agregar({ id: uuid(), autor: "humano", texto: limpio, versionBase: version });
    setTexto("");
    setEnviando(true);

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
      agregar({ id: uuid(), autor: "editor", texto: resultado.datos.mensaje, versionBase: version, origen: resultado.datos.origen });
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
      toast.error("No se aplicó la propuesta");
      return;
    }

    actualizarPropuesta(mensaje.id, { estado: "aplicada", versionCreada: resultado.datos.version });
    onAplicado(resultado.datos.reporte, resultado.datos.revisar_citas);
    onLimpiarSeleccion();
    toast.success(`Versión ${resultado.datos.version} creada`);
    if (resultado.datos.revisar_citas) {
      agregar({
        id: uuid(),
        autor: "sistema",
        texto: `La versión ${resultado.datos.version} tiene citas sin evidencia validada (${resultado.datos.citas_invalidas.join(", ")}): queda en "revisar citas" y no puede publicarse.`,
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
    actualizarPropuesta(mensaje.id, { estado: "descartada" });
  }

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col border-l border-border bg-surface print:hidden"
      aria-label="Chat del expediente"
    >
      <Tabs.Root defaultValue="chat" className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5" aria-label="Panel lateral">
          {[
            { valor: "chat", etiqueta: "Chat" },
            { valor: "evidencia", etiqueta: `Evidencia (${evidencia.length})` },
          ].map((t) => (
            <Tabs.Trigger
              key={t.valor}
              value={t.valor}
              className="rounded-[var(--radius-input)] px-2 py-1 text-xs text-text-muted data-[state=active]:bg-surface-muted data-[state=active]:text-text"
            >
              {t.etiqueta}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="chat" className="flex min-h-0 flex-1 flex-col focus:outline-none">
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3" data-testid="chat-mensajes">
            {mensajes.length === 0 && (
              <p className="text-xs leading-relaxed text-text-subtle">
                Selecciona texto del expediente y pide un cambio: la respuesta llega como propuesta con diff, y solo
                &quot;Aplicar&quot; crea una versión. Sin selección, la pregunta se responde sin tocar el documento.
              </p>
            )}

            <ul className="flex flex-col gap-3">
              {mensajes.map((m) => (
                <li key={m.id}>
                  {m.autor === "humano" && (
                    <div className="ml-6 rounded-[var(--radius-card)] bg-surface-muted px-3 py-2 text-sm text-text">
                      {m.texto}
                      <span className="mt-1 block text-[10px] text-text-subtle">sobre la versión {m.versionBase}</span>
                    </div>
                  )}

                  {m.autor === "editor" && (
                    <div className="mr-6 rounded-[var(--radius-card)] border border-border px-3 py-2 text-sm text-text">
                      {m.texto}
                      <span className="mt-1 block text-[10px] text-text-subtle">
                        Editor · {m.origen === "n8n" ? "agente" : "respuesta de demostración"} · no modifica el documento
                      </span>
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
                      <VersionDiff diff={m.propuesta.diff} titulo={`Propuesta sobre la versión ${m.propuesta.version_base}`} maxAltura={200} />

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
                            Aplicar
                          </button>
                          <button
                            type="button"
                            disabled={m.estado !== "pendiente"}
                            onClick={() => descartar(m)}
                            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-input)] border border-border px-2.5 text-xs text-text-muted hover:bg-surface-hover disabled:opacity-60"
                          >
                            {m.estado === "descartando" && <Loader2 size={12} className="animate-spin" aria-hidden />}
                            Descartar
                          </button>
                          <span className="text-[10px] text-text-subtle">
                            {m.origen === "n8n" ? "agente Editor" : "propuesta determinista de demostración"}
                          </span>
                        </div>
                      ) : (
                        <p className="text-[11px] text-text-subtle">
                          {m.estado === "aplicada" && `Aplicada: versión ${m.versionCreada} creada.`}
                          {m.estado === "descartada" && "Descartada: el documento quedó sin cambios."}
                          {m.estado === "conflicto" && "En conflicto: el expediente avanzó de versión. Vuelve a pedir la propuesta."}
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
          </div>

          <div className="shrink-0 border-t border-border p-2">
            <div className="mb-2 flex flex-wrap gap-1">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={modoLectura || enviando}
                  onClick={() => enviar(s)}
                  className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-text-muted">v{version}</span>
              <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-text-muted">caso {casoId.slice(0, 8)}</span>
              {evidenciaElegida.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEvidenciaElegida([])}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-text-muted hover:bg-surface-hover"
                >
                  {evidenciaElegida.length} evidencias <X size={10} aria-hidden />
                </button>
              )}
              {seleccion ? (
                <button
                  type="button"
                  onClick={onLimpiarSeleccion}
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-focus/40 bg-focus/10 px-2 py-0.5 text-focus"
                  title={seleccion.texto}
                >
                  selección: {seleccion.texto.slice(0, 28) || `${seleccion.block_ids.length} bloque(s)`} <X size={10} aria-hidden />
                </button>
              ) : (
                <span className="text-text-subtle">sin selección · las preguntas no modifican el documento</span>
              )}
            </div>

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
                    {m === "propuesta" ? "Editar" : "Preguntar"}
                  </button>
                ))}
              </div>
            )}

            <form
              className="flex items-end gap-1.5"
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
                aria-label="Instrucción para el Editor"
                placeholder={modoLectura ? "Modo lectura" : seleccion ? "Qué cambio quieres en la selección…" : "Pregunta sobre el expediente…"}
                className="min-h-[52px] flex-1 resize-none rounded-[var(--radius-input)] border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-subtle disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    enviar(texto);
                  }
                }}
              />
              <button
                type="submit"
                disabled={enviando || modoLectura || texto.trim().length === 0}
                aria-label="Enviar"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] bg-primary text-white hover:bg-primary-hover disabled:opacity-40"
              >
                <Send size={14} aria-hidden />
              </button>
            </form>
            <p className="mt-1 text-[10px] text-text-subtle">
              {origen === "fixture"
                ? "Datos de demostración: las propuestas son deterministas, no salen de un modelo."
                : "Propuestas del agente Editor."}
            </p>
          </div>
        </Tabs.Content>

        <Tabs.Content value="evidencia" className="min-h-0 flex-1 overflow-auto p-3 focus:outline-none">
          {evidencia.length === 0 ? (
            <p className="text-xs text-text-subtle">Este caso no tiene evidencia validada cargada.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {evidencia.map((e) => (
                <li key={e.referencia} className="rounded-[var(--radius-card)] border border-border p-2">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onAbrirCita(e.referencia)}
                      className="break-all text-left font-mono text-[11px] text-text hover:underline"
                    >
                      [{e.referencia}]
                    </button>
                    <label className="flex shrink-0 items-center gap-1 text-[11px] text-text-muted">
                      <input
                        type="checkbox"
                        checked={evidenciaElegida.includes(e.id)}
                        onChange={(ev) =>
                          setEvidenciaElegida((previos) =>
                            ev.target.checked ? [...previos, e.id] : previos.filter((x) => x !== e.id),
                          )
                        }
                      />
                      adjuntar
                    </label>
                  </div>
                  <p className="mt-1 text-[11px] text-text-subtle">
                    {e.familia} · {e.pista_codigo} · {e.tipo}
                    {e.refutada && " · refutada"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}
