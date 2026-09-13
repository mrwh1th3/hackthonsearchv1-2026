"""Corrida completa: detectores → investigadores → challenger → validador → salida."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from .detectors import group_leads, run_detectors
from .estate import Estate
from .structure import prepare
from .triage import branch, build_triage
from .investigate import Investigator
from .llm import CHALLENGER_SYSTEM, LLM
from .validate import validate_finding

SUBMISSION_KEYS = ("scheme_type", "entities", "rule_broken", "narrative", "peso_amount", "confidence",
                   "money_trail", "exhibits")


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def run(estate_path: str, seed: int, llm: LLM) -> dict:
    t0 = time.monotonic()
    prep = prepare(estate_path, llm)          # estructura: mapeo + normalización antes de leer nada
    e = Estate(estate_path, conn=prep.conn, structure=prep)
    inv = Investigator(e)
    raw = run_detectors(e)
    groups = [g for g in group_leads(raw) if g["kind"] not in prep.disabled]
    findings, leads, lead_refs = [], [], {}
    for g in groups:
        res = inv.investigate(g)
        base = {"entity": g["entity"], "signal": ", ".join(g["signals"]), "signal_detail": "; ".join(g["details"]),
                "investigated_as": g["kind"], "tool_calls_made": res["tool_calls"]}
        refs = [g["entity"]] + ([Estate.emp_ref(x) for x in e.employees if x["emp_id"] == g["subject"][1]][:1]
                                if g["kind"] == "kickback" and len(g["subject"]) > 1 else [])
        if res["closed"]:
            leads.append({**base, "reason": res["reason"], "closed_by": res["closed_by"],
                          "defense": res.get("defense", [])})
            lead_refs[id(leads[-1])] = refs
            continue
        errs = validate_finding(e, res)
        if errs:
            leads.append({**base, "reason": "Candidate finding failed validation before printing: " + "; ".join(errs),
                          "closed_by": "validator", "defense": []})
            lead_refs[id(leads[-1])] = refs
            continue
        res["signals"] = g["signals"]
        res["tool_calls"] = res["tool_calls"] + ["validate_finding"]
        text = llm.ask("challenger", CHALLENGER_SYSTEM, json.dumps(
            {k: res[k] for k in ("scheme_type", "entities", "peso_amount", "evidence", "rule_broken")},
            ensure_ascii=False, sort_keys=True))
        if text:
            res["defense"].append({"argument": text.strip(), "held": False, "by": "llm",
                                   "why": "Deterministic evidence above is unchanged by this argument; "
                                          "confidence is set by rules, not by the model."})
        findings.append(res)

    # entidades con hallazgo no se listan también como leads cerrados de la misma tipología
    accused = {(f["scheme_type"], ent) for f in findings for ent in f["entities"]}
    leads = [l for l in leads if (l["investigated_as"], l["entity"]) not in accused]
    findings.sort(key=lambda f: (-f["peso_amount"], f["scheme_type"], f["entities"]))
    if not prep.identity:
        _cite_original_ids(findings, prep)
    triage = build_triage(e, seed, findings, [(l, lead_refs[id(l)]) for l in leads], prep.disabled, prep.original_id)

    wall = round(time.monotonic() - t0, 3)
    return {"seed": seed, "estate_path": estate_path, "estate_sha256": file_sha256(estate_path),
            "structure_report": prep.report, "triage": triage,
            "company_rfc": e.company_rfc, "period": e.period, "bank_horizon": e.bank_horizon.isoformat(),
            "estate_profile": e.profile,
            "detector_hits": len(raw), "leads_investigated": len(groups),
            "findings": findings, "leads": leads,
            "run_metadata": {"llm_calls": llm.calls, "mxn_cost": round(llm.cost_mxn, 4),
                             "wall_clock_seconds": wall,
                             "cost_by_role": {k: round(v, 4) for k, v in sorted(llm.by_role.items())},
                             "deterministic": True, "llm_mode": llm.mode, "model": llm.model if llm.mode != "off" else None}}


def _cite_original_ids(findings: list[dict], prep) -> None:
    """record_id y partidas de conciliación en los ids del estate original que entregó el juez."""
    for f in findings:
        for x in f["exhibits"]:
            x["record_id"] = prep.original_id(x["source_table"], x["record_id"])
        rec = f.get("reconciliation")
        if rec:
            rec["items"] = [(prep.original_id(rec["table"], k), a) for k, a in rec["items"]]


def to_submission(r: dict) -> dict:
    return {"seed": r["seed"],
            "findings": [dict({k: f[k] for k in SUBMISSION_KEYS}, fraud_flag=True) for f in r["findings"]],
            "leads_not_pursued": [{"entity": l["entity"], "signal": l["signal"], "reason": l["reason"],
                                   "tool_calls_made": l["tool_calls_made"], "closed_by": l["closed_by"],
                                   "fraud_flag": False}
                                  for l in r["leads"]],
            "run_metadata": r["run_metadata"]}


def content_fingerprint(r: dict) -> str:
    """Huella de todo lo que el sistema concluyó, excluyendo el reloj. `structure_report` (cómo se leyó el
    estate) y `triage` (derivado de hallazgos, leads y el padrón) quedan fuera para que la huella de un estate
    canónico siga siendo la misma que antes de existir esos pasos; su determinismo se prueba aparte."""
    body = {k: v for k, v in r.items() if k not in ("run_metadata", "estate_path", "structure_report", "triage")}
    body["llm"] = {k: v for k, v in r["run_metadata"].items() if k != "wall_clock_seconds"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def write_outputs(r: dict, out_dir: str) -> dict:
    from .casefile import render_html
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    r["fingerprint"] = content_fingerprint(r)
    tri = r.get("triage")
    if tri and "records" in tri:
        # el run_log referencia el triage (archivo aparte, puede tener miles de sujetos sin señal)
        body = json.dumps(tri, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        r["triage"] = {"file": "triage.json", "branch_files": {"fraud": "branch_fraud.json",
                                                               "no_fraud": "branch_no_fraud.json"},
                       "sha256": hashlib.sha256(body.encode()).hexdigest(), "counts": tri["counts"]}
    (out / "run_log.json").write_text(json.dumps(r, indent=2, ensure_ascii=False, default=str))
    (out / "submission.json").write_text(json.dumps(to_submission(r), indent=2, ensure_ascii=False))
    (out / "case_file.html").write_text(render_html(r))
    paths = {"run_log": str(out / "run_log.json"), "submission": str(out / "submission.json"),
             "case_file": str(out / "case_file.html")}
    if tri and "records" in tri:
        paths.update(write_triage(tri, out))
    return paths


def write_triage(triage: dict, out: Path) -> dict:
    dump = lambda o: json.dumps(o, indent=2, ensure_ascii=False, sort_keys=True) + "\n"   # noqa: E731
    (out / "triage.json").write_text(dump(triage))
    (out / "branch_fraud.json").write_text(dump(branch(triage, True)))
    (out / "branch_no_fraud.json").write_text(dump(branch(triage, False)))
    return {"triage": str(out / "triage.json"), "branch_fraud": str(out / "branch_fraud.json"),
            "branch_no_fraud": str(out / "branch_no_fraud.json")}
