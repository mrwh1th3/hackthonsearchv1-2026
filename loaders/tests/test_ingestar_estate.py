"""Pruebas del puente de ingesta multi-formato de la web (`loaders/ingestar_estate.py`).

    python3 -m unittest discover -s loaders/tests -p 'test_*.py' -v

Fuente: data/external/seed_103/estate.db (o FORENSE_SEED103=/ruta/estate.db). `generator/forensic/mutate.py`
exporta ese estate, sin mutación estructural, a carpeta de CSV, ZIP de CSV y XLSX. Sin la fuente, se omiten.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable
BRIDGE = ROOT / "loaders" / "ingestar_estate.py"
TABLES = ["vendors", "invoices", "ledger", "bank_txns", "purchase_orders", "contracts", "employees", "efos_list"]
ID_COL = {"vendors": "rfc", "invoices": "uuid", "ledger": "entry_id", "bank_txns": "txn_id", "purchase_orders": "po_id",
          "contracts": "contract_id", "employees": "emp_id", "efos_list": "rfc"}

sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "loaders"))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def seed_103() -> Path | None:
    env = os.environ.get("FORENSE_SEED103")
    candidates = [Path(env)] if env else []
    candidates.append(ROOT / "data" / "external" / "seed_103" / "estate.db")
    # worktree en .claude/worktrees/<x>: los datos (gitignored) viven en la copia principal
    if ROOT.parent.name == "worktrees" and ROOT.parent.parent.name == ".claude":
        candidates.append(ROOT.parents[2] / "data" / "external" / "seed_103" / "estate.db")
    return next((c for c in candidates if c.is_file()), None)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def bridge(inp: Path, estates: Path, work: Path | None = None) -> subprocess.CompletedProcess:
    args = [PY, str(BRIDGE), "--input", str(inp), "--estates-dir", str(estates)]
    if work:
        args += ["--work-dir", str(work)]
    return subprocess.run(args, capture_output=True, text=True, cwd=ROOT)


SRC = seed_103()


@unittest.skipIf(SRC is None, "falta data/external/seed_103/estate.db (o FORENSE_SEED103)")
class PuenteIngesta(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="ingestar_estate_")
        cls.dir = Path(cls.tmp.name)
        mutate = _load("mutate", ROOT / "generator" / "forensic" / "mutate.py")
        cls.inputs = {}
        for fmt, name in (("csv_dir", "csv"), ("csv_zip", "datos.zip"), ("xlsx", "libro.xlsx")):
            out = cls.dir / "in" / name
            mutate.mutate(SRC, out, "none", 0, "tuning", fmt)
            cls.inputs[fmt] = out
        # nombres de columna distintos al esquema: el mapeo real, no solo el cambio de formato
        cls.inputs["renamed"] = cls.dir / "in" / "renamed"
        cls.renamed_manifest = mutate.mutate(SRC, cls.inputs["renamed"], "rename_columns", 3, "tuning", "csv_dir")
        src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
        cls.counts = {t: src.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLES}
        cls.ids = {t: sorted(str(r[0]) for r in src.execute(f"SELECT {ID_COL[t]} FROM {t}")) for t in TABLES}
        src.close()
        cls.f2f = _load("forensic_to_forense", ROOT / "loaders" / "forensic_to_forense.py")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_ok(self, inp: Path, estates: Path) -> dict:
        r = bridge(inp, estates)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        db = Path(out["estate_db"])
        self.assertEqual(db, estates / f"{out['sha256']}.db")
        # direccionado por contenido: el nombre es el sha de los bytes (lo que registra forensic_to_forense.py)
        self.assertEqual(sha256(db), out["sha256"])
        rep = json.loads(Path(out["structure_report_path"]).read_text())
        self.assertEqual(rep["sha256"], out["sha256"])
        self.assertEqual(rep["structure_report"], out["structure_report"])
        return out

    def assert_canonical(self, db: Path):
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        self.f2f.validar(conn)          # las 8 tablas y columnas del spec: el loader a Supabase la acepta
        for t in TABLES:
            self.assertEqual(conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0], self.counts[t], t)
            got = sorted(str(r[0]) for r in conn.execute(f"SELECT {ID_COL[t]} FROM {t}"))
            self.assertEqual(got, self.ids[t], f"ids originales de {t}")
        conn.close()
        prev = subprocess.run([PY, "loaders/estate_preview.py", str(db), "invoices", "0", "2"], capture_output=True,
                              text=True, cwd=ROOT)
        self.assertEqual(prev.returncode, 0, prev.stderr)
        self.assertEqual(json.loads(prev.stdout)["total"], self.counts["invoices"])

    def test_sqlite_canonico_se_guarda_tal_cual(self):
        estates = self.dir / "e_sqlite"
        out = self.run_ok(SRC, estates)
        self.assertEqual(out["status"], "identity")
        self.assertEqual(out["sha256"], sha256(SRC))     # mismo sha que antes: la corrida ya cargada se reutiliza
        self.assertEqual(out["warnings"], [])

    def test_carpeta_de_csv(self):
        out = self.run_ok(self.inputs["csv_dir"], self.dir / "e_csv")
        self.assertEqual(out["status"], "adapted")
        self.assertEqual(out["structure_report"]["input"]["input_format"], "csv_dir")
        self.assert_canonical(Path(out["estate_db"]))

    def test_zip_de_csv(self):
        out = self.run_ok(self.inputs["csv_zip"], self.dir / "e_zip")
        self.assertEqual(out["structure_report"]["input"]["input_format"], "zip")
        self.assert_canonical(Path(out["estate_db"]))
        again = self.run_ok(self.inputs["csv_zip"], self.dir / "e_zip2")
        self.assertEqual(again["sha256"], out["sha256"], "conversión determinista")

    def test_xlsx(self):
        out = self.run_ok(self.inputs["xlsx"], self.dir / "e_xlsx")
        self.assertEqual(out["structure_report"]["input"]["input_format"], "xlsx")
        self.assert_canonical(Path(out["estate_db"]))

    def hallazgos(self, path):
        from auditor.llm import LLM
        from auditor.pipeline import run
        r = run(str(path), 103, LLM("off"), str(self.dir / f"run_{sha256(Path(path))[:8]}"))
        return [{k: f[k] for k in ("scheme_type", "entities", "peso_amount", "confidence", "exhibits")} for f in r["findings"]]

    def test_zip_de_csv_da_los_mismos_hallazgos_que_el_sqlite(self):
        out = self.run_ok(self.inputs["csv_zip"], self.dir / "e_hallazgos")
        orig = self.hallazgos(SRC)
        self.assertEqual(len(orig), 10)
        self.assertEqual(self.hallazgos(out["estate_db"]), orig)

    def test_csv_con_columnas_renombradas_se_mapea_y_el_loader_lo_acepta(self):
        self.assertTrue(self.renamed_manifest["applied"])
        out = self.run_ok(self.inputs["renamed"], self.dir / "e_renamed")
        tablas = out["structure_report"]["tables"]
        renombradas = [(t, c, v["source"]) for t, m in tablas.items() for c, v in m.get("columns", {}).items()
                       if v["source"] != c]
        self.assertTrue(renombradas, "la mutación debió renombrar columnas")
        self.assert_canonical(Path(out["estate_db"]))
        self.assertEqual(self.hallazgos(out["estate_db"]), self.hallazgos(SRC))

    def test_csv_sin_facturas_es_error_de_estructura(self):
        d = self.dir / "sin_facturas"
        d.mkdir()
        (d / "vendors.csv").write_text("rfc,legal_name\nAAA010101AA1,Uno\n")
        r = bridge(d, self.dir / "e_err")
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertTrue(r.stderr.startswith("error: estate structure:"), r.stderr)
        self.assertEqual(r.stdout, "")


class LimitesEntrada(unittest.TestCase):
    """No requieren la fuente: la entrada se rechaza antes de la ingesta."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ingestar_limites_")
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def zip_con(self, name: str, members: dict) -> Path:
        p = self.dir / name
        with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as z:
            for n, data in members.items():
                z.writestr(zipfile.ZipInfo(n, date_time=(2026, 1, 1, 0, 0, 0)), data, compress_type=zipfile.ZIP_DEFLATED)
        return p

    def assert_rechazo(self, inp: Path, patron: str):
        r = bridge(inp, self.dir / "estates")
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertRegex(r.stderr, patron)
        self.assertFalse((self.dir / "estates").exists() and any((self.dir / "estates").iterdir()))

    def test_zip_slip(self):
        self.assert_rechazo(self.zip_con("slip.zip", {"../../evil.csv": b"a,b\n1,2\n"}), "ruta insegura")
        self.assert_rechazo(self.zip_con("abs.zip", {"/etc/evil.csv": b"a,b\n1,2\n"}), "ruta insegura")

    def test_zip_bomb(self):
        self.assert_rechazo(self.zip_con("bomb.zip", {"invoices.csv": b"0" * (8 * 1024 * 1024)}), "compresión sospechosa")

    def test_zip_anidado_o_sin_datos(self):
        self.assert_rechazo(self.zip_con("nested.zip", {"inner.zip": b"PK\x03\x04"}), "ZIP anidado")
        self.assert_rechazo(self.zip_con("vacio.zip", {"leeme.md": b"hola"}), "no contiene")

    def test_mezcla_en_directorio(self):
        d = self.dir / "mezcla"
        d.mkdir()
        (d / "vendors.csv").write_text("rfc\nAAA010101AA1\n")
        (d / "estate.db").write_bytes(b"SQLite format 3\x00" + b"\x00" * 84)
        self.assert_rechazo(d, "solo puede ser CSV o XLSX")


if __name__ == "__main__":
    unittest.main()
