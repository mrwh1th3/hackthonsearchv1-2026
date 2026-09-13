"""Pruebas de la entrega en disco: re-ejecutar no cambia submission.json y executions.jsonl deja la prueba.

    python3 -m unittest discover -s tests/auditor -v
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _estate import ROOT  # noqa: E402

from auditor.casefile import trail_svg  # noqa: E402
from auditor.llm import LLM  # noqa: E402
from auditor.pipeline import run, write_outputs  # noqa: E402

PY = sys.executable
DELIVERABLE = ("submission.json", "run_log.json", "case_file.html")


def executions(out: Path) -> list[dict]:
    return [json.loads(x) for x in (out / "executions.jsonl").read_text().splitlines()]


class RerunTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = Path(cls.tmp.name) / "estate.db"
        subprocess.run([PY, "generator/forensic/estate.py", "--seed", "7", "--out", str(cls.db), "--key",
                        str(Path(cls.tmp.name) / "key.json")], cwd=ROOT, check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.out = Path(tempfile.mkdtemp(dir=self.tmp.name))

    def audit(self, seed: int = 7, clock: float | None = None) -> dict:
        r = run(str(self.db), seed, LLM("off"), str(self.out))
        if clock is not None:
            r["run_metadata"]["wall_clock_seconds"] = clock   # otra medición de la misma corrida
        return write_outputs(r, str(self.out))

    def snapshot(self) -> dict:
        return {n: ((self.out / n).read_bytes(), (self.out / n).stat().st_mtime_ns) for n in DELIVERABLE}

    def test_same_folder_keeps_every_byte_and_logs_the_real_time(self):
        self.audit(clock=1.25)
        first = self.snapshot()
        paths = self.audit(clock=9.75)
        self.assertEqual(self.snapshot(), first)       # mismos bytes y ni siquiera se reescribieron
        sub = json.loads((self.out / "submission.json").read_text())
        self.assertEqual(sub["run_metadata"]["wall_clock_seconds"], 1.25)
        log = executions(self.out)
        self.assertEqual([x["submission"] for x in log], ["new", "unchanged"])
        self.assertEqual(log[1]["wall_clock_seconds_measured"], 9.75)
        self.assertEqual(log[1]["wall_clock_seconds_reported"], 1.25)
        self.assertEqual(log[0]["fingerprint"], log[1]["fingerprint"])
        self.assertEqual(paths["executions"], str(self.out / "executions.jsonl"))

    def test_a_different_result_is_written_and_marked(self):
        self.audit(seed=7, clock=1.25)
        self.audit(seed=8, clock=2.5)
        sub = json.loads((self.out / "submission.json").read_text())
        self.assertEqual((sub["seed"], sub["run_metadata"]["wall_clock_seconds"]), (8, 2.5))
        self.assertEqual([x["submission"] for x in executions(self.out)], ["new", "replaced"])

    def test_unreadable_previous_submission_is_replaced(self):
        (self.out / "submission.json").write_text("{ no es json")
        self.audit(clock=3.0)
        self.assertEqual(json.loads((self.out / "submission.json").read_text())["run_metadata"]["wall_clock_seconds"], 3.0)
        self.assertEqual(executions(self.out)[-1]["submission"], "replaced")

    def test_cli_twice_into_same_folder_is_byte_identical_and_validates(self):
        env = dict(os.environ, PYTHONPATH=str(ROOT / "src"))
        cmd = [PY, "-m", "auditor", "run", "--estate", str(self.db), "--seed", "7", "--out", str(self.out)]
        subprocess.run(cmd, cwd=ROOT, env=env, check=True, capture_output=True)
        first = {n: (self.out / n).read_bytes() for n in DELIVERABLE}
        second = subprocess.run(cmd, cwd=ROOT, env=env, check=True, capture_output=True, text=True)
        self.assertEqual({n: (self.out / n).read_bytes() for n in DELIVERABLE}, first)
        self.assertEqual(executions(self.out)[-1]["submission"], "unchanged")
        self.assertIn("fingerprint=", second.stdout)
        v = subprocess.run([PY, "spec/forensic-auditor/validate_format.py", "--submission", str(self.out / "submission.json"),
                            "--estate", str(self.db)], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(v.returncode, 0, v.stdout)


class TrailDiagramTest(unittest.TestCase):
    """El diagrama del rastro del dinero dibuja tramos, no una fila por movimiento."""

    def test_repeated_payments_to_one_payee_are_one_arrow_citing_every_exhibit(self):
        pays = [{"from": "COMPANY", "to": "RFC:AAA010101AA1", "amount": 100.0 + i, "date": f"2026-0{i + 1}-15",
                 "exhibit_id": f"EX-{i + 1:02d}"} for i in range(3)]
        kick = {"from": "RFC:AAA010101AA1", "to": "EMP:0003", "amount": 30.0, "date": "2026-04-01", "exhibit_id": "EX-09"}
        svg = trail_svg(pays + [kick], {"COMPANY": "Audited company"})
        self.assertEqual(svg.count("marker-end="), 2)                      # dos tramos, conectados
        self.assertIn("3 movements · MXN 303.00", svg)
        self.assertIn("2026-01-15 to 2026-03-15 · EX-01 … EX-03", svg)
        self.assertIn("<title>EX-01, EX-02, EX-03</title>", svg)
        self.assertIn("MXN 30.00 · 2026-04-01", svg)
        many = trail_svg(pays * 80, {})
        self.assertEqual(many.count("marker-end="), 1)
        self.assertLess(int(many.split('height="')[1].split('"')[0]), 200)  # antes: una fila por pago


if __name__ == "__main__":
    unittest.main()
