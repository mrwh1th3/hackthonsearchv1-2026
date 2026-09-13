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


# ---------------------------------------------------------------- mutaciones estructurales
def run_cli(estate: Path, seed: int, out: Path) -> subprocess.CompletedProcess:
    import os
    env = dict(os.environ, PYTHONPATH=str(ROOT / "src"))
    return subprocess.run([PY, "-m", "auditor", "run", "--estate", str(estate), "--seed", str(seed), "--out", str(out)],
                          cwd=ROOT, env=env, capture_output=True, text=True)


def projection(sub: dict, man: dict | None = None) -> dict:
    """Lo que el sistema concluyó, en ids del estate canónico original (traduce entidades e ids del mutado)."""
    inv_ent = {v: k for k, v in (man or {}).get("entity_map", {}).items()}
    inv_ids = {t: {str(v): k for k, v in m.items()} for t, m in (man or {}).get("id_maps", {}).items()}
    ent = lambda e: inv_ent.get(e, e)   # noqa: E731
    rid = lambda t, r: inv_ids.get(t, {}).get(str(r), str(r))   # noqa: E731
    fs = sorted((f["scheme_type"], tuple(sorted(ent(e) for e in f["entities"])), round(f["peso_amount"], 2),
                 f["confidence"], tuple(sorted((x["source_table"], rid(x["source_table"], x["record_id"]))
                                               for x in f["exhibits"]))) for f in sub["findings"])
    ls = sorted((ent(l["entity"]), l["signal"], l["closed_by"]) for l in sub["leads_not_pursued"])
    return {"findings": fs, "leads": ls}


def translate_sub(sub: dict, man: dict) -> dict:
    inv_ent = {v: k for k, v in man.get("entity_map", {}).items()}
    out = json.loads(json.dumps(sub))
    for f in out["findings"]:
        f["entities"] = [inv_ent.get(e, e) for e in f["entities"]]
    return out


def mutation_base(spec: str, work: Path) -> tuple:
    """classic:N | variants:N | external:DIR -> (etiqueta, semilla, estate, clave)"""
    src, _, arg = spec.partition(":")
    if src == "external":
        d = Path(arg).resolve()
        return f"external_{d.name}", int(load_key(d / "ground_truth.json")["seed"]), d / "estate.db", d / "ground_truth.json"
    seed = int(arg)
    tag = f"seed_{seed}" if src == "classic" else f"variants_{seed}"
    estate, keyf = work / tag / "estate.db", work / "keys" / f"{tag}.json"
    if not estate.exists() or not keyf.exists():
        gen = [PY, "generator/forensic/estate.py", "--seed", str(seed), "--out", str(estate), "--key", str(keyf)]
        if src == "variants":
            gen += ["--conventions", "random"]
        sh(gen)
    return tag, seed, estate, keyf


EXT = {"sqlite": "estate.db", "csv_dir": "estate_csv", "csv_messy": "estate_csv_messy", "csv_bom_tab": "estate_tab",
       "csv_zip": "estate_csv.zip", "xlsx": "estate.xlsx", "xlsx_messy": "estate_messy.xlsx", "xlsx_zip": "estate_xlsx.zip",
       "xlsx_numeric_clabe": "estate_numclabe.xlsx", "single_csv": "invoices.csv"}


