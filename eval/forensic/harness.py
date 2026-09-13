#!/usr/bin/env python3
"""Harness de evaluación Forensic Auditor. Único código que abre la clave de evaluación.

    python3 eval/forensic/harness.py --report-seeds 101 102 103 104 105 --tuning-seeds 1 2 3 4 5

Por semilla: genera estate + clave, corre el agente como subproceso (no importa nada de
src/), valida el formato con el validador oficial, corre dos veces para comprobar
determinismo y puntúa contra la clave. Escribe la tabla de resultados CSV."""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable


def sh(args: list[str], env_src: bool = False) -> str:
    import os
    env = dict(os.environ)
    if env_src:
        env["PYTHONPATH"] = str(ROOT / "src")
    p = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(args)}\n{p.stdout}\n{p.stderr}")
    return p.stdout


def load_key(path: Path) -> dict:
    """Acepta la clave envuelta ({"ground_truth": {...}}, nuestro generador) o desnuda (estates externos)."""
    raw = json.loads(Path(path).read_text())
    key = raw.get("ground_truth", raw) if isinstance(raw, dict) else raw
    missing = [k for k in ("seed", "schemes", "decoys", "company_rfc") if k not in key]
    if missing:
        raise ValueError(f"{path}: answer key lacks {missing} (spec/forensic-auditor/ground_truth_schema.json)")
    for s in key["schemes"]:
        for k in ("scheme_id", "type", "entities", "peso_amount", "difficulty"):
            if k not in s:
                raise ValueError(f"{path}: scheme lacks {k}")
    for dcy in key["decoys"]:
        for k in ("entity", "signal", "why_innocent"):
            if k not in dcy:
                raise ValueError(f"{path}: decoy lacks {k}")
    return key


def score(key: dict, sub: dict) -> dict:
    """Un hallazgo empareja un esquema si coincide el tipo y comparte una entidad distinta de la
    empresa auditada (la empresa aparece en todos los esquemas de ingresos y ciclos: no discrimina)."""
    schemes, decoys, findings = key["schemes"], key["decoys"], sub["findings"]
    company = f"RFC:{key.get('company_rfc', '')}"
    matched, used = [], set()
    for s in schemes:
        ents = set(s["entities"]) - {company}
        hit = next((i for i, f in enumerate(findings) if i not in used and f["scheme_type"] == s["type"]
                    and ents & (set(f["entities"]) - {company})), None)
        if hit is not None:
            used.add(hit)
            matched.append((s, findings[hit]))
    scheme_ents = {e for s in schemes for e in s["entities"]}
    accused_ents = {e for f in findings for e in f["entities"]}
    decoys_accused = [d for d in decoys if d["entity"] in accused_ents and d["entity"] not in scheme_ents]
    unmatched = [f for i, f in enumerate(findings) if i not in used]
    claimed = sum(f["peso_amount"] for _, f in matched)
    actual = sum(s["peso_amount"] for s, _ in matched)
    per_scheme_ok = all(abs(f["peso_amount"] - s["peso_amount"]) <= 0.02 * s["peso_amount"] for s, f in matched)
    return {"schemes_planted": len(schemes), "schemes_found": len(matched),
            "recall_pct": round(100 * len(matched) / len(schemes), 1) if schemes else 100.0,
            "decoys_planted": len(decoys), "decoys_accused": len(decoys_accused),
            "false_accusation_rate_pct": round(100 * len(decoys_accused) / len(decoys), 1) if decoys else 0.0,
            "unmatched_findings_n": len(unmatched),
            "peso_claimed": round(claimed, 2), "peso_actual": round(actual, 2),
            "peso_reconciles": "yes" if matched and per_scheme_ok else ("n/a" if not matched else "no"),
            "unmatched_findings": [(f["scheme_type"], f["entities"]) for f in unmatched],
            "missed": [(s["type"], s["difficulty"], s["entities"]) for s in schemes if s not in [m[0] for m in matched]],
            "decoys_hit": [(d["signal"], d["entity"]) for d in decoys_accused],
            "peso_mismatch": [(s["type"], s["peso_amount"], f["peso_amount"]) for s, f in matched
                              if abs(f["peso_amount"] - s["peso_amount"]) > 0.02 * s["peso_amount"]]}


def run_agent(label: str, seed: int, estate: Path, keyf: Path, work: Path) -> dict:
    runs = []
    for k in ("a", "b"):
        out = work / label / f"run_{k}"
        sh([PY, "-m", "auditor", "run", "--estate", str(estate), "--seed", str(seed), "--out", str(out)], env_src=True)
        runs.append(out)
    fmt = subprocess.run([PY, "spec/forensic-auditor/validate_format.py", "--submission",
                          str(runs[0] / "submission.json"), "--estate", str(estate)],
                         cwd=ROOT, capture_output=True, text=True)
    log_a = json.loads((runs[0] / "run_log.json").read_text())
    log_b = json.loads((runs[1] / "run_log.json").read_text())
    sub = json.loads((runs[0] / "submission.json").read_text())
    s = score(load_key(keyf), sub)
    md = sub["run_metadata"]
    s.update({"seed": seed, "source": label, "llm_calls": md["llm_calls"], "mxn_cost": md["mxn_cost"],
              "wall_clock_s": md["wall_clock_seconds"], "format_valid": fmt.returncode == 0,
              "deterministic": log_a["fingerprint"] == log_b["fingerprint"],
              "case_file": str(runs[0] / "case_file.html")})
    return s


