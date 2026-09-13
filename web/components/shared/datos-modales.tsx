"use client";

import { Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Corrida } from "@/lib/data";
import { soloFecha } from "@/lib/date/formato";
import type { ResumenEstructura } from "@/lib/estates/estructura";
import { ACCEPT } from "@/lib/estates/formatos";
import { EstructuraResumen } from "./estructura-resumen";

/**
 * Los dos pop-ups del diseño Inspector, con sus mismas medidas, sombras y
 * velos (`design-ref/Agents.dc.html`, bloques `askOpen` línea 398 y
 * `manageOpen` línea 362):
 *
 *   * **Tipo de dataset** — caja de 360px, radio 18px, velo
 *     `rgba(20,20,19,.22)`, dos tarjetas con el cuadrado/círculo de 14px.
 *   * **Administrar datos** — overlay a pantalla completa con `padding:10px`,
 *     velo `rgba(20,20,19,.18)`, tarjeta radio 20px y filas de radio 14px.
 *
 * Lo que **no** se porta, y por qué: el original renombra, borra y
 * "conecta" datasets con un `postgres://usuario:clave@host/db` que no va a
 * ninguna parte, y fabrica tamaño y "Updated 2h ago" (docs/22 trampa 1). Las
 * filas de aquí muestran corrida, dataset, estado y fecha de corte reales, y
 * las acciones llevan a las rutas que sí existen: el asistente de carga y la
 * inyección en vivo de `/datos`. Un botón que finge escribir en un sistema
 * forense es peor que no tenerlo.
 */

/**
 * Los dos pop-ups se montan en `document.body` por portal, no donde se
 * declaran. Motivo medido: el contenedor del picker lleva `filter` y
 * `transform` para la transición del diseño, y un ancestro con cualquiera de
 * los dos crea bloque contenedor — un `position:fixed` dentro se recorta a
 * esa caja en lugar de cubrir la ventana. Se vio en pantalla: el modal
 * aparecía metido dentro del picker.
 */
function Portal({ children }: { children: React.ReactNode }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  return createPortal(children, document.body);
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

type RespuestaCarga = { status: number; body: Record<string, unknown> };

/**
 * POST multipart con progreso de subida. `fetch` no expone el avance del cuerpo enviado; XHR sí. Cuando
 * termina de subir, el servidor todavía convierte y valida: esa fase se muestra sin porcentaje, porque no
 * hay avance medido que mostrar.
 */
function enviarDataset(archivos: File[], onProgreso: (fraccion: number) => void): Promise<RespuestaCarga> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const a of archivos) form.append("archivos", a, a.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/estates");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgreso(e.loaded / e.total);
    };
    xhr.upload.onload = () => onProgreso(1);
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        body = {};
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("red"));
    xhr.send(form);
  });
}

type Fase = { tipo: "inicio" } | { tipo: "subiendo"; fraccion: number } | { tipo: "procesando" } | { tipo: "listo"; corridaId: string; estructura: ResumenEstructura | null };

