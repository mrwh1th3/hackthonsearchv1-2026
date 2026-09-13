"""Validador previo a imprimir: una acusación que no valida se convierte en lead cerrado
por el validador. Replica las reglas de spec/forensic-auditor/validate_format.py."""
from __future__ import annotations

from .config import MAX_NARRATIVE_WORDS, MIN_EXHIBITS, PESO_TOLERANCE
from .estate import Estate

ID_COLUMN = {"ledger": "entry_id", "invoices": "uuid", "bank_txns": "txn_id", "vendors": "rfc",
             "efos_list": "rfc", "purchase_orders": "po_id", "contracts": "contract_id", "employees": "emp_id"}
AMOUNT_COLUMN = {"invoices": "total", "bank_txns": "amount", "purchase_orders": "amount", "contracts": "value"}
RFC_FIELDS = {"vendors": ("rfc",), "efos_list": ("rfc",),
              "invoices": ("issuer_rfc", "receiver_rfc"),
              "purchase_orders": ("vendor_rfc",), "contracts": ("vendor_rfc",)}
EMPLOYEE_FIELDS = {"employees": ("emp_id",), "ledger": ("approver",),
                   "purchase_orders": ("requester", "approver")}


def _backed_entities(e: Estate, cited_rows: list[tuple[str, dict]]) -> set[str]:
    """Resolve participation from typed fields or exact account joins only.

    A bank reference, exhibit note, person's name, or shared bank prefix is not
    identity evidence. Account ownership comes from the actual estate masters;
    an unrelated master row that was not cited cannot establish participation
    unless a cited transfer uses that exact account.
    """
    employees = {str(emp["emp_id"]): Estate.emp_ref(emp) for emp in e.employees}
    employees.update({ref: ref for ref in list(employees.values())})
    accounts: dict[str, set[str]] = {}
    for vendor in e.vendors.values():
        if vendor.get("bank_clabe"):
            accounts.setdefault(str(vendor["bank_clabe"]), set()).add(f"RFC:{vendor['rfc']}")
    for emp in e.employees:
        if emp.get("bank_clabe"):
            accounts.setdefault(str(emp["bank_clabe"]), set()).add(Estate.emp_ref(emp))
    supported = set()
    for table, row in cited_rows:
        for field in RFC_FIELDS.get(table, ()):
            if row.get(field):
                supported.add(f"RFC:{row[field]}")
        for field in EMPLOYEE_FIELDS.get(table, ()):
            ref = employees.get(str(row.get(field) or ""))
            if ref:
                supported.add(ref)
        if table == "bank_txns":
            for field in ("from_clabe", "to_clabe"):
                supported.update(accounts.get(str(row.get(field) or ""), ()))
    return supported


def validate_finding(e: Estate, f: dict) -> list[str]:
    errs = []
    if len(f["exhibits"]) < MIN_EXHIBITS:
        errs.append(f"only {len(f['exhibits'])} exhibits (minimum {MIN_EXHIBITS})")
    if len(f["narrative"].split()) > MAX_NARRATIVE_WORDS:
        errs.append(f"narrative has {len(f['narrative'].split())} words (maximum {MAX_NARRATIVE_WORDS})")
    ids = {x["exhibit_id"] for x in f["exhibits"]}
    for s in f["money_trail"]:
        if s["exhibit_id"] not in ids:
            errs.append(f"money trail step cites unknown exhibit {s['exhibit_id']}")
    per_table: dict[str, float] = {}
    cited_rows = []
    for x in f["exhibits"]:
        col = ID_COLUMN[x["source_table"]]
        rows = e.q(f"SELECT * FROM {x['source_table']} WHERE {col} = ?", (x["record_id"],))
        if not rows:
            errs.append(f"{x['source_table']}.{x['record_id']} does not exist")
            continue
        st = getattr(e, "structure", None)
        if st is not None and not st.identity and not st.original_exists(x["source_table"], x["record_id"]):
            errs.append(f"{x['source_table']}.{x['record_id']} does not resolve in the original estate "
                        f"(as {st.original_id(x['source_table'], x['record_id'])})")
            continue
        cited_rows.append((x["source_table"], dict(rows[0])))
        amt = AMOUNT_COLUMN.get(x["source_table"])
        if amt:
            per_table[x["source_table"]] = per_table.get(x["source_table"], 0.0) + float(rows[0][amt] or 0)
    claimed = f["peso_amount"]
    if not per_table:
        errs.append("no amount-bearing exhibit")
    else:
        best_table, best = min(per_table.items(), key=lambda kv: abs(claimed - kv[1]))
        f["reconciled_against"] = {"table": best_table, "sum": round(best, 2), "per_table":
                                   {k: round(v, 2) for k, v in sorted(per_table.items())}}
        if abs(claimed - best) > PESO_TOLERANCE * max(best, 1):
            errs.append(f"peso_amount {claimed:,.2f} does not reconcile (closest {best_table} = {best:,.2f})")
    supported = _backed_entities(e, cited_rows)
    for ent in f["entities"]:
        if ":" not in ent:
            errs.append(f"entity {ent} lacks a type prefix")
        elif ent not in supported:
            errs.append(f"entity {ent} has no structured evidence of involvement in the cited records")
    return errs
