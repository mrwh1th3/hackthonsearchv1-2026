"""Investigadores por tipología y revisor adversarial (challenger).

Cada investigador reúne evidencia con `Tools`, la puntúa con reglas explícitas y
devuelve un hallazgo candidato o un cierre con razón. Los montos salen de las filas
del estate; ningún texto libre (concepto, referencia, razón social) decide nada."""
from __future__ import annotations

from .config import (AMOUNT_MATCH, KICKBACK_TIMING_DAYS, PPD_GRACE_DAYS, RECENT_REGISTRATION_DAYS,
                     ROUND_TRIP_MAX_DAYS, ROUND_TRIP_MIN_RATIO, SPLIT_PROVEN_WINDOW_DAYS,
                     SPLIT_WINDOW_DAYS, LIMIT_CANDIDATES, UNCOLLECTED_MIN_AGE_DAYS, NEAR_LIMIT_RATIO)
from .detectors import is_quarter_end
from .estate import Estate, Tools, days_between, within

FREE_MAIL = ("gmail.", "hotmail.", "outlook.", "yahoo.")


def mxn(x: float) -> str:
    return f"MXN {x:,.2f}"


def approval_limits(e: Estate, min_orders: int, step: int) -> list[float]:
    import math
    lims = set(LIMIT_CANDIDATES)
    for r in e.q("SELECT approver, count(*) n, max(amount) m FROM purchase_orders GROUP BY approver"):
        if r["n"] >= min_orders and r["m"]:
            lims.add(float(math.ceil((r["m"] + 0.01) / step) * step))
    return sorted(lims)


class Exhibits:
    def __init__(self):
        self.items: list[dict] = []
        self._key: dict[tuple, str] = {}

    def add(self, table: str, record_id, note: str) -> str:
        k = (table, str(record_id))
        if k not in self._key:
            eid = f"EX-{len(self.items) + 1:02d}"
            self._key[k] = eid
            self.items.append({"exhibit_id": eid, "source_table": table,
                               "record_id": str(record_id), "note": note})
        return self._key[k]


def closed(reason: str, by: str = "investigator", defense: list | None = None) -> dict:
    return {"closed": True, "reason": reason, "closed_by": by, "defense": defense or []}


