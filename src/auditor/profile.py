"""Perfilado del estate antes de investigar.

Los estates de terceros no siguen nuestras convenciones: la orden de compra puede registrar
el subtotal o el total con IVA, el aprobador puede venir como nombre o como `EMP:0001`, la
empresa puede operar con más de una cuenta y la lista 69-B puede traer solo 'presunto'.
Aquí se deducen esas convenciones de los propios datos, una sola vez y de forma determinista.
Todas las reglas leen el resultado; el perfil completo queda en run_log.json (`estate_profile`).

Nada de esto lee texto libre: solo montos, fechas, IDs y CLABEs."""
from __future__ import annotations

from collections import Counter, defaultdict

from .config import (LIMIT_CANDIDATES, NEAR_LIMIT_RATIO, PO_BASE_DOMINANCE, PO_MATCH_DAYS, PO_MATCH_TOLERANCE,
                     RECENT_REGISTRATION_DAYS, RECENT_REGISTRATION_QUANTILE)


def _quantile(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * (len(xs) - 1)))]


def _days(a: str, b: str) -> int:
    from .estate import days_between
    return days_between(a, b)


def detect_po_base(pos: list[dict], invs: list[dict]) -> dict:
    """Vota, sobre todas las facturas de compra, si el monto de la orden coincide con el total o con
    el subtotal. Se elige una sola base por estate (la dominante); ambas solo si las dos son frecuentes.
    Emparejar por factura con "la base que convenga" crearía coincidencias espurias."""
    by_vendor = defaultdict(list)
    for p in pos:
        by_vendor[p["vendor_rfc"]].append(p)
    votes = Counter()
    for i in invs:
        ps = [p for p in by_vendor.get(i["issuer_rfc"], []) if abs(_days(p["date"], i["issue_date"])) <= PO_MATCH_DAYS]
        t = i["total"] and any(abs(p["amount"] - i["total"]) <= PO_MATCH_TOLERANCE * i["total"] for p in ps)
        s = i["subtotal"] and any(abs(p["amount"] - i["subtotal"]) <= PO_MATCH_TOLERANCE * i["subtotal"] for p in ps)
        if t and not s:
            votes["total"] += 1
        elif s and not t:
            votes["subtotal"] += 1
        elif s and t:
            votes["ambiguous"] += 1
    t, s = votes["total"], votes["subtotal"]
    if t == 0 and s == 0:
        base = ["total"]
    elif t >= PO_BASE_DOMINANCE * (t + s):
        base = ["total"]
    elif s >= PO_BASE_DOMINANCE * (t + s):
        base = ["subtotal"]
    else:
        base = ["total", "subtotal"]
    return {"bases": base, "votes": dict(sorted(votes.items()))}


def detect_person_format(values: list[str], emp_ids: set[str], emp_names: set[str]) -> dict:
    ids = sum(1 for v in values if v in emp_ids)
    names = sum(1 for v in values if str(v).strip().lower() in emp_names)
    blank = sum(1 for v in values if not str(v or "").strip())
    fmt = "emp_id" if ids > names else ("name" if names else "unknown")
    return {"format": fmt, "as_emp_id": ids, "as_name": names, "blank": blank,
            "unresolved": len(values) - ids - names - blank}


def detect_own_accounts(bank: list[dict], main: set[str], third_party: set[str]) -> list[str]:
    """Cuenta propia adicional: CLABE que no es de proveedor ni de empleado y que intercambia dinero
    con la cuenta principal en AMBOS sentidos. Un cliente solo paga a la empresa; un proveedor
    registrado tiene CLABE en `vendors`. La referencia bancaria no se usa."""
    sent, recv = set(), set()
    for t in bank:
        if t["from_clabe"] in main and t["to_clabe"] not in main:
            sent.add(t["to_clabe"])
        if t["to_clabe"] in main and t["from_clabe"] not in main:
            recv.add(t["from_clabe"])
    return sorted(c for c in sent & recv if c not in third_party)


def observed_thresholds(amounts: list[float]) -> list[float]:
    """Umbrales de política visibles en la distribución: montos redondos con muchas órdenes justo
    debajo y pocas justo encima (la huella de quien evita un límite o de una política real)."""
    out = []
    for lim in sorted(set(LIMIT_CANDIDATES) | {float(x) for x in range(10_000, 1_000_001, 10_000)}):
        below = sum(1 for a in amounts if NEAR_LIMIT_RATIO * lim <= a < lim)
        above = sum(1 for a in amounts if lim <= a < lim * (2 - NEAR_LIMIT_RATIO))
        if below >= 3 and below >= 2 * max(1, above):
            out.append(lim)
    return out


