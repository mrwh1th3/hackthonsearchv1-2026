"""CLI: python3 -m auditor run --estate PATH --seed N --out DIR [--llm off|record|replay --cassette F]"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .casefile import render_html
from .llm import LLM
from .pipeline import run, write_outputs


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
    a = ap.parse_args(argv)

    if a.cmd == "render":
        log = json.loads(Path(a.run_log).read_text())
        out = Path(a.out) if a.out else Path(a.run_log).with_name("case_file.html")
        out.write_text(render_html(log))
        print(out)
        return 0

    llm = LLM(a.llm, a.cassette, a.model) if a.model else LLM(a.llm, a.cassette)
    result = run(a.estate, a.seed, llm)
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
