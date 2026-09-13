"""Temporal association must not lose a second cycle because bank IDs sort earlier."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _estate import Builder, CO_CLABE  # noqa: E402

from auditor.estate import Estate  # noqa: E402
from auditor.llm import LLM  # noqa: E402
from auditor.pipeline import run  # noqa: E402


class TemporalCycleAssociationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def estate(self, name: str, transaction_ids: tuple[str, ...]):
        b = Builder(Path(self.tmp.name) / f"{name}.db")
        vendor, middle = b.vendor("RTA010101AB1"), b.vendor("RTB010101AB1")
        b.purchase(middle, 30_000, "2026-01-20")
        first_invoice = b.purchase(vendor, 500_000, "2026-02-08", pay=False)
        second_invoice = b.purchase(vendor, 498_000, "2026-03-28", pay=False)
        # Both possible completions fit the existing 60-day/85% constraints.
        # IDs deliberately favor borrowing the second cycle's hops for the first exit.
        events = [
            ("2026-02-08", CO_CLABE, vendor["clabe"], 500_000, f"Pago factura {first_invoice}"),
            ("2026-02-10", vendor["clabe"], middle["clabe"], 490_000, "Transferencia"),
            ("2026-02-18", middle["clabe"], CO_CLABE, 480_000, "Transferencia"),
            ("2026-03-28", CO_CLABE, vendor["clabe"], 498_000, f"Pago factura {second_invoice}"),
            ("2026-03-31", vendor["clabe"], middle["clabe"], 488_000, "Transferencia"),
            ("2026-04-09", middle["clabe"], CO_CLABE, 478_000, "Transferencia"),
        ]
        for txn_id, event in zip(transaction_ids, events):
            b.rows["bank_txns"].append((txn_id, *event, "SPEI"))
        path = b.write()
        expected = [tuple((event[0], event[1], event[2], event[3]) for event in events[:3]),
                    tuple((event[0], event[1], event[2], event[3]) for event in events[3:])]
        return path, expected

    def cycles(self, path: str):
        estate = Estate(path)
        try:
            self.assertIn(CO_CLABE, estate.company_clabes)
            return estate.cycles()
        finally:
            estate.conn.close()

    @staticmethod
    def semantics(cycles):
        return [tuple((t["date"], t["from_clabe"], t["to_clabe"], t["amount"]) for t in cycle)
                for cycle in cycles]

    def test_two_cycles_are_preserved_without_reusing_or_inventing_transfers(self):
        ids = ("start-A", "zz-hop-A", "zz-return-A", "start-B", "aa-hop-B", "aa-return-B")
        path, expected = self.estate("misleading_ids", ids)
        cycles = self.cycles(path)
        self.assertEqual(len(cycles), 2)
        self.assertEqual(self.semantics(cycles), expected)
        selected = [t["txn_id"] for cycle in cycles for t in cycle]
        self.assertEqual(len(selected), len(set(selected)))
        self.assertCountEqual(selected, ids)
        self.assertEqual([cycle[0]["amount"] for cycle in cycles], [500_000, 498_000])
        self.assertEqual(sum(cycle[0]["amount"] for cycle in cycles), 998_000)

    def test_id_permutations_preserve_semantic_edges_and_dates(self):
        permutations = [
            ("start-A", "zz-hop-A", "zz-return-A", "start-B", "aa-hop-B", "aa-return-B"),
            ("start-B", "aa-hop-B", "aa-return-B", "start-A", "zz-hop-A", "zz-return-A"),
            ("aa-return-B", "start-A", "zz-hop-A", "aa-hop-B", "zz-return-A", "start-B"),
        ]
        for number, ids in enumerate(permutations):
            with self.subTest(permutation=number):
                path, expected = self.estate(f"permutation_{number}", ids)
                self.assertEqual(self.semantics(self.cycles(path)), expected)

    def test_investigator_accounts_for_both_original_exit_invoices(self):
        ids = ("start-A", "zz-hop-A", "zz-return-A", "start-B", "aa-hop-B", "aa-return-B")
        path, _ = self.estate("finding", ids)
        result = run(path, 1, LLM("off"))
        findings = [f for f in result["findings"] if f["scheme_type"] == "round_tripping"
                    and "RFC:RTA010101AB1" in f["entities"]]
        self.assertEqual(len(findings), 1, result["leads"])
        finding = findings[0]
        self.assertEqual(finding["peso_amount"], 998_000)
        self.assertEqual(len(finding["scoring"]["cycles"]), 2)
        self.assertEqual(len(finding["money_trail"]), 6)
        self.assertEqual(sum(amount for _, amount in finding["reconciliation"]["items"]), 998_000)


if __name__ == "__main__":
    unittest.main()
