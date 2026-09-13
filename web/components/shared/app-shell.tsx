"use client";

import { GitBranch, Home, Menu, Trash2, UserRound } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { Investigacion, Perfil } from "@/lib/data";
import { soloFecha } from "@/lib/date/formato";
import { cn } from "@/lib/utils";
import { ProfileDialog } from "./profile-dialog";
import { InspectorWordmark } from "./logo";
import { effectiveStatus, isActive, STATUS_LABEL, type LabRun } from "@/lib/laboratorio/types";

/**
 * Inspector's slide-out navigation remains the single application shell.
 * New and historical investigations use this same navigation. Delivery state
 * remains independent of the risk found in the dataset.
 */
export interface AppShellProps {
  children: ReactNode;
  perfilNombre: string;
  perfilOrganizacion?: string;
  notificacionesNoLeidas?: number;
  /**
   * Investigaciones reales del perfil de la sesión (privadas, regla 3). Un
   * perfil sin investigaciones ve el vacío honesto, nunca una lista fabricada.
   */
  investigaciones: Investigacion[];
  labRuns?: LabRun[];
  /** Perfil privado completo (regla 3), para el modal — ver `ProfileDialog`. */
  perfil: Perfil;
  perfilEsFixture: boolean;
}

/**
 * El panel izquierdo es la **única** navegación del diseño, y las pantallas
 * de lienzo completo (board y resultados) llevan su propio wordmark dentro de
 * la cabecera — en el original ese wordmark abre el mismo panel
 * (`openLeft` en las tres pantallas). Para que puedan hacerlo sin duplicar
 * estado, el shell publica su interruptor por contexto.
 */
const PanelContext = createContext<{ abrir: () => void; abierto: boolean }>({ abrir: () => {}, abierto: false });

export function useInspectorPanel() {
  return useContext(PanelContext);
}

const ESTADOS_EN_CURSO: ReadonlySet<Investigacion["estado"]> = new Set(["en_cola", "investigando", "generando_reporte"]);
const ESTADOS_VISIBLES: Record<Investigacion["estado"], string> = {
  en_cola: "Queued", investigando: "Investigating…", generando_reporte: "Preparing report",
  investigacion_completa: "Ready", parcial: "Finished · review notes", error: "Error · inspect run", cancelada: "Cancelled",
};
const SIN_RUNS: LabRun[] = [];

