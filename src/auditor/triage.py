"""Bandera explícita de fraude y separación en dos ramas.

Todo lo que el proceso evalúa recibe `fraud_flag`: true si terminó en hallazgo, false si se cerró como lead o
si ningún detector lo levantó. `triage.json` tiene un registro por (sujeto, tipología evaluada) más un
consolidado por sujeto; `branch_fraud.json` y `branch_no_fraud.json` son sus dos particiones, con la misma
forma de registro, para que cada rama las consuma sin volver a correr el auditor.

La bandera la pone el código determinista a partir del veredicto ya validado; no la decide ningún LLM.
Ids: RFC en su forma canónica (sin prefijo ni espacios, en mayúsculas) y emp_id tal como lo escribe el
estate original; `record_ids` usa los ids del estate original."""
from __future__ import annotations

import json
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent / "schemas" / "triage_schema.json"
TRIAGE_VERSION = 1


def _subject_type(sid: str, vendors: set, customers: set) -> str:
    if sid.startswith("EMP:"):
        return "employee"
    if sid.startswith("CLABE:"):
        return "company_account"
    rfc = sid.split(":", 1)[1] if ":" in sid else sid
    if rfc in vendors:
        return "vendor"
    if rfc in customers:
        return "customer"
    return "vendor"


def _master_ref(sid: str, e, original_id) -> list[dict]:
    if sid.startswith("RFC:"):
        rfc = sid[4:]
        if rfc in e.vendors:
            return [{"source_table": "vendors", "record_id": original_id("vendors", rfc)}]
        return []
    if sid.startswith("EMP:"):
        emp = _emp_by_ref(e).get(sid)
        return [{"source_table": "employees", "record_id": original_id("employees", emp["emp_id"])}] if emp else []
    return []


def _emp_by_ref(e) -> dict:
    if not hasattr(e, "_emp_by_ref"):
        from .estate import Estate
        e._emp_by_ref = {Estate.emp_ref(x): x for x in e.employees}
    return e._emp_by_ref


def build_triage(e, seed: int, findings: list[dict], leads: list[tuple], disabled: dict, original_id) -> dict:
    """findings: hallazgos finales (ids ya en forma original). leads: [(lead, subject_refs)] finales."""
    from .estate import Estate
    vendors = set(e.vendors)
    customers = {r[0] for r in e.q("SELECT DISTINCT receiver_rfc FROM invoices WHERE issuer_rfc = ?", (e.company_rfc,))
                 if r[0] and r[0] != e.company_rfc}
    records = []
    for f in findings:
        for ent in f["entities"]:
            records.append({
                "subject_id": ent, "subject_type": _subject_type(ent, vendors, customers),
                "scheme_type": f["scheme_type"], "signal": ", ".join(f.get("signals", [])),
                "fraud_flag": True, "status": "finding", "confidence": f["confidence"],
                "score": f.get("scoring"), "signals": list(f.get("signals", [])),
                "reason": f["narrative"], "peso_amount": f["peso_amount"],
                "record_ids": [{"source_table": x["source_table"], "record_id": x["record_id"]} for x in f["exhibits"]],
                "related_subjects": [x for x in f["entities"] if x != ent],
                "tool_calls": list(f.get("tool_calls", [])), "closed_by": None})
    for l, refs in leads:
        for ent in refs:
            records.append({
                "subject_id": ent, "subject_type": _subject_type(ent, vendors, customers),
                "scheme_type": l["investigated_as"], "signal": l["signal"],
                "fraud_flag": False, "status": "closed_lead", "confidence": None,
                "score": next((d_.get("scoring") for d_ in l.get("defense", []) if d_.get("scoring")), None),
                "signals": [s.strip() for s in l["signal"].split(",") if s.strip()],
                "reason": l["reason"], "peso_amount": None,
                "record_ids": _master_ref(ent, e, original_id),
                "related_subjects": [x for x in refs if x != ent],
                "tool_calls": list(l["tool_calls_made"]), "closed_by": l["closed_by"]})

    seen = {r["subject_id"] for r in records}
    not_run = (" Not evaluated for missing data: " + "; ".join(f"{s} ({', '.join(m)})" for s, m in disabled.items())
               + ".") if disabled else ""
    universe = [(f"RFC:{r}", "vendor") for r in sorted(vendors)] + \
               [(f"RFC:{r}", "customer") for r in sorted(customers - vendors)] + \
               [(Estate.emp_ref(x), "employee") for x in e.employees] + \
               [(f"CLABE:{c}", "company_account") for c in sorted(e.company_clabes)]
    for sid, typ in universe:
        if sid in seen:
            continue
        seen.add(sid)
        reason = ("Company's own bank account; it is the payer or collector in every scheme, not a subject of one."
                  if typ == "company_account" else
                  "No detector raised a signal for this subject, so no investigation was opened.") + not_run
        records.append({
            "subject_id": sid, "subject_type": typ, "scheme_type": None, "signal": None,
            "fraud_flag": False, "status": "no_signal", "confidence": None, "score": None, "signals": [],
            "reason": reason, "peso_amount": None, "record_ids": _master_ref(sid, e, original_id),
            "related_subjects": [], "tool_calls": [], "closed_by": None})
    records.sort(key=sort_key)

    subjects: dict[str, dict] = {}
    for r in records:
        s = subjects.setdefault(r["subject_id"], {"subject_id": r["subject_id"], "subject_type": r["subject_type"],
                                                  "fraud_flag": False, "schemes_flagged": [], "schemes_closed": [],
                                                  "records": 0})
        s["records"] += 1
        if r["fraud_flag"]:
            s["fraud_flag"] = True
            if r["scheme_type"] not in s["schemes_flagged"]:
                s["schemes_flagged"].append(r["scheme_type"])
        elif r["status"] == "closed_lead" and r["scheme_type"] not in s["schemes_closed"]:
            s["schemes_closed"].append(r["scheme_type"])
    rollup = [dict(v, schemes_flagged=sorted(v["schemes_flagged"]), schemes_closed=sorted(v["schemes_closed"]))
              for _, v in sorted(subjects.items())]
    return {"triage_version": TRIAGE_VERSION, "seed": seed,
            "counts": {"records": len(records), "fraud_flag_true": sum(r["fraud_flag"] for r in records),
                       "fraud_flag_false": sum(not r["fraud_flag"] for r in records),
                       "subjects": len(rollup), "subjects_flagged": sum(s["fraud_flag"] for s in rollup),
                       "by_status": {k: sum(1 for r in records if r["status"] == k)
                                     for k in ("finding", "closed_lead", "no_signal")}},
            "disabled_schemes": dict(disabled), "records": records, "subjects": rollup}


def sort_key(r: dict) -> tuple:
    return (not r["fraud_flag"], r["subject_id"], r["scheme_type"] or "~", r["status"], r["signal"] or "",
            r["closed_by"] or "", json.dumps(r["record_ids"], sort_keys=True))


def branch(triage: dict, flag: bool) -> dict:
    recs = [r for r in triage["records"] if r["fraud_flag"] is flag]
    subs = [s for s in triage["subjects"] if s["fraud_flag"] is flag]
    return {"triage_version": triage["triage_version"], "seed": triage["seed"],
            "branch": "fraud" if flag else "no_fraud", "fraud_flag": flag,
            "counts": {"records": len(recs), "subjects": len(subs)}, "records": recs, "subjects": subs}