def one_seed(seed: int, work: Path, schemes: int | None, decoys: int | None, conventions: str = "classic") -> dict:
    tag = f"seed_{seed}" if conventions == "classic" else f"{conventions}_{seed}"
    estate = work / tag / "estate.db"
    keyf = work / "keys" / f"{tag}.json"
    gen = [PY, "generator/forensic/estate.py", "--seed", str(seed), "--out", str(estate), "--key", str(keyf)]
    if conventions != "classic":
        gen += ["--conventions", conventions]
    if schemes is not None:
        gen += ["--schemes", str(schemes)]
    if decoys is not None:
        gen += ["--decoys", str(decoys)]
    sh(gen)
    return run_agent(tag, seed, estate, keyf, work)


def external(dir_: Path, work: Path) -> dict:
    """Estate ajeno: dir con estate.db y ground_truth.json (clave desnuda o envuelta)."""
    estate, keyf = dir_ / "estate.db", dir_ / "ground_truth.json"
    key = load_key(keyf)
    return run_agent(f"external_{dir_.name}", int(key["seed"]), estate, keyf, work)


COLS = ["seed", "schemes_planted", "schemes_found", "recall_pct", "decoys_planted", "decoys_accused",
        "false_accusation_rate_pct", "peso_claimed", "peso_actual", "peso_reconciles", "llm_calls", "mxn_cost",
        "wall_clock_s"]


def write_table(rows: list[dict], path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tot = {"seed": "TOTAL"}
    for c in ("schemes_planted", "schemes_found", "decoys_planted", "decoys_accused", "llm_calls"):
        tot[c] = sum(r[c] for r in rows)
    for c in ("peso_claimed", "peso_actual", "mxn_cost", "wall_clock_s"):
        tot[c] = round(sum(r[c] for r in rows), 3)
    tot["recall_pct"] = round(100 * tot["schemes_found"] / tot["schemes_planted"], 1) if tot["schemes_planted"] else 0
    tot["false_accusation_rate_pct"] = round(100 * tot["decoys_accused"] / tot["decoys_planted"], 1) if tot["decoys_planted"] else 0
    tot["peso_reconciles"] = "yes" if all(r["peso_reconciles"] in ("yes", "n/a") for r in rows) else "no"
    with path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
        w.writerow(tot)


def report(label: str, rows: list[dict], out: Path) -> None:
    write_table(rows, out / f"results_{label}.csv")
    for r in rows:
        print(f"[{label}] {r['source']}: recall {r['schemes_found']}/{r['schemes_planted']} "
              f"decoys accused {r['decoys_accused']}/{r['decoys_planted']} extra findings {r['unmatched_findings_n']} "
              f"peso {r['peso_reconciles']} format {'ok' if r['format_valid'] else 'FAIL'} deterministic {r['deterministic']}")
        if r["missed"] or r["decoys_hit"] or r["unmatched_findings"] or r["peso_mismatch"]:
            print(f"    missed={r['missed']} decoys_hit={r['decoys_hit']} extra={r['unmatched_findings']} "
                  f"peso_mismatch={r['peso_mismatch']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report-seeds", type=int, nargs="*", default=[101, 102, 103, 104, 105])
    ap.add_argument("--tuning-seeds", type=int, nargs="*", default=[1, 2, 3, 4, 5])
    ap.add_argument("--conventions", default="classic", choices=["classic", "random"],
                    help="classic: generador original; random: convenciones y formas de esquema variables por semilla")
    ap.add_argument("--external", nargs="*", default=[], help="dirs con estate.db + ground_truth.json")
    ap.add_argument("--external-label", default="tuning", choices=["tuning", "heldout"])
    ap.add_argument("--work", default="data/forensic")
    ap.add_argument("--out", default="reports/forensic")
    ap.add_argument("--schemes", type=int)
    ap.add_argument("--decoys", type=int)
    a = ap.parse_args()
    overlap = set(a.report_seeds) & set(a.tuning_seeds)
    if overlap:
        print(f"FAIL reporting and tuning seeds overlap: {sorted(overlap)}")
        return 2
    work, out = ROOT / a.work, ROOT / a.out
    out.mkdir(parents=True, exist_ok=True)
    src = "classic" if a.conventions == "classic" else "variants"
    summary = {}
    for label, seeds in (("tuning", a.tuning_seeds), ("heldout", a.report_seeds)):
        if not seeds:
            continue
        rows = [one_seed(s, work, a.schemes, a.decoys, a.conventions) for s in seeds]
        name = f"{src}_{label}"
        report(name, rows, out)
        summary[name] = {"seeds": seeds, "rows": rows}
    if a.external:
        rows = [external(Path(x).resolve(), work) for x in a.external]
        name = f"external_{a.external_label}"
        report(name, rows, out)
        summary[name] = {"dirs": a.external, "rows": rows}
    tag = "_".join(summary) or "empty"
    (out / f"eval_summary_{tag}.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    bad = [r for v in summary.values() for r in v["rows"] if not r["format_valid"] or not r["deterministic"]]
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
