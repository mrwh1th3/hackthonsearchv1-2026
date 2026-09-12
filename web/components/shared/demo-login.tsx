"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Logo } from "./logo";

/**
 * 15 §4: tarjeta centrada de 380px, acceso demo auditor/1234, gate en
 * servidor (POST /api/session). Enter envía; error inline asociado al
 * formulario, foco visible.
 */
export function DemoLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [usuario, setUsuario] = useState("auditor");
  const [password, setPassword] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usuario, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(mensajeError(res.status, body.error));
        return;
      }
      const next = searchParams.get("next") || "/";
      router.push(next);
      router.refresh();
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
      <div className="w-full max-w-[380px] rounded-[var(--radius-card)] border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white">
            <Logo className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-text">Bienvenido a Forense</h1>
            <p className="mt-1 text-xs uppercase tracking-wide text-text-subtle">Acceso demo</p>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate>
          <div className="mb-4">
            <label htmlFor="usuario" className="mb-1 block text-xs font-medium text-text-muted">
              Usuario
            </label>
            <input
              id="usuario"
              name="usuario"
              autoComplete="username"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              className="h-11 w-full rounded-[var(--radius-input)] border border-border bg-surface px-3 text-sm outline-none focus:border-focus focus:ring-2 focus:ring-focus/30"
              aria-describedby={error ? errorId : undefined}
            />
          </div>

          <div className="mb-2">
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-text-muted">
              Contraseña
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={verPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-[var(--radius-input)] border border-border bg-surface px-3 pr-10 text-sm outline-none focus:border-focus focus:ring-2 focus:ring-focus/30"
                aria-describedby={error ? errorId : undefined}
                aria-invalid={Boolean(error)}
              />
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-subtle hover:text-text"
                aria-label={verPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {verPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <p id={errorId} role="alert" className="mb-3 text-xs text-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={cargando}
            className="h-11 w-full rounded-[var(--radius-input)] bg-primary text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {cargando ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-text-subtle">
          Workspace sintético compartido · usuario <code>auditor</code> · contraseña <code>1234</code>
        </p>
      </div>
    </div>
  );
}

function mensajeError(status: number, codigo?: string): string {
  if (codigo === "credenciales_invalidas") return "Usuario o contraseña incorrectos.";
  if (codigo === "demasiados_intentos") return "Demasiados intentos. Espera un momento.";
  if (codigo === "sesion_no_configurada") return "Sesión demo no configurada en este entorno.";
  // Las credenciales eran correctas: lo que falló fue leer el perfil. Lo más
  // probable es que el schema `forense` no esté expuesto en PostgREST, así que
  // el mensaje nombra eso en vez de dejar un "no se pudo" genérico.
  if (codigo === "fuente_de_datos_no_disponible") {
    return "Credenciales correctas, pero la base no respondió. Revisa que el schema forense esté expuesto en Supabase y que SUPABASE_URL apunte al proyecto con las migraciones aplicadas.";
  }
  if (status === 403) return "Origen no permitido.";
  return "No se pudo iniciar sesión.";
}
