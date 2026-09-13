"""Codex subscription adapter. Official CLI, isolated cwd, JSON schema, no shell tools.

Authentication is reused through Codex itself, never extracted or copied. A/B and
the compiler get only the supplied slices. Only sector research enables web search.
Docs: https://learn.chatgpt.com/docs/non-interactive-mode
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import threading


_ACTIVE_PROCESS_GROUPS: set[int] = set()


def terminate_active_calls() -> None:
    """Forward supervisor shutdown to every isolated Codex process group."""
    pids = tuple(_ACTIVE_PROCESS_GROUPS)
    for pid in pids:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    if pids:
        time.sleep(0.25)
    for pid in pids:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def install_shutdown_handlers() -> None:
    # Opt-in for CLI runners only: a library import must not replace host handlers.
    if threading.current_thread() is not threading.main_thread():
        return
    def stop(signum, _frame):
        terminate_active_calls()
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)


class ProviderError(RuntimeError):
    def __init__(self, message: str, *, events: list | None = None):
        super().__init__(message)
        self.events = events or []


def codex_binary() -> str:
    configured = os.environ.get("FORENSE_CODEX_BIN")
    if configured:
        if not Path(configured).is_file():
            raise ProviderError("FORENSE_CODEX_BIN no apunta a un ejecutable existente.")
        return configured
    found = shutil.which("codex")
    if found:
        return found
    for app in ("ChatGPT", "Codex"):
        candidate = Path(f"/Applications/{app}.app/Contents/Resources/codex")
        if candidate.is_file():
            return str(candidate)
    raise ProviderError("Codex CLI no está instalado. Instala Codex y ejecuta codex login.")


def child_environment() -> dict[str, str]:
    # No DATABASE_URL, API keys, app secrets, or parent agent thread/session IDs.
    allowed = {"PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "CODEX_HOME",
               "SYSTEMROOT", "APPDATA", "LOCALAPPDATA", "SSL_CERT_FILE", "SSL_CERT_DIR"}
    return {k: v for k, v in os.environ.items() if k in allowed}


def preflight() -> dict:
    try:
        executable = codex_binary()
        result = subprocess.run([executable, "login", "status"], env=child_environment(),
                                text=True, capture_output=True, timeout=15)
        authenticated = result.returncode == 0 and "chatgpt" in (result.stdout + result.stderr).lower()
        return {"available": True, "authenticated": authenticated, "auth_mode": "chatgpt" if authenticated else "unavailable",
                "message": "Sesión ChatGPT disponible" if authenticated else "Ejecuta codex login con tu cuenta ChatGPT."}
    except (OSError, subprocess.SubprocessError, ProviderError):
        return {"available": False, "authenticated": False, "auth_mode": "unavailable", "message": "Codex CLI no está disponible."}


def safe_events(stdout: str) -> list[dict]:
    """Persist operational facts; exclude hidden reasoning and unrestricted raw output."""
    result = []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(event, dict):
            continue
        typ = event.get("type", "")
        if typ in {"turn.completed", "turn.started", "thread.started"}:
            result.append({k: event[k] for k in ("type", "usage", "thread_id", "model") if k in event})
        elif typ in {"turn.failed", "error"}:
            result.append({"type": typ, "message": "Codex no pudo completar el turno; revisa autenticación, cuota y conexión."})
        elif typ == "item.completed":
            item = event.get("item", {})
            if item.get("type") in {"web_search", "web_search_call"}:
                result.append({"type": "web_search", "action": item.get("action", {}), "status": item.get("status")})
            elif item.get("type") in {"mcp_tool_call", "dynamic_tool_call"}:
                tool = str(item.get("tool", item.get("tool_name", "")))
                if "web" in tool.lower() and any(x in tool.lower() for x in ("search", "run")):
                    result.append({"type": "web_search", "tool": tool, "status": item.get("status")})
    return result


class CodexProvider:
    name = "codex"

    def __init__(self, model: str | None = None, timeout: int | None = None, **_: object):
        self.model = model or os.environ.get("FORENSE_CODEX_MODEL")
        self.timeout = min(max(timeout or int(os.environ.get("FORENSE_CODEX_TIMEOUT", "180")), 10), 600)

    def call(self, actor: str, prompt: str, schema: dict) -> dict:
        if not isinstance(schema, dict) or schema.get("type") != "object":
            raise ProviderError("La salida de Codex requiere un contrato JSON de tipo objeto.")
        if len(prompt.encode()) > 160_000:
            raise ProviderError("El recorte supera el límite de contexto del laboratorio.")
        start = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="forense_codex_") as temp:
            root = Path(temp)
            contract, output = root / "schema.json", root / "output.json"
            contract.write_text(json.dumps(schema, ensure_ascii=False))
            command = [codex_binary(), "-a", "never", "exec", "--ignore-user-config", "--ephemeral",
                       "--skip-git-repo-check", "--sandbox", "read-only", "--cd", temp,
                       "--json", "--color", "never", "--output-schema", str(contract),
                       "--output-last-message", str(output)]
            config = {
                "forced_login_method": '"chatgpt"', "web_search": '"live"' if actor == "sector_research" else '"disabled"',
                "features.shell_tool": "false", "features.unified_exec": "false",
                "features.apps": "false", "features.plugins": "false", "features.multi_agent": "false",
                "features.browser_use": "false", "features.computer_use": "false", "features.in_app_browser": "false",
                "features.code_mode_host": "true" if actor == "sector_research" else "false",
                "features.shell_snapshot": "false", "hide_agent_reasoning": "true",
                "mcp_servers": "{}", "project_doc_max_bytes": "0", "history.persistence": '"none"',
            }
            for key, value in config.items():
                command.extend(["-c", f"{key}={value}"])
            if self.model:
                command.extend(["--model", self.model])
            command.append("-")
            try:
                process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           text=True, env=child_environment(), start_new_session=True)
                _ACTIVE_PROCESS_GROUPS.add(process.pid)
                try:
                    stdout, _stderr = process.communicate(prompt, timeout=self.timeout)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        stdout, _stderr = process.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        stdout, _stderr = process.communicate()
                    raise ProviderError("Codex excedió el tiempo permitido; el proceso fue detenido.", events=safe_events(stdout))
                finally:
                    _ACTIVE_PROCESS_GROUPS.discard(process.pid)
            except OSError as exc:
                raise ProviderError("No se pudo iniciar Codex CLI.") from exc
            events = safe_events(stdout)
            if process.returncode != 0 or any(e["type"] in {"turn.failed", "error"} for e in events):
                raise ProviderError("Codex no completó la solicitud. Comprueba sesión ChatGPT, cuota y conectividad.", events=events)
            try:
                value = json.loads(output.read_text())
                if not isinstance(value, dict):
                    raise ValueError("object required")
            except (OSError, ValueError) as exc:
                raise ProviderError("Codex no devolvió JSON válido conforme al contrato.", events=events) from exc
            usage = [e["usage"] for e in events if isinstance(e.get("usage"), dict)]
            return {"output": value, "tokens_in": sum(u.get("input_tokens", 0) for u in usage) if usage else max(1, len(prompt) // 4),
                    "tokens_out": sum(u.get("output_tokens", 0) for u in usage) if usage else max(1, len(json.dumps(value)) // 4),
                    "cached_tokens_in": sum(u.get("cached_input_tokens", 0) for u in usage),
                    "tokens_estimated": not bool(usage), "model": self.model or "codex-default",
                    "duration_ms": round((time.monotonic() - start) * 1000), "provider_events": events,
                    "cost_usd_est": None, "billing": "chatgpt_subscription", "api_requests": None}
