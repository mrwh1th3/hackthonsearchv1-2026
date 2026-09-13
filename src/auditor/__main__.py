"""CLI del auditor.

    python3 -m auditor run --estate PATH --seed N --out DIR [--llm off|record|replay --cassette F]
        PATH: SQLite, directorio de CSV, CSV, XLSX o ZIP (el formato se detecta por contenido)
    python3 -m auditor render --run-log DIR/run_log.json [--out FILE]
    python3 -m auditor branch --run-log DIR/run_log.json --flag true|false [--out FILE]
    python3 -m auditor validator-estate --estate PATH --out FILE.db
        SQLite con nombres canónicos e ids originales para spec/forensic-auditor/validate_format.py --estate"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .casefile import render_html
from .llm import LLM
from .pipeline import run, write_outputs
from .structure import StructureError


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="auditor")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="investigate an estate")
    r.add_argument("--estate", required=True)
    r.add_argument("--seed", type=int, required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--llm", default="off", choices=["off", "record", "replay"])
    r.add_argument("--cassette")
    r.add_argument("--model", default=None)
    g = sub.add_parser("render", help="rebuild the case file from a run log, offline")
    g.add_argument("--run-log", required=True)
    g.add_argument("--out")
    b = sub.add_parser("branch", help="export the fraud_flag=true or false branch of a completed run, offline")
    b.add_argument("--run-log", required=True)
    b.add_argument("--flag", required=True, choices=["true", "false"])
    b.add_argument("--out")
    v = sub.add_parser("validator-estate", help="export a canonical SQLite with original ids for validate_format.py")
    v.add_argument("--estate", required=True)
    v.add_argument("--out", required=True)
    a = ap.parse_args(argv)

    if a.cmd == "branch":
        from .triage import branch
        log_path = Path(a.run_log)
        log = json.loads(log_path.read_text())
        ref = log.get("triage") or {}
        tri_path = log_path.with_name(ref.get("file", "triage.json"))
        if not tri_path.exists():
            print(f"error: {tri_path} not found; run the auditor first", file=sys.stderr)
            return 2
        tri = json.loads(tri_path.read_text())
        text = json.dumps(branch(tri, a.flag == "true"), indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        if a.out:
            Path(a.out).write_text(text)
            print(a.out)
        else:
            sys.stdout.write(text)
        return 0

    if a.cmd == "validator-estate":
        import tempfile
        from .structure import prepare
        try:
            prep = prepare(a.estate, None, tempfile.mkdtemp(prefix="auditor_validator_"))
        except StructureError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(prep.export_validator_estate(a.out))
        return 0

    if a.cmd == "render":
        log = json.loads(Path(a.run_log).read_text())
        out = Path(a.out) if a.out else Path(a.run_log).with_name("case_file.html")
        out.write_text(render_html(log))
        print(out)
        return 0

    llm = LLM(a.llm, a.cassette, a.model) if a.model else LLM(a.llm, a.cassette)
    try:
        result = run(a.estate, a.seed, llm, a.out)
    except StructureError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    paths = write_outputs(result, a.out)
    md = result["run_metadata"]
    print(f"seed={a.seed} findings={len(result['findings'])} leads_closed={len(result['leads'])} "
          f"llm_calls={md['llm_calls']} mxn_cost={md['mxn_cost']} wall_clock_s={md['wall_clock_seconds']} "
          f"fingerprint={result['fingerprint'][:16]}")
    for f in result["findings"]:
        print(f"  {f['scheme_type']:<20} {f['confidence']:<9} {f['peso_amount']:>14,.2f}  {', '.join(f['entities'])}")
    print(json.dumps(paths))
    return 0


if __name__ == "__main__":
    sys.exit(main())
