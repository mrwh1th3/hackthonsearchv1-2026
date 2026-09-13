"""Judge-facing paths preserve evidence without presenting parallel payments as a chain."""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from runpy import run_path
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _estate import Builder, CO_CLABE, ROOT  # noqa: E402

from auditor.casefile import render_html  # noqa: E402
from auditor.estate import Estate  # noqa: E402
from auditor.llm import LLM  # noqa: E402
from auditor.pipeline import run, to_submission  # noqa: E402
from auditor.trails import representative_trail, split_connected_trails  # noqa: E402
from auditor.validate import validate_finding  # noqa: E402


def step(frm: str, to: str, number: int) -> dict:
    return {"from": frm, "to": to, "amount": 100.0 + number,
            "date": f"2026-01-{number:02d}", "exhibit_id": f"EX-{number:02d}"}


class ConnectedTrailTest(unittest.TestCase):
    def assert_connected(self, paths: list[list[dict]]) -> None:
        for path in paths:
            self.assertTrue(path)
            self.assertTrue(all(a["to"] == b["from"] for a, b in zip(path, path[1:])))

    def test_parallel_payments_remain_separate_and_no_edge_is_invented(self):
        original = [step("COMPANY", "RFC:VENDOR", n) for n in range(1, 5)]
        before = deepcopy(original)
        paths = split_connected_trails(original)
        self.assertEqual(paths, [[s] for s in original])
        self.assertEqual([s for path in paths for s in path], before)
        self.assertEqual(original, before)
        self.assert_connected(paths)

    def test_three_hop_cycle_remains_one_connected_path(self):
        cycle = [step("COMPANY", "RFC:VENDOR", 1), step("RFC:VENDOR", "RFC:MIDDLE", 2),
                 step("RFC:MIDDLE", "COMPANY", 3)]
        self.assertEqual(split_connected_trails(cycle), [cycle])
        self.assertEqual(representative_trail(cycle), cycle)
        self.assert_connected(split_connected_trails(cycle))

    def test_disconnected_chains_preserve_order_and_choose_first_longest(self):
        first = [step("COMPANY", "RFC:A", 1), step("RFC:A", "EMP:1", 2)]
        second = [step("COMPANY", "RFC:B", 3), step("RFC:B", "EMP:2", 4)]
        original = first + second + [step("COMPANY", "RFC:C", 5)]
        paths = split_connected_trails(original)
        self.assertEqual(paths, [first, second, [original[-1]]])
        self.assertEqual(representative_trail(original), first)
        self.assertEqual([s for path in paths for s in path], original)
        self.assert_connected(paths)

    def test_duplicate_steps_are_preserved_and_empty_trail_stays_empty(self):
        payment = step("COMPANY", "RFC:VENDOR", 1)
        self.assertEqual(split_connected_trails([payment, deepcopy(payment)]), [[payment], [payment]])
        self.assertEqual(split_connected_trails([]), [])
        self.assertEqual(representative_trail([]), [])


class ClockIndependentEstateTest(unittest.TestCase):
    def read_without_clock(self, configure=None):
        class NoWallClock(date):
            @classmethod
            def today(cls):
                raise AssertionError("Estate horizon must come from data, never today's date")

        with tempfile.TemporaryDirectory() as tmp:
            b = Builder(Path(tmp) / "estate.db")
            for rows in b.rows.values():
                rows.clear()
            if configure is not None:
                configure(b)
            with patch("auditor.estate.date", NoWallClock):
                estate = Estate(b.write())
                try:
                    return estate.bank_horizon, estate.period
                finally:
                    estate.conn.close()

    def test_empty_estate_uses_documented_sentinel_without_reading_clock(self):
        self.assertEqual(self.read_without_clock(), (date(1970, 1, 1), (None, None)))

    def test_ledger_only_estate_uses_latest_structured_date_before_sentinel(self):
        def rows(b):
            b.ledger("2025-11-07", "5000", 100, 0, None, "EMP:0001")
            b.ledger("2025-12-08", "5000", 100, 0, None, "EMP:0001")

        self.assertEqual(self.read_without_clock(rows), (date(2025, 12, 8), (None, None)))


