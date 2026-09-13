"""Unified supervisor integration gates without starting Codex or external services."""
from __future__ import annotations

import importlib.util
import json
import signal
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

from labs import provider

WORKER_PATH = Path(__file__).resolve().parents[2] / "web" / "lib" / "laboratorio" / "worker.py"
spec = importlib.util.spec_from_file_location("forense_test_web_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class UnifiedWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.run_id = str(uuid.uuid4())
        self.directory = self.root / "data" / "labs" / "runs" / self.run_id
        self.directory.mkdir(parents=True)
        self.launch_path = self.directory / "launch.json"
        self.launch_path.write_text(json.dumps({"run_id": self.run_id, "status": "queued"}))
        self.engine_output = self.directory / "engine"
        self.engine_output.mkdir()
        self.args = ["-m", "labs.runner", "run", "--engine-output", str(self.engine_output / "run_log.json"),
                     "--giro", "construccion", "--out", str(self.directory.parent), "--run-id", self.run_id,
                     "--provider", "mock"]
        self.configuration = {"engine": {"estate": str(self.root / "estate.db"), "seed": 42,
                                         "output": str(self.engine_output)}, "args": self.args}
        self.save_configuration()

    def tearDown(self):
        self.temp.cleanup()

    def save_configuration(self):
        (self.directory / "worker.json").write_text(json.dumps(self.configuration))

    def invoke(self, execute):
        with patch.object(worker, "ROOT", self.root), patch.object(worker.sys, "argv", ["worker.py", self.run_id]), \
             patch.object(worker, "execute", side_effect=execute) as calls:
            worker.main()
        return json.loads(self.launch_path.read_text()), calls

    def test_motor_completes_and_artifact_is_read_before_agents_start(self):
        observed = []

        def execute(args, log, timeout, *, engine=False):
            phase = json.loads(self.launch_path.read_text())["phase"]
            observed.append((engine, phase))
            if engine:
                self.assertEqual(args[:3], ["-m", "auditor", "run"])
                self.assertEqual(args[-2:], ["--llm", "off"])
                self.assertEqual(args[args.index("--estate") + 1], self.configuration["engine"]["estate"])
                self.assertEqual(timeout, 5 * 60)
                (self.engine_output / "run_log.json").write_text('{"findings": [{"scheme_type":"phantom_vendor"}]}')
            else:
                self.assertEqual(args, self.args)
                engine_trace = json.loads((self.directory / "engine_trace.json").read_text())
                self.assertEqual(engine_trace[0]["status"], "completed")
                self.assertEqual(engine_trace[0]["findings_count"], 1)
                self.assertLessEqual(timeout, 30 * 60)
                (self.directory / "summary.json").write_text('{"status":"completed"}')
            return 0

        launch, calls = self.invoke(execute)
        self.assertEqual(observed, [(True, "engine"), (False, "agents")])
        self.assertEqual(calls.call_count, 2)
        self.assertEqual(launch["status"], "completed")
        self.assertIn("completed_at", launch)

    def test_motor_nonzero_never_starts_agents(self):
        launch, calls = self.invoke(lambda *args, **kwargs: 2)
        self.assertEqual(calls.call_count, 1)
        self.assertEqual(launch["status"], "failed")
        trace = json.loads((self.directory / "engine_trace.json").read_text())
        self.assertEqual(trace[0]["status"], "failed")
        self.assertFalse((self.directory / "summary.json").exists())

    def test_exit_zero_without_valid_motor_artifact_is_failed_stage(self):
        for content in (None, "not-json", '{"findings":"wrong type"}', "[]"):
            with self.subTest(content=content):
                path = self.engine_output / "run_log.json"
                if path.exists():
                    path.unlink()
                if content is not None:
                    path.write_text(content)
                self.launch_path.write_text(json.dumps({"run_id": self.run_id, "status": "queued"}))
                launch, calls = self.invoke(lambda *args, **kwargs: 0)
                self.assertEqual(calls.call_count, 1)
                self.assertEqual(launch["status"], "failed")
                trace = json.loads((self.directory / "engine_trace.json").read_text())
                self.assertEqual(trace[0]["status"], "failed", "An unreadable artifact cannot be displayed as a completed motor stage")

    def test_motor_timeout_persists_failure_and_skips_agents(self):
        def timeout(*args, **kwargs):
            raise TimeoutError("timeout")

        launch, calls = self.invoke(timeout)
        self.assertEqual(calls.call_count, 1)
        self.assertEqual(launch["status"], "failed")
        self.assertIn("tiempo", launch["error"])
        trace = json.loads((self.directory / "engine_trace.json").read_text())
        self.assertEqual(trace[0]["status"], "failed")
        self.assertIn("ts_end", trace[0])

    def test_existing_engine_snapshot_skips_motor_and_preserves_partial_result(self):
        self.configuration.pop("engine")
        self.save_configuration()

        def execute(args, log, timeout, *, engine=False):
            self.assertFalse(engine)
            self.assertEqual(args, self.args)
            (self.directory / "summary.json").write_text('{"status":"partial"}')
            return 0

        launch, calls = self.invoke(execute)
        self.assertEqual(calls.call_count, 1)
        self.assertEqual(launch["status"], "partial")
        self.assertFalse((self.directory / "engine_trace.json").exists())

    def test_agent_exit_zero_without_terminal_summary_is_failure(self):
        self.configuration.pop("engine")
        self.save_configuration()
        for result in (None, "running", "failed"):
            with self.subTest(result=result):
                summary = self.directory / "summary.json"
                if summary.exists():
                    summary.unlink()
                if result:
                    summary.write_text(json.dumps({"status": result}))
                launch, calls = self.invoke(lambda *args, **kwargs: 0)
                self.assertEqual(calls.call_count, 1)
                self.assertEqual(launch["status"], "failed")

    def test_execute_uses_process_group_and_escalates_timeout(self):
        child = MagicMock(pid=424242)
        child.wait.side_effect = [subprocess.TimeoutExpired("worker", 1), subprocess.TimeoutExpired("worker", 5), 0]
        with patch.object(worker, "ROOT", self.root), patch.object(worker.subprocess, "Popen", return_value=child) as popen, \
             patch.object(worker.os, "killpg") as kill:
            with self.assertRaises(TimeoutError):
                worker.execute(["-m", "auditor", "run"], MagicMock(), 1, engine=True)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertEqual(popen.call_args.kwargs["env"]["PYTHONPATH"], str(self.root / "src"))
        self.assertEqual([call.args for call in kill.call_args_list], [(424242, signal.SIGTERM), (424242, signal.SIGKILL)])

    def test_codex_timeout_kills_group_and_preserves_recorded_usage(self):
        event = json.dumps({"type":"turn.completed", "usage":{"input_tokens":71,"output_tokens":19}})
        child = MagicMock(pid=434343, returncode=1)
        child.communicate.side_effect = [subprocess.TimeoutExpired("codex", 10), subprocess.TimeoutExpired("codex", 5), (event, "sensitive stderr")]
        with patch.object(provider, "codex_binary", return_value="/fake/codex"), \
             patch.object(provider.subprocess, "Popen", return_value=child), patch.object(provider.os, "killpg") as kill:
            with self.assertRaises(provider.ProviderError) as caught:
                provider.CodexProvider(timeout=10).call("agent_a", "Bounded evidence", {"type":"object","properties":{}})
        self.assertEqual([call.args for call in kill.call_args_list], [(434343, signal.SIGTERM), (434343, signal.SIGKILL)])
        self.assertNotIn(434343, provider._ACTIVE_PROCESS_GROUPS)
        self.assertEqual(caught.exception.events[0]["usage"]["input_tokens"], 71)
        self.assertNotIn("sensitive", str(caught.exception))

    def test_supervisor_shutdown_terminates_every_isolated_codex_group(self):
        with patch.object(provider, "_ACTIVE_PROCESS_GROUPS", {444444, 454545}), \
             patch.object(provider.os, "killpg") as kill, patch.object(provider.time, "sleep") as sleep:
            provider.terminate_active_calls()
        observed = [call.args for call in kill.call_args_list]
        self.assertEqual(set(observed[:2]), {(444444, signal.SIGTERM), (454545, signal.SIGTERM)})
        self.assertEqual(set(observed[2:]), {(444444, signal.SIGKILL), (454545, signal.SIGKILL)})
        sleep.assert_called_once_with(.25)

    def test_full_report_is_not_published_before_official_gate_passes(self):
        def build(candidate):
            output = candidate / "delivery"
            output.mkdir()
            (output / "case_file.html").write_text("validated paper")
            (output / "manifest.json").write_text("{}")

        def validate(candidate, estate):
            self.assertTrue((candidate / "delivery" / "case_file.html").exists())
            self.assertFalse((self.directory / "delivery" / "case_file.html").exists())
            self.assertEqual(estate, self.directory / "engine" / "validator_estate.db")
            return {"status": "passed", "offline_replay_verified": True}

        with patch("labs.delivery.read_inputs", return_value={"engine/run_log.json": b'{"structure_report":{"validator_estate":"validator_estate.db"}}'}), \
             patch("labs.delivery.build_delivery", side_effect=build), \
             patch.object(worker, "verify_delivery", side_effect=validate):
            worker.publish_delivery(self.directory)
        self.assertEqual((self.directory / "delivery" / "case_file.html").read_text(), "validated paper")
        self.assertEqual(json.loads((self.directory / "delivery" / "validation.json").read_text())["status"], "passed")
        self.assertEqual(list(self.directory.glob(".delivery-candidate-*")), [])

    def test_failed_delivery_gate_preserves_previous_report_and_engine(self):
        destination = self.directory / "delivery"
        destination.mkdir()
        (destination / "case_file.html").write_text("previous verified report")
        (self.engine_output / "run_log.json").write_text("original engine evidence")
        with patch("labs.delivery.read_inputs", return_value={"engine/run_log.json": b'{"estate_path":"/saved/estate.db"}'}), \
             patch("labs.delivery.build_delivery"), \
             patch.object(worker, "verify_delivery", side_effect=ValueError("invalid exhibit")):
            with self.assertRaises(ValueError):
                worker.publish_delivery(self.directory)
        self.assertEqual((destination / "case_file.html").read_text(), "previous verified report")
        self.assertEqual((self.engine_output / "run_log.json").read_text(), "original engine evidence")
        self.assertFalse((destination / "validation.json").exists())
        self.assertEqual(list(self.directory.glob(".delivery-candidate-*")), [])

    def test_completion_is_measured_after_report_validation_and_sealed_into_export(self):
        events = []
        final_launch = {"status": "completed", "timing_scope": "through_report", "total_duration_ms": 12500}

        def build(candidate):
            events.append("build")
            output = candidate / "delivery"
            output.mkdir(exist_ok=True)
            (output / "case_file.html").write_text((candidate / "launch.json").read_text())
            (output / "manifest.json").write_text("{}")

        def validate(candidate, estate):
            events.append("validate")
            self.assertFalse((self.directory / "delivery").exists())
            return {"status": "passed"}

        def finish():
            events.append("finish")
            self.assertEqual(events, ["build", "validate", "finish"])
            return final_launch

        with patch("labs.delivery.read_inputs", return_value={"launch.json": b'{"status":"running","phase":"report"}', "engine/run_log.json": b'{"estate_path":"/saved/estate.db"}'}), \
             patch("labs.delivery.build_delivery", side_effect=build), patch.object(worker, "verify_delivery", side_effect=validate):
            worker.publish_delivery(self.directory, finish)
        self.assertEqual(events, ["build", "validate", "finish", "build", "validate"])
        self.assertEqual(json.loads(self.launch_path.read_text()), final_launch)
        self.assertEqual(json.loads((self.directory / "delivery" / "case_file.html").read_text()), final_launch)

    def test_sealed_gate_failure_never_exposes_final_timing_or_replaces_previous_report(self):
        destination = self.directory / "delivery"
        destination.mkdir()
        (destination / "case_file.html").write_text("previous report")
        before = self.launch_path.read_bytes()
        with patch("labs.delivery.read_inputs", return_value={"launch.json": before, "engine/run_log.json": b'{"estate_path":"/saved/estate.db"}'}), \
             patch("labs.delivery.build_delivery"), \
             patch.object(worker, "verify_delivery", side_effect=[{"status": "passed"}, {"status": "failed"}]):
            with self.assertRaises(ValueError):
                worker.publish_delivery(self.directory, lambda: {"total_duration_ms": 999, "timing_scope": "through_report"})
        self.assertEqual(self.launch_path.read_bytes(), before)
        self.assertEqual((destination / "case_file.html").read_text(), "previous report")

    def test_worker_remains_running_during_report_and_counts_report_preparation(self):
        self.configuration.pop("engine")
        self.save_configuration()
        (self.engine_output / "case_file.html").write_text("engine report")
        ticks = [10.0]

        def execute(*args, **kwargs):
            ticks[0] += 2
            (self.directory / "summary.json").write_text('{"status":"completed"}')
            return 0

        def publish(directory, finalize, *, provisional_launch):
            current = json.loads(self.launch_path.read_text())
            self.assertEqual((current["status"], current["phase"]), ("running", "report"))
            self.assertNotIn("completed_at", current)
            self.assertEqual(provisional_launch["status"], "completed")
            self.assertNotIn("timing_scope", provisional_launch)
            ticks[0] += 3
            final = finalize()
            worker.save(self.launch_path, final)
            return final

        with patch.object(worker.time, "monotonic", side_effect=lambda: ticks[0]), patch.object(worker, "publish_delivery", side_effect=publish):
            launch, _ = self.invoke(execute)
        self.assertEqual(launch["status"], "completed")
        self.assertEqual(launch["total_duration_ms"], 5000)
        self.assertEqual(launch["timing_scope"], "through_report")
        self.assertEqual(launch["report_completed_at"], launch["completed_at"])

    def test_worker_exposes_delivery_failure_without_discarding_saved_results(self):
        self.configuration.pop("engine")
        self.save_configuration()
        (self.engine_output / "case_file.html").write_text("saved engine evidence")

        def execute(*args, **kwargs):
            (self.directory / "summary.json").write_text('{"status":"partial"}')
            return 0

        with patch.object(worker, "publish_delivery", side_effect=ValueError("gate failed")):
            launch, _ = self.invoke(execute)
        self.assertEqual(launch["status"], "partial")
        self.assertIn("delivery validation", launch["error"])
        self.assertNotIn("timing_scope", launch)
        self.assertEqual((self.engine_output / "case_file.html").read_text(), "saved engine evidence")


if __name__ == "__main__":
    unittest.main()
