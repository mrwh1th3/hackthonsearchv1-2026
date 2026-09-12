"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  BarChart3,
  Bell,
  Database,
  FolderKanban,
  Gauge,
  HelpCircle,
  History,
  LogOut,
  Menu,
  Search,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

/**
 * Mapeo de navegación (18/15 §3 vs 09 mapa de vistas): doc15 nombra el
 * ítem "Historial de ejecuciones" (técnico) y separa "Investigaciones"; el
 * mapa de rutas 09 solo materializa `/historial` (solicitudes/llamadas,
 * producto) y `/corridas` (bitácora técnica). Resolución tomada aquí:
 * "Investigaciones" -> /historial (vista de producto: solicitudes,
 * ejecuciones y llamadas del usuario); "Historial" -> /corridas (vista
 * técnica de ejecuciones, como dice 15 §7: "El historial de /corridas se
 * conserva como vista técnica"). Documentado en solicitudes_coordinador
 * para confirmar o ajustar cuando exista una ruta /investigaciones propia.
 */
const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: Gauge },
  { href: "/historial", label: "Investigaciones", icon: FolderKanban },
  { href: "/corridas", label: "Historial", icon: History },
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
  breadcrumb?: string;
}

export function AppShell({ children, perfilNombre, perfilOrganizacion, notificacionesNoLeidas = 0, breadcrumb }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [buscadorOpen, setBuscadorOpen] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuscadorOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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
    <div className="min-h-screen bg-app-bg">
      {/* Sidebar de escritorio */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface transition-[width] duration-150 lg:flex",
          collapsed ? "w-16" : "w-[232px]",
        )}
        aria-label="Navegación principal"
      >
        <SidebarContent collapsed={collapsed} pathname={pathname} perfilNombre={perfilNombre} perfilOrganizacion={perfilOrganizacion} iniciales={iniciales} onSalir={salir} cerrandoSesion={cerrandoSesion} />
      </aside>

      {/* Drawer móvil/tablet (<1024) */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[232px] flex-col border-r border-border bg-surface lg:hidden">
            <Dialog.Title className="sr-only">Navegación</Dialog.Title>
            <div className="flex justify-end p-2">
              <Dialog.Close asChild>
                <button aria-label="Cerrar navegación" className="rounded-md p-1.5 hover:bg-surface-hover">
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
            <SidebarContent collapsed={false} pathname={pathname} perfilNombre={perfilNombre} perfilOrganizacion={perfilOrganizacion} iniciales={iniciales} onSalir={salir} cerrandoSesion={cerrandoSesion} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className={cn("flex min-h-screen flex-col transition-[margin] duration-150", collapsed ? "lg:ml-16" : "lg:ml-[232px]")}>
        {/* Header, 60px */}
        <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b border-border bg-surface px-4">
          <button
            type="button"
            aria-label="Abrir navegación"
            className="rounded-md p-1.5 hover:bg-surface-hover lg:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={20} />
          </button>
          <button
            type="button"
            aria-label={collapsed ? "Expandir sidebar" : "Compactar sidebar"}
            className="hidden rounded-md p-1.5 hover:bg-surface-hover lg:inline-flex"
            onClick={() => setCollapsed((c) => !c)}
          >
            <Menu size={18} />
          </button>
          <nav aria-label="Ruta actual" className="min-w-0 flex-1 truncate text-sm text-text-muted">
            {breadcrumb ?? NAV_ITEMS.find((n) => n.href === pathname)?.label ?? "Forense"}
          </nav>
          <button
            type="button"
            onClick={() => setBuscadorOpen(true)}
            className="hidden h-9 items-center gap-2 rounded-[var(--radius-input)] border border-border bg-surface-muted px-3 text-xs text-text-subtle hover:bg-surface-hover sm:inline-flex"
          >
            <Search size={14} aria-hidden />
            Buscar por RFC, UUID o nombre
            <kbd className="rounded border border-border bg-surface px-1 text-[10px]">⌘K</kbd>
          </button>
          <button type="button" onClick={() => setBuscadorOpen(true)} className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-surface-hover sm:hidden" aria-label="Buscar">
            <Search size={18} />
          </button>
          <Link
            href="/notificaciones"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-surface-hover"
            aria-label={`Notificaciones${notificacionesNoLeidas > 0 ? `, ${notificacionesNoLeidas} sin leer` : ""}`}
          >
            <Bell size={18} />
            {notificacionesNoLeidas > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-medium text-white">
                {notificacionesNoLeidas > 9 ? "9+" : notificacionesNoLeidas}
              </span>
            )}
          </Link>
          <Link
            href="/perfil"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-medium text-white"
            aria-label="Perfil"
          >
            {iniciales || <User size={16} />}
          </Link>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:mx-auto lg:w-full lg:max-w-[1440px] lg:px-8">{children}</main>
      </div>

      {/* Búsqueda global (Cmd/Ctrl+K) */}
      <Dialog.Root open={buscadorOpen} onOpenChange={setBuscadorOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content className="fixed left-1/2 top-24 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-lg">
            <Dialog.Title className="mb-2 text-sm font-medium text-text">Buscar</Dialog.Title>
            <input
              autoFocus
              type="search"
              placeholder="RFC, UUID de CFDI, nombre o código de pista…"
              className="h-10 w-full rounded-[var(--radius-input)] border border-border bg-surface-muted px-3 text-sm outline-none focus:border-focus"
            />
            <p className="mt-2 text-xs text-text-subtle">
              Búsqueda global pendiente de conectar a datos persistidos (fixtures de este corte no indexan todavía). Escape para cerrar.
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function SidebarContent({
  collapsed,
  pathname,
  perfilNombre,
  perfilOrganizacion,
  iniciales,
  onSalir,
  cerrandoSesion,
}: {
  collapsed: boolean;
  pathname: string;
  perfilNombre: string;
  perfilOrganizacion?: string;
  iniciales: string;
  onSalir: () => void;
  cerrandoSesion: boolean;
}) {
  return (
    <>
      <div className={cn("flex h-[60px] items-center gap-2 border-b border-border px-4", collapsed && "justify-center px-0")}>
        <Logo className="h-5 w-5 text-text" />
        {!collapsed && <span className="text-sm font-semibold text-text">Forense</span>}
      </div>

      <div className={cn("p-3", collapsed && "px-1.5")}>
        <Link
          href="/"
          className={cn(
            "flex h-9 items-center justify-center gap-2 rounded-[var(--radius-input)] bg-primary text-sm font-medium text-white hover:bg-primary-hover",
            collapsed ? "px-0" : "px-3",
          )}
        >
          {collapsed ? "+" : "Nueva investigación"}
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-2" aria-label="Secciones">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-[var(--radius-input)] px-2.5 text-sm transition-colors",
                active ? "bg-surface-muted font-medium text-text" : "text-text-muted hover:bg-surface-hover hover:text-text",
                collapsed && "justify-center px-0",
              )}
              title={collapsed ? label : undefined}
            >
              <Icon size={17} aria-hidden />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-0.5 border-t border-border p-2">
        <Link
          href="/perfil"
          className={cn("flex h-9 items-center gap-2.5 rounded-[var(--radius-input)] px-2.5 text-sm text-text-muted hover:bg-surface-hover", collapsed && "justify-center px-0")}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-white">{iniciales}</span>
          {!collapsed && (
            <span className="min-w-0 truncate">
              <span className="block truncate text-text">{perfilNombre}</span>
              {perfilOrganizacion && <span className="block truncate text-xs text-text-subtle">{perfilOrganizacion}</span>}
            </span>
          )}
        </Link>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn("flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-input)] px-2.5 text-sm text-text-muted hover:bg-surface-hover", collapsed && "justify-center px-0")}
            >
              <HelpCircle size={17} aria-hidden />
              {!collapsed && "Ayuda y atajos"}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="right" sideOffset={8} className="z-50 w-64 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-xs text-text shadow-lg">
              <p className="mb-2 font-medium">Atajos de teclado</p>
              <ul className="space-y-1 text-text-muted">
                <li>
                  <kbd className="rounded border border-border px-1">⌘/Ctrl K</kbd> Búsqueda global
                </li>
                <li>
                  <kbd className="rounded border border-border px-1">Esc</kbd> Cerrar diálogos/paneles
                </li>
                <li>
                  <kbd className="rounded border border-border px-1">Tab</kbd> Navegar por foco
                </li>
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <button
          type="button"
          onClick={onSalir}
          disabled={cerrandoSesion}
          className={cn("flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-input)] px-2.5 text-sm text-text-muted hover:bg-surface-hover disabled:opacity-50", collapsed && "justify-center px-0")}
        >
          <LogOut size={17} aria-hidden />
          {!collapsed && (cerrandoSesion ? "Saliendo…" : "Cerrar sesión")}
        </button>
      </div>
    </>
  );
}