class JudgeExportTest(unittest.TestCase):
    """Five bounded known fixture patterns; no ground truth or network/model access."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.cases = {}
        for scheme in ("phantom_vendor", "kickback", "round_tripping", "threshold_splitting", "revenue_inflation"):
            path = Path(cls.tmp.name) / f"{scheme}.db"
            b = Builder(path, po_base="subtotal", person="emp_id")
            if scheme == "phantom_vendor":
                v = b.vendor("PHA010101AB1", registered="2024-01-01")
                for d, amt in (("2026-01-10", 150_000), ("2026-02-11", 180_000), ("2026-03-12", 120_000)):
                    b.purchase(v, amt, d, po=False)
                b.efos(v["rfc"], "presunto", "2026-06-01")
                entity = "RFC:PHA010101AB1"
            elif scheme == "kickback":
                v = b.vendor("KIK010101AB1")
                mgr = b.emps[1]
                for m in range(1, 4):
                    b.purchase(v, 150_000, f"2026-0{m}-05", approver=mgr)
                    b.txn(f"2026-0{m}-09", v["clabe"], mgr[3], 9_000 + m, "Transferencia personal")
                entity = "RFC:KIK010101AB1"
            elif scheme == "round_tripping":
                v, mid = b.vendor("RTA010101AB1"), b.vendor("RTB010101AB1")
                b.purchase(mid, 30_000, "2026-01-20")
                b.purchase(v, 500_000, "2026-02-01")
                b.txn("2026-02-05", v["clabe"], mid["clabe"], 487_500, "x")
                b.txn("2026-03-01", mid["clabe"], CO_CLABE, 475_300, "y")
                entity = "RFC:RTA010101AB1"
            elif scheme == "threshold_splitting":
                v = b.vendor("SPL010101AB1")
                for k, (d, sub) in enumerate((("2026-03-02", 46_900), ("2026-03-04", 48_200), ("2026-03-07", 47_500))):
                    b.purchase(v, round(sub * 1.16, 2), d, approver=b.emps[k], requester=b.emps[3])
                big = b.vendor("BIG010101AB1")
                for k in range(3):
                    b.purchase(big, 120_000, f"2026-04-1{k}", approver=b.emps[k])
                entity = "RFC:SPL010101AB1"
            else:
                b.sale("CUS010101AB1", 495_000, "2025-10-23")
                b.sale("CUS010101AB1", 284_000, "2025-11-26")
                b.txn("2026-06-30", CO_CLABE, "002000000000000001", 1, "horizonte")
                entity = "RFC:CUS010101AB1"
            b.write()
            result = run(str(path), 1, LLM("off"))
            finding = next((f for f in result["findings"] if f["scheme_type"] == scheme and entity in f["entities"]), None)
            if finding is None:
                raise AssertionError(f"Known {scheme} fixture was rejected: {result['leads']}")
            cls.cases[scheme] = (path, result, finding)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_all_five_schemes_export_connected_paths_without_losing_money_or_evidence(self):
        for scheme, (_, result, finding) in self.cases.items():
            with self.subTest(scheme=scheme):
                before = deepcopy(result)
                exported = next(f for f in to_submission(result)["findings"]
                                if f["scheme_type"] == scheme and f["entities"] == finding["entities"])
                paths = exported["money_trails"]
                self.assertTrue(paths)
                self.assertEqual([s for path in paths for s in path], finding["money_trail"])
                self.assertTrue(all(path and all(a["to"] == b["from"] for a, b in zip(path, path[1:])) for path in paths))
                self.assertEqual(exported["money_trail"], max(paths, key=len))
                self.assertEqual(exported["peso_amount"], finding["peso_amount"])
                self.assertEqual(exported["exhibits"], finding["exhibits"])
                self.assertEqual(exported["entities"], finding["entities"])
                self.assertEqual(exported["confidence"], finding["confidence"])
                self.assertEqual(result, before, "Export must not rewrite the motor's run log")

    def test_all_five_schemes_keep_backed_entities_and_reconcile(self):
        for scheme, (path, _, finding) in self.cases.items():
            with self.subTest(scheme=scheme):
                estate = Estate(str(path))
                try:
                    self.assertEqual(validate_finding(estate, deepcopy(finding)), [])
                finally:
                    estate.conn.close()
        self.assertIn("RFC:RTB010101AB1", self.cases["round_tripping"][2]["entities"])
        self.assertIn("EMP:0002", self.cases["kickback"][2]["entities"])

    def test_exports_still_pass_official_structure_and_estate_validation(self):
        official = run_path(str(ROOT / "spec/forensic-auditor/validate_format.py"))
        for scheme, (path, result, _) in self.cases.items():
            with self.subTest(scheme=scheme):
                submission = to_submission(result)
                self.assertEqual(official["validate_structure"](submission), [])
                self.assertEqual(official["validate_against_estate"](submission, str(path)), [])

    def test_note_text_cannot_back_an_invented_entity(self):
        path, _, original = self.cases["phantom_vendor"]
        finding = deepcopy(original)
        invented = "RFC:UNRELATED999"
        finding["entities"].append(invented)
        finding["exhibits"][0]["note"] += f" Mention of {invented}."
        estate = Estate(str(path))
        try:
            errors = validate_finding(estate, finding)
            self.assertTrue(any(invented in error for error in errors), errors)
        finally:
            estate.conn.close()

    def test_existing_uncited_employee_is_not_part_of_the_finding(self):
        path, _, original = self.cases["phantom_vendor"]
        finding = deepcopy(original)
        finding["entities"].append("EMP:0005")
        estate = Estate(str(path))
        try:
            self.assertIsNotNone(estate.person("EMP:0005"))
            errors = validate_finding(estate, finding)
            self.assertTrue(any("EMP:0005" in error for error in errors), errors)
        finally:
            estate.conn.close()

    def test_shared_bank_prefix_does_not_back_another_employee(self):
        path, _, original = self.cases["kickback"]
        finding = deepcopy(original)
        finding["entities"].append("EMP:0005")
        estate = Estate(str(path))
        try:
            backed = estate.person("EMP:0002")["bank_clabe"]
            other = estate.person("EMP:0005")["bank_clabe"]
            self.assertEqual(backed[:3], other[:3])
            self.assertNotEqual(backed, other)
            errors = validate_finding(estate, finding)
            self.assertTrue(any("EMP:0005" in error for error in errors), errors)
        finally:
            estate.conn.close()

    def test_casefile_discloses_missing_name_and_possible_shared_exposure(self):
        result = deepcopy(self.cases["phantom_vendor"][1])
        html = render_html(result)
        self.assertIn("Name not supplied", html)
        self.assertIn("Amounts may overlap across findings", html)
        result["company_name"] = '<script>alert("name")</script> & Company'
        html = render_html(result)
        self.assertIn("&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt; &amp; Company", html)
        self.assertNotIn('<script>alert("name")</script>', html)


if __name__ == "__main__":
    unittest.main()
