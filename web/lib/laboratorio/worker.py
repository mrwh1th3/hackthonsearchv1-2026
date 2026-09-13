"""One durable run: canonical data → deterministic motor → A/B → compiler."""
from __future__ import annotations

import json
import os
from pathlib import Path
import runpy
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Callable
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save(path: Path, value: object) -> None:
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.chmod(0o600)
    temporary.replace(path)


def execute(args: list[str], log, timeout: float, *, engine: bool = False) -> int:
    env = dict(os.environ)
    if engine:
        env["PYTHONPATH"] = str(ROOT / "src")
    child = subprocess.Popen([sys.executable, *args], cwd=ROOT, env=env, stdout=log, stderr=log, start_new_session=True)
    try:
        return child.wait(timeout=max(timeout, 1))
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        raise TimeoutError("timeout")


def verify_delivery(directory: Path, estate: Path) -> dict:
    gate = runpy.run_path(str(ROOT / "scripts" / "verify-judge-delivery.py"))
    return gate["verify"](directory, estate)


def publish_delivery(directory: Path, finalize: Callable[[], dict] | None = None, *, provisional_launch: dict | None = None) -> dict | None:
    """Validate a private candidate before any full report becomes downloadable."""
    from labs.delivery import build_delivery, read_inputs
    inputs = read_inputs(directory)
    engine = json.loads(inputs["engine/run_log.json"])
    canonical = engine.get("structure_report", {}).get("validator_estate")
    estate = directory / "engine" / canonical if canonical else Path(engine["estate_path"])
    with tempfile.TemporaryDirectory(prefix=".delivery-candidate-", dir=directory) as temp:
        candidate = Path(temp)
        for name, content in inputs.items():
            target = candidate / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            target.chmod(0o600)
        if provisional_launch is not None:
            # The private draft can use terminal agent results while the public
            # supervisor remains running until its report has passed the gate.
            save(candidate / "launch.json", provisional_launch)
        build_delivery(candidate)
        validation = verify_delivery(candidate, estate)
        if validation.get("status") != "passed":
            raise ValueError("The official delivery gate did not pass")
        final_launch = None
        if finalize is not None:
            # Measure through actual report preparation and validation, then seal
            # that measurement into the reproducible artifact. Final metric
            # serialization/sealing is outside the measured interval.
            final_launch = finalize()
            save(candidate / "launch.json", final_launch)
            build_delivery(candidate)
            validation = verify_delivery(candidate, estate)
            if validation.get("status") != "passed":
                raise ValueError("The sealed delivery did not pass validation")
        destination = directory / "delivery"
        destination.mkdir(exist_ok=True, mode=0o700)
        if destination.is_symlink():
            raise ValueError("Delivery must remain inside this investigation")
        for name in ("case_file.html", "manifest.json"):
            (candidate / "delivery" / name).replace(destination / name)
        save(destination / "validation.json", validation)
        if final_launch is not None:
            save(directory / "launch.json", final_launch)
        return final_launch


def main() -> None:
    run_id = str(UUID(sys.argv[1]))
    directory = ROOT / "data" / "labs" / "runs" / run_id
    launch_path = directory / "launch.json"
    launch = json.loads(launch_path.read_text())
    launch["status"] = "running"
    save(launch_path, launch)
    started = time.monotonic()
    # Include dispatch/queue preparation already elapsed before this process.
    # Continue with a monotonic clock so wall-clock corrections cannot change it.
    try:
        dispatch_start = datetime.fromisoformat(launch["started_at"].replace("Z", "+00:00"))
        preparation_ms = max(0, (datetime.now(timezone.utc) - dispatch_start).total_seconds() * 1000)
    except (KeyError, ValueError, TypeError):
        preparation_ms = 0
        launch["started_at"] = now()
    engine_spans = []
    try:
        configuration = json.loads((directory / "worker.json").read_text())
        with (directory / "worker.log").open("w") as log:
            engine = configuration.get("engine")
            if engine:
                launch["phase"] = "engine"
                save(launch_path, launch)
                span = {"span_id": f"{run_id}:engine", "actor": "deterministic", "step": "engine.run", "status": "running", "ts_start": now(), "input_ref": "conjunto de datos", "output_ref": "engine/run_log.json", "rationale": "Aplicar el motor al conjunto completo antes de entregar el resultado a A y B.", "tokens_in": 0, "tokens_out": 0}
                engine_spans.append(span)
                save(directory / "engine_trace.json", engine_spans)
                code = execute(["-m", "auditor", "run", "--estate", engine["estate"], "--seed", str(engine["seed"]), "--out", engine["output"], "--llm", "off"], log, 5 * 60, engine=True)
                span.update(ts_end=now(), duration_ms=round((time.monotonic() - started) * 1000), status="running" if code == 0 else "failed")
                if code != 0:
                    raise RuntimeError("engine_failed")
                # No agent starts until the actual motor artifact exists and can be decoded.
                result = json.loads((Path(engine["output"]) / "run_log.json").read_text())
                if not isinstance(result.get("findings"), list):
                    raise RuntimeError("invalid_engine_output")
                span["status"] = "completed"
                span["findings_count"] = len(result["findings"])
                save(directory / "engine_trace.json", engine_spans)
            launch["phase"] = "agents"
            save(launch_path, launch)
            code = execute(configuration["args"], log, 30 * 60 - (time.monotonic() - started))
        summary_path = directory / "summary.json"
        summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
        terminal = summary.get("status")
        if code != 0 or terminal not in {"completed", "partial"}:
            launch["status"] = "failed"
            launch["error"] = "La investigación no se completó. Revisa los eventos persistidos y la conexión de Codex."
        else:
            launch["status"] = terminal
    except TimeoutError:
        launch["status"] = "failed"
        launch["error"] = "La ejecución alcanzó su límite de tiempo. Los resultados de las etapas completadas siguen disponibles."
    except Exception:
        launch["status"] = "failed"
        launch["error"] = "El motor no pudo completar el análisis de los datos." if launch.get("phase") == "engine" else "El proceso se interrumpió. Comprueba Python y las dependencias del servidor."
    if engine_spans and engine_spans[-1].get("status") == "running":
        engine_spans[-1].update(status="failed", ts_end=now(), duration_ms=round((time.monotonic() - started) * 1000))
    if engine_spans:
        save(directory / "engine_trace.json", engine_spans)
    terminal_status = launch["status"]

    def finish(*, report: bool = False) -> dict:
        result = dict(launch, status=terminal_status, completed_at=now(),
                      total_duration_ms=round(preparation_ms + (time.monotonic() - started) * 1000))
        if report:
            result.update(timing_scope="through_report", report_completed_at=result["completed_at"])
        return result

    if (directory / "engine" / "case_file.html").exists() and (directory / "summary.json").exists():
        try:
            launch.update(status="running", phase="report")
            save(launch_path, launch)
            if str(ROOT) not in sys.path:
                sys.path.insert(0, str(ROOT))
            publish_delivery(directory, lambda: finish(report=True), provisional_launch=finish())
            return
        except Exception:
            # An export failure must not destroy completed investigation artifacts.
            launch["error"] = "The full report did not pass delivery validation. Saved investigation results remain available."
            (directory / "delivery_error.txt").write_text(launch["error"])
    save(launch_path, finish())


if __name__ == "__main__":
    main()
