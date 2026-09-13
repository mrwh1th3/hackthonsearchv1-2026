"""Detectores deterministas. Solo abren leads: ninguno acusa. Cada lead nombra la
entidad, la señal que disparó y qué tipología hay que investigar."""
from __future__ import annotations

from collections import defaultdict

from .config import LIMIT_CANDIDATES, NEAR_LIMIT_RATIO, QUARTER_END_DAYS, RECENT_REGISTRATION_DAYS
from .estate import Estate, d, days_between


def _lead(kind: str, subject: tuple, entity: str, signal: str, detail: str) -> dict:
    return {"kind": kind, "subject": subject, "entity": entity, "signal": signal, "detail": detail}


def is_quarter_end(iso_date: str) -> bool:
    x = d(iso_date)
    if x.month not in (3, 6, 9, 12):
        return False
    last = 31 if x.month in (3, 12) else 30
    return last - x.day < QUARTER_END_DAYS


def run_detectors(e: Estate) -> list[dict]:
    leads: list[dict] = []
    co = e.company_rfc
    purchase_invs = defaultdict(list)
    for r in e.q("SELECT * FROM invoices WHERE receiver_rfc = ? ORDER BY issue_date, uuid", (co,)):
        purchase_invs[r["issuer_rfc"]].append(dict(r))
    sales = defaultdict(list)
    for r in e.q("SELECT * FROM invoices WHERE issuer_rfc = ? ORDER BY issue_date, uuid", (co,)):
        sales[r["receiver_rfc"]].append(dict(r))
    pos = defaultdict(list)
    for r in e.q("SELECT * FROM purchase_orders ORDER BY date, po_id"):
        pos[r["vendor_rfc"]].append(dict(r))
    contracts = {r["vendor_rfc"] for r in e.q("SELECT vendor_rfc FROM contracts")}
    efos = {r["rfc"]: dict(r) for r in e.q("SELECT * FROM efos_list")}

    for rfc in sorted(purchase_invs):
        invs = purchase_invs[rfc]
        v = e.vendors.get(rfc)
        ent = f"RFC:{rfc}"
        if rfc in efos:
            leads.append(_lead("phantom_vendor", (rfc,), ent, "efos_list_match",
                               f"RFC on the Art. 69-B list as '{efos[rfc]['status']}'"))
        if v and v.get("registered_date"):
            gap = days_between(v["registered_date"], invs[0]["issue_date"])
            if 0 <= gap <= RECENT_REGISTRATION_DAYS:
                leads.append(_lead("phantom_vendor", (rfc,), ent, "recently_registered_vendor",
                                   f"registered {gap} days before its first invoice"))
            elif gap < 0:
                # facturó antes de su alta: inconsistencia del padrón, se abre para explicarla como anomalía
                leads.append(_lead("phantom_vendor", (rfc,), ent, "invoiced_before_registration",
                                   f"first invoice {-gap} days before its registration date"))
        if rfc not in contracts:
            po_amounts = [p["amount"] for p in pos.get(rfc, [])]
            undoc = [i for i in invs if not any(abs(a - i["total"]) <= 0.01 * i["total"] for a in po_amounts)]
            if len(undoc) >= 2:
                leads.append(_lead("phantom_vendor", (rfc,), ent, "undocumented_purchases",
                                   f"{len(undoc)} invoices with no matching purchase order and no contract"))

    from .config import OBSERVED_LIMIT_MIN_ORDERS, OBSERVED_LIMIT_ROUND
    from .investigate import approval_limits
    limits = approval_limits(e, OBSERVED_LIMIT_MIN_ORDERS, OBSERVED_LIMIT_ROUND)
    emp_by_clabe = {x["bank_clabe"]: x for x in e.employees if x.get("bank_clabe")}
    for rfc, v in sorted(e.vendors.items()):
        vc = v.get("bank_clabe")
        if not vc:
            continue
        for t in e.q("SELECT * FROM bank_txns WHERE from_clabe = ? ORDER BY date, txn_id", (vc,)):
            emp = emp_by_clabe.get(t["to_clabe"])
            if emp:
                leads.append(_lead("kickback", (rfc, emp["emp_id"]), f"RFC:{rfc}",
                                   "vendor_to_employee_transfer",
                                   f"{t['txn_id']}: vendor account paid {Estate.emp_ref(emp)}'s account"))
        approvers = {p["approver"] for p in pos.get(rfc, [])}
        for emp in e.employees:
            ec = emp.get("bank_clabe") or ""
            if ec[:3] == vc[:3] and emp["name"] in approvers:
                leads.append(_lead("kickback", (rfc, emp["emp_id"]), f"RFC:{rfc}",
                                   "employee_vendor_shared_bank",
                                   f"approver {Estate.emp_ref(emp)} and vendor bank at institution {vc[:3]}"))
        if e.company_clabes:
            back = e.q(f"SELECT count(*) FROM bank_txns WHERE from_clabe = ? AND to_clabe IN "
                       f"({','.join('?' * len(e.company_clabes))})", (vc, *sorted(e.company_clabes)))[0][0]
            if back and rfc in purchase_invs:
                leads.append(_lead("round_tripping", (rfc,), f"RFC:{rfc}", "funds_returned_to_company",
                                   f"{back} transfers from the vendor's account back to the company"))
        if rfc in purchase_invs and rfc in sales:
            leads.append(_lead("round_tripping", (rfc,), f"RFC:{rfc}", "vendor_is_customer",
                               "the company both buys from and invoices this RFC"))

        near = []
        for p in pos.get(rfc, []):
            for lim in limits:
                if NEAR_LIMIT_RATIO * lim <= p["amount"] < lim:
                    near.append((lim, p))
        by_lim = defaultdict(list)
        for lim, p in near:
            by_lim[lim].append(p)
        for lim, ps in sorted(by_lim.items()):
            ps.sort(key=lambda p: (p["date"], p["po_id"]))
            for i in range(len(ps) - 2):
                if days_between(ps[i]["date"], ps[i + 2]["date"]) <= 75:
                    leads.append(_lead("threshold_splitting", (rfc,), f"RFC:{rfc}", "po_below_approval_limit",
                                       f"{len(ps)} orders between {NEAR_LIMIT_RATIO:.0%} and 100% of MXN {lim:,.0f}"))
                    break

    for rfc in sorted(sales):
        qe = [i for i in sales[rfc] if is_quarter_end(i["issue_date"])]
        if qe:
            leads.append(_lead("revenue_inflation", (rfc,), f"RFC:{rfc}", "quarter_end_revenue",
                               f"{len(qe)} sales invoices in the last {QUARTER_END_DAYS} days of a quarter"))
        canc = [i for i in sales[rfc] if i["status"] == "cancelado"]
        if canc:
            leads.append(_lead("revenue_inflation", (rfc,), f"RFC:{rfc}", "cancelled_sales_invoice",
                               f"{len(canc)} sales invoices later cancelled"))
    return leads


def group_leads(leads: list[dict]) -> list[dict]:
    """Un expediente de investigación por (tipología, sujeto), con todas sus señales."""
    groups: dict[tuple, dict] = {}
    for l in leads:
        key = (l["kind"], l["subject"])
        g = groups.setdefault(key, {"kind": l["kind"], "subject": l["subject"], "entity": l["entity"],
                                    "signals": [], "details": []})
        if l["signal"] not in g["signals"]:
            g["signals"].append(l["signal"])
            g["details"].append(l["detail"])
    order = {"phantom_vendor": 0, "kickback": 1, "round_tripping": 2, "threshold_splitting": 3,
             "revenue_inflation": 4}
    return sorted(groups.values(), key=lambda g: (order[g["kind"]], g["subject"]))