def mutation_eval(bases: list, kinds: list, vocab: str, label: str, work: Path, out: Path,
                  formats: list | None = None, format_kind: str = "none") -> list:
    rows = []
    for spec in bases:
        tag, seed, estate, keyf = mutation_base(spec, work)
        key = load_key(keyf)
        base_dir = work / "mutations" / label / tag
        o = run_cli(estate, seed, base_dir / "original")
        if o.returncode != 0:
            raise RuntimeError(f"original run failed for {tag}: {o.stderr[-800:]}")
        sub_o = json.loads((base_dir / "original" / "submission.json").read_text())
        proj_o = projection(sub_o)
        score_o = score(key, sub_o)
        jobs = [(k, "sqlite") for k in kinds] + [(format_kind, f) for f in (formats or [])]
        for kind, fmt in jobs:
            mdir = base_dir / (kind if fmt == "sqlite" else f"{kind}__{fmt}")
            mest, mman = mdir / EXT[fmt], mdir / "manifest.json"
            sh([PY, "generator/forensic/mutate.py", "--estate", str(estate), "--out", str(mest), "--kind", kind,
                "--seed", str(seed), "--vocab", vocab, "--manifest", str(mman), "--format", fmt])
            man = json.loads(mman.read_text())
            ra = run_cli(mest, seed, mdir / "run_a")
            row = {"base": tag, "seed": seed, "kind": kind, "format": fmt, "vocab": vocab,
                   "applied": "+".join(man["applied"]) or "-",
                   "expect": man["expect"], "exit_code": ra.returncode,
                   "orig_found": score_o["schemes_found"], "orig_decoys_accused": score_o["decoys_accused"],
                   "planted": score_o["schemes_planted"], "decoys": score_o["decoys_planted"]}
            if man["expect"] == "error":
                msg = (ra.stderr.strip().splitlines() or [""])[-1]
                row.update({"outcome_ok": ra.returncode != 0 and "estate structure:" in ra.stderr,
                            "identical": None, "error_message": msg[:300]})
                print(f"[{label}] {tag} {kind:<18} {fmt:<18} expect=error exit={ra.returncode} ok={row['outcome_ok']} {msg[:120]}")
                rows.append(row)
                continue
            if ra.returncode != 0:
                row.update({"outcome_ok": False, "identical": False, "error_message": ra.stderr.strip()[-400:]})
                print(f"[{label}] {tag} {kind:<18} CRASH {ra.stderr.strip()[-300:]}")
                rows.append(row)
                continue
            rb = run_cli(mest, seed, mdir / "run_b")
            sub_m = json.loads((mdir / "run_a" / "submission.json").read_text())
            log_a = json.loads((mdir / "run_a" / "run_log.json").read_text())
            log_b = json.loads((mdir / "run_b" / "run_log.json").read_text()) if rb.returncode == 0 else {}
            same = projection(sub_m, man) == proj_o
            sc = score(key, translate_sub(sub_m, man))
            vres = subprocess.run([PY, "spec/forensic-auditor/validate_format.py", "--submission",
                                   str(mdir / "run_a" / "submission.json"), "--estate", str(mest)],
                                  cwd=ROOT, capture_output=True, text=True) if fmt == "sqlite" else None
            vexp = mdir / "run_a" / "validator_estate.db"
            vres2 = subprocess.run([PY, "spec/forensic-auditor/validate_format.py", "--submission",
                                    str(mdir / "run_a" / "submission.json"), "--estate", str(vexp)],
                                   cwd=ROOT, capture_output=True, text=True) if vexp.exists() else None
            sr = log_a.get("structure_report", {})
            dis = sr.get("disabled_schemes", {})
            # degradado honesto: algo se declaró desactivado Y todo esquema perdido es de un tipo desactivado
            missed_outside = [t for t, _, _ in sc["missed"] if t not in dis]
            orig_missed = [t for t, _, _ in score_o["missed"]]
            missed_outside = [t for t in missed_outside if t not in orig_missed or missed_outside.count(t) > orig_missed.count(t)]
            row.update({"identical": same, "found": sc["schemes_found"], "decoys_accused": sc["decoys_accused"],
                        "missed_outside_disabled": ";".join(missed_outside),
                        "outcome_ok": (same if man["expect"] == "identical"
                                       else bool(dis) and not missed_outside and sc["decoys_accused"] <= score_o["decoys_accused"]),
                        "validator_vs_mutated": "n/a (not SQLite)" if vres is None else
                        ("pass" if vres.returncode == 0 else ("crash" if "Traceback" in vres.stderr else "fail")),
                        "validator_vs_export": "n/a (identity)" if vres2 is None else
                        ("pass" if vres2.returncode == 0 else "fail"),
                        "precision_lost": ";".join(f"{k}={v}" for k, v in sr.get("precision_lost", {}).items()),
                        "validator_compatible_expected": man["official_validator_compatible"],
                        "structure_status": sr.get("status"),
                        "disabled_schemes": ";".join(sr.get("disabled_schemes", {})),
                        "low_confidence": len(sr.get("low_confidence", [])),
                        "llm_assist_calls": len(sr.get("llm_assist", [])),
                        "deterministic": log_a.get("fingerprint") == log_b.get("fingerprint")})
            if not same and man["expect"] == "identical":
                pa, pb = projection(sub_m, man), proj_o
                row["diff"] = {"missing_findings": [f[:2] for f in pb["findings"] if f not in pa["findings"]],
                               "extra_findings": [f[:2] for f in pa["findings"] if f not in pb["findings"]],
                               "leads_delta": len(set(pa["leads"]) ^ set(pb["leads"]))}
            rows.append(row)
            print(f"[{label}] {tag} {kind:<18} {fmt:<18} {row['applied']:<45} identical={same} found={sc['schemes_found']}/"
                  f"{sc['schemes_planted']} decoys={sc['decoys_accused']} validator={row['validator_vs_mutated']}"
                  f"/{row['validator_vs_export']}"
                  + (f" precision_lost={row['precision_lost']}" if row["precision_lost"] else "")
                  + (f" disabled={row['disabled_schemes']}" if row["disabled_schemes"] else "")
                  + (f" diff={row['diff']}" if row.get("diff") else ""))
    write_mutation_tables(rows, label, out)
    return rows


