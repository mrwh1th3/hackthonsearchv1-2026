#!/usr/bin/env python3
"""Corre el auditor (src/auditor) sobre estates ya cargados como corridas y guarda el
resultado en forense.auditor_resultados. Sin LLM (determinista, sin red).

    python3 loaders/auditor_to_forense.py data/forensic/test_sets/seed_40{1,2,3,4,5}/estate.db
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from forensic_to_supabase import db_url, lit  # noqa: E402
from forensic_to_forense import NS  # noqa: E402


def main() -> int:
    parts = ["BEGIN;"]
    for e in sys.argv[1:]:
        db = Path(e).resolve()
        seed = int(db.parent.name.split("_")[-1])
        digest = hashlib.sha256(db.read_bytes()).hexdigest()
        cid = str(uuid.uuid5(NS, f"corrida:{seed}:{digest}"))
        out = db.parent / "auditor"
        env = dict(os.environ, PYTHONPATH=str(ROOT / "src"))
        subprocess.run([sys.executable, "-m", "auditor", "run", "--estate", str(db), "--seed", str(seed),
                        "--out", str(out)], check=True, env=env, cwd=ROOT, capture_output=True)
        log = json.loads((out / "run_log.json").read_text())
        sub = (out / "submission.json").read_text()
        html = (out / "case_file.html").read_text()
        parts.append(
            "INSERT INTO forense.auditor_resultados (corrida_id, seed, fingerprint, estate_sha256, submission, run_log, case_file_html) "
            f"VALUES ({lit(cid)}, {seed}, {lit(log['fingerprint'])}, {lit(digest)}, {lit(sub)}::jsonb, "
            f"{lit(json.dumps(log, ensure_ascii=False, default=str))}::jsonb, {lit(html)}) "
            "ON CONFLICT (corrida_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, submission = EXCLUDED.submission, "
            "run_log = EXCLUDED.run_log, case_file_html = EXCLUDED.case_file_html, generado_at = now();")
        parts.append(f"INSERT INTO forense.bitacora (corrida_id, agente, tipo_evento, payload) VALUES ({lit(cid)}, 'auditor', 'dictamen', "
                     f"{lit(json.dumps({'fuente': 'src/auditor', 'findings': len(log['findings']), 'leads_cerrados': len(log['leads']), 'fingerprint': log['fingerprint'], **{k: log['run_metadata'][k] for k in ('llm_calls', 'mxn_cost', 'wall_clock_seconds')}}))}::jsonb);")
        print(f"seed {seed}: findings={len(log['findings'])} leads={len(log['leads'])} corrida={cid}")
    parts.append("COMMIT;")
    r = subprocess.run(["psql", db_url(), "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input="\n".join(parts),
                       text=True, capture_output=True)
    if r.returncode:
        sys.stderr.write(r.stderr[-2000:])
    return r.returncode


if __name__ == "__main__":
    raise SystemExit(main())