class Investigator:
    def __init__(self, estate: Estate):
        self.e = estate
        self.t = Tools(estate)

    def name(self, rfc: str) -> str:
        v = self.e.vendors.get(rfc)
        return v["legal_name"] if v and v.get("legal_name") else rfc

    def approval_limits(self) -> list[float]:
        """Límites candidatos: los redondos de config más el tope observado de cada aprobador
        (su máximo firmado, redondeado hacia arriba a 5,000). Así un estate con otra política
        no depende de adivinar la lista."""
        from .config import OBSERVED_LIMIT_MIN_ORDERS, OBSERVED_LIMIT_ROUND
        return approval_limits(self.e, OBSERVED_LIMIT_MIN_ORDERS, OBSERVED_LIMIT_ROUND)

    def investigate(self, lead: dict) -> dict:
        out = getattr(self, lead["kind"])(*lead["subject"])
        out["tool_calls"] = self.t.take_calls()
        return out

    # ------------------------------------------------------------------ phantom
    def phantom_vendor(self, rfc: str) -> dict:
        t = self.t
        v = t.vendor_profile(rfc) or {}
        invs = [i for i in t.invoices_from_vendor(rfc) if i["status"] != "cancelado"]
        if not invs:
            return closed(f"No valid invoices from {rfc} to the company; nothing was paid.")
        pos = t.purchase_orders(rfc)
        ctrs = t.contracts(rfc)
        efos = t.efos_status(rfc)

        # emparejamiento uno a uno orden↔factura, del par más parecido al menos parecido,
        # para que una orden de otro esquema no "documente" dos facturas
        pairs = sorted((abs(p["amount"] - i["total"]) / i["total"], abs(days_between(p["date"], i["issue_date"])),
                        p["po_id"], i["uuid"])
                       for p in pos for i in invs
                       if abs(p["amount"] - i["total"]) <= 0.005 * i["total"] and within(p["date"], i["issue_date"], 0, 45))
        po_of: dict[str, dict] = {}
        taken: set[str] = set()
        by_id = {p["po_id"]: p for p in pos}
        for _, _, po_id, uuid in pairs:
            if po_id not in taken and uuid not in po_of:
                taken.add(po_id)
                po_of[uuid] = by_id[po_id]

        def po_for(inv):
            return po_of.get(inv["uuid"])

        def contract_for(inv):
            return next((c for c in ctrs if c["start_date"] <= inv["issue_date"]), None)

        undoc = [i for i in invs if not po_for(i) and not contract_for(i)]
        efos_def = bool(efos and efos["status"] == "definitivo"
                        and any(i["issue_date"] >= efos["publication_date"] for i in invs))
        defense = []
        if efos and not efos_def:
            defense.append({"argument": f"RFC is on the 69-B list as '{efos['status']}' "
                                        f"(published {efos['publication_date']}).",
                            "held": False,
                            "why": "Presumed status is not a final determination and every invoice predates or "
                                   "is documented independently of it."})
        if len(undoc) < 2 and not efos_def:
            docs = sorted({p["po_id"] for i in invs if (p := po_for(i))} |
                          {c["contract_id"] for i in invs if (c := contract_for(i))})
            by = "challenger" if efos or v.get("registered_date") else "investigator"
            return closed(f"{len(invs) - len(undoc)} of {len(invs)} invoices are backed by purchase orders or a "
                          f"contract ({', '.join(docs[:4])}{'…' if len(docs) > 4 else ''}); "
                          f"deliveries are documented, so the vendor is real.", by, defense)
        cited = undoc if undoc else invs
        first = invs[0]["issue_date"]
        gap = days_between(v["registered_date"], first) if v.get("registered_date") else None
        recent = gap is not None and gap <= RECENT_REGISTRATION_DAYS
        no_approval = []
        for i in cited:
            rows = t.ledger_for_invoice(i["uuid"])
            if rows and all(not str(r.get("approver") or "").strip() for r in rows if r["credit"] or r["debit"]):
                no_approval.append((i, rows[0]))
        free_mail = any(m in str(v.get("contact_email") or "").lower() for m in FREE_MAIL)

        evidence = []
        if undoc:
            evidence.append(f"{len(undoc)} of {len(invs)} invoices have no purchase order and no contract")
        if efos_def:
            evidence.append(f"RFC is on the SAT Art. 69-B list as 'definitivo' since {efos['publication_date']}")
        if recent:
            evidence.append(f"registered {gap} days before its first invoice ({v['registered_date']} → {first})")
        if no_approval:
            evidence.append(f"{len(no_approval)} ledger postings carry no approver")
        corroboration = sum([efos_def, recent, bool(no_approval)])
        if corroboration == 0:
            return closed(f"{len(undoc)} invoices lack a PO, but the vendor has operated since "
                          f"{v.get('registered_date', 'unknown')}, is not on the 69-B list and every posting "
                          f"was approved; missing paperwork alone is not an accusation.", "challenger")
        confidence = "proven" if (undoc and efos_def) or (undoc and recent and no_approval) else "probable"

        ex = Exhibits()
        ex.add("vendors", rfc, f"Vendor master record: registered {v.get('registered_date')}"
               + (", free e-mail domain" if free_mail else "") + ".")
        if efos:
            ex.add("efos_list", rfc, f"Listed by SAT under Art. 69-B as '{efos['status']}' on {efos['publication_date']}.")
        trail, used = [], set()
        for i in cited:
            iid = ex.add("invoices", i["uuid"], f"CFDI for {mxn(i['total'])} with no purchase order or contract behind it.")
            pay = t.payment_for_invoice(i, v.get("bank_clabe", ""), used)
            if pay:
                used.add(pay["txn_id"])
                pid = ex.add("bank_txns", pay["txn_id"], f"Company paid {mxn(pay['amount'])} for {i['uuid']}.")
                trail.append({"from": "COMPANY", "to": f"RFC:{rfc}", "amount": pay["amount"],
                              "date": pay["date"], "exhibit_id": pid})
            else:
                trail.append({"from": "COMPANY", "to": f"RFC:{rfc}", "amount": i["total"],
                              "date": i["issue_date"], "exhibit_id": iid})
        for i, row in no_approval[:2]:
            ex.add("ledger", row["entry_id"], f"Posting of {i['uuid']} with an empty approver field.")
        amount = round(sum(i["total"] for i in cited), 2)
        narrative = (f"{self.name(rfc)} billed the company {len(cited)} times for {mxn(amount)} of generic services. "
                     f"No purchase order or contract authorizes any of these purchases"
                     + (f", the vendor was registered only {gap} days before its first invoice" if recent else "")
                     + (", SAT lists it as a definitive simulated-operations issuer (EFOS)" if efos_def else "")
                     + (", and the accounting entries were posted without an approver" if no_approval else "")
                     + ". The company nevertheless paid, so the money left with nothing verifiable received.")
        return {"closed": False, "scheme_type": "phantom_vendor", "entities": [f"RFC:{rfc}"],
                "subject_name": self.name(rfc),
                "rule_broken": ("CFF Art. 69-B (CFDI issued by a taxpayer that simulates operations have no tax effect) "
                                "and LISR Art. 27 frac. I (deductions must be strictly indispensable and backed by a "
                                "real operation); internal control: purchases require an approved purchase order."),
                "peso_amount": amount, "confidence": confidence, "narrative": narrative,
                "evidence": evidence, "exhibits": ex.items, "money_trail": trail,
                "reconciliation": {"table": "invoices", "items": [(i["uuid"], i["total"]) for i in cited]},
                "defense": defense + [{"argument": "The vendor may simply be new.",
                                       "held": False,
                                       "why": "A new vendor would still need a purchase order or contract; none exists "
                                              "for any cited invoice."}]}

    # ------------------------------------------------------------------ kickback
    def kickback(self, rfc: str, emp_id: str) -> dict:
        t = self.t
        v = t.vendor_profile(rfc) or {}
        emp = next((x for x in self.e.employees if x["emp_id"] == emp_id), None)
        if not emp or not v.get("bank_clabe") or not emp.get("bank_clabe"):
            return closed("Vendor or employee has no bank account on file; no flow can be traced.")
        eref = Estate.emp_ref(emp)
        transfers = t.txns_between(v["bank_clabe"], emp["bank_clabe"])
        reverse = t.txns_between(emp["bank_clabe"], v["bank_clabe"])
        if not transfers:
            return closed(f"{eref} and {rfc} bank at the same institution ({v['bank_clabe'][:3]}), but the bank "
                          f"records show zero transfers between CLABE …{v['bank_clabe'][-4:]} and "
                          f"…{emp['bank_clabe'][-4:]} in either direction. Sharing a bank is not a payment.",
                          "challenger",
                          [{"argument": "Employee approves this vendor's orders and banks at the same institution.",
                            "held": True, "why": "No money moved between them."}])
        pos = [p for p in t.purchase_orders(rfc) if p["approver"] == emp["name"]]
        invs = t.invoices_from_vendor(rfc)
        pays = t.txns_between(self.e.company_clabes, v["bank_clabe"])
        timed = [k for k in transfers if any(within(p["date"], k["date"], 0, KICKBACK_TIMING_DAYS) for p in pays)]
        if not pos and not timed:
            return closed(f"{len(transfers)} transfers from {rfc} to {eref}, but the employee approved none of the "
                          f"vendor's orders and no transfer follows a company payment; no conflict of interest "
                          f"is shown.", "challenger")
        confidence = "proven" if pos and len(timed) * 2 >= len(transfers) and len(transfers) >= 2 else "probable"
        evidence = [f"{len(transfers)} transfers from the vendor's account to {eref}'s personal account"]
        if pos:
            evidence.append(f"{eref} approved {len(pos)} purchase orders for this vendor")
        if timed:
            evidence.append(f"{len(timed)} transfers arrive within {KICKBACK_TIMING_DAYS} days after the company paid the vendor")
        ex = Exhibits()
        ex.add("employees", emp["emp_id"], f"{eref} ({emp['role']}) holds CLABE …{emp['bank_clabe'][-4:]}.")
        ex.add("vendors", rfc, f"Vendor master record with CLABE …{v['bank_clabe'][-4:]}.")
        trail = []
        for p in pos[:4]:
            pid = ex.add("purchase_orders", p["po_id"], f"Order for {mxn(p['amount'])} approved by {eref}.")
            inv = next((i for i in invs if abs(i["total"] - p["amount"]) <= AMOUNT_MATCH * p["amount"]), None)
            if inv:
                iid = ex.add("invoices", inv["uuid"], f"Vendor invoice for that order, {mxn(inv['total'])}.")
                trail.append({"from": "COMPANY", "to": f"RFC:{rfc}", "amount": inv["total"],
                              "date": inv["issue_date"], "exhibit_id": iid})
            else:
                trail.append({"from": "COMPANY", "to": f"RFC:{rfc}", "amount": p["amount"],
                              "date": p["date"], "exhibit_id": pid})
        for k in transfers:
            kid = ex.add("bank_txns", k["txn_id"], f"Vendor account sent {mxn(k['amount'])} to {eref}'s account.")
            trail.append({"from": f"RFC:{rfc}", "to": eref, "amount": k["amount"], "date": k["date"], "exhibit_id": kid})
        trail.sort(key=lambda s: (s["date"], s["from"] != "COMPANY"))
        amount = round(sum(k["amount"] for k in transfers), 2)
        defense = [{"argument": "The employee might bank at the same institution by coincidence.",
                    "held": False, "why": f"The bank records show {len(transfers)} actual transfers, not a shared bank code."}]
        if reverse:
            defense.append({"argument": "Transfers could be repayment of a personal loan.",
                            "held": False, "why": f"Only {len(reverse)} transfers go the other way."})
        else:
            defense.append({"argument": "Transfers could be repayment of a personal loan.",
                            "held": False, "why": "No transfer from the employee to the vendor exists to create such a loan."})
        narrative = (f"{eref}, {emp['role']}, approved {len(pos)} purchase orders for {self.name(rfc)}. "
                     f"After the company paid those invoices, the vendor's bank account sent {len(transfers)} transfers "
                     f"totalling {mxn(amount)} to the employee's personal account"
                     + (f", {len(timed)} of them within {KICKBACK_TIMING_DAYS} days of a company payment" if timed else "")
                     + ". An approver receiving money from the vendor they approve is a kickback.")
        return {"closed": False, "scheme_type": "kickback", "entities": [f"RFC:{rfc}", eref],
                "subject_name": f"{self.name(rfc)} / {eref}", "employee_label": f"{emp['name']}, {emp['role']}",
                "rule_broken": ("Conflict of interest in procurement: an approver may not receive payments from a "
                                "vendor they authorize (company anti-corruption policy; may constitute fraude, "
                                "Código Penal Federal Art. 386)."),
                "peso_amount": amount, "confidence": confidence, "narrative": narrative, "evidence": evidence,
                "exhibits": ex.items, "money_trail": trail,
                "reconciliation": {"table": "bank_txns", "items": [(k["txn_id"], k["amount"]) for k in transfers]},
                "defense": defense}

    # ------------------------------------------------------------------ round trip
    def round_tripping(self, rfc: str) -> dict:
        t = self.t
        v = t.vendor_profile(rfc) or {}
        vc = v.get("bank_clabe")
        if not vc:
            return closed("Vendor has no bank account on file.")
        outs = t.txns_between(self.e.company_clabes, vc)
        backs = t.txns_between(vc, self.e.company_clabes)
        invs = t.invoices_from_vendor(rfc)
        sales = t.invoices_to_customer(rfc)
        cycles, refunds, used = [], [], set()
        for b in backs:
            o = next((o for o in outs if o["txn_id"] not in used
                      and within(o["date"], b["date"], 0, ROUND_TRIP_MAX_DAYS)
                      and ROUND_TRIP_MIN_RATIO <= b["amount"] / o["amount"] <= 1.0), None)
            if not o:
                continue
            used.add(o["txn_id"])
            inv = next((i for i in invs if i["uuid"] in str(o.get("reference") or "")), None) or \
                next((i for i in invs if abs(i["total"] - o["amount"]) <= AMOUNT_MATCH * o["amount"]), None)
            booking = next((s for s in sales if abs(s["total"] - b["amount"]) <= 0.005 * b["amount"]
                            and within(s["issue_date"], b["date"], -10, 10) and s["status"] != "cancelado"), None)
            if inv and inv["status"] == "cancelado" and not booking:
                refunds.append((o, b, inv))
            else:
                cycles.append((o, b, inv, booking))
        booked = [c for c in cycles if c[3]]
        if not cycles or (len(booked) == 0 and len(cycles) < 2):
            if refunds:
                o, b, inv = refunds[0]
                return closed(f"{b['txn_id']} returned {mxn(b['amount'])} {days_between(o['date'], b['date'])} days "
                              f"after payment {o['txn_id']}, but invoice {inv['uuid']} was cancelled and no revenue "
                              f"was booked: a refund of a cancelled CFDI, not revenue.", "challenger",
                              [{"argument": "Money paid out came back from the same vendor.", "held": True,
                                "why": "The paid invoice was cancelled and the return was not recorded as a sale."}])
            return closed(f"The company paid {rfc} {len(outs)} times and received {len(backs)} transfers from it, "
                          f"but no receipt matches a payment within {ROUND_TRIP_MAX_DAYS} days at "
                          f"≥{ROUND_TRIP_MIN_RATIO:.0%} of its amount; the two flows are independent "
                          f"trade (sales {len(sales)}, purchases {len(invs)}).", "investigator")
        confidence = "proven" if len(booked) >= 2 else "probable"
        ex = Exhibits()
        ex.add("vendors", rfc, "Counterparty is both a supplier and, on paper, a customer.")
        trail, amount_items = [], []
        for o, b, inv, booking in cycles:
            if inv:
                ex.add("invoices", inv["uuid"], f"Purchase CFDI for {mxn(inv['total'])} used to send the money out.")
                amount_items.append((inv["uuid"], inv["total"]))
            oid = ex.add("bank_txns", o["txn_id"], f"Company paid {mxn(o['amount'])} to the vendor.")
            bid = ex.add("bank_txns", b["txn_id"],
                         f"{days_between(o['date'], b['date'])} days later the vendor sent back {mxn(b['amount'])}.")
            if booking:
                rows = t.ledger_for_invoice(booking["uuid"])
                rev = next((r for r in rows if r["credit"] and str(r["account_code"]).startswith("4")), None)
                if rev:
                    ex.add("ledger", rev["entry_id"], f"Returned money booked as revenue ({mxn(rev['credit'])}) via {booking['uuid']}.")
            trail.append({"from": "COMPANY", "to": f"RFC:{rfc}", "amount": o["amount"], "date": o["date"], "exhibit_id": oid})
            trail.append({"from": f"RFC:{rfc}", "to": "COMPANY", "amount": b["amount"], "date": b["date"], "exhibit_id": bid})
        amount = round(sum(a for _, a in amount_items), 2) if len(amount_items) == len(cycles) \
            else round(sum(o["amount"] for o, *_ in cycles), 2)
        back_total = round(sum(b["amount"] for _, b, _, _ in cycles), 2)
        evidence = [f"{len(cycles)} payments came back from the same account within {ROUND_TRIP_MAX_DAYS} days "
                    f"({mxn(back_total)} of {mxn(amount)})"]
        if booked:
            evidence.append(f"{len(booked)} of the returns were booked as sales revenue")
        narrative = (f"The company paid {self.name(rfc)} {mxn(amount)} in {len(cycles)} purchases. Each time, within "
                     f"days, the same vendor account sent most of the money back ({mxn(back_total)} in total)"
                     + (f", and the company recorded {len(booked)} of those returns as sales revenue" if booked else "")
                     + ". The same pesos went out and came back, creating purchases and income that never happened "
                       "commercially.")
        return {"closed": False, "scheme_type": "round_tripping", "entities": [f"RFC:{rfc}"],
                "subject_name": self.name(rfc),
                "rule_broken": ("NIF D-1 (revenue requires transferring control of goods to a customer; money returned "
                                "by the counterparty that was just paid is not revenue) and CFF Art. 69-B (simulated "
                                "operations)."),
                "peso_amount": amount, "confidence": confidence, "narrative": narrative, "evidence": evidence,
                "exhibits": ex.items, "money_trail": trail,
                "reconciliation": {"table": "invoices" if len(amount_items) == len(cycles) else "bank_txns",
                                   "items": amount_items if len(amount_items) == len(cycles)
                                   else [(o["txn_id"], o["amount"]) for o, *_ in cycles]},
                "defense": [{"argument": "The vendor might also be a genuine customer.", "held": False,
                             "why": "Every cited return mirrors a payment made days earlier, at 80–100% of its amount."}]
                + ([{"argument": "Returns could be refunds.", "held": False,
                     "why": "The paid invoices are valid, not cancelled, and the returns were booked as sales."}] if booked else [])}

    # ------------------------------------------------------------------ splitting
    def threshold_splitting(self, rfc: str) -> dict:
        t = self.t
        pos = t.purchase_orders(rfc)
        ctrs = t.contracts(rfc)
        best = None
        for lim in self.approval_limits():
            near = [p for p in pos if NEAR_LIMIT_RATIO * lim <= p["amount"] < lim]
            for i in range(len(near)):
                win = [p for p in near[i:] if days_between(near[i]["date"], p["date"]) <= SPLIT_WINDOW_DAYS]
                if len(win) >= 3 and sum(p["amount"] for p in win) > lim and (best is None or len(win) > len(best[1])):
                    best = (lim, win)
        if not best:
            near = [p for p in pos if any(NEAR_LIMIT_RATIO * l <= p["amount"] < l for l in LIMIT_CANDIDATES)]
            gaps = [days_between(a["date"], b["date"]) for a, b in zip(near, near[1:])]
            regular = gaps and min(gaps) >= 25
            reason = (f"{len(near)} orders sit just under an approval limit, but they are spaced "
                      f"{min(gaps) if gaps else 0}–{max(gaps) if gaps else 0} days apart"
                      + (f" under contract {ctrs[0]['contract_id']} (MXN {ctrs[0]['value']:,.0f})" if ctrs else "")
                      + f"; no three fall within {SPLIT_WINDOW_DAYS} days, so this is a recurring charge, "
                        f"not one purchase split up.")
            return closed(reason, "challenger" if regular else "investigator",
                          [{"argument": "Orders just under the limit suggest splitting.", "held": True,
                            "why": "Regular monthly cadence matches a recurring service."}] if regular else [])
        lim, win = best
        span = days_between(win[0]["date"], win[-1]["date"])
        approvers = sorted({p["approver"] for p in win})
        above = [p for a in approvers for p in t.approvals_by(a) if p["amount"] >= lim]
        total = round(sum(p["amount"] for p in win), 2)
        if above:
            return closed(f"{len(win)} orders of {NEAR_LIMIT_RATIO:.0%}–100% of MXN {lim:,.0f} within {span} days, but "
                          f"approver(s) {', '.join(approvers)} also signed {len(above)} orders of MXN {lim:,.0f} or more "
                          f"(e.g. {above[0]['po_id']} for {mxn(above[0]['amount'])}); MXN {lim:,.0f} is not a limit "
                          f"they needed to evade.", "challenger",
                          [{"argument": "Orders cluster just under a round amount.", "held": True,
                            "why": "The approver is authorised above that amount."}])
        if len(approvers) > 1:
            return closed(f"{len(win)} orders just under MXN {lim:,.0f} within {span} days, but signed by "
                          f"{len(approvers)} different approvers ({', '.join(approvers)}); no single person split a "
                          f"purchase to stay inside their own authority.", "challenger",
                          [{"argument": "Orders cluster under the approval limit.", "held": True,
                            "why": "Independent approvers signed them."}])
        proven = span <= SPLIT_PROVEN_WINDOW_DAYS
        evidence = [f"{len(win)} orders of {NEAR_LIMIT_RATIO:.0%}–100% of MXN {lim:,.0f} within {span} days, "
                    f"together {mxn(total)}"]
        if not above:
            evidence.append(f"approver(s) {', '.join(approvers)} never signed an order of MXN {lim:,.0f} or more — "
                            f"that is the limit of their authority")
        if len(approvers) == 1:
            evidence.append("the same person approved every order")
        ex = Exhibits()
        trail, invs, used = [], t.invoices_from_vendor(rfc), set()
        v = self.e.vendors.get(rfc, {})
        for p in win:
            ex.add("purchase_orders", p["po_id"], f"Order {p['date']} for {mxn(p['amount'])}, "
                                                   f"{(p['amount'] / lim):.1%} of the limit, approved by {p['approver']}.")
        for p in win:
            inv = next((i for i in invs if i["uuid"] not in used and abs(i["total"] - p["amount"]) <= AMOUNT_MATCH * p["amount"]
                        and within(p["date"], i["issue_date"], -5, 30)), None)
            if not inv:
                continue
            used.add(inv["uuid"])
            iid = ex.add("invoices", inv["uuid"], f"Invoice for the order, {mxn(inv['total'])}.")
            pay = t.payment_for_invoice(inv, v.get("bank_clabe", ""), set())
            step = {"from": "COMPANY", "to": f"RFC:{rfc}", "amount": inv["total"], "date": inv["issue_date"], "exhibit_id": iid}
            if pay:
                step = {"from": "COMPANY", "to": f"RFC:{rfc}", "amount": pay["amount"], "date": pay["date"],
                        "exhibit_id": ex.add("bank_txns", pay["txn_id"], f"Payment of {inv['uuid']}.")}
            trail.append(step)
        for a in approvers:
            emp = t.employee_by_name(a)
            if emp:
                ex.add("employees", emp["emp_id"], f"Approver {Estate.emp_ref(emp)} ({emp['role']}).")
        narrative = (f"Within {span} days, {len(win)} purchase orders to {self.name(rfc)} were each set just below "
                     f"the MXN {lim:,.0f} approval limit. Together they total {mxn(total)}, a purchase that should "
                     f"have gone to a higher approver. Splitting it kept every order inside "
                     f"{'one approver' if len(approvers) == 1 else 'lower approvers'}' authority.")
        ents = [f"RFC:{rfc}"]
        return {"closed": False, "scheme_type": "threshold_splitting", "entities": ents,
                "subject_name": self.name(rfc),
                "rule_broken": (f"Purchase approval-limit policy: purchases above MXN {lim:,.0f} require higher "
                                f"authorization; splitting one purchase into {len(win)} orders below the limit evades it."),
                "peso_amount": total, "confidence": "proven" if proven else "probable", "narrative": narrative,
                "evidence": evidence, "exhibits": ex.items, "money_trail": trail,
                "reconciliation": {"table": "purchase_orders", "items": [(p["po_id"], p["amount"]) for p in win]},
                "defense": [{"argument": "These could be separate recurring purchases.", "held": False,
                             "why": f"All {len(win)} fall within {span} days, not a monthly cadence."}]}

    # ------------------------------------------------------------------ revenue
    def revenue_inflation(self, rfc: str) -> dict:
        t = self.t
        sales = t.invoices_to_customer(rfc)
        used, flagged, collected, not_due = set(), [], [], []
        for s in sales:
            r = t.receipt_for_invoice(s, used)
            age = days_between(s["issue_date"], self.e.bank_horizon.isoformat())
            if r:
                used.add(r["txn_id"])
                collected.append((s, r))
            elif s["status"] == "cancelado":
                flagged.append(s)
            elif (s["metodo_pago"] == "PPD" and age < PPD_GRACE_DAYS) or age < UNCOLLECTED_MIN_AGE_DAYS:
                not_due.append(s)
            else:
                flagged.append(s)
        if not flagged:
            ex = collected[0] if collected else None
            return closed(f"All {len(collected)} sales invoices to {rfc} were collected"
                          + (f" (e.g. {ex[0]['uuid']} paid by {ex[1]['txn_id']} on {ex[1]['date']})" if ex else "")
                          + (f"; {len(not_due)} are still within credit terms" if not_due else "")
                          + ". Quarter-end timing alone is not inflation.",
                          "challenger" if collected else "investigator")
        qend = [s for s in flagged if is_quarter_end(s["issue_date"])]
        canc = [s for s in flagged if s["status"] == "cancelado"]
        new_customer = not collected
        n = len(flagged)
        if not (n >= 2 or canc or qend):
            return closed(f"One uncollected invoice ({flagged[0]['uuid']}) outside quarter-end and not cancelled; "
                          f"consistent with an ordinary late payer ({len(collected)} other invoices were paid).")
        proven = n >= 2 and qend and (len(canc) == n or new_customer)
        evidence = [f"{n} sales invoices never collected in bank records through {self.e.bank_horizon.isoformat()}"]
        if qend:
            evidence.append(f"{len(qend)} issued in the last days of a quarter")
        if canc:
            evidence.append(f"{len(canc)} cancelled after the revenue was booked")
        if new_customer:
            evidence.append("customer has never paid any invoice")
        ex = Exhibits()
        trail = []
        for s in flagged:
            iid = ex.add("invoices", s["uuid"], f"Sales CFDI {s['issue_date']} for {mxn(s['total'])}, "
                                                 f"{'cancelled' if s['status'] == 'cancelado' else 'never paid'}.")
            rows = t.ledger_for_invoice(s["uuid"])
            rev = next((r for r in rows if r["credit"] and str(r["account_code"]).startswith("4")), None)
            if rev:
                ex.add("ledger", rev["entry_id"], f"Revenue of {mxn(rev['credit'])} recognised on {rev['date']}.")
            trail.append({"from": "COMPANY", "to": f"RFC:{rfc}", "amount": s["total"], "date": s["issue_date"], "exhibit_id": iid})
        if len(ex.items) < 3:
            rows = t.ledger_for_invoice(flagged[0]["uuid"])
            for r in rows:
                ex.add("ledger", r["entry_id"], f"Receivable posting for {flagged[0]['uuid']}, never cleared by a receipt.")
        total = round(sum(s["total"] for s in flagged), 2)
        narrative = (f"The company recorded {mxn(total)} of sales to {rfc} in {n} invoices"
                     + (f", {len(qend)} dated in the final days of a quarter" if qend else "")
                     + ". No payment for any of them appears in the bank records"
                     + (f", and {len(canc)} were cancelled after the period closed" if canc else "")
                     + (". The customer never paid the company for anything" if new_customer else "")
                     + ". Revenue was reported for sales that did not produce cash.")
        return {"closed": False, "scheme_type": "revenue_inflation", "entities": [f"RFC:{rfc}"],
                "subject_name": rfc,
                "rule_broken": ("NIF D-1 revenue recognition: income requires transfer of control and probable "
                                "collection; cancelled or never-collected CFDI (CFF Art. 29-A) cannot support booked revenue."),
                "peso_amount": total, "confidence": "proven" if proven else "probable", "narrative": narrative,
                "evidence": evidence, "exhibits": ex.items, "money_trail": trail,
                "reconciliation": {"table": "invoices", "items": [(s["uuid"], s["total"]) for s in flagged]},
                "defense": [{"argument": "Credit terms could explain the missing receipts.", "held": False,
                             "why": f"Bank records run to {self.e.bank_horizon.isoformat()}, beyond normal terms"
                                    + ("; cancelled CFDI will never be paid." if canc else ".")}]}