export function TipoDatasetModal({ onClose, onCargado }: { onClose: () => void; onCargado?: (corridaId: string) => void }) {
  const [fase, setFase] = useState<Fase>({ tipo: "inicio" });
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [nombres, setNombres] = useState<string[]>([]);
  const ocupado = fase.tipo === "subiendo" || fase.tipo === "procesando";
  // Durante la subida y la conversión no se cierra: el resultado (corrida y estructura) se perdería.
  // Ya cargado, cerrar equivale a abrir la corrida: existe en la base aunque no se mire el resumen.
  const cerrar = () => {
    if (fase.tipo === "listo") onCargado?.(fase.corridaId);
    onClose();
  };
  useEscape(ocupado ? () => {} : cerrar);

  async function subir(archivos: File[]) {
    if (archivos.length === 0 || ocupado) return;
    setError(null);
    setNombres(archivos.map((a) => a.name));
    setFase({ tipo: "subiendo", fraccion: 0 });
    try {
      const { status, body } = await enviarDataset(archivos, (f) =>
        setFase(f >= 1 ? { tipo: "procesando" } : { tipo: "subiendo", fraccion: f }),
      );
      if (status < 200 || status >= 300 || typeof body.corrida_id !== "string") {
        setError(String(body.detalle ?? body.error ?? `Upload failed (${status})`));
        setFase({ tipo: "inicio" });
        return;
      }
      setFase({ tipo: "listo", corridaId: body.corrida_id, estructura: (body.estructura as ResumenEstructura) ?? null });
    } catch {
      setError("Could not connect to the server.");
      setFase({ tipo: "inicio" });
    }
  }

  if (fase.tipo === "listo") {
    return (
      <Portal>
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-[rgba(32,40,30,.22)] p-4 backdrop-blur-[5px] sm:p-6"
          role="dialog"
          aria-modal
          aria-label="Dataset uploaded"
        >
          <div className="flex max-h-full w-[520px] max-w-full flex-col gap-3.5 overflow-hidden rounded-[20px] border border-border/70 bg-surface p-6 shadow-[0_24px_80px_rgba(28,36,25,.16)]">
            <div className="flex flex-col gap-[3px]">
              <h3 className="m-0 font-display text-[20px] font-medium tracking-[-.035em] text-text">Dataset uploaded</h3>
              <span className="truncate text-[12px] text-text-subtle">{nombres.join(", ")}</span>
            </div>
            <div className="min-h-0 overflow-y-auto">
              {fase.estructura ? (
                <EstructuraResumen estructura={fase.estructura} />
              ) : (
                <p className="m-0 text-[12px] text-text-subtle">No structure report was returned.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cerrar}
                className="insp-focus-ring h-9 rounded-[12px] bg-[var(--brand-strong)] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:brightness-110"
              >
                Open dataset
              </button>
            </div>
          </div>
        </div>
      </Portal>
    );
  }

  const etiqueta =
    fase.tipo === "subiendo"
      ? `Uploading… ${Math.round(fase.fraccion * 100)}%`
      : fase.tipo === "procesando"
        ? "Reading structure and importing…"
        : "SQLite, CSV, XLSX or ZIP";
  return (
    <Portal>
    <div
      onClick={ocupado ? undefined : onClose}
      className="fixed inset-0 z-10 flex items-center justify-center bg-[rgba(32,40,30,.22)] p-4 backdrop-blur-[5px] sm:p-6"
      role="dialog"
      aria-modal
      aria-label="Dataset type"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[360px] max-w-full flex-col gap-3.5 rounded-[20px] border border-border/70 bg-surface p-6 shadow-[0_24px_80px_rgba(28,36,25,.16)]"
      >
        <h3 className="m-0 font-display text-[20px] font-medium tracking-[-.035em] text-text">Dataset type</h3>
        <div className="flex gap-2.5">
          <span
            aria-disabled
            className="flex flex-1 flex-col items-center gap-2.5 rounded-[var(--radius-card-sm)] border border-dashed border-border/80 bg-surface-raised px-3.5 py-5 text-[13.5px] font-medium text-text-subtle"
          >
            <span aria-hidden className="box-border h-3.5 w-3.5 rounded-[3px] border-[1.6px] border-border" />
            File upload
          </span>
          <span
            aria-disabled
            className="flex flex-1 flex-col items-center gap-2.5 rounded-[var(--radius-card-sm)] border border-dashed border-border/80 bg-surface-raised px-3.5 py-5 text-[13.5px] font-medium text-text-subtle"
          >
            <span aria-hidden className="box-border h-3.5 w-3.5 rounded-full border-[1.6px] border-border" />
            Live injection
          </span>
        </div>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (!ocupado) setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            void subir(Array.from(e.dataTransfer.files ?? []));
          }}
          className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border px-3.5 py-5 text-center transition-colors duration-150 hover:bg-[var(--brand-soft)] focus-within:border-[var(--focus)] focus-within:ring-2 focus-within:ring-[var(--brand-soft)] ${
            arrastrando ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-border bg-surface-raised"
          } ${ocupado ? "pointer-events-none opacity-60" : ""}`}
        >
          <span className="text-[13.5px] font-medium text-text" aria-live="polite">
            {etiqueta}
          </span>
          <span className="text-[12px] leading-relaxed text-text-subtle">
            {ocupado
              ? nombres.join(", ")
              : "Drop a SQLite database, ZIP, Excel workbook or CSV tables. Multiple CSVs form one dataset."}
          </span>
          {fase.tipo === "subiendo" && (
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fase.fraccion * 100)}
              className="block h-1 w-full overflow-hidden rounded-full bg-surface-muted"
            >
              <span className="block h-full bg-[var(--brand)] transition-[width] duration-150" style={{ width: `${Math.round(fase.fraccion * 100)}%` }} />
            </span>
          )}
          <input
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            disabled={ocupado}
            aria-label="Upload dataset"
            onChange={(e) => {
              const archivos = Array.from(e.target.files ?? []);
              e.target.value = "";
              void subir(archivos);
            }}
          />
        </label>
        {error && <p className="m-0 whitespace-pre-line text-[12px] leading-relaxed text-error">{error}</p>}
      </div>
    </div>
    </Portal>
  );
}

type PreviewRespuesta = {
  tablas: { nombre: string; filas: number }[];
  tabla: string;
  columnas: string[];
  filas: (string | number | null)[][];
  total: number;
  offset: number;
  limit: number;
};

const PAGINA = 100;

/** A, B, …, Z, AA, AB… como los encabezados de columna de una hoja de cálculo. */
function letraColumna(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Preview de solo lectura del estate de una corrida, tipo hoja de cálculo: pestañas por
 * tabla con su conteo real, encabezados A/B/C + nombre de columna, número de fila y
 * páginas de 100. No edita nada; los datos salen de `GET /api/estates/preview`.
 */
export function DatasetPreviewModal({ corrida, onClose }: { corrida: Corrida; onClose: () => void }) {
  const [tabla, setTabla] = useState("vendors");
  const [offset, setOffset] = useState(0);
  const [datos, setDatos] = useState<PreviewRespuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [estructura, setEstructura] = useState<{ datos?: ResumenEstructura; error?: string } | null>(null);
  const [verEstructura, setVerEstructura] = useState(false);
  useEscape(onClose);

  useEffect(() => {
    if (!verEstructura || estructura) return;
    let vigente = true;
    fetch(`/api/estates/estructura?${new URLSearchParams({ corrida_id: corrida.id })}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!vigente) return;
        setEstructura(
          res.ok && body.estructura
            ? { datos: body.estructura as ResumenEstructura }
            : { error: body.detalle ?? body.error ?? `Could not read the structure (${res.status})` },
        );
      })
      .catch(() => vigente && setEstructura({ error: "Could not connect to the server." }));
    return () => {
      vigente = false;
    };
  }, [verEstructura, estructura, corrida.id]);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    const qs = new URLSearchParams({ corrida_id: corrida.id, tabla, offset: String(offset), limit: String(PAGINA) });
    fetch(`/api/estates/preview?${qs}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (!res.ok) setError(body.detalle ?? body.error ?? `Could not read the dataset (${res.status})`);
        else setDatos(body as PreviewRespuesta);
      })
      .catch(() => vigente && setError("Could not connect to the server."))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [corrida.id, tabla, offset]);

  const total = datos?.tabla === tabla ? datos.total : 0;
  const hasta = Math.min(offset + PAGINA, total);

  return (
    <Portal>
      <div
        onClick={onClose}
        className="fixed inset-0 z-10 flex bg-[rgba(32,40,30,.22)] p-4 backdrop-blur-[5px] sm:p-6"
        role="dialog"
        aria-modal
        aria-label={`Preview of ${corrida.nombre}`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="mx-auto flex min-w-0 max-w-[1240px] flex-1 flex-col overflow-hidden rounded-[20px] border border-border/70 bg-surface shadow-[0_24px_80px_rgba(28,36,25,.16)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-surface-raised px-5 py-4">
            <div className="flex min-w-0 flex-col gap-[3px]">
              <h2 className="m-0 truncate font-display text-[20px] font-medium tracking-[-.035em] text-text">{corrida.nombre}</h2>
              <span className="text-[12px] text-text-subtle">Read-only preview · {corrida.dataset}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={verEstructura}
                onClick={() => setVerEstructura((v) => !v)}
                className="insp-focus-ring h-9 rounded-[12px] border border-border/80 bg-surface px-4 text-[13px] font-medium text-text-muted transition-colors duration-150 hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]"
              >
                {verEstructura ? "Ver datos" : "Estructura"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="insp-focus-ring h-9 rounded-[12px] bg-[var(--brand-strong)] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:brightness-110"
              >
                Close
              </button>
            </div>
          </div>

          {verEstructura && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {estructura?.datos ? (
                <div className="mx-auto max-w-[640px]">
                  <EstructuraResumen estructura={estructura.datos} />
                </div>
              ) : estructura?.error ? (
                <p className="m-0 p-7 text-center text-[13px] text-text-subtle">{estructura.error}</p>
              ) : (
                <p className="m-0 p-7 text-center text-[13px] text-text-subtle">Loading…</p>
              )}
            </div>
          )}

          {!verEstructura && datos && (
            <div role="tablist" aria-label="Dataset tables" className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-2.5 py-2">
              {datos.tablas.map((t) => (
                <button
                  key={t.nombre}
                  type="button"
                  role="tab"
                  aria-selected={t.nombre === tabla}
                  onClick={() => {
                    setTabla(t.nombre);
                    setOffset(0);
                  }}
                  className={`insp-focus-ring flex-none whitespace-nowrap rounded-[10px] border px-3 py-1.5 text-[12px] transition-colors duration-150 ${
                    t.nombre === tabla
                      ? "border-[var(--brand)]/25 bg-[var(--brand-soft)] font-medium text-[var(--brand-strong)]"
                      : "border-transparent text-text-muted hover:bg-[var(--brand-soft)]"
                  }`}
                >
                  {t.nombre} <span className="tabular-nums text-text-subtle">{t.filas.toLocaleString("es-MX")}</span>
                </button>
              ))}
            </div>
          )}

          <div className="relative min-h-0 flex-1 overflow-auto" hidden={verEstructura}>
            {error ? (
              <p className="m-0 p-7 text-center text-[13px] text-error">{error}</p>
            ) : datos && datos.tabla === tabla ? (
              <table className="border-separate border-spacing-0 text-[12px] text-text">
                <thead className="sticky top-0 z-[1]">
                  <tr>
                    <th className="sticky left-0 z-[2] min-w-[48px] border-b border-r border-[var(--border)] bg-surface-raised" />
                    {datos.columnas.map((c, i) => (
                      <th
                        key={c}
                        className="border-b border-r border-[var(--border)] bg-surface-raised px-2 py-1 text-left font-normal text-text-subtle"
                      >
                        <span className="block text-[10.5px] tracking-wide">{letraColumna(i)}</span>
                        <span className="block whitespace-nowrap font-medium text-text">{c}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos.filas.map((fila, r) => (
                    <tr key={offset + r} className="hover:bg-surface-hover">
                      <td className="sticky left-0 border-b border-r border-[var(--border)] bg-surface-raised px-2 py-1 text-right tabular-nums text-text-subtle">
                        {offset + r + 1}
                      </td>
                      {fila.map((v, i) => (
                        <td
                          key={i}
                          title={v == null ? "" : String(v)}
                          className={`max-w-[280px] truncate whitespace-nowrap border-b border-r border-[var(--border)] px-2 py-1 ${
                            typeof v === "number" ? "text-right tabular-nums" : ""
                          } ${v == null || v === "" ? "text-placeholder" : ""}`}
                        >
                          {v == null ? "NULL" : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {cargando && !error && (
              <p className="m-0 p-7 text-center text-[13px] text-text-subtle">Loading…</p>
            )}
          </div>

          {!verEstructura && datos && !error && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-2.5 py-2 text-[12px] text-text-subtle">
              <span className="tabular-nums">
                {total === 0 ? "Sin filas" : `Filas ${(offset + 1).toLocaleString("es-MX")}–${hasta.toLocaleString("es-MX")} de ${total.toLocaleString("es-MX")}`}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0 || cargando}
                  onClick={() => setOffset(Math.max(0, offset - PAGINA))}
                  className="insp-focus-ring h-8 rounded-[10px] border border-border/80 bg-surface px-3 text-text-muted transition-colors duration-150 hover:bg-[var(--brand-soft)] disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={hasta >= total || cargando}
                  onClick={() => setOffset(offset + PAGINA)}
                  className="insp-focus-ring h-8 rounded-[10px] border border-border/80 bg-surface px-3 text-text-muted transition-colors duration-150 hover:bg-[var(--brand-soft)] disabled:opacity-50"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

export function AdministrarDatosModal({
  corridas,
  onClose,
}: {
  corridas: Corrida[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [tipoAbierto, setTipoAbierto] = useState(false);
  const [preview, setPreview] = useState<Corrida | null>(null);
  const [confirmando, setConfirmando] = useState<Corrida | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [borradas, setBorradas] = useState<Set<string>>(new Set());
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null);
  const router = useRouter();
  // Con un pop-up encima, Escape cierra solo el de arriba.
  useEscape(tipoAbierto || preview || confirmando ? () => {} : onClose);

  async function borrarCorrida(c: Corrida) {
    setBorrando(c.id);
    setErrorBorrado(null);
    try {
      const res = await fetch(`/api/corridas/${c.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorBorrado(body.detalle ?? body.error ?? `Could not delete (${res.status})`);
        return;
      }
      setBorradas((prev) => new Set(prev).add(c.id));
      router.refresh();
    } catch {
      setErrorBorrado("Could not connect to the server.");
    } finally {
      setBorrando(null);
      setConfirmando(null);
    }
  }

  // El original ordena "dynamic first"; aquí eso es real: las corridas
  // clonadas por inyección en vivo van primero, y luego por fecha de corte.
  const filas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return corridas
      .filter((c) => !borradas.has(c.id))
      .filter((c) => !q || c.nombre.toLowerCase().includes(q) || c.dataset.toLowerCase().includes(q))
      .slice()
      .sort(
        (a, b) =>
          Number(b.corrida_origen_id != null) - Number(a.corrida_origen_id != null) ||
          new Date(b.fecha_corte).getTime() - new Date(a.fecha_corte).getTime(),
      );
  }, [corridas, query, borradas]);

  return (
    <Portal>
    <div className="fixed inset-0 z-[9] flex bg-[rgba(32,40,30,.22)] p-4 backdrop-blur-[5px] sm:p-6" role="dialog" aria-modal aria-label="Manage datasets">
      <div className="mx-auto flex min-w-0 max-w-[1240px] flex-1 flex-col overflow-hidden rounded-[20px] border border-border/70 bg-surface shadow-[0_24px_80px_rgba(28,36,25,.16)]">
        <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-border/70 bg-surface-raised px-5 py-4">
          <div className="flex flex-col gap-[3px]">
            <h2 className="m-0 font-display text-[22px] font-medium tracking-[-.035em] text-text">Manage datasets</h2>
            <span className="text-[12.5px] text-text-subtle">
              {corridas.length} corrida{corridas.length === 1 ? "" : "s"} · inyecciones primero
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 items-center gap-2 rounded-[12px] border border-border/80 bg-surface px-3 transition-colors focus-within:border-[var(--focus)] focus-within:ring-2 focus-within:ring-[var(--brand-soft)]">
              <Search size={13} className="text-placeholder" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search datasets"
                aria-label="Search datasets"
                className="w-[150px] border-none bg-transparent text-[12.5px] text-text outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setTipoAbierto(true)}
              className="insp-focus-ring h-9 rounded-[12px] border border-border/80 bg-surface px-4 text-[13px] font-medium text-text-muted transition-colors duration-150 hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]"
            >
              Add dataset
            </button>
            <button
              type="button"
              onClick={onClose}
              className="insp-focus-ring h-9 rounded-[12px] bg-[var(--brand-strong)] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:brightness-110"
            >
              Listo
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
          {filas.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border/70 bg-surface-raised px-4 py-3"
            >
              <span
                aria-hidden
                className="h-2 w-2 flex-none bg-[var(--brand)]"
                style={{ borderRadius: c.corrida_origen_id != null ? "50%" : "2px" }}
              />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{c.nombre}</span>
              {c.corrida_origen_id != null && (
                <span className="flex flex-none items-center gap-1.5 rounded-[5px] border border-live-border bg-live-bg px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-live-fg">
                  <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-live-dot" />
                  Live injection
                </span>
              )}
              <span className="flex-none whitespace-nowrap text-[12px] text-text-subtle">{c.dataset}</span>
              <span className="flex-none whitespace-nowrap text-[12px] text-text-subtle">{c.estado}</span>
              <span className="flex-none whitespace-nowrap text-[12px] text-text-subtle">Corte {soloFecha(c.fecha_corte)}</span>
              <button
                type="button"
                onClick={() => setPreview(c)}
                className="insp-focus-ring h-8 flex-none rounded-[10px] border border-border/80 bg-surface px-3 text-[12px] text-text-muted transition-colors duration-150 hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]"
              >
                Inspeccionar
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(c)}
                disabled={borrando === c.id}
                aria-label={`Delete ${c.nombre}`}
                title="Delete dataset"
                className="insp-focus-ring flex h-8 w-8 flex-none items-center justify-center rounded-[10px] border border-border/80 bg-surface text-error transition-colors duration-150 hover:bg-error/10 disabled:opacity-50"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          ))}
          {filas.length === 0 && (
            <p className="m-0 py-7 text-center text-[13px] text-text-subtle">
              {corridas.length === 0 ? "Upload a dataset to get started." : "Ninguna corrida coincide."}
            </p>
          )}
          {errorBorrado && <p className="m-0 px-1 text-[12px] text-error">{errorBorrado}</p>}
        </div>
      </div>
    </div>
    {tipoAbierto && <TipoDatasetModal onClose={() => setTipoAbierto(false)} />}
    {preview && <DatasetPreviewModal corrida={preview} onClose={() => setPreview(null)} />}
    {confirmando && (
      <div
        onClick={() => (borrando ? null : setConfirmando(null))}
        className="fixed inset-0 z-10 flex items-center justify-center bg-[rgba(32,40,30,.22)] p-4 backdrop-blur-[5px] sm:p-6"
        role="alertdialog"
        aria-modal
        aria-label={`Confirm deletion of ${confirmando.nombre}`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex w-[360px] max-w-full flex-col gap-3 rounded-[20px] border border-border/70 bg-surface p-6 shadow-[0_24px_80px_rgba(28,36,25,.16)]"
        >
          <h3 className="m-0 font-display text-[20px] font-medium tracking-[-.035em] text-text">Delete “{confirmando.nombre}”</h3>
          <p className="m-0 text-[13px] leading-relaxed text-text-subtle">
            This deletes the dataset and its invoices, transactions, checks, cases and investigations. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmando(null)}
              disabled={borrando === confirmando.id}
              className="insp-focus-ring h-9 rounded-[12px] border border-border/80 bg-surface px-4 text-[13px] font-medium text-text-muted transition-colors duration-150 hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => borrarCorrida(confirmando)}
              disabled={borrando === confirmando.id}
              className="insp-focus-ring h-9 rounded-[12px] bg-error px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:opacity-90 disabled:opacity-50"
            >
              {borrando === confirmando.id ? "Borrando…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    )}
    </Portal>
  );
}