def write_mutation_tables(rows: list, label: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    cols = ["base", "seed", "kind", "format", "applied", "vocab", "expect", "exit_code", "outcome_ok", "identical",
            "planted", "orig_found", "found", "decoys", "orig_decoys_accused", "decoys_accused", "validator_vs_mutated",
            "validator_compatible_expected", "validator_vs_export", "precision_lost", "missed_outside_disabled",
            "structure_status",
            "disabled_schemes", "low_confidence",
            "llm_assist_calls", "deterministic", "error_message"]
    with (out / f"mutations_{label}.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    by = {}
    for r in rows:
        group = r["kind"] if r.get("format", "sqlite") == "sqlite" else f"format:{r['format']}"
        k = by.setdefault(group, {"kind": group, "runs": 0, "outcome_ok": 0, "identical": 0, "planted": 0,
                                      "orig_found": 0, "found": 0, "decoys": 0, "orig_decoys_accused": 0,
                                      "decoys_accused": 0, "validator_pass": 0, "validator_compatible": 0,
                                      "validator_pass_when_compatible": 0, "deterministic": 0})
        k["runs"] += 1
        k["outcome_ok"] += bool(r.get("outcome_ok"))
        k["identical"] += bool(r.get("identical"))
        for c in ("planted", "orig_found", "decoys", "orig_decoys_accused"):
            k[c] += r[c]
        k["found"] += r.get("found", 0) or 0
        k["decoys_accused"] += r.get("decoys_accused", 0) or 0
        k["validator_pass"] += r.get("validator_vs_mutated") == "pass"
        comp = bool(r.get("validator_compatible_expected"))
        k["validator_compatible"] += comp
        k["validator_pass_when_compatible"] += comp and r.get("validator_vs_mutated") == "pass"
        k["validator_export_pass"] = k.get("validator_export_pass", 0) + (r.get("validator_vs_export") == "pass")
        k["validator_export_na_identity"] = k.get("validator_export_na_identity", 0) + \
            (r.get("validator_vs_export") == "n/a (identity)")
        k["validator_export_fail"] = k.get("validator_export_fail", 0) + (r.get("validator_vs_export") == "fail")
        k["deterministic"] += bool(r.get("deterministic"))
    if by:
        with (out / f"mutations_{label}_by_kind.csv").open("w", newline="") as fh:
            fields = list(next(iter(by.values())).keys())
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            tot = {f: ("TOTAL" if f == "kind" else 0) for f in fields}
            for v in by.values():
                w.writerow(v)
                for f in fields[1:]:
                    tot[f] += v[f]
            w.writerow(tot)
    (out / f"mutations_{label}.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False, default=str))


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
    ap.add_argument("--mutations", nargs="*", help="modo mutaciones: kinds de generator/forensic/mutate.py o 'all'")
    ap.add_argument("--mutation-bases", nargs="*", default=[],
                    help="classic:N | variants:N | external:DIR (la semilla de mutación es la del estate base)")
    ap.add_argument("--vocab", default="tuning", choices=["tuning", "heldout"])
    ap.add_argument("--mutation-label", default="tuning")
    ap.add_argument("--formats", nargs="*", default=[], help="formatos de entrada a evaluar (mutate.py --format) o 'all'")
    ap.add_argument("--format-kind", default="none", help="mutación estructural aplicada antes de exportar el formato")
    ap.add_argument("--tuned-bases", nargs="*", default=[],
                    help="bases usadas para ajustar; el harness rechaza reportar held-out sobre ellas")
    a = ap.parse_args()
    if a.mutations is not None:
        import importlib.util
        spec = importlib.util.spec_from_file_location("mutate", ROOT / "generator" / "forensic" / "mutate.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        kinds = mod.KINDS if a.mutations in ([], ["all"]) else a.mutations
        clash = set(a.mutation_bases) & set(a.tuned_bases)
        if clash:
            print(f"FAIL mutation bases overlap with tuning bases: {sorted(clash)}")
            return 2
        work = Path(a.work) if Path(a.work).is_absolute() else ROOT / a.work
        out = Path(a.out) if Path(a.out).is_absolute() else ROOT / a.out
        formats = [f for f in mod.FORMATS if f != "sqlite"] if a.formats == ["all"] else a.formats
        if a.mutations == ["none"]:
            kinds = []
        rows = mutation_eval(a.mutation_bases, kinds, a.vocab, a.mutation_label, work, out, formats, a.format_kind)
        bad = [r for r in rows if not r.get("outcome_ok") or r.get("deterministic") is False]
        print(f"{len(rows)} mutated runs, {len(rows) - len(bad)} as expected")
        return 1 if bad else 0
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
