"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { Investigacion } from "@/lib/data";
import { soloFecha } from "@/lib/date/formato";

/**
 * Puerto **fiel** del shell de `design-ref/Agents.dc.html` (líneas 26–56).
 *
 * El usuario pidió tres veces la UI idéntica, y las dos primeras entregas la
 * desviaron: se le añadió una barra de nueve entradas de navegación y una
 * pantalla índice que el diseño no tiene. Eso se quitó. El panel del diseño
 * lleva exactamente cuatro cosas, en este orden: wordmark con su botón de
 * cierre, buscador "Buscar investigaciones", el rótulo "Investigaciones" con su
 * lista, y un botón al pie.
 *
 * Medidas y tiempos copiados del original, no aproximados:
 *   * disparador del wordmark: `top:20px; left:22px`, alto 22px, oculto cuando
 *     una pantalla toma el lienzo completo (`triggerDisplay` en el original);
 *   * velo: `rgba(20,20,19,.12)`, `transition: opacity .2s`;
 *   * panel: 300px, `max-width:86vw`, `translateX(-100%)` → `translateX(0)` con
 *     `transform .24s cubic-bezier(.22,.7,.3,1)`, borde derecho `#ebe8e2` y
 *     `box-shadow: 0 0 30px rgba(20,20,19,.06)`;
 *   * separadores internos `#f0eee9`, distintos del borde exterior;
 *   * filas: `padding:9px 10px`, radio 9px, `background .15s` al pasar;
 *   * spinner: 16px, borde 2px `#e3e0da` con `border-top` `#141413`, girando
 *     `.8s linear infinite`.
 *
 * Lo único que NO es copia literal, y por qué: el original enlaza "Sign in" a
 * `Login.dc.html` porque está diseñado sin sesión. Aquí la sesión existe, así
 * que esa ranura —misma posición, mismo tamaño, mismo estilo— cierra sesión.
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
}

const ESTADOS_EN_CURSO: ReadonlySet<Investigacion["estado"]> = new Set(["en_cola", "investigando", "generando_reporte"]);

export function AppShell({ children, perfilNombre, investigaciones }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPanelOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setPanelOpen(false);
  }, [pathname]);

  // El original ordena con las terminadas al final y filtra por título.
  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return investigaciones
      .map((inv) => {
        const enCurso = ESTADOS_EN_CURSO.has(inv.estado);
        const titulo = inv.titulo ?? inv.mensaje ?? "Investigación";
        return {
          id: inv.id,
          titulo,
          enCurso,
          estado: enCurso ? "Investigando…" : `Lista · ${soloFecha(inv.completada_at ?? inv.creado)}`,
        };
      })
      .sort((a, b) => Number(a.enCurso ? 0 : 1) - Number(b.enCurso ? 0 : 1))
      .filter((f) => !q || f.titulo.toLowerCase().includes(q));
  }, [investigaciones, busqueda]);

  async function salir() {
    try {
      await fetch("/api/session", { method: "DELETE" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  // El original esconde el disparador cuando una pantalla toma el lienzo
  // completo: ahí el wordmark ya vive dentro de su propia cabecera.
  const lienzoCompleto = pathname.startsWith("/corridas/") || pathname.startsWith("/casos/");

  return (
    <div className="relative min-h-screen bg-app-bg font-sans text-text">
      {!lienzoCompleto && (
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label="Abrir navegación"
          className="absolute left-[22px] top-[20px] z-[3] flex h-[38px] items-center border-none bg-transparent p-0"
        >
          <Wordmark className="h-[22px]" />
        </button>
      )}

      <div
        onClick={() => setPanelOpen(false)}
        aria-hidden
        className="absolute inset-0 z-[4] bg-[rgba(20,20,19,.12)] transition-opacity duration-200"
        style={{ opacity: panelOpen ? 1 : 0, pointerEvents: panelOpen ? "auto" : "none" }}
      />

      <aside
        className="absolute bottom-0 left-0 top-0 z-[5] flex w-[300px] max-w-[86vw] flex-col border-r border-border bg-surface shadow-[0_0_30px_rgba(20,20,19,.06)]"
        style={{
          transform: panelOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform .24s cubic-bezier(.22,.7,.3,1)",
        }}
      >
        <div className="flex items-center justify-between gap-2.5 border-b border-[#f0eee9] px-4 pb-3.5 pt-4">
          <Wordmark className="h-[19px]" />
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="Cerrar navegación"
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
              placeholder="Buscar investigaciones"
              aria-label="Buscar investigaciones"
              className="min-w-0 flex-1 border-none bg-transparent text-[12.5px] text-text outline-none placeholder:text-[var(--placeholder)]"
            />
          </div>

          <span className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-[0.04em] text-text-subtle">Investigaciones</span>

          {filas.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => router.push(`/investigaciones/${f.id}`)}
              className="flex items-center gap-[9px] rounded-[9px] border-none bg-transparent px-2.5 py-[9px] text-left transition-colors duration-150 hover:bg-[#f7f6f4]"
            >
              {f.enCurso && (
                <span
                  aria-hidden
                  className="h-4 w-4 flex-none rounded-full border-2 border-[#e3e0da] border-t-text"
                  style={{ animation: "insp-spin .8s linear infinite" }}
                />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="max-w-[200px] truncate text-[13.5px] text-text">{f.titulo}</span>
                <span className="text-[11.5px] text-text-subtle">{f.estado}</span>
              </span>
            </button>
          ))}

          {filas.length === 0 && (
            <p className="px-2 py-5 text-center text-[12.5px] text-text-subtle">
              {busqueda.trim() ? `Ninguna investigación coincide con “${busqueda.trim()}”.` : "Todavía no hay investigaciones."}
            </p>
          )}
        </div>

        <div className="border-t border-[#f0eee9] p-3">
          <button
            type="button"
            onClick={salir}
            className="flex h-[38px] w-full items-center justify-center rounded-[10px] border border-border bg-surface text-[13px] font-medium text-text-muted transition-colors duration-150 hover:bg-[#f7f6f4]"
          >
            Salir · {perfilNombre}
          </button>
        </div>
      </aside>

      {children}
    </div>
  );
}

/**
 * El wordmark del original es un PNG con la palabra rasterizada
 * (`assets/inspector-wordmark.png`, 1250×217). Se compone como texto en
 * Instrument Sans al mismo alto: nítido a cualquier densidad y traducible.
 * Ver la desviación declarada en `docs/22-frontend-inspector.md`.
 */
function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`flex items-center ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/inspector-logo.png" alt="" aria-hidden className="mr-2 h-full w-auto" />
      <span className="text-[17px] font-semibold leading-none tracking-[-0.02em] text-text">Forense</span>
    </span>
  );
}