def build_profile(e) -> dict:
    emp_ids = {x["emp_id"] for x in e.employees}
    emp_names = {str(x["name"]).strip().lower() for x in e.employees if x.get("name")}
    pos = [dict(r) for r in e.q("SELECT * FROM purchase_orders ORDER BY date, po_id")]
    purchases = [dict(r) for r in e.q("SELECT * FROM invoices WHERE receiver_rfc = ? ORDER BY issue_date, uuid",
                                      (e.company_rfc,))]
    sales = [dict(r) for r in e.q("SELECT * FROM invoices WHERE issuer_rfc = ? ORDER BY issue_date, uuid",
                                  (e.company_rfc,))]
    bank = [dict(r) for r in e.q("SELECT * FROM bank_txns ORDER BY date, txn_id")]

    po_base = detect_po_base(pos, purchases)
    approver_fmt = detect_person_format([p["approver"] for p in pos], emp_ids, emp_names)
    requester_fmt = detect_person_format([p["requester"] for p in pos], emp_ids, emp_names)
    ledger_fmt = detect_person_format([r["approver"] for r in e.q("SELECT approver FROM ledger")], emp_ids, emp_names)

    third = {v["bank_clabe"] for v in e.vendors.values() if v.get("bank_clabe")} | \
            {x["bank_clabe"] for x in e.employees if x.get("bank_clabe")}
    main = set(e.company_clabes)
    own = detect_own_accounts(bank, main, third)

    # límites observados por aprobador (resuelto a emp_id si se puede)
    per_approver = defaultdict(list)
    for p in pos:
        emp = e.person(p["approver"])
        per_approver[emp["emp_id"] if emp else str(p["approver"])].append(p["amount"])
    approver_max = {k: round(max(v), 2) for k, v in sorted(per_approver.items()) if len(v) >= 3}
    thresholds = observed_thresholds([p["amount"] for p in pos])

    # cadencia de pago: días factura → pago (referencia al UUID o monto exacto a la CLABE del proveedor)
    delays = []
    pays_by_clabe = defaultdict(list)
    for t in bank:
        if t["from_clabe"] in main:
            pays_by_clabe[t["to_clabe"]].append(t)
    for i in purchases:
        v = e.vendors.get(i["issuer_rfc"]) or {}
        for t in pays_by_clabe.get(v.get("bank_clabe"), []):
            if abs(t["amount"] - i["total"]) <= 0.005 * max(i["total"], 1) and 0 <= _days(i["issue_date"], t["date"]) <= 180:
                delays.append(_days(i["issue_date"], t["date"]))
                break

    # antigüedad del proveedor al facturar por primera vez: qué es "reciente" depende del padrón
    first_inv = {}
    for i in purchases:
        first_inv.setdefault(i["issuer_rfc"], i["issue_date"])
    gaps = [_days(v["registered_date"], first_inv[r]) for r, v in e.vendors.items()
            if r in first_inv and v.get("registered_date")]
    q = _quantile([g for g in gaps if g >= 0], RECENT_REGISTRATION_QUANTILE)
    recent_days = int(min(RECENT_REGISTRATION_DAYS, q)) if q is not None else RECENT_REGISTRATION_DAYS

    efos = Counter(r["status"] for r in e.q("SELECT status FROM efos_list"))
    return {
        "company_rfc": e.company_rfc,
        "company_accounts": {"dominant_outgoing": sorted(main), "own_by_two_way_flow": own},
        "po_amount_base": po_base,
        "person_reference": {"purchase_orders.approver": approver_fmt, "purchase_orders.requester": requester_fmt,
                             "ledger.approver": ledger_fmt},
        "approval_limits": {"per_approver_max_signed": approver_max, "observed_thresholds": thresholds,
                            "candidates": sorted(LIMIT_CANDIDATES)},
        "payment_delay_days": {"n": len(delays), "median": _quantile(delays, 0.5), "p90": _quantile(delays, 0.9)},
        "registration_gap_days": {"n": len(gaps), "p25": q, "recent_threshold_days": recent_days},
        "efos_statuses": dict(sorted(efos.items())),
        "sales": {"n": len(sales), "metodo_pago": dict(sorted(Counter(s["metodo_pago"] for s in sales).items()))},
    }