export function AppShell({ children, perfilNombre, investigaciones, labRuns = SIN_RUNS, perfil, perfilEsFixture }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [perfilAbierto, setPerfilAbierto] = useState(false);
  // Navegación con respuesta inmediata: la fila pulsada gira y una barra corre
  // arriba hasta que Next confirma la ruta (o su `loading.tsx`). Antes el clic
  // no hacía nada visible mientras el servidor armaba la página.
  const [navegando, startNavegacion] = useTransition();
  const [destino, setDestino] = useState<string | null>(null);
  const [confirmandoBorrar, setConfirmandoBorrar] = useState<{ id: string; titulo: string } | null>(null);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const [investigacionesBorradas, setInvestigacionesBorradas] = useState<Set<string>>(new Set());
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null);
  const [runsActuales, setRunsActuales] = useState(labRuns);
  useEffect(() => setRunsActuales(labRuns), [labRuns]);
  useEffect(() => {
    if (!panelOpen || labRuns.length === 0) return;
    const controller = new AbortController();
    void fetch("/api/laboratorio", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as { runs?: LabRun[] };
        if (!controller.signal.aborted && Array.isArray(body.runs)) setRunsActuales(body.runs);
      })
      .catch(() => { /* Preserve the last known persisted history if refresh fails. */ });
    return () => controller.abort();
  }, [panelOpen, labRuns.length]);

  async function borrarInvestigacion(id: string) {
    setBorrandoId(id);
    setErrorBorrado(null);
    try {
      const res = await fetch(`/api/investigaciones/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        setErrorBorrado(body.detalle ?? body.error ?? `Could not delete (${res.status})`);
        return;
      }
      setInvestigacionesBorradas((prev) => new Set(prev).add(id));
      if (pathname === `/documentos/${id}`) router.push("/");
      router.refresh();
    } catch {
      setErrorBorrado("Could not connect to the server.");
    } finally {
      setBorrandoId(null);
      setConfirmandoBorrar(null);
    }
  }

  function navegar(href: string) {
    setPanelOpen(false);
    setDestino(href);
    startNavegacion(() => router.push(href));
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPanelOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setPanelOpen(false);
    setDestino(null);
  }, [pathname]);

  useEffect(() => {
    if (!navegando) setDestino(null);
  }, [navegando]);

  // El original ordena con las terminadas al final y filtra por título.
  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const historicas = investigaciones
      .filter((inv) => !investigacionesBorradas.has(inv.id))
      .map((inv) => {
        const enCurso = ESTADOS_EN_CURSO.has(inv.estado);
        const titulo = inv.titulo ?? inv.mensaje ?? "Investigation";
        return {
          id: inv.id,
          titulo,
          enCurso,
          estado: enCurso ? ESTADOS_VISIBLES[inv.estado] : `${ESTADOS_VISIBLES[inv.estado]} · ${soloFecha(inv.completada_at ?? inv.creado)}`,
          requiereAtencion: inv.estado === "error" || inv.estado === "parcial",
          href: `/documentos/${inv.id}`,
          creado: inv.creado,
          permiteBorrar: true,
        };
      });
    const nuevas = runsActuales.map((run) => {
      const estado = effectiveStatus(run);
      return {
        id: run.launch.run_id,
        titulo: run.launch.corrida_nombre,
        enCurso: isActive(run),
        estado: `${STATUS_LABEL[estado]} · ${soloFecha(run.launch.started_at)}`,
        requiereAtencion: estado === "failed",
        href: `/?corrida=${encodeURIComponent(run.launch.corrida_id)}&run=${encodeURIComponent(run.launch.run_id)}`,
        creado: run.launch.started_at,
        permiteBorrar: false,
      };
    });
    return [...nuevas, ...historicas]
      .sort((a, b) => Number(a.enCurso ? 0 : 1) - Number(b.enCurso ? 0 : 1) || b.creado.localeCompare(a.creado))
      .filter((f) => !q || f.titulo.toLowerCase().includes(q));
  }, [investigaciones, runsActuales, busqueda, investigacionesBorradas]);

  async function salir() {
    try {
      await fetch("/api/session", { method: "DELETE" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  // El original esconde el disparador cuando una pantalla toma el lienzo
  // completo: ahí el wordmark ya vive dentro de su propia cabecera
  // (`CanvasHeader`), y es ese mismo logo el que abre el panel. El expediente
  // entró aquí el 2026-09-12: llevaba DOS logos —el absoluto del shell y el de
  // su cabecera— y el pill del reporte quedaba 70 px por debajo del que abre
  // el panel. Con una sola cabecera, pill y acciones van a su misma altura.
  const lienzoCompleto =
    /^\/corridas\/[^/]+$/.test(pathname) ||
    /^\/casos\/[^/]+$/.test(pathname) ||
    /^\/casos\/[^/]+\/expediente$/.test(pathname) ||
    /^\/documentos\/[^/]+$/.test(pathname) ||
    /^\/analisis\/[^/]+$/.test(pathname);

  return (
    <PanelContext.Provider value={{ abrir: () => setPanelOpen((v) => !v), abierto: panelOpen }}>
    <div className="relative min-h-screen bg-app-bg font-sans text-text" aria-busy={navegando || undefined}>
      {navegando && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[10] h-[2px] overflow-hidden bg-[#ebe8e2]">
          <div className="h-full w-1/3 bg-text" style={{ animation: "insp-progreso 1s ease-in-out infinite" }} />
        </div>
      )}
      {!lienzoCompleto && (
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label="Open navigation"
          aria-expanded={panelOpen}
          aria-controls="inspector-navigation"
          className="absolute left-[22px] top-[20px] z-[3] flex h-[26px] w-[26px] items-center justify-center border-none bg-transparent p-0 text-text"
        >
          <Menu size={22} strokeWidth={1.8} aria-hidden />
        </button>
      )}

      <div
        onClick={() => setPanelOpen(false)}
        aria-hidden
        className="fixed inset-0 z-[4] bg-[rgba(20,20,19,.12)] transition-opacity duration-200"
        style={{ opacity: panelOpen ? 1 : 0, pointerEvents: panelOpen ? "auto" : "none" }}
      />

      <aside
        id="inspector-navigation"
        aria-label="Investigation navigation"
        aria-hidden={!panelOpen}
        inert={!panelOpen}
        className="fixed bottom-0 left-0 top-0 z-[5] flex w-[300px] max-w-[86vw] flex-col border-r border-border bg-surface shadow-[0_0_30px_rgba(20,20,19,.06)]"
        style={{
          transform: panelOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform .24s cubic-bezier(.22,.7,.3,1)",
        }}
      >
        <div className="flex items-center justify-between gap-2.5 border-b border-[#f0eee9] px-4 pb-3.5 pt-4">
          <Wordmark className="h-[21px]" />
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="Close navigation"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border-none bg-transparent text-text-muted transition-colors duration-150 hover:bg-[#f7f6f4]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <path d="M9.5 4v16" />
              <path d="M16.5 9.5 14 12l2.5 2.5" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2.5 py-3.5">
          <div className="mx-0.5 mb-2 flex h-8 items-center gap-2 rounded-[10px] border border-border bg-surface px-[11px] transition-colors duration-150 focus-within:border-[var(--border-stronger)]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--placeholder)" strokeWidth="2.2" strokeLinecap="round" className="flex-none">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <line x1="15.4" y1="15.4" x2="20.5" y2="20.5" />
            </svg>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Search investigations"
              aria-label="Search investigations"
              className="min-w-0 flex-1 border-none bg-transparent text-[12.5px] text-text outline-none placeholder:text-[var(--placeholder)]"
            />
          </div>

          {/*
            "Inicio" a pedido del usuario (2026-09-12): el diseño da por hecho
            que el wordmark vuelve al inicio, pero aquí el wordmark ABRE este
            panel, así que sin esta fila no había forma de volver a `/` desde
            una pantalla de lienzo completo. Misma altura, radio y `:hover`
            que las filas de investigación, para que no rompa el panel.
          */}
          <button
            type="button"
            onClick={() => navegar("/")}
            onMouseEnter={() => router.prefetch("/")}
            aria-current={pathname === "/" ? "page" : undefined}
            className={cn(
              "mb-1 flex items-center gap-[9px] rounded-[9px] border-none px-2.5 py-[9px] text-left transition-colors duration-150 hover:bg-surface-hover",
              pathname === "/" ? "bg-surface-muted" : "bg-transparent",
            )}
          >
            <Home size={15} strokeWidth={1.8} className="flex-none text-text-muted" aria-hidden />
            <span className="text-[13.5px] text-text">Home</span>
          </button>

          <button
            type="button"
            onClick={() => navegar("/hypotheses")}
            onMouseEnter={() => router.prefetch("/hypotheses")}
            aria-current={pathname === "/hypotheses" ? "page" : undefined}
            className={cn(
              "mb-3 flex items-center gap-[9px] rounded-[9px] border-none px-2.5 py-[9px] text-left transition-colors duration-150 hover:bg-surface-hover",
              pathname === "/hypotheses" ? "bg-surface-muted" : "bg-transparent",
            )}
          >
            <GitBranch size={15} strokeWidth={1.8} className="flex-none text-text-muted" aria-hidden />
            <span className="text-[13.5px] text-text">Hypotheses</span>
          </button>

          <span className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-[0.04em] text-text-subtle">Investigations</span>

          {filas.map((f) => {
            const href = f.href;
            const abriendo = navegando && destino === href;
            return (
            <div key={f.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => navegar(href)}
                onMouseEnter={() => router.prefetch(href)}
                onFocus={() => router.prefetch(href)}
                disabled={abriendo}
                aria-busy={abriendo || undefined}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-[9px] rounded-[9px] border-none px-2.5 py-[9px] text-left transition-colors duration-150 hover:bg-[#f7f6f4]",
                  abriendo ? "bg-[#f7f6f4]" : "bg-transparent",
                )}
              >
                {(f.enCurso || abriendo) && (
                  <span
                    aria-hidden
                    className="h-4 w-4 flex-none rounded-full border-2 border-[#e3e0da] border-t-text"
                    style={{ animation: "insp-spin .8s linear infinite" }}
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="max-w-[200px] truncate text-[13.5px] text-text">{f.titulo}</span>
                  <span className={cn("text-[11.5px]", f.requiereAtencion ? "text-warn" : "text-text-subtle")}>{abriendo ? "Opening…" : f.estado}</span>
                </span>
              </button>
              {f.permiteBorrar && <button
                type="button"
                onClick={() => setConfirmandoBorrar({ id: f.id, titulo: f.titulo })}
                disabled={borrandoId === f.id}
                aria-label={`Delete ${f.titulo}`}
                title="Delete investigation"
                className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border-none bg-transparent text-text-subtle opacity-0 transition-colors duration-150 hover:bg-error/10 hover:text-error focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
              >
                <Trash2 size={13} aria-hidden />
              </button>}
            </div>
            );
          })}

          {filas.length === 0 && (
            <p className="px-2 py-5 text-center text-[12.5px] text-text-subtle">
              {busqueda.trim() ? `No investigation matches “${busqueda.trim()}”.` : "No investigations yet."}
            </p>
          )}
          {errorBorrado && <p className="px-2 py-1 text-[12px] text-error">{errorBorrado}</p>}
        </div>

        <div className="flex items-center gap-1.5 border-t border-[#f0eee9] p-3">
          <button
            type="button"
            onClick={() => setPerfilAbierto(true)}
            aria-label="Open profile"
            title="Profile · voice call settings"
            className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-border bg-surface text-text-muted transition-colors duration-150 hover:bg-[#f7f6f4]"
          >
            <UserRound size={16} strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            onClick={salir}
            className="flex h-[38px] flex-1 items-center justify-center rounded-[10px] border border-border bg-surface text-[13px] font-medium text-text-muted transition-colors duration-150 hover:bg-[#f7f6f4]"
          >
            Sign out · {perfilNombre}
          </button>
        </div>
      </aside>

      {/*
        El disparador del wordmark es `absolute` en la esquina superior
        izquierda, así que las rutas que no son el home ni una pantalla de
        lienzo completo necesitan sitio para él: sin este margen su título se
        pintaba DEBAJO del logo (se vio en `/datos` y en el expediente). El
        home se centra solo y las de lienzo llevan el wordmark dentro de su
        propia cabecera, así que ninguna de las dos lo lleva.
      */}
      {lienzoCompleto || pathname === "/" ? children : <div className="px-6 pb-10 pt-[70px]">{children}</div>}

      <ProfileDialog perfil={perfil} esFixture={perfilEsFixture} abierto={perfilAbierto} onOpenChange={setPerfilAbierto} />

      {confirmandoBorrar && (
        <div
          onClick={() => (borrandoId ? null : setConfirmandoBorrar(null))}
          className="fixed inset-0 z-[9] flex items-center justify-center bg-[rgba(31,39,27,.20)] p-5 backdrop-blur-[4px]"
          role="alertdialog"
          aria-modal
          aria-label={`Confirm deletion of ${confirmandoBorrar.titulo}`}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-[380px] max-w-full flex-col gap-4 rounded-[20px] border border-border bg-surface p-6 shadow-[0_24px_80px_-20px_rgba(31,39,27,.24)]"
          >
            <h3 className="m-0 font-display text-[21px] font-medium leading-tight tracking-tight text-text">Delete “{confirmandoBorrar.titulo}”</h3>
            <p className="m-0 text-[13px] leading-relaxed text-text-subtle">
              This deletes the investigation and its notifications. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmandoBorrar(null)}
                disabled={borrandoId === confirmandoBorrar.id}
                className="h-[32px] rounded-[var(--radius-control)] border border-border bg-surface px-3.5 text-[13px] font-medium text-text transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => borrarInvestigacion(confirmandoBorrar.id)}
                disabled={borrandoId === confirmandoBorrar.id}
                className="h-[32px] rounded-[var(--radius-control)] bg-error px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:opacity-90 disabled:opacity-50"
              >
                {borrandoId === confirmandoBorrar.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </PanelContext.Provider>
  );
}

/** Shared live-type wordmark, using the same font as page titles. */
export function Wordmark({ className }: { className?: string }) {
  return <InspectorWordmark className={className} />;
}
