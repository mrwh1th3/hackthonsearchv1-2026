"""Pruebas del auditor adaptativo: perfilado, variantes de cada detector y exculpaciones.

    python3 -m unittest discover -s tests/auditor -v
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _estate import CO_CLABE, ROOT, Builder  # noqa: E402

from auditor.detectors import run_detectors  # noqa: E402
from auditor.estate import Estate  # noqa: E402
from auditor.llm import LLM  # noqa: E402
from auditor.pipeline import run  # noqa: E402

PY = sys.executable
EXTERNAL = ROOT.parents[2] / "data" / "external" / "seed_103" if "worktrees" in str(ROOT) else ROOT / "data" / "external" / "seed_103"


def verdicts(path: str) -> tuple[dict, dict]:
    """(hallazgos por (tipo, entidad), leads cerrados por (tipo, entidad))."""
    r = run(path, 0, LLM("off"))
    found = {(f["scheme_type"], e): f for f in r["findings"] for e in f["entities"]}
    closed = {(l["investigated_as"], l["entity"]): l for l in r["leads"]}
    return found, closed


class Tmp(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = Path(self.dir.name) / "estate.db"

    def tearDown(self):
        self.dir.cleanup()


class ProfileTest(Tmp):
    def test_po_base_subtotal_and_emp_id_and_own_account(self):
        b = Builder(self.db, po_base="subtotal", person="emp_id")
        own = "012180000000000027"
        b.txn("2026-02-01", CO_CLABE, own, 300_000, "x")
        b.txn("2026-03-01", own, CO_CLABE, 300_000, "y")
        b.txn("2026-03-05", "002999999999999999", CO_CLABE, 50_000, "cliente")   # solo entra: cliente
        e = Estate(b.write())
        p = e.profile
        self.assertEqual(p["po_amount_base"]["bases"], ["subtotal"])
        self.assertEqual(p["person_reference"]["purchase_orders.approver"]["format"], "emp_id")
        self.assertEqual(p["company_accounts"]["own_by_two_way_flow"], [own])
        self.assertNotIn("002999999999999999", e.company_clabes)
        self.assertEqual(e.person("EMP:0001")["name"], "Ana Uno")
        self.assertEqual(e.person("Ana Uno")["emp_id"], "EMP:0001")

    def test_po_base_total(self):
        e = Estate(Builder(self.db, po_base="total").write())
        self.assertEqual(e.profile["po_amount_base"]["bases"], ["total"])
        self.assertEqual(e.profile["person_reference"]["purchase_orders.approver"]["format"], "name")


class PhantomTest(Tmp):
    def _phantom(self, b, rfc="PHA010101AB1", registered="2024-01-01"):
        v = b.vendor(rfc, registered=registered)
        for d, amt in (("2026-01-10", 150_000.0), ("2026-02-11", 180_000.0), ("2026-03-12", 120_000.0)):
            b.purchase(v, amt, d, po=False)
        return v

    def test_presunto_without_documents_is_accused(self):
        b = Builder(self.db, po_base="subtotal", person="emp_id")
        self._phantom(b)
        b.efos("PHA010101AB1", "presunto", "2026-06-01")   # publicado después de todas las facturas
        found, _ = verdicts(b.write())
        f = found[("phantom_vendor", "RFC:PHA010101AB1")]
        self.assertEqual(f["confidence"], "probable")
        self.assertTrue(f["scoring"]["signals"]["efos_presunto"]["on"])
        self.assertIn("predate", " ".join(f["evidence"]))

    def test_presunto_with_contract_is_exculpated(self):
        b = Builder(self.db, po_base="subtotal")
        self._phantom(b)
        b.efos("PHA010101AB1", "presunto", "2026-06-01")
        b.contract("PHA010101AB1", "2025-12-01", 900_000)
        found, closed = verdicts(b.write())
        self.assertNotIn(("phantom_vendor", "RFC:PHA010101AB1"), found)
        reason = closed[("phantom_vendor", "RFC:PHA010101AB1")]["reason"]
        self.assertIn("contract", reason)
        self.assertIn("presunto", reason)          # el cierre dice la verdad sobre la lista 69-B

    def test_orders_on_subtotal_document_the_invoices(self):
        b = Builder(self.db, po_base="subtotal")
        v = b.vendor("DOC010101AB1", registered="2025-12-01")
        for d, amt in (("2026-01-10", 150_000.0), ("2026-02-11", 180_000.0), ("2026-03-12", 120_000.0)):
            b.purchase(v, amt, d)
        found, _ = verdicts(b.write())
        self.assertNotIn(("phantom_vendor", "RFC:DOC010101AB1"), found)

    def test_missing_paperwork_alone_is_not_an_accusation(self):
        b = Builder(self.db)
        v = b.vendor("OLD010101AB1", registered="2010-01-01")
        for d, amt in (("2026-01-10", 15_000.0), ("2026-02-11", 18_000.0)):
            b.purchase(v, amt, d, po=False)
        for d in ("2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"):
            b.purchase(v, 30_000.0, d)
        found, closed = verdicts(b.write())
        self.assertNotIn(("phantom_vendor", "RFC:OLD010101AB1"), found)
        self.assertIn("corroboration scores", closed[("phantom_vendor", "RFC:OLD010101AB1")]["reason"])


class SplittingTest(Tmp):
    def test_requester_spreads_across_approvers(self):
        b = Builder(self.db, po_base="subtotal", person="emp_id")
        v = b.vendor("SPL010101AB1", registered="2015-01-01")
        for k, (d, sub) in enumerate((("2026-03-02", 46_900.0), ("2026-03-04", 48_200.0), ("2026-03-07", 47_500.0))):
            b.purchase(v, round(sub * 1.16, 2), d, approver=b.emps[k], requester=b.emps[3])
        # los aprobadores también firman órdenes grandes: no es su propio límite lo que se evade
        big = b.vendor("BIG010101AB1", registered="2010-01-01")
        for k in range(3):
            b.purchase(big, 120_000.0, f"2026-04-1{k}", approver=b.emps[k])
        found, _ = verdicts(b.write())
        f = found[("threshold_splitting", "RFC:SPL010101AB1")]
        self.assertEqual(f["scoring"]["grouped_by"], "requester")
        self.assertEqual(f["entities"], ["RFC:SPL010101AB1"])
        # pesos = facturas con IVA
        self.assertAlmostEqual(f["peso_amount"], round(sum(round(x * 1.16, 2) for x in (46_900, 48_200, 47_500)), 2), 1)

    def test_fixed_monthly_fee_with_contract_is_exculpated(self):
        b = Builder(self.db, po_base="subtotal", person="emp_id")
        v = b.vendor("FEE010101AB1", registered="2015-01-01")
        b.contract("FEE010101AB1", "2025-12-01", 600_000)
        for m in range(1, 5):
            b.purchase(v, round(48_700.0 * 1.16, 2), f"2026-0{m}-15", approver=b.emps[1], requester=b.emps[3])
        found, closed = verdicts(b.write())
        self.assertNotIn(("threshold_splitting", "RFC:FEE010101AB1"), found)
        self.assertIn("recurring", closed[("threshold_splitting", "RFC:FEE010101AB1")]["reason"])


class RoundTripTest(Tmp):
    def test_three_hop_cycle_is_accused(self):
        b = Builder(self.db)
        a = b.vendor("RTA010101AB1")
        mid = b.vendor("RTB010101AB1")
        b.purchase(mid, 30_000.0, "2026-01-20")
        b.purchase(a, 500_000.0, "2026-02-01")
        b.txn("2026-02-05", a["clabe"], mid["clabe"], 487_500.0, "x")
        b.txn("2026-03-01", mid["clabe"], CO_CLABE, 475_300.0, "y")
        found, _ = verdicts(b.write())
        f = found[("round_tripping", "RFC:RTA010101AB1")]
        self.assertIn("RFC:RTB010101AB1", f["entities"])
        self.assertEqual(f["peso_amount"], 500_000.0)

    def test_transfers_between_own_accounts_open_nothing(self):
        b = Builder(self.db)
        own = "012180000000000027"
        b.txn("2026-02-01", CO_CLABE, own, 482_000.0, "x")
        b.txn("2026-03-01", own, CO_CLABE, 482_000.0, "y")
        e = Estate(b.write())
        self.assertEqual(e.cycles(), [])
        self.assertFalse([l for l in run_detectors(e) if l["kind"] == "round_tripping"])

    def test_weak_return_is_not_a_cycle(self):
        b = Builder(self.db)
        a, mid = b.vendor("RTA010101AB1"), b.vendor("RTB010101AB1")
        b.purchase(a, 500_000.0, "2026-02-01")
        b.txn("2026-02-05", a["clabe"], mid["clabe"], 300_000.0, "x")    # 60%: no conserva el monto
        b.txn("2026-03-01", mid["clabe"], CO_CLABE, 290_000.0, "y")
        self.assertEqual(Estate(b.write()).cycles(), [])


class RevenueTest(Tmp):
    def test_ppd_without_any_collection_is_accused(self):
        b = Builder(self.db)
        b.sale("CUS010101AB1", 495_000.0, "2025-10-23")
        b.sale("CUS010101AB1", 284_000.0, "2025-11-26")
        b.txn("2026-06-30", CO_CLABE, "002000000000000001", 1.0, "horizonte")
        found, _ = verdicts(b.write())
        self.assertIn(("revenue_inflation", "RFC:CUS010101AB1"), found)

    def test_partial_payments_exculpate(self):
        b = Builder(self.db)
        u1 = b.sale("CUS010101AB1", 518_000.0, "2025-10-23")
        u2 = b.sale("CUS010101AB1", 300_000.0, "2025-11-26")
        payer = "044900000000000001"
        for d, amt in (("2025-11-20", 240_000.0), ("2025-12-20", 120_000.0)):
            b.txn(d, payer, CO_CLABE, amt, f"Pago parcial PPD {u1}")
        b.txn("2026-01-10", payer, CO_CLABE, 150_000.0, f"Abono {u2}")
        b.txn("2026-06-30", CO_CLABE, "002000000000000001", 1.0, "horizonte")
        found, _ = verdicts(b.write())
        self.assertNotIn(("revenue_inflation", "RFC:CUS010101AB1"), found)

    def test_money_from_own_account_is_not_collection(self):
        b = Builder(self.db)
        own = "012180000000000027"
        b.txn("2025-09-01", CO_CLABE, own, 100_000.0, "x")
        b.txn("2025-09-10", own, CO_CLABE, 100_000.0, "y")
        u1 = b.sale("CUS010101AB1", 495_000.0, "2025-10-23")
        b.sale("CUS010101AB1", 284_000.0, "2025-11-26")
        b.txn("2025-11-27", own, CO_CLABE, 495_000.0, f"Cobro {u1}")
        b.txn("2026-06-30", CO_CLABE, "002000000000000001", 1.0, "horizonte")
        found, _ = verdicts(b.write())
        self.assertIn(("revenue_inflation", "RFC:CUS010101AB1"), found)


class KickbackTest(Tmp):
    def test_approver_written_as_emp_id(self):
        b = Builder(self.db, po_base="subtotal", person="emp_id")
        v = b.vendor("KIK010101AB1", registered="2015-01-01")
        mgr = b.emps[1]
        for m in range(1, 4):
            d = f"2026-0{m}-05"
            b.purchase(v, 150_000.0, d, approver=mgr)
            b.txn(f"2026-0{m}-09", v["clabe"], mgr[3], 9_000.0 + m, "Transferencia personal")
        found, _ = verdicts(b.write())
        f = found[("kickback", "RFC:KIK010101AB1")]
        self.assertIn("EMP:0002", f["entities"])
        self.assertIn("approved 3 purchase orders", f["narrative"])

    def test_shared_bank_without_transfers_is_closed(self):
        b = Builder(self.db, person="emp_id")
        v = b.vendor("SAM010101AB1", clabe="044180000000009999")   # mismo banco que los empleados
        for m in range(1, 4):
            b.purchase(v, 40_000.0, f"2026-0{m}-07", approver=b.emps[0])
        found, closed = verdicts(b.write())
        self.assertNotIn(("kickback", "RFC:SAM010101AB1"), found)
        self.assertIn("zero transfers", closed[("kickback", "RFC:SAM010101AB1")]["reason"])


def mask_clock(text: str) -> str:
    return re.sub(r'"wall_clock_seconds": [0-9.]+', '"wall_clock_seconds": 0', text)


class EndToEndTest(unittest.TestCase):
    """Generador (clásico y convenciones aleatorias) → auditor → validador oficial, dos veces."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.estates = []
        for conv, seed in (("classic", 7001), ("random", 7002), ("random", 7003)):
            out = Path(cls.tmp.name) / f"{conv}_{seed}"
            args = [PY, "generator/forensic/estate.py", "--seed", str(seed), "--out", str(out / "estate.db"),
                    "--key", str(out / "key.json")]
            if conv != "classic":
                args += ["--conventions", conv]
            subprocess.run(args, cwd=ROOT, check=True, capture_output=True)
            cls.estates.append((seed, str(out / "estate.db")))
        if (EXTERNAL / "estate.db").is_file():
            cls.estates.append((103, str(EXTERNAL / "estate.db")))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _run(self, seed, db, out):
        env = dict(os.environ, PYTHONPATH=str(ROOT / "src"))
        subprocess.run([PY, "-m", "auditor", "run", "--estate", db, "--seed", str(seed), "--out", out],
                       cwd=ROOT, env=env, check=True, capture_output=True)

    def test_format_and_determinism(self):
        for seed, db in self.estates:
            with self.subTest(estate=db):
                a, b = Path(self.tmp.name) / f"run_{seed}_a", Path(self.tmp.name) / f"run_{seed}_b"
                self._run(seed, db, str(a))
                self._run(seed, db, str(b))
                v = subprocess.run([PY, "spec/forensic-auditor/validate_format.py", "--submission",
                                    str(a / "submission.json"), "--estate", db], cwd=ROOT, capture_output=True, text=True)
                self.assertEqual(v.returncode, 0, v.stdout + v.stderr)
                sa, sb = (a / "submission.json").read_text(), (b / "submission.json").read_text()
                self.assertEqual(mask_clock(sa), mask_clock(sb))      # idénticos salvo el reloj de pared
                la, lb = json.loads((a / "run_log.json").read_text()), json.loads((b / "run_log.json").read_text())
                self.assertEqual(la["fingerprint"], lb["fingerprint"])
                self.assertIn("estate_profile", la)

    def test_ground_truth_unreachable_from_src(self):
        hits = [str(p) for p in (ROOT / "src").rglob("*.py") if "ground_truth" in p.read_text()]
        self.assertEqual(hits, [])

    def test_classic_generator_unchanged_without_flag(self):
        # la bandera nueva no altera el estate clásico: dos generaciones idénticas byte a byte
        outs = []
        for k in ("x", "y"):
            out = Path(self.tmp.name) / f"cls_{k}"
            subprocess.run([PY, "generator/forensic/estate.py", "--seed", "42", "--out", str(out / "e.db"),
                            "--key", str(out / "k.json")], cwd=ROOT, check=True, capture_output=True)
            outs.append((out / "e.db").read_bytes())
        self.assertEqual(outs[0], outs[1])


if __name__ == "__main__":
    unittest.main()
