"""Investigadores por tipología y revisor adversarial (challenger).

Cada investigador reúne evidencia con `Tools`, la puntúa con reglas explícitas y
devuelve un hallazgo candidato o un cierre con razón. Los montos salen de las filas
del estate; ningún texto libre (concepto, referencia, razón social) decide nada."""
from __future__ import annotations

from .config import (AMOUNT_MATCH, FIXED_FEE_MIN_GAP_DAYS, KICKBACK_TIMING_DAYS, LIMIT_CANDIDATES, NEAR_LIMIT_RATIO,
                     PARTIAL_COLLECTION_MIN, PHANTOM_THRESHOLD, PHANTOM_WEIGHTS, PO_MATCH_DAYS, PO_MATCH_TOLERANCE,
                     PPD_GRACE_DAYS, ROUND_TRIP_CHAIN_MAX_DAYS, ROUND_TRIP_HOP_MIN_RATIO, ROUND_TRIP_MAX_DAYS,
                     ROUND_TRIP_MIN_RATIO, SPLIT_PROVEN_WINDOW_DAYS, SPLIT_WINDOW_DAYS, UNCOLLECTED_MIN_AGE_DAYS)
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
        """Orden: (1) exculpación documental — facturas respaldadas por orden de compra en la base de
        monto del estate o por contrato vigente; (2) puntaje de corroboración independiente
        (PHANTOM_WEIGHTS) sobre lo no documentado; se acusa con puntaje ≥ PHANTOM_THRESHOLD."""
        t = self.t
        v = t.vendor_profile(rfc) or {}
        invs = [i for i in t.invoices_from_vendor(rfc) if i["status"] != "cancelado"]
        if not invs:
            return closed(f"No valid invoices from {rfc} to the company; nothing was paid.")
        pos = t.purchase_orders(rfc)
        ctrs = t.contracts(rfc)
        efos = t.efos_status(rfc)
        base = "/".join(self.e.po_bases)

        # emparejamiento uno a uno orden↔factura, del par más parecido al menos parecido,
        # para que una orden de otro esquema no "documente" dos facturas
        pairs = sorted((g, abs(days_between(p["date"], i["issue_date"])), p["po_id"], i["uuid"])
                       for p in pos for i in invs
                       if (g := self.e.po_invoice_gap(p, i, PO_MATCH_TOLERANCE)) is not None
                       and within(p["date"], i["issue_date"], 0, PO_MATCH_DAYS))
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
        first = invs[0]["issue_date"]
        gap = days_between(v["registered_date"], first) if v.get("registered_date") else None
        recent_days = self.e.recent_days
        # Facturar antes del alta es una anomalía de datos maestros (alta re-capturada, RFC migrado o fecha
        # mal cargada), no un indicio de simulación: por sí sola nunca suma corroboración, solo se explica.
        recent = gap is not None and -recent_days <= gap <= recent_days
        anomalia = ""
        if gap is not None and gap < 0:
            anomalia = (f" Anomaly, not fraud: the first invoice ({first}) predates the vendor's registration date "
                        f"({v['registered_date']}) by {-gap} days. That is a vendor master-data inconsistency "
                        f"(record re-captured or date mis-keyed), not evidence of simulated operations, so it is "
                        f"not counted as a fraud signal"
                        + (" by itself; registration and first billing still fall within "
                           f"{recent_days} days of each other, so the vendor is treated as new."
                           if recent else f"; the vendor was already billing more than {recent_days} "
                           "days before the record existed, so it is an established vendor, not a new one."))
        cuando_alta = (f"registered {gap} days before its first invoice" if gap is not None and gap >= 0
                       else f"registered {-gap if gap is not None else 0} days after its first invoice")
        efos_status = efos["status"] if efos else None
        before_pub = [i for i in invs if efos and i["issue_date"] < efos["publication_date"]]
        efos_def = bool(efos_status == "definitivo" and len(before_pub) < len(invs))
        efos_other = bool(efos and not efos_def)   # presunto, o definitivo publicado tras todas las facturas
        if efos:
            efos_phrase = (f"RFC is on the SAT Art. 69-B list as '{efos_status}' (published {efos['publication_date']}; "
                           f"{len(before_pub)} of {len(invs)} invoices predate the publication)")
        else:
            efos_phrase = "RFC does not appear on the SAT Art. 69-B list in this estate"
        defense = []
        if len(undoc) < 2:
            docs = sorted({p["po_id"] for i in invs if (p := po_for(i))} |
                          {c["contract_id"] for i in invs if (c := contract_for(i))})
            if efos:
                defense.append({"argument": f"RFC is on the 69-B list as '{efos_status}' "
                                            f"(published {efos['publication_date']}).",
                                "held": False,
                                "why": "Every invoice but at most one is backed by an approved purchase order or a "
                                       "contract, so deliveries are documented independently of the listing."})
            by = "challenger" if efos or v.get("registered_date") else "investigator"
            return closed(f"{len(invs) - len(undoc)} of {len(invs)} invoices are backed by purchase orders (matched on "
                          f"the order {base} amount) or a contract ({', '.join(docs[:4])}{'…' if len(docs) > 4 else ''}); "
                          f"deliveries are documented, so the vendor is real. {efos_phrase}." + anomalia, by, defense)
        cited = undoc
        no_approval = []
        for i in cited:
            rows = t.ledger_for_invoice(i["uuid"])
            # la póliza de registro (fecha de la factura); el pago posterior lo firma tesorería
            booking = [r for r in rows if r["date"] == i["issue_date"] and (r["credit"] or r["debit"])] or \
                [r for r in rows if r["credit"] or r["debit"]]
            if booking and all(not str(r.get("approver") or "").strip() for r in booking):
                no_approval.append((i, booking[0]))
        free_mail = any(m in str(v.get("contact_email") or "").lower() for m in FREE_MAIL)
        undoc_value = sum(i["total"] for i in undoc)
        billed = sum(i["total"] for i in invs)
        majority = 2 * undoc_value >= billed
        emp_clabes = {x["bank_clabe"]: x for x in self.e.employees if x.get("bank_clabe")}
        to_emp = t.txns_between(v["bank_clabe"], set(emp_clabes)) if v.get("bank_clabe") and emp_clabes else []

        signals = {"efos_definitivo": efos_def, "efos_presunto": efos_other, "recent_registration": recent,
                   "no_ledger_approver": bool(no_approval), "majority_undocumented": majority,
                   "vendor_pays_employee": bool(to_emp)}
        score = sum(PHANTOM_WEIGHTS[k] for k, on in signals.items() if on)
        scoring = {"signals": {k: {"on": on, "weight": PHANTOM_WEIGHTS[k]} for k, on in signals.items()},
                   "score": score, "threshold": PHANTOM_THRESHOLD}

        evidence = [f"{len(undoc)} of {len(invs)} invoices have no purchase order (order {base} amount) and no contract"]
        if efos_def:
            evidence.append(f"RFC is on the SAT Art. 69-B list as 'definitivo' since {efos['publication_date']}")
        elif efos_other:
            evidence.append(f"RFC is on the SAT Art. 69-B list as '{efos_status}' since {efos['publication_date']}"
                            + (f"; {len(before_pub)} of the invoices predate that publication, which the 69-B "
                               f"presumption also reaches" if before_pub else ""))
        if recent:
            evidence.append(f"{cuando_alta} ({v['registered_date']} → {first}); "
                            f"'recent' here means within {recent_days} days, the lower quartile of this vendor master")
        if no_approval:
            evidence.append(f"{len(no_approval)} ledger postings carry no approver")
        if majority:
            evidence.append(f"undocumented invoices are {undoc_value / billed:.0%} of everything the vendor billed")
        if to_emp:
            evidence.append(f"the vendor's account sent {len(to_emp)} transfers to employee accounts "
                            f"({', '.join(sorted({Estate.emp_ref(emp_clabes[k['to_clabe']]) for k in to_emp}))})")
        if score < PHANTOM_THRESHOLD:
            missing = ", ".join(k for k, on in signals.items() if not on)
            return closed(f"{len(undoc)} of {len(invs)} invoices lack a purchase order or contract, but corroboration "
                          f"scores {score} of the {PHANTOM_THRESHOLD} required (absent: {missing}). {efos_phrase}; the "
                          f"vendor has been registered since {v.get('registered_date', 'unknown')} and "
                          f"{'some' if no_approval else 'every'} posting was approved. Missing paperwork alone is not "
                          f"an accusation." + anomalia, "challenger", [{"argument": "Invoices without purchase orders.",
                                                                        "held": True, "why": "No independent signal "
                                                                        "corroborates simulation.", "scoring": scoring}])
        confidence = "proven" if score >= 3 and (efos_def or no_approval) else "probable"

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
        narrative = (f"{self.name(rfc)} billed the company {len(cited)} times for {mxn(amount)} of services. "
                     f"No purchase order or contract authorizes any of these purchases"
                     + (f", the vendor was {cuando_alta}" if recent else "")
                     + (", SAT lists it as a definitive simulated-operations issuer (EFOS)" if efos_def else "")
                     + (f", SAT lists it as a presumed simulated-operations issuer ({efos_status}, "
                        f"{efos['publication_date']})" if efos_other else "")
                     + (", and the accounting entries were posted without an approver" if no_approval else "")
                     + ". The company nevertheless paid, so the money left with nothing verifiable received.")
        return {"closed": False, "scheme_type": "phantom_vendor", "entities": [f"RFC:{rfc}"],
                "subject_name": self.name(rfc),
                "rule_broken": ("CFF Art. 69-B (CFDI issued by a taxpayer that simulates operations have no tax effect) "
                                "and LISR Art. 27 frac. I (deductions must be strictly indispensable and backed by a "
                                "real operation); internal control: purchases require an approved purchase order."),
                "peso_amount": amount, "confidence": confidence, "narrative": narrative, "scoring": scoring,
                "evidence": evidence, "exhibits": ex.items, "money_trail": trail,
                "reconciliation": {"table": "invoices", "items": [(i["uuid"], i["total"]) for i in cited]},
                "defense": defense + ([{"argument": "The vendor may simply be new.",
                                        "held": False,
                                        "why": "A new vendor would still need a purchase order or contract; none exists "
                                               "for any cited invoice."}] if not anomalia else [])
                           + ([{"argument": "The vendor invoiced before its registration date.",
                                "held": False,
                                "why": anomalia.strip() + " The date gap itself is not what the finding rests on."}]
                              if anomalia else [])
                           + ([{"argument": f"'{efos_status}' is not a final 69-B determination.", "held": False,
                                "why": "The listing is only one corroborating signal; the finding rests on purchases "
                                       "with no order or contract that the company paid anyway."}] if efos_other else [])}

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
        pos = [p for p in t.purchase_orders(rfc) if self.e.person_key(p["approver"]) == emp["emp_id"]]
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
            inv = next((i for i in invs if self.e.po_invoice_gap(p, i, AMOUNT_MATCH) is not None), None)
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
    def _chain_finding(self, rfc: str, chains: list[list[dict]], direct_note: str) -> dict:
        """Ciclo de 3–4 saltos: empresa → proveedor → tercero(s) → empresa."""
        t = self.t
        t._log("money_cycles")
        invs = t.invoices_from_vendor(rfc)
        ex = Exhibits()
        ex.add("vendors", rfc, "First recipient of the money: a registered supplier paid for an invoice.")
        trail, inv_items, out_items, others = [], [], [], []
        for chain in chains:
            o = chain[0]
            inv = next((i for i in invs if i["uuid"] in str(o.get("reference") or "")), None) or \
                next((i for i in invs if abs(i["total"] - o["amount"]) <= 0.005 * o["amount"]
                      and within(i["issue_date"], o["date"], 0, 120)), None)
            if inv:
                ex.add("invoices", inv["uuid"], f"Purchase CFDI for {mxn(inv['total'])} that justified the first payment.")
                inv_items.append((inv["uuid"], inv["total"]))
            out_items.append((o["txn_id"], o["amount"]))
            prev = None
            for n, x in enumerate(chain):
                src = self.e.clabe_owner.get(x["from_clabe"], f"CLABE …{x['from_clabe'][-4:]}")
                dst = self.e.clabe_owner.get(x["to_clabe"], f"CLABE …{x['to_clabe'][-4:]}")
                if dst not in ("COMPANY", f"RFC:{rfc}") and dst not in others:
                    others.append(dst)
                kept = f", {x['amount'] / prev:.1%} of the previous hop" if prev else ""
                xid = ex.add("bank_txns", x["txn_id"], f"Hop {n + 1}: {src} sent {mxn(x['amount'])} to {dst} on {x['date']}{kept}.")
                trail.append({"from": src, "to": dst, "amount": x["amount"], "date": x["date"], "exhibit_id": xid})
                prev = x["amount"]
        use_inv = len(inv_items) == len(chains)
        amount = round(sum(a for _, a in (inv_items if use_inv else out_items)), 2)
        back = round(sum(c[-1]["amount"] for c in chains), 2)
        days = [days_between(c[0]["date"], c[-1]["date"]) for c in chains]
        hops = sorted({len(c) for c in chains})
        ents = [f"RFC:{rfc}"] + [o for o in others if o.startswith("RFC:") or o.startswith("EMP:")]
        named = [o for o in others if o.startswith(("RFC:", "EMP:"))]
        evidence = [f"{len(chains)} payment(s) to {rfc} travelled through {', '.join(others) or 'a third party'} and "
                    f"came back to a company account within {max(days)} days ({mxn(back)} of {mxn(amount)})",
                    f"every hop kept at least {ROUND_TRIP_HOP_MIN_RATIO:.0%} of the previous amount; "
                    f"cycle length {'/'.join(map(str, hops))} transfers"]
        if direct_note:
            evidence.append(direct_note)
        confidence = "proven" if len(chains) >= 2 else "probable"
        narrative = (f"The company paid {self.name(rfc)} {mxn(amount)}. Within {max(days)} days the same money moved on to "
                     f"{', '.join(named) or 'another account'} and then back into a company account, "
                     f"arriving as {mxn(back)} after a small cut at each hop. The purchase and the incoming money "
                     f"are the same pesos going around, not trade.")
        return {"closed": False, "scheme_type": "round_tripping", "entities": ents, "subject_name": self.name(rfc),
                "rule_broken": ("NIF D-1 (income requires a real transfer of goods or services; money that returns "
                                "through the supplier just paid is not revenue) and CFF Art. 69-B (simulated operations)."),
                "peso_amount": amount, "confidence": confidence, "narrative": narrative, "evidence": evidence,
                "exhibits": ex.items, "money_trail": trail,
                "reconciliation": {"table": "invoices" if use_inv else "bank_txns",
                                   "items": inv_items if use_inv else out_items},
                "scoring": {"cycles": [[x["txn_id"] for x in c] for c in chains], "hop_min_ratio": ROUND_TRIP_HOP_MIN_RATIO,
                            "max_days": ROUND_TRIP_CHAIN_MAX_DAYS},
                "defense": [{"argument": "The third party could be an ordinary customer paying the company.",
                             "held": False,
                             "why": f"Its payment arrived days after it received {mxn(chains[0][1]['amount'])} from the "
                                    f"supplier the company had just paid, at {chains[0][-1]['amount'] / chains[0][0]['amount']:.1%} "
                                    f"of the original amount."},
                            {"argument": "Transfers between the company's own accounts are not round-tripping.",
                             "held": False,
                             "why": "Correct, and those are excluded: this cycle leaves through a registered supplier's "
                                    "account and passes through a third party."}]}

    def round_tripping(self, rfc: str) -> dict:
        t = self.t
        v = t.vendor_profile(rfc) or {}
        vc = v.get("bank_clabe")
        if not vc:
            return closed("Vendor has no bank account on file.")
        chains = [c for c in self.e.cycles() if c[0]["to_clabe"] == vc]
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
        direct_ok = bool(cycles) and not (len(booked) == 0 and len(cycles) < 2)
        if chains and not direct_ok:
            note = (f"{len(cycles)} direct return(s) from the vendor itself also exist" if cycles else "")
            return self._chain_finding(rfc, chains, note)
        if not direct_ok:
            if refunds:
                o, b, inv = refunds[0]
                return closed(f"{b['txn_id']} returned {mxn(b['amount'])} {days_between(o['date'], b['date'])} days "
                              f"after payment {o['txn_id']}, but invoice {inv['uuid']} was cancelled and no revenue "
                              f"was booked: a refund of a cancelled CFDI, not revenue.", "challenger",
                              [{"argument": "Money paid out came back from the same vendor.", "held": True,
                                "why": "The paid invoice was cancelled and the return was not recorded as a sale."}])
            return closed(f"The company paid {rfc} {len(outs)} times and received {len(backs)} transfers from it, "
                          f"but no receipt matches a payment within {ROUND_TRIP_MAX_DAYS} days at "
                          f"≥{ROUND_TRIP_MIN_RATIO:.0%} of its amount, and no payment to it travels through a third "
                          f"account back to the company within {ROUND_TRIP_CHAIN_MAX_DAYS} days keeping "
                          f"≥{ROUND_TRIP_HOP_MIN_RATIO:.0%} per hop; the two flows are independent trade "
                          f"(sales {len(sales)}, purchases {len(invs)}). Transfers between the company's own "
                          f"accounts ({len(self.e.own_accounts)} detected) are never counted as a cycle.", "investigator")
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
    def _split_candidates(self, pos: list[dict]) -> list[dict]:
        """Ventanas de ≥3 órdenes justo bajo un límite, ≤SPLIT_WINDOW_DAYS, que juntas lo superan,
        agrupadas por la misma persona: el aprobador (una persona se queda dentro de su propia
        autoridad) o el solicitante (una compra repartida entre varios aprobadores)."""
        cands = []
        for lim in self.approval_limits():
            near = [p for p in pos if NEAR_LIMIT_RATIO * lim <= p["amount"] < lim]
            for mode in ("requester", "approver"):
                groups: dict[str, list] = {}
                for p in near:
                    groups.setdefault(self.e.person_key(p[mode]), []).append(p)
                for person, ps in sorted(groups.items()):
                    if not person:
                        continue
                    ps.sort(key=lambda p: (p["date"], p["po_id"]))
                    for i in range(len(ps)):
                        win = [p for p in ps[i:] if days_between(ps[i]["date"], p["date"]) <= SPLIT_WINDOW_DAYS]
                        if len(win) >= 3 and sum(p["amount"] for p in win) > lim:
                            approvers = sorted({self.e.person_key(p["approver"]) for p in win})
                            if mode == "requester" and len(approvers) < 2:
                                continue   # un solo aprobador: lo evalúa el modo aprobador
                            cands.append({"lim": lim, "mode": mode, "person": person, "win": win,
                                          "span": days_between(win[0]["date"], win[-1]["date"]),
                                          "approvers": approvers})
        cands.sort(key=lambda c: (-len(c["win"]), c["span"], c["mode"] != "requester", c["lim"], c["person"],
                                  [p["po_id"] for p in c["win"]]))
        return cands

    def threshold_splitting(self, rfc: str) -> dict:
        t = self.t
        pos = t.purchase_orders(rfc)
        ctrs = t.contracts(rfc)
        cands = self._split_candidates(pos)
        if not cands:
            near = [p for p in pos if any(NEAR_LIMIT_RATIO * l <= p["amount"] < l for l in self.approval_limits())]
            gaps = [days_between(a["date"], b["date"]) for a, b in zip(near, near[1:])]
            amounts = [p["amount"] for p in near]
            fixed = bool(amounts) and max(amounts) - min(amounts) <= 0.01 * max(amounts)
            regular = bool(gaps) and min(gaps) >= FIXED_FEE_MIN_GAP_DAYS
            ctr = next((c for c in ctrs if near and c["start_date"] <= near[0]["date"]), None)
            reason = (f"{len(near)} orders sit just under an approval limit, but they are spaced "
                      f"{min(gaps) if gaps else 0}–{max(gaps) if gaps else 0} days apart"
                      + (f" for an identical {mxn(amounts[0])}" if fixed and len(near) > 1 else "")
                      + (f" under contract {ctr['contract_id']} (MXN {ctr['value']:,.0f}, since {ctr['start_date']})"
                         if ctr else (f" under contract {ctrs[0]['contract_id']} (MXN {ctrs[0]['value']:,.0f})" if ctrs else ""))
                      + f"; no three fall within {SPLIT_WINDOW_DAYS} days for the same requester or approver, so this "
                        f"is a recurring charge, not one purchase split up.")
            return closed(reason, "challenger" if regular else "investigator",
                          [{"argument": "Orders just under the limit suggest splitting.", "held": True,
                            "why": "Regular cadence" + (" of a fixed fee under a signed contract" if fixed and ctr else "")
                                   + " matches a recurring service."}] if regular else [])
        exculpated = []
        chosen = None
        for c in cands:
            lim, win = c["lim"], c["win"]
            if c["mode"] == "approver":
                above = [p for p in t.approvals_by(c["person"]) if p["amount"] > lim]
                if above:
                    exculpated.append((c, f"approver {c['person']} also signed {len(above)} orders above MXN {lim:,.0f} "
                                          f"(e.g. {above[0]['po_id']} for {mxn(above[0]['amount'])}); "
                                          f"MXN {lim:,.0f} is not a limit they needed to evade"))
                    continue
            chosen = c
            break
        if chosen is None:
            c, why = exculpated[0]
            return closed(f"{len(c['win'])} orders of {NEAR_LIMIT_RATIO:.0%}–100% of MXN {c['lim']:,.0f} within "
                          f"{c['span']} days, but {why}. No requester spread a purchase across approvers "
                          f"({len(cands)} window(s) examined).", "challenger",
                          [{"argument": "Orders cluster just under a round amount.", "held": True,
                            "why": "The approver is authorised above that amount."}])
        lim, win, span, mode = chosen["lim"], chosen["win"], chosen["span"], chosen["mode"]
        approvers = chosen["approvers"]
        person = self.e.person(chosen["person"])
        pref = Estate.emp_ref(person) if person else chosen["person"]
        total_po = round(sum(p["amount"] for p in win), 2)
        evidence = [f"{len(win)} orders of {NEAR_LIMIT_RATIO:.0%}–100% of MXN {lim:,.0f} within {span} days, "
                    f"together {mxn(total_po)} on the purchase orders"]
        if mode == "approver":
            evidence.append(f"approver {pref} signed every order and never signed one above MXN {lim:,.0f} — "
                            f"that is the limit of their authority")
        else:
            evidence.append(f"requester {pref} raised every order and each went to a different approver "
                            f"({', '.join(approvers)}), so no approver saw the full MXN {total_po:,.0f}")
        ex = Exhibits()
        trail, invs, used = [], t.invoices_from_vendor(rfc), set()
        v = self.e.vendors.get(rfc, {})
        for p in win:
            ex.add("purchase_orders", p["po_id"], f"Order {p['date']} for {mxn(p['amount'])}, "
                                                   f"{(p['amount'] / lim):.1%} of the limit, requested by "
                                                   f"{self.e.person_key(p['requester'])}, approved by "
                                                   f"{self.e.person_key(p['approver'])}.")
        matched = []
        for p in win:
            inv = next((i for i in invs if i["uuid"] not in used and self.e.po_invoice_gap(p, i, AMOUNT_MATCH) is not None
                        and within(p["date"], i["issue_date"], -5, 30)), None)
            if not inv:
                continue
            used.add(inv["uuid"])
            matched.append(inv)
            iid = ex.add("invoices", inv["uuid"], f"Invoice for the order, {mxn(inv['total'])} including VAT.")
            pay = t.payment_for_invoice(inv, v.get("bank_clabe", ""), set())
            step = {"from": "COMPANY", "to": f"RFC:{rfc}", "amount": inv["total"], "date": inv["issue_date"], "exhibit_id": iid}
            if pay:
                step = {"from": "COMPANY", "to": f"RFC:{rfc}", "amount": pay["amount"], "date": pay["date"],
                        "exhibit_id": ex.add("bank_txns", pay["txn_id"], f"Payment of {inv['uuid']}.")}
            trail.append(step)
        for a in (approvers if mode == "approver" else [chosen["person"]]):
            emp = t.employee_by_name(a)
            if emp:
                ex.add("employees", emp["emp_id"], f"{'Approver' if mode == 'approver' else 'Requester'} "
                                                     f"{Estate.emp_ref(emp)} ({emp['role']}).")
        # pesos: lo que se pagó (facturas con IVA) si cada orden tiene su factura; si no, las órdenes
        if len(matched) == len(win):
            total = round(sum(i["total"] for i in matched), 2)
            recon = {"table": "invoices", "items": [(i["uuid"], i["total"]) for i in matched]}
        else:
            total = total_po
            recon = {"table": "purchase_orders", "items": [(p["po_id"], p["amount"]) for p in win]}
        if not trail:
            trail = [{"from": "COMPANY", "to": f"RFC:{rfc}", "amount": p["amount"], "date": p["date"],
                      "exhibit_id": ex._key[("purchase_orders", p["po_id"])]} for p in win]
        proven = span <= SPLIT_PROVEN_WINDOW_DAYS
        narrative = (f"Within {span} days, {len(win)} purchase orders to {self.name(rfc)} were each set just below "
                     f"the MXN {lim:,.0f} approval limit. Together they total {mxn(total_po)}, a purchase that should "
                     f"have gone to a higher approver. "
                     + ("Splitting it kept every order inside one approver's authority."
                        if mode == "approver" else
                        f"The same requester ({pref}) raised all of them and routed each to a different approver, "
                        f"so nobody reviewed the whole purchase."))
        return {"closed": False, "scheme_type": "threshold_splitting", "entities": [f"RFC:{rfc}"],
                "subject_name": self.name(rfc),
                "rule_broken": (f"Purchase approval-limit policy: purchases above MXN {lim:,.0f} require higher "
                                f"authorization; splitting one purchase into {len(win)} orders below the limit evades it."),
                "peso_amount": total, "confidence": "proven" if proven else "probable", "narrative": narrative,
                "evidence": evidence, "exhibits": ex.items, "money_trail": trail, "reconciliation": recon,
                "scoring": {"grouped_by": mode, "person": chosen["person"], "limit": lim, "window_days": span,
                            "candidates_examined": len(cands), "exculpated_candidates": len(exculpated)},
                "defense": [{"argument": "These could be separate recurring purchases.", "held": False,
                             "why": f"All {len(win)} fall within {span} days, not a monthly cadence."}]
                + ([{"argument": "Different approvers signed them independently.", "held": False,
                     "why": f"One requester raised all {len(win)} orders for the same vendor in {span} days."}]
                   if mode == "requester" else [])}

    # ------------------------------------------------------------------ revenue
    def revenue_inflation(self, rfc: str) -> dict:
        t = self.t
        sales = t.invoices_to_customer(rfc)
        used, flagged, collected, partial, not_due = set(), [], [], [], []
        for s in sales:
            rs = t.receipts_for_invoice(s, used)
            got = round(sum(r["amount"] for r in rs), 2)
            age = days_between(s["issue_date"], self.e.bank_horizon.isoformat())
            if rs and got >= PARTIAL_COLLECTION_MIN * s["total"]:
                used |= {r["txn_id"] for r in rs}
                (collected if got >= 0.995 * s["total"] else partial).append((s, rs, got))
            elif s["status"] == "cancelado":
                flagged.append(s)
            elif (s["metodo_pago"] == "PPD" and age < PPD_GRACE_DAYS) or age < UNCOLLECTED_MIN_AGE_DAYS:
                not_due.append(s)
            else:
                flagged.append(s)
        paid = collected + partial
        if not flagged:
            ex = paid[0] if paid else None
            return closed(f"All {len(paid)} sales invoices to {rfc} were collected by bank transfer from a third-party "
                          f"account"
                          + (f" (e.g. {ex[0]['uuid']}: {len(ex[1])} receipt(s) {', '.join(r['txn_id'] for r in ex[1][:3])} "
                             f"totalling {mxn(ex[2])} of {mxn(ex[0]['total'])})" if ex else "")
                          + (f"; {len(partial)} were paid in instalments ({s_ppd(partial)}), which is how PPD credit "
                             f"sales are settled" if partial else "")
                          + (f"; {len(not_due)} are still within credit terms" if not_due else "")
                          + ". Quarter-end timing or credit terms alone are not inflation.",
                          "challenger" if paid else "investigator",
                          [{"argument": "Sales on credit (PPD) without full payment look like inflated revenue.",
                            "held": True, "why": "Real instalment payments reached the company."}] if partial else [])
        qend = [s for s in flagged if is_quarter_end(s["issue_date"])]
        canc = [s for s in flagged if s["status"] == "cancelado"]
        new_customer = not paid
        n = len(flagged)
        if not (n >= 2 or canc or qend):
            return closed(f"One uncollected invoice ({flagged[0]['uuid']}) outside quarter-end and not cancelled; "
                          f"consistent with an ordinary late payer ({len(paid)} other invoices were paid).")
        proven = n >= 2 and ((qend and (len(canc) == n or new_customer)) or (new_customer and len(sales) == n))
        evidence = [f"{n} sales invoices never collected in bank records through {self.e.bank_horizon.isoformat()}"]
        ppd = [s for s in flagged if s["metodo_pago"] == "PPD"]
        if ppd:
            evidence.append(f"{len(ppd)} issued on credit (PPD, forma_pago {ppd[0]['forma_pago']}) with no instalment "
                            f"ever received, beyond {PPD_GRACE_DAYS} days of terms")
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
                                                 f"{s['metodo_pago']}, {'cancelled' if s['status'] == 'cancelado' else 'never paid'}.")
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
                     + (f", {len(ppd)} on credit terms" if ppd else "")
                     + ". No payment for any of them appears in the bank records, not even a partial one"
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
                "scoring": {"uncollected": n, "partially_collected": len(partial), "collected": len(collected),
                            "not_due": len(not_due), "quarter_end": len(qend), "cancelled": len(canc)},
                "defense": [{"argument": "Credit terms could explain the missing receipts.", "held": False,
                             "why": f"Bank records run to {self.e.bank_horizon.isoformat()}, beyond {PPD_GRACE_DAYS} days "
                                    f"of terms, and not one instalment arrived"
                                    + ("; cancelled CFDI will never be paid." if canc else ".")}]}


def s_ppd(partial: list) -> str:
    s, rs, got = partial[0]
    return f"{s['uuid']}: {mxn(got)} of {mxn(s['total'])} in {len(rs)} payments"
