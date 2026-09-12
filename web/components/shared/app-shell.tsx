"use client";

import { BarChart3, Bell, Database, FolderKanban, Gauge, HelpCircle, History, LogOut, Search, User, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ESTADO_LABEL } from "./execution-history";
import { cn } from "@/lib/utils";
import type { Investigacion } from "@/lib/data";

/**
 * Shell del diseño Inspector (docs/22-frontend-inspector.md, corrección del
 * 2026-09-12: "La UI del diseño ES la navegación principal, y va exacta").
 * Sustituye a la barra lateral fija anterior: el panel izquierdo deslizante
 * de `design-ref/Agents.dc.html` (líneas 22–56) ES la única navegación,
 * alimentado con investigaciones reales (`obtenerHistorialPrivado`, pasado
 * como prop desde `app/(app)/layout.tsx` porque es un dato privado por
 * perfil — CLAUDE.md regla 3 — nunca `DataSource.listInvestigaciones()`
 * público). Las rutas que el diseño no contempla (perfil, notificaciones,
 * historial, estadísticas, datos, método) se alcanzan desde ese mismo panel,
 * en una sección "Secciones" añadida debajo de "Investigaciones": el diseño
 * no tiene hueco para ellas, pero seguir existiendo es requisito de 09/15 y
 * de CLAUDE.md regla 9 (no se borra funcionalidad), y una segunda barra
 * lateral al lado sería exactamente la navegación duplicada que se pidió
 * evitar.
 *
 * Adaptación necesaria frente al original: `Agents.dc.html` es una vista de
 * una sola pantalla (`position:relative;min-height:100vh;overflow:hidden`
 * en el contenedor raíz) — aquí hay páginas reales con contenido más alto
 * que el viewport (tablas, expedientes). El overlay y el panel usan
 * `position:fixed` (no `absolute` sobre un contenedor con `overflow:hidden`)
 * para que el contenido de cada ruta pueda desplazarse con normalidad sin
 * romper el layout ni cortar la parte baja de la página.
 *
 * `router.push` (next/navigation) mantiene este layout montado entre
 * navegaciones (no hay recarga completa ni remonte del shell, docs/22 "Ser
 * idéntico y tener URLs no son cosas opuestas") siempre que las páginas no
 * fuercen `<a>`/recarga dura, que es el caso en todo el árbol de `(app)`.
 */
const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: Gauge },
  { href: "/corridas", label: "Corridas", icon: History },
  { href: "/historial", label: "Historial", icon: FolderKanban },
  { href: "/estadisticas", label: "Estadísticas", icon: BarChart3 },
  { href: "/notificaciones", label: "Notificaciones", icon: Bell },
  { href: "/datos", label: "Datos", icon: Database },
  { href: "/metodo", label: "Método", icon: HelpCircle },
] as const;

export interface AppShellProps {
  children: ReactNode;
  perfilNombre: string;
  perfilOrganizacion?: string;
  notificacionesNoLeidas?: number;
  /**
   * Investigaciones reales del perfil de la sesión (privadas, CLAUDE.md
   * regla 3). El panel las lista y filtra por texto; un perfil sin
   * investigaciones ve el estado vacío honesto, nunca una lista fabricada.
   */
  investigaciones: Investigacion[];
}

const ESTADOS_EN_CURSO: ReadonlySet<Investigacion["estado"]> = new Set(["en_cola", "investigando", "generando_reporte"]);

