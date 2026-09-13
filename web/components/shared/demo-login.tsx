"use client";

import { ArrowRight, Check, Eye, EyeOff, FileText, GitBranch, LoaderCircle, ScanLine } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import styles from "@/app/login/login.module.css";
import { InspectorWordmark } from "./logo";

const WORKFLOW = [
  { label: "Records", icon: FileText, title: "Start with the source.", description: "Bring financial records into one investigation, with their original evidence intact." },
  { label: "Investigate", icon: GitBranch, title: "Question every signal.", description: "Follow deterministic checks with AI review. Explore connections and challenge the findings." },
  { label: "Review", icon: ScanLine, title: "See how it adds up.", description: "Review findings, supporting evidence and limitations together before making a decision." },
] as const;

/** Only return local destinations; `next` is an untrusted query parameter. */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const decodedPath = decodeURIComponent(next.split(/[?#]/, 1)[0]);
    if (decodedPath.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decodedPath)) return "/";
    const url = new URL(next, "https://forense.local");
    if (url.origin !== "https://forense.local" || decodeURIComponent(url.pathname).startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function DemoLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = useId();
  const [usuario, setUsuario] = useState("auditor");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [retryUntil, setRetryUntil] = useState(0);
  const [demoFilled, setDemoFilled] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const busy = status !== "idle";
  const errorId = `${id}-error`;
  const step = WORKFLOW[activeStep];
  const StepIcon = step.icon;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (retryUntil <= 0) return;
    function updateCountdown() {
      const seconds = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1_000));
      setRetrySeconds(seconds);
      if (seconds === 0) {
        window.clearInterval(timer);
        setError((current) => current === signInError(429) ? null : current);
      }
    }
    const timer = window.setInterval(updateCountdown, 1_000);
    updateCountdown();
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  function clearError() {
    setError(null);
    setInvalidFields([]);
    setDemoFilled(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current || retrySeconds > 0) return;
    const missing = [!usuario.trim() && "username", !password && "password"].filter(Boolean) as string[];
    if (missing.length) {
      setInvalidFields(missing);
      setError(missing.length === 2 ? "Enter your username and password." : `Enter your ${missing[0]}.`);
      (missing.includes("username") ? usernameRef : passwordRef).current?.focus();
      return;
    }

    inFlightRef.current = true;
    setStatus("submitting");
    setError(null);
    setInvalidFields([]);
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    let redirecting = false;
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usuario: usuario.trim(), password }),
        signal: controller.signal,
      });
      if (!mountedRef.current) return;
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        if (!mountedRef.current) return;
        const details = body && typeof body === "object" ? body as Record<string, unknown> : {};
        const code = typeof details.error === "string" ? details.error : undefined;
        setError(signInError(response.status, code));
        if (response.status === 401) setInvalidFields(["username", "password"]);
        if (response.status === 429) {
          const retryMs = typeof details.retry_after_ms === "number" && Number.isFinite(details.retry_after_ms)
            ? details.retry_after_ms : 60_000;
          const seconds = Math.min(3_600, Math.max(1, Math.ceil(retryMs / 1_000)));
          setRetrySeconds(seconds);
          setRetryUntil(Date.now() + seconds * 1_000);
        }
        return;
      }
      setStatus("redirecting");
      router.push(safeNextPath(searchParams.get("next")));
      router.refresh();
      redirecting = true;
    } catch {
      if (mountedRef.current) {
        setError(controller.signal.aborted ? "The request took too long. Please try again." : "Could not connect. Check your connection and try again.");
      }
    } finally {
      window.clearTimeout(timeout);
      requestRef.current = null;
      if (!redirecting) {
        inFlightRef.current = false;
        if (mountedRef.current) setStatus("idle");
      }
    }
  }

  function fillDemoCredentials() {
    setUsuario("auditor");
    setPassword("1234");
    setShowPassword(false);
    setError(null);
    setInvalidFields([]);
    setDemoFilled(true);
    passwordRef.current?.focus();
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <InspectorWordmark className={styles.brand} />
        <span className={styles.workspaceBadge}>Research workspace</span>
      </header>

      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby={`${id}-intro`}>
          <p className={styles.eyebrow}>From records to understanding</p>
          <h1 id={`${id}-intro`} className={styles.headline}>Follow the<br />{" "}<span>evidence.</span></h1>
          <p className={styles.description}>A clearer view of financial activity.<br className={styles.desktopBreak} /> Every finding, connected to its source.</p>

        </section>

        <section className={styles.signIn} aria-labelledby={`${id}-sign-in`}>
          <div className={styles.formHeading}>
            <h2 id={`${id}-sign-in`}>Sign in</h2>
            <p>Continue to your investigation workspace.</p>
          </div>

          <form onSubmit={onSubmit} noValidate aria-labelledby={`${id}-sign-in`} aria-busy={busy}>
            <div className={styles.field}>
              <label htmlFor={`${id}-username`}>Username</label>
              <input ref={usernameRef} id={`${id}-username`} name="usuario" autoComplete="username"
                autoCapitalize="none" spellCheck={false} required disabled={busy} value={usuario}
                onChange={(event) => { setUsuario(event.target.value); clearError(); }}
                className={styles.input} aria-invalid={invalidFields.includes("username")}
                aria-describedby={error ? errorId : undefined} />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-password`}>Password</label>
              <div className={styles.passwordField}>
                <input ref={passwordRef} id={`${id}-password`} name="password" type={showPassword ? "text" : "password"}
                  autoComplete="current-password" required disabled={busy} value={password}
                  onChange={(event) => { setPassword(event.target.value); clearError(); }}
                  className={styles.input} aria-invalid={invalidFields.includes("password")}
                  aria-describedby={error ? errorId : undefined} />
                <button type="button" disabled={busy} className={styles.passwordToggle}
                  onClick={() => setShowPassword((visible) => !visible)} aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
            </div>

            {error && <p id={errorId} role="alert" className={styles.error}>{error}</p>}
            <button type="submit" className={styles.submit} disabled={busy || retrySeconds > 0}>
              {busy ? <LoaderCircle size={17} className={styles.spinner} aria-hidden="true" /> : null}
              <span>{status === "redirecting" ? "Opening workspace…" : status === "submitting" ? "Signing in…" : retrySeconds > 0 ? `Try again in ${retrySeconds}s` : "Sign in"}</span>
              {!busy && retrySeconds === 0 && <ArrowRight size={17} aria-hidden="true" />}
            </button>
          </form>
          <p className={styles.screenReaderOnly} role="status">{status === "submitting" ? "Signing in. Please wait." : status === "redirecting" ? "Signed in. Opening your workspace." : ""}</p>

          <div className={styles.demo}>
            <div className={styles.demoHeader}>
              <span>Trying the demo?</span>
              <button type="button" disabled={busy || retrySeconds > 0} onClick={fillDemoCredentials} className={styles.demoButton}>
                {demoFilled && <Check size={13} aria-hidden="true" />}{demoFilled ? "Credentials filled" : "Use demo credentials"}
              </button>
            </div>
            <p>Default access: <code>auditor</code> / <code>1234</code>.<br />Your workspace may use a different password.</p>
          </div>
        </section>

        <div className={styles.workflow}>
          <div className={styles.workflowSteps} role="group" aria-label="Explore the investigation workflow">
            {WORKFLOW.map((item, index) => (
              <button key={item.label} type="button" className={styles.workflowStep}
                aria-pressed={activeStep === index} aria-controls={`${id}-workflow-detail`}
                onClick={() => setActiveStep(index)}>
                <span className={styles.stepNumber}>0{index + 1}</span>{" "}<span>{item.label}</span>
              </button>
            ))}
          </div>
          <div id={`${id}-workflow-detail`} className={styles.workflowDetail} aria-live="polite" aria-atomic="true">
            <div key={step.label} className={styles.workflowContent}>
              <span className={styles.stepIcon}><StepIcon size={20} strokeWidth={1.5} aria-hidden="true" /></span>
              <div><h2>{step.title}</h2><p>{step.description}</p></div>
            </div>
          </div>
        </div>
      </main>

      <footer className={styles.footer}><span>Evidence first. Human judgment always.</span><span>Shared demo access</span></footer>
    </div>
  );
}

function signInError(status: number, code?: string): string {
  if (code === "credenciales_invalidas" || status === 401) return "Incorrect username or password. Please try again.";
  if (code === "demasiados_intentos" || status === 429) return "Too many sign-in attempts. Wait for the countdown, then try again.";
  if (code === "sesion_no_configurada") return "Sign-in is not configured for this workspace. Contact the workspace owner.";
  if (code === "fuente_de_datos_no_disponible") return "Your credentials were accepted, but the workspace could not be loaded. Please try again.";
  if (status === 403) return "This sign-in request was not allowed. Reload the page and try again.";
  return "Could not sign in. Please try again.";
}
