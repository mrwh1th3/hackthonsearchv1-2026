"""La entrega del runner en vivo (`loaders/auditoria_en_vivo.py`) es la del CLI y no cambia al re-auditar.

    python3 -m unittest discover -s loaders/tests -p 'test_*.py' -v

Corre `correr()` completo sin base: `psql` y `publicar` se sustituyen por registros en memoria, así que la prueba no
toca Supabase ni n8n.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "loaders"))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sin_reloj(texto: str) -> str:
    return re.sub(r'"wall_clock_seconds": [0-9.]+', '"wall_clock_seconds": 0', texto)


class AuditoriaEnVivoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = Path(cls.tmp.name) / "estate.db"
        subprocess.run([PY, "generator/forensic/estate.py", "--seed", "7", "--out", str(cls.db), "--key",
                        str(Path(cls.tmp.name) / "key.json")], cwd=ROOT, check=True, capture_output=True)
        cls.vivo = _load("auditoria_en_vivo", ROOT / "loaders" / "auditoria_en_vivo.py")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def auditar(self, corrida: str, salida: Path) -> list[str]:
        sql: list[str] = []
        args = argparse.Namespace(corrida=corrida, estate=str(self.db), investigacion=str(uuid.uuid4()),
                                  caso=str(uuid.uuid4()), perfil=str(uuid.uuid4()), seed=7, paso_ms=0, llm="off",
                                  agentes="off", agentes_timeout=1, cassette=None)
        with mock.patch.dict(os.environ, {"FORENSE_SALIDA_DIR": str(salida)}), \
                mock.patch.object(self.vivo, "psql", lambda s, *f: (sql.append(s), "Estate · prueba")[1]), \
                mock.patch.object(self.vivo, "publicar", lambda *a, **k: None):
            self.assertEqual(self.vivo.correr(args), 0)
        return sql

    def test_entrega_igual_al_cli_en_carpeta_configurable_e_identica_al_reauditar(self):
        corrida = str(uuid.uuid4())
        salida = Path(self.tmp.name) / "salidas"
        sql1 = self.auditar(corrida, salida)
        carpeta = salida / corrida
        primera = (carpeta / "submission.json").read_bytes()
        sql2 = self.auditar(corrida, salida)
        self.assertEqual((carpeta / "submission.json").read_bytes(), primera)

        cli = Path(self.tmp.name) / "cli"
        subprocess.run([PY, "-m", "auditor", "run", "--estate", str(self.db), "--seed", "7", "--out", str(cli)], cwd=ROOT,
                       env=dict(os.environ, PYTHONPATH=str(ROOT / "src")), check=True, capture_output=True)
        self.assertEqual(sin_reloj(primera.decode()), sin_reloj((cli / "submission.json").read_text()))
        self.assertNotIn("paso_visible_ms", json.loads(primera)["run_metadata"])

        fin = lambda sql: next(s for s in sql if "'redaccion_fin'" in s)   # noqa: E731
        self.assertIn("submission nueva", fin(sql1))
        self.assertIn("submission idéntica a la auditoría anterior", fin(sql2))
        persistida = next(s for s in sql2 if "INSERT INTO forense.auditor_resultados" in s)
        self.assertIn(json.loads(primera)["findings"][0]["exhibits"][0]["record_id"], persistida)

    def test_carpeta_por_defecto_y_tilde(self):
        with mock.patch.dict(os.environ, {"FORENSE_SALIDA_DIR": ""}):
            self.assertEqual(self.vivo.carpeta_salida("c1"), ROOT / "data" / "forensic" / "runs" / "c1")
        with mock.patch.dict(os.environ, {"FORENSE_SALIDA_DIR": "~/Documents/Forense"}):
            self.assertEqual(self.vivo.carpeta_salida("c1"), Path.home() / "Documents" / "Forense" / "c1")
        with mock.patch.dict(os.environ, {"FORENSE_SALIDA_DIR": "out/entregas"}):
            self.assertEqual(self.vivo.carpeta_salida("c1"), ROOT / "out" / "entregas" / "c1")


if __name__ == "__main__":
    unittest.main()
