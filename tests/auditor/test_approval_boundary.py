"""Signing at an approval limit is not evidence of authority above that limit."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _estate import Builder  # noqa: E402

from auditor.llm import LLM  # noqa: E402
from auditor.pipeline import run  # noqa: E402


class ApprovalBoundaryTest(unittest.TestCase):
    def audit(self, history_amount: float) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            b = Builder(Path(tmp) / "estate.db", po_base="total", person="emp_id")
            approver = b.emps[1]
            split = b.vendor("SPL010101AB1")
            history = b.vendor("HIS010101AB1")
            # All three qualify for 50,000; none qualify for the next inferred 55,000.
            # This keeps another candidate threshold from hiding the equality bug.
            for date, amount in (("2026-03-02", 46_000), ("2026-03-05", 46_500), ("2026-03-10", 46_700)):
                b.purchase(split, amount, date, approver=approver)
            for date in ("2026-01-02", "2026-02-02", "2026-04-02"):
                b.purchase(history, history_amount, date, approver=approver)
            return run(b.write(), 1, LLM("off"))

    @staticmethod
    def findings(result: dict) -> list[dict]:
        return [f for f in result["findings"] if f["scheme_type"] == "threshold_splitting"
                and "RFC:SPL010101AB1" in f["entities"]]

    def test_orders_exactly_at_limit_do_not_exculpate_split_purchases(self):
        result = self.audit(50_000)
        findings = self.findings(result)
        self.assertEqual(len(findings), 1, result["leads"])
        finding = findings[0]
        self.assertEqual(finding["scoring"]["limit"], 50_000)
        self.assertEqual(finding["scoring"]["grouped_by"], "approver")
        self.assertEqual(finding["scoring"]["person"], "EMP:0002")
        self.assertEqual(finding["scoring"]["window_days"], 8)
        self.assertEqual(finding["peso_amount"], 139_200)
        self.assertEqual(finding["scoring"]["exculpated_candidates"], 0)
        self.assertEqual(result["estate_profile"]["approval_limits"]["per_approver_max_signed"]["EMP:0002"], 50_000)

    def test_orders_strictly_above_limit_still_exculpate(self):
        for history_amount in (50_000.01, 60_000):
            with self.subTest(history_amount=history_amount):
                result = self.audit(history_amount)
                self.assertEqual(self.findings(result), [])
                leads = [lead for lead in result["leads"]
                         if lead["investigated_as"] == "threshold_splitting"
                         and lead["entity"] == "RFC:SPL010101AB1"]
                self.assertEqual(len(leads), 1)
                self.assertEqual(leads[0]["closed_by"], "challenger")
                self.assertIn("approvals_by", leads[0]["tool_calls_made"])
                self.assertEqual(result["estate_profile"]["approval_limits"]["per_approver_max_signed"]["EMP:0002"],
                                 history_amount)


if __name__ == "__main__":
    unittest.main()