export function AppShell({ children, perfilNombre, perfilOrganizacion, notificacionesNoLeidas = 0, investigaciones }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPanelOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Cerrar el panel al navegar (mismo comportamiento que el drawer anterior).
  useEffect(() => {
    setPanelOpen(false);
  }, [pathname]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return investigaciones;
    return investigaciones.filter((inv) => (inv.titulo ?? inv.mensaje ?? "").toLowerCase().includes(q));
  }, [investigaciones, busqueda]);

  async function salir() {
    setCerrandoSesion(true);
    try {
      await fetch("/api/session", { method: "DELETE" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const iniciales = perfilNombre
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-app-bg" style={{ fontFamily: "var(--font-display)" }}>
      {/* Disparador del panel: mismo botón en todas las rutas (design-ref líneas 24, 173-175, 194-196). */}
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        aria-label="Abrir navegación"
        className="fixed left-[22px] top-5 z-30 flex h-[38px] items-center gap-2 border-none bg-transparent p-0 text-text"
      >
        <Image src="/inspector-logo.png" alt="" width={22} height={22} className="block h-[22px] w-[22px] rounded-[6px]" priority />
        <span className="text-[17px] font-semibold tracking-tight text-text">Forense</span>
      </button>

      {/* Overlay (design-ref línea 26). */}
      <div
        aria-hidden={!panelOpen}
        onClick={() => setPanelOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-[rgba(20,20,19,.12)] transition-opacity duration-200",
          panelOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Panel deslizante — navegación única (design-ref líneas 28-56). */}
      <nav
        aria-label="Navegación"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[86vw] flex-col border-r border-border bg-surface shadow-[0_0_30px_rgba(20,20,19,.06)] transition-transform duration-[240ms] ease-[cubic-bezier(.22,.7,.3,1)]",
          panelOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2.5 border-b border-border px-4 pb-3.5 pt-4">
          <span className="flex items-center gap-2 text-[15px] font-semibold text-text">
            <Image src="/inspector-logo.png" alt="" width={19} height={19} className="block h-[19px] w-[19px] rounded-[5px]" />
            Forense
          </span>
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="Cerrar navegación"
            className="insp-focus-ring flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-control)] border-none bg-transparent text-text-subtle transition-colors hover:bg-surface-hover"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2.5 pt-3.5">
          <div className="focus-within:border-border-stronger mx-0.5 mb-2 flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 transition-colors">
            <Search size={13} className="text-placeholder" aria-hidden />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar investigaciones"
              className="min-w-0 flex-1 border-none bg-transparent text-xs text-text outline-none"
            />
          </div>
          <span className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-subtle">Investigaciones</span>

          {filtradas.length === 0 ? (
            <p className="px-2 py-3 text-xs text-text-subtle">
              {investigaciones.length === 0 ? "Sin investigaciones todavía." : `Ninguna investigación coincide con “${busqueda}”.`}
            </p>
          ) : (
            filtradas.map((inv) => (
              <Link
                key={inv.id}
                href={`/investigaciones/${inv.id}`}
                className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
              >
                {ESTADOS_EN_CURSO.has(inv.estado) && (
                  <span
                    aria-hidden
                    className="h-4 w-4 flex-none rounded-full border-2 border-border"
                    style={{ borderTopColor: "var(--text)", animation: "insp-spin .8s linear infinite" }}
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="max-w-[200px] truncate text-[13.5px] text-text">{inv.titulo ?? inv.mensaje ?? "Investigación"}</span>
                  <span className="text-[11.5px] text-text-subtle">{ESTADO_LABEL[inv.estado]}</span>
                </span>
              </Link>
            ))
          )}

          <span className="mt-3 px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-subtle">Secciones</span>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-[13.5px] transition-colors",
                  active ? "bg-surface-muted font-medium text-text" : "text-text hover:bg-surface-hover",
                )}
              >
                <Icon size={15} aria-hidden className="flex-none text-text-subtle" />
                <span className="flex-1 truncate">{label}</span>
                {href === "/notificaciones" && notificacionesNoLeidas > 0 && (
                  <span className="flex-none rounded-full bg-error px-1.5 text-[10px] font-medium leading-4 text-white">
                    {notificacionesNoLeidas > 9 ? "9+" : notificacionesNoLeidas}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col gap-1 border-t border-border p-3">
          <Link href="/perfil" className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-[13.5px] text-text transition-colors hover:bg-surface-hover">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary text-[10px] font-medium text-white">
              {iniciales || <User size={13} />}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="block truncate">{perfilNombre}</span>
              {perfilOrganizacion && <span className="block truncate text-[11px] text-text-subtle">{perfilOrganizacion}</span>}
            </span>
          </Link>
          <button
            type="button"
            onClick={salir}
            disabled={cerrandoSesion}
            className="flex h-[38px] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            <LogOut size={15} aria-hidden />
            {cerrandoSesion ? "Saliendo…" : "Cerrar sesión"}
          </button>
        </div>
      </nav>

      <main className="min-h-screen w-full px-4 pb-10 pt-16 sm:px-6 sm:pt-[76px] lg:px-10" style={{ fontFamily: "var(--font-inter)" }}>
        <div className="mx-auto w-full max-w-[1440px]">{children}</div>
      </main>
    </div>
  );
}
