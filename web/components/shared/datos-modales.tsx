"use client";

import { Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Corrida } from "@/lib/data";
import { soloFecha } from "@/lib/date/formato";

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

export function TipoDatasetModal({ onClose, onCargado }: { onClose: () => void; onCargado?: (corridaId: string) => void }) {
  useEscape(onClose);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subir(archivo: File) {
    setSubiendo(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("estate", archivo);
      const res = await fetch("/api/estates", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.corrida_id !== "string") {
        setError(body.detalle ?? body.error ?? `No se pudo cargar (${res.status})`);
        return;
      }
      onCargado?.(body.corrida_id);
      onClose();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSubiendo(false);
    }
  }
  return (
    <Portal>
    <div
      onClick={onClose}
      className="fixed inset-0 z-10 flex items-center justify-center bg-[rgba(20,20,19,.22)] p-5"
      role="dialog"
      aria-modal
      aria-label="Tipo de dataset"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[360px] max-w-full flex-col gap-3.5 rounded-[18px] border border-border bg-surface p-5 shadow-[0_18px_60px_rgba(20,20,19,.16)]"
      >
        <h3 className="m-0 text-[15px] font-semibold tracking-tight text-text">Tipo de dataset</h3>
        <div className="flex gap-2.5">
          <span
            aria-disabled
            className="flex flex-1 flex-col items-center gap-2.5 rounded-[var(--radius-card-sm)] border border-dashed border-border px-3.5 py-5 text-[13.5px] font-medium text-text-subtle"
          >
            <span aria-hidden className="box-border h-3.5 w-3.5 rounded-[3px] border-[1.6px] border-border" />
            Estático
          </span>
          <span
            aria-disabled
            className="flex flex-1 flex-col items-center gap-2.5 rounded-[var(--radius-card-sm)] border border-dashed border-border px-3.5 py-5 text-[13.5px] font-medium text-text-subtle"
          >
            <span aria-hidden className="box-border h-3.5 w-3.5 rounded-full border-[1.6px] border-border" />
            Inyección en vivo
          </span>
        </div>
        <label
          className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[var(--radius-card-sm)] border border-border-strong px-3.5 py-4 text-center transition-colors duration-150 hover:bg-surface-hover ${subiendo ? "pointer-events-none opacity-60" : ""}`}
        >
          <span className="text-[13.5px] font-medium text-text">{subiendo ? "Cargando y validando…" : "Estate SQLite (.db)"}</span>
          <span className="text-[12px] leading-relaxed text-text-subtle">
            Formato de los jueces: vendors, invoices, ledger, bank_txns, purchase_orders, contracts, employees, efos_list.
          </span>
          <input
            type="file"
            accept=".db,.sqlite,.sqlite3"
            className="sr-only"
            disabled={subiendo}
            aria-label="Subir estate SQLite"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
            }}
          />
        </label>
        {error && <p className="m-0 text-[12px] leading-relaxed text-error">{error}</p>}
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
  useEscape(onClose);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    const qs = new URLSearchParams({ corrida_id: corrida.id, tabla, offset: String(offset), limit: String(PAGINA) });
    fetch(`/api/estates/preview?${qs}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (!res.ok) setError(body.detalle ?? body.error ?? `No se pudo leer el dataset (${res.status})`);
        else setDatos(body as PreviewRespuesta);
      })
      .catch(() => vigente && setError("No se pudo conectar con el servidor."))
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
        className="fixed inset-0 z-10 flex bg-[rgba(20,20,19,.22)] p-5"
        role="dialog"
        aria-modal
        aria-label={`Preview de ${corrida.nombre}`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-card-lg)] border border-border bg-surface shadow-[0_18px_60px_rgba(20,20,19,.16)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-2.5">
            <div className="flex min-w-0 flex-col gap-[3px]">
              <h2 className="m-0 truncate text-[15px] font-semibold tracking-tight text-text">{corrida.nombre}</h2>
              <span className="text-[12px] text-text-subtle">Preview de solo lectura · {corrida.dataset}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-[32px] rounded-[var(--radius-control)] bg-primary px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
            >
              Cerrar
            </button>
          </div>

          {datos && (
            <div role="tablist" aria-label="Tablas del dataset" className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-2.5 py-2">
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
                  className={`flex-none whitespace-nowrap rounded-[var(--radius-control)] border px-2.5 py-1 text-[12.5px] transition-colors duration-150 ${
                    t.nombre === tabla
                      ? "border-border-strong bg-surface-hover font-medium text-text"
                      : "border-transparent text-text-muted hover:bg-surface-hover"
                  }`}
                >
                  {t.nombre} <span className="tabular-nums text-text-subtle">{t.filas.toLocaleString("es-MX")}</span>
                </button>
              ))}
            </div>
          )}

          <div className="relative min-h-0 flex-1 overflow-auto">
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
              <p className="m-0 p-7 text-center text-[13px] text-text-subtle">Cargando…</p>
            )}
          </div>

          {datos && !error && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-2.5 py-2 text-[12px] text-text-subtle">
              <span className="tabular-nums">
                {total === 0 ? "Sin filas" : `Filas ${(offset + 1).toLocaleString("es-MX")}–${hasta.toLocaleString("es-MX")} de ${total.toLocaleString("es-MX")}`}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0 || cargando}
                  onClick={() => setOffset(Math.max(0, offset - PAGINA))}
                  className="h-[28px] rounded-[var(--radius-control)] border border-border bg-surface px-2.5 text-text-muted transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={hasta >= total || cargando}
                  onClick={() => setOffset(offset + PAGINA)}
                  className="h-[28px] rounded-[var(--radius-control)] border border-border bg-surface px-2.5 text-text-muted transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50"
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
        setErrorBorrado(body.detalle ?? body.error ?? `No se pudo borrar (${res.status})`);
        return;
      }
      setBorradas((prev) => new Set(prev).add(c.id));
      router.refresh();
    } catch {
      setErrorBorrado("No se pudo conectar con el servidor.");
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
    <div className="fixed inset-0 z-[9] flex bg-[rgba(20,20,19,.18)] p-2.5" role="dialog" aria-modal aria-label="Administrar datos">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-card-lg)] border border-border bg-surface shadow-[0_18px_60px_rgba(20,20,19,.14)]">
        <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-[var(--border)] p-2.5">
          <div className="flex flex-col gap-[3px]">
            <h2 className="m-0 text-[17px] font-semibold tracking-tight text-text">Administrar datos</h2>
            <span className="text-[12.5px] text-text-subtle">
              {corridas.length} corrida{corridas.length === 1 ? "" : "s"} · inyecciones primero
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-[34px] items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 transition-colors focus-within:border-primary">
              <Search size={13} className="text-placeholder" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar corridas"
                aria-label="Buscar corridas en administrar datos"
                className="w-[150px] border-none bg-transparent text-[12.5px] text-text outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setTipoAbierto(true)}
              className="h-[34px] rounded-[var(--radius-control)] border border-border bg-surface px-3.5 text-[13px] font-medium text-text transition-colors duration-150 hover:bg-surface-hover"
            >
              Añadir dataset
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-[34px] rounded-[var(--radius-control)] bg-primary px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
            >
              Listo
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
          {filas.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-surface-raised px-3.5 py-2.5"
            >
              <span
                aria-hidden
                className="h-2 w-2 flex-none bg-primary"
                style={{ borderRadius: c.corrida_origen_id != null ? "50%" : "2px" }}
              />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{c.nombre}</span>
              {c.corrida_origen_id != null && (
                <span className="flex flex-none items-center gap-1.5 rounded-[5px] border border-live-border bg-live-bg px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-live-fg">
                  <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-live-dot" />
                  Inyección en vivo
                </span>
              )}
              <span className="flex-none whitespace-nowrap text-[12px] text-text-subtle">{c.dataset}</span>
              <span className="flex-none whitespace-nowrap text-[12px] text-text-subtle">{c.estado}</span>
              <span className="flex-none whitespace-nowrap text-[12px] text-text-subtle">Corte {soloFecha(c.fecha_corte)}</span>
              <button
                type="button"
                onClick={() => setPreview(c)}
                className="h-[30px] flex-none rounded-[var(--radius-control)] border border-border bg-surface px-2.5 text-[12.5px] text-text-muted transition-colors duration-150 hover:bg-surface-hover"
              >
                Inspeccionar
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(c)}
                disabled={borrando === c.id}
                aria-label={`Borrar ${c.nombre}`}
                title="Borrar dataset"
                className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-error transition-colors duration-150 hover:bg-error/10 disabled:opacity-50"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          ))}
          {filas.length === 0 && (
            <p className="m-0 py-7 text-center text-[13px] text-text-subtle">
              {corridas.length === 0 ? "Sin corridas todavía. Añade un dataset para empezar." : "Ninguna corrida coincide."}
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
        className="fixed inset-0 z-10 flex items-center justify-center bg-[rgba(20,20,19,.22)] p-5"
        role="alertdialog"
        aria-modal
        aria-label={`Confirmar borrado de ${confirmando.nombre}`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex w-[360px] max-w-full flex-col gap-3 rounded-[18px] border border-border bg-surface p-5 shadow-[0_18px_60px_rgba(20,20,19,.16)]"
        >
          <h3 className="m-0 text-[15px] font-semibold tracking-tight text-text">Borrar “{confirmando.nombre}”</h3>
          <p className="m-0 text-[13px] leading-relaxed text-text-subtle">
            Se borra la corrida completa: sus CFDI, movimientos, pistas, clusters, casos e investigaciones. No se puede deshacer.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmando(null)}
              disabled={borrando === confirmando.id}
              className="h-[32px] rounded-[var(--radius-control)] border border-border bg-surface px-3.5 text-[13px] font-medium text-text transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => borrarCorrida(confirmando)}
              disabled={borrando === confirmando.id}
              className="h-[32px] rounded-[var(--radius-control)] bg-error px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:opacity-90 disabled:opacity-50"
            >
              {borrando === confirmando.id ? "Borrando…" : "Borrar"}
            </button>
          </div>
        </div>
      </div>
    )}
    </Portal>
  );
}
