#!/usr/bin/env python3
"""Generador de estates Forensic Auditor (spec/forensic-auditor/estate_schema.sql).

Escribe dos archivos separados:
  * el estate SQLite que ve el agente (--out)
  * la clave de evaluación (--key), que solo lee eval/forensic/harness.py

    python3 generator/forensic/estate.py --seed 101 --out data/forensic/seed_101/estate.db \
        --key data/forensic/keys/seed_101.json

Stdlib, determinista: la misma semilla produce bytes idénticos.
"""
from __future__ import annotations

import argparse
import json
import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "spec" / "forensic-auditor" / "estate_schema.sql"

PERIOD_START = date(2026, 1, 1)
PERIOD_END = date(2026, 6, 30)
import os
APPROVAL_LIMIT = float(os.environ.get("FORENSIC_APPROVAL_LIMIT", "100000"))  # política de compras simulada

COMPANY_RFC = "INO920101AB1"
COMPANY_NAME = "Industrias del Norte SA de CV"
BANKS = ["002", "012", "014", "021", "030", "036", "044", "058", "072", "127", "137"]
SCHEME_TYPES = ["phantom_vendor", "kickback", "round_tripping",
                "threshold_splitting", "revenue_inflation"]

FIRST = ["Ana", "Luis", "María", "Jorge", "Sofía", "Carlos", "Lucía", "Miguel", "Elena",
         "Raúl", "Paola", "Andrés", "Daniela", "Héctor", "Valeria", "Óscar", "Fernanda",
         "Ricardo", "Gabriela", "Tomás", "Isabel", "Arturo", "Mónica", "Diego"]
LAST = ["García", "Martínez", "López", "Hernández", "González", "Pérez", "Rodríguez",
        "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz", "Cruz",
        "Morales", "Reyes", "Ortiz", "Garza", "Treviño", "Villarreal", "Cantú"]
WORDS = ["Norte", "Regio", "Industrial", "Técnica", "Global", "Integral", "Sierra", "Acero",
         "Delta", "Omega", "Cumbres", "Valle", "Frontera", "Nova", "Prisma", "Atlas",
         "Vértice", "Solar", "Horizonte", "Alianza", "Titán", "Mitras", "Anáhuac"]
STREETS = ["Av. Constitución", "Calle Morelos", "Av. Gonzalitos", "Calle Padre Mier",
           "Av. Lázaro Cárdenas", "Calle Zaragoza", "Av. Ruiz Cortines", "Calle Hidalgo"]
CITIES = ["Monterrey", "San Pedro Garza García", "Guadalupe", "Apodaca", "Santa Catarina",
          "San Nicolás de los Garza", "Escobedo"]
CATEGORIES = {
    "Mantenimiento": ("5100", "Mantenimiento", "Servicio de mantenimiento a equipo de planta"),
    "Materias primas": ("5000", "Costo de materias primas", "Suministro de lámina de acero"),
    "Logística": ("5200", "Fletes y logística", "Servicio de flete terrestre"),
    "Consultoría": ("6000", "Honorarios profesionales", "Servicios de consultoría"),
    "Refacciones": ("5100", "Mantenimiento", "Refacciones para línea de producción"),
    "Limpieza": ("5300", "Servicios generales", "Servicio de limpieza industrial"),
    "Tecnología": ("6100", "Servicios de tecnología", "Licencias y soporte de software"),
    "Seguridad": ("5300", "Servicios generales", "Servicio de seguridad privada"),
}


def iso(d: date) -> str:
    return d.isoformat()


def rdate(rng: random.Random, a: date, b: date) -> date:
    return a + timedelta(days=rng.randint(0, max(0, (b - a).days)))


class Estate:
    def __init__(self, seed: int):
        self.rng = random.Random(seed)
        self.seed = seed
        self.vendors: dict[str, dict] = {}
        self.customers: dict[str, dict] = {}
        self.employees: list[dict] = []
        self.invoices: list[dict] = []
        self.ledger: list[dict] = []
        self.bank: list[dict] = []
        self.pos: list[dict] = []
        self.contracts: list[dict] = []
        self.efos: list[dict] = []
        self._pools: dict[str, list[int]] = {}
        self._rfcs: set[str] = {COMPANY_RFC}
        self._clabes: set[str] = set()
        self.company_clabe = self.clabe("012")
        self.schemes: list[dict] = []
        self.decoys: list[dict] = []

    # ---- identificadores -------------------------------------------------
    def nid(self, prefix: str) -> str:
        pool = self._pools.get(prefix)
        if pool is None:
            pool = self.rng.sample(range(1, 99999), 20000)
            self._pools[prefix] = pool
        return f"{prefix}-{pool.pop():05d}"

    def clabe(self, bank: str | None = None, branch: str | None = None) -> str:
        while True:
            b = bank or self.rng.choice(BANKS)
            br = branch or f"{self.rng.randint(100, 999)}"
            c = b + br + "".join(self.rng.choice("0123456789") for _ in range(12))
            if c not in self._clabes:
                self._clabes.add(c)
                return c

    def rfc(self, name: str) -> str:
        letters = "".join(ch for ch in name.upper() if ch.isalpha() and ch.isascii())
        while True:
            head = (letters + "XXX")[:3] if self.rng.random() < 0.7 else "".join(
                self.rng.choice("ABCDEFGHIJKLMNOPRSTUVWXYZ") for _ in range(3))
            d = rdate(self.rng, date(1985, 1, 1), date(2022, 12, 31))
            tail = "".join(self.rng.choice("ABCDEFGHJKLMNPRSTUVWXYZ0123456789") for _ in range(3))
            r = f"{head}{d:%y%m%d}{tail}"
            if r not in self._rfcs:
                self._rfcs.add(r)
                return r

    def company_name(self) -> str:
        suffix = self.rng.choice(["SA de CV", "S de RL de CV", "SC", "SAPI de CV"])
        return f"{self.rng.choice(WORDS)} {self.rng.choice(WORDS)} {suffix}"

    # ---- entidades -------------------------------------------------------
    def add_employees(self, n: int):
        roles = (["Director de Finanzas", "Gerente de Compras", "Gerente de Compras",
                  "Jefe de Mantenimiento", "Contador General", "Gerente de Ventas"]
                 + ["Analista de Compras", "Supervisor de Planta", "Almacenista",
                    "Ejecutivo de Ventas", "Auxiliar Contable", "Ingeniero de Procesos"] * 4)
        for i in range(n):
            self.employees.append({
                "emp_id": f"EMP:{i + 1:04d}",
                "name": f"{self.rng.choice(FIRST)} {self.rng.choice(LAST)} {self.rng.choice(LAST)}",
                "role": roles[i],
                "bank_clabe": self.clabe(),
                "hire_date": iso(rdate(self.rng, date(2008, 1, 1), date(2024, 6, 30))),
            })

    def by_role(self, role: str) -> list[dict]:
        return [e for e in self.employees if e["role"] == role]

    def requester(self) -> dict:
        return self.rng.choice([e for e in self.employees if "Director" not in e["role"]
                                and "Gerente de Compras" not in e["role"]])

    def approver_for(self, amount: float) -> dict:
        if amount > APPROVAL_LIMIT:
            return self.by_role("Director de Finanzas")[0]
        return self.rng.choice(self.by_role("Gerente de Compras"))

    def add_vendor(self, category: str, registered: date, email_free: bool = False,
                   bank: str | None = None, branch: str | None = None) -> dict:
        name = self.company_name()
        rfc = self.rfc(name)
        slug = name.split()[0].lower().encode("ascii", "ignore").decode() or "contacto"
        domain = self.rng.choice(["gmail.com", "hotmail.com", "outlook.com"]) if email_free \
            else f"{slug}{self.rng.randint(1, 99)}.com.mx"
        v = {"rfc": rfc, "legal_name": name, "registered_date": iso(registered),
             "address": f"{self.rng.choice(STREETS)} {self.rng.randint(10, 3999)}, "
                        f"{self.rng.choice(CITIES)}",
             "bank_clabe": self.clabe(bank, branch), "category": category,
             "contact_email": f"{'ventas' if not email_free else slug}@{domain}"}
        self.vendors[rfc] = v
        return v

    def add_customer(self) -> dict:
        name = self.company_name()
        c = {"rfc": self.rfc(name), "name": name, "clabe": self.clabe()}
        self.customers[c["rfc"]] = c
        return c

    def add_contract(self, v: dict, start: date, value: float, scope: str) -> dict:
        c = {"contract_id": self.nid("CTR"), "vendor_rfc": v["rfc"], "start_date": iso(start),
             "value": round(value, 2), "scope_text": scope}
        self.contracts.append(c)
        return c

    # ---- transacciones ---------------------------------------------------
    def ledger_row(self, d: date, code: str, name: str, debit: float, credit: float,
                   desc: str, inv: str | None, cc: str, approver: str) -> dict:
        row = {"date": iso(d), "account_code": code, "account_name": name,
               "debit": round(debit, 2), "credit": round(credit, 2), "description": desc,
               "invoice_uuid": inv, "cost_center": cc, "approver": approver, "_ord": len(self.ledger)}
        self.ledger.append(row)
        return row

    def txn(self, d: date, frm: str, to: str, amount: float, ref: str, channel: str = "SPEI") -> dict:
        t = {"txn_id": self.nid("BNK"), "date": iso(d), "from_clabe": frm, "to_clabe": to,
             "amount": round(amount, 2), "reference": ref, "channel": channel}
        self.bank.append(t)
        return t

    def purchase(self, v: dict, total: float, d: date, *, concepto: str | None = None,
                 approver: dict | None = None, requester: dict | None = None, po: bool = True,
                 ledger_approver: str | None = None, pay: bool = True,
                 pay_delay: tuple[int, int] = (15, 40), status: str = "vigente",
                 po_date: date | None = None) -> dict:
        total = round(total, 2)
        code, acct, default_concept = CATEGORIES.get(v["category"], CATEGORIES["Consultoría"])
        concepto = concepto or default_concept
        approver = approver or self.approver_for(total)
        requester = requester or self.requester()
        out: dict = {"po": None}
        if po:
            p = {"po_id": self.nid("PO"), "vendor_rfc": v["rfc"],
                 "date": iso(po_date or d - timedelta(days=self.rng.randint(2, 9))),
                 "amount": total, "requester": requester["name"], "approver": approver["name"],
                 "description": concepto}
            self.pos.append(p)
            out["po"] = p
        subtotal = round(total / 1.16, 2)
        inv = {"uuid": self.nid("INV"), "issuer_rfc": v["rfc"], "receiver_rfc": COMPANY_RFC,
               "issue_date": iso(d), "subtotal": subtotal, "iva": round(total - subtotal, 2),
               "total": total, "concepto_text": concepto, "uso_cfdi": "G03",
               "forma_pago": "03", "metodo_pago": "PUE", "status": status}
        self.invoices.append(inv)
        out["invoice"] = inv
        appr = approver["name"] if ledger_approver is None else ledger_approver
        cc = self.rng.choice(["CC-100 Producción", "CC-200 Mantenimiento", "CC-300 Administración"])
        self.ledger_row(d, code, acct, total, 0, f"Registro factura {v['legal_name']}",
                        inv["uuid"], cc, appr)
        self.ledger_row(d, "2100", "Cuentas por pagar", 0, total, "Registro factura",
                        inv["uuid"], cc, appr)
        out["payment"] = None
        if pay:
            pd = d + timedelta(days=self.rng.randint(*pay_delay))
            out["payment"] = self.txn(pd, self.company_clabe, v["bank_clabe"], total,
                                      f"Pago factura {inv['uuid']}")
            self.ledger_row(pd, "2100", "Cuentas por pagar", total, 0, "Pago a proveedor",
                            inv["uuid"], cc, self.by_role("Contador General")[0]["name"])
            self.ledger_row(pd, "1020", "Bancos", 0, total, "Pago a proveedor", inv["uuid"], cc,
                            self.by_role("Contador General")[0]["name"])
        return out

    def sale(self, rfc: str, clabe: str | None, total: float, d: date, *, collect: bool = True,
             delay: tuple[int, int] = (5, 40), metodo: str = "PUE", status: str = "vigente",
             concepto: str = "Venta de piezas troqueladas") -> dict:
        total = round(total, 2)
        subtotal = round(total / 1.16, 2)
        inv = {"uuid": self.nid("INV"), "issuer_rfc": COMPANY_RFC, "receiver_rfc": rfc,
               "issue_date": iso(d), "subtotal": subtotal, "iva": round(total - subtotal, 2),
               "total": total, "concepto_text": concepto, "uso_cfdi": "G01",
               "forma_pago": "99" if metodo == "PPD" else "03", "metodo_pago": metodo,
               "status": status}
        self.invoices.append(inv)
        mgr = self.by_role("Gerente de Ventas")[0]["name"]
        led = [self.ledger_row(d, "1100", "Clientes", total, 0, "Venta", inv["uuid"], "CC-400 Ventas", mgr),
               self.ledger_row(d, "4000", "Ingresos por ventas", 0, total, "Venta", inv["uuid"],
                               "CC-400 Ventas", mgr)]
        receipt = None
        if collect and clabe:
            rd = d + timedelta(days=self.rng.randint(*delay))
            receipt = self.txn(rd, clabe, self.company_clabe, total, f"Cobro {inv['uuid']}")
            self.ledger_row(rd, "1020", "Bancos", total, 0, "Cobro a cliente", inv["uuid"],
                            "CC-400 Ventas", mgr)
            self.ledger_row(rd, "1100", "Clientes", 0, total, "Cobro a cliente", inv["uuid"],
                            "CC-400 Ventas", mgr)
        return {"invoice": inv, "ledger": led, "receipt": receipt}

    # ---- actividad legítima ---------------------------------------------
    def baseline(self, scale: int = 1):
        rng = self.rng
        self.add_employees(22)
        cats = list(CATEGORIES)
        for i in range(32 * scale):
            v = self.add_vendor(cats[i % len(cats)], rdate(rng, date(2010, 1, 1), date(2023, 12, 31)))
            has_contract = rng.random() < 0.45
            base = rng.choice([12_000, 25_000, 48_000, 70_000, 130_000, 210_000])
            if has_contract:
                self.add_contract(v, rdate(rng, date(2024, 1, 1), date(2025, 10, 1)),
                                  base * 12, f"Contrato marco de {v['category'].lower()}")
            for _ in range(rng.randint(2, 6)):
                total = round(base * rng.uniform(0.6, 1.4), -1) + rng.randint(0, 99) / 100
                self.purchase(v, total, rdate(rng, PERIOD_START, PERIOD_END))
        for _ in range(14 * scale):
            c = self.add_customer()
            for _ in range(rng.randint(2, 6)):
                delay, metodo = ((45, 75), "PPD") if rng.random() < 0.25 else ((3, 35), "PUE")
                self.sale(c["rfc"], c["clabe"], round(rng.uniform(40_000, 650_000), 2),
                          rdate(rng, PERIOD_START, PERIOD_END), delay=delay, metodo=metodo)
        for _ in range(8):  # ruido real de la lista 69-B, sin relación con la empresa
            name = self.company_name()
            self.efos.append({"rfc": self.rfc(name), "legal_name": name,
                              "status": rng.choice(["definitivo", "presunto"]),
                              "publication_date": iso(rdate(rng, date(2022, 1, 1), date(2026, 5, 1)))})

    # ---- esquemas --------------------------------------------------------
    def scheme(self, stype: str, idx: int, difficulty: str, shared: dict | None = None) -> dict:
        return getattr(self, f"s_{stype}")(f"S{idx}_{stype}_{idx}", difficulty, shared if shared is not None else {})

    def s_phantom_vendor(self, sid: str, diff: str, shared: dict) -> dict:
        rng = self.rng
        first = rdate(rng, date(2026, 1, 20), date(2026, 4, 15))
        reg_gap = rng.randint(100, 150) if diff == "hard" else rng.randint(10, 60)
        v = self.add_vendor("Consultoría", first - timedelta(days=reg_gap), email_free=diff != "hard")
        invs, txns, total = [], [], 0.0
        d = first
        for _ in range(rng.randint(3, 5)):
            amt = rng.randint(4, 17) * 10_000 * 1.16
            r = self.purchase(v, amt, d, concepto=rng.choice(["Servicios de consultoría integral",
                                                             "Asesoría administrativa",
                                                             "Servicios profesionales diversos"]),
                              po=False, ledger_approver="" if diff != "hard" else None)
            invs.append(r["invoice"]["uuid"]); txns.append(r["payment"]["txn_id"])
            total += r["invoice"]["total"]
            d += timedelta(days=rng.randint(12, 30))
        if diff == "easy":
            self.efos.append({"rfc": v["rfc"], "legal_name": v["legal_name"], "status": "definitivo",
                              "publication_date": iso(rdate(rng, date(2025, 6, 1), date(2026, 5, 30)))})
        shared["vendor"] = v
        return {"scheme_id": sid, "type": "phantom_vendor", "entities": [f"RFC:{v['rfc']}"],
                "supporting_invoices": invs, "supporting_txns": txns,
                "peso_amount": round(total, 2), "difficulty": diff}

    def s_kickback(self, sid: str, diff: str, shared: dict) -> dict:
        rng = self.rng
        v = shared.get("vendor") or self.add_vendor(
            rng.choice(["Refacciones", "Mantenimiento", "Logística"]),
            rdate(rng, date(2016, 1, 1), date(2023, 1, 1)))
        emp = rng.choice(self.by_role("Gerente de Compras"))
        invs, txns, total = [], [], 0.0
        for _ in range(rng.randint(3, 5)):
            amt = round(rng.uniform(0.45, 0.96) * APPROVAL_LIMIT, 2)
            r = self.purchase(v, amt, rdate(rng, date(2026, 1, 10), date(2026, 5, 20)),
                              approver=emp)
            invs.append(r["invoice"]["uuid"])
            kd = date.fromisoformat(r["payment"]["date"]) + timedelta(days=rng.randint(2, 7))
            ref = rng.choice(["Asesoría externa", "Comisión", "Préstamo personal", ""]) \
                if diff != "easy" else "Comisión"
            k = self.txn(kd, v["bank_clabe"], emp["bank_clabe"], round(amt * rng.uniform(0.08, 0.12), 2), ref)
            txns.append(k["txn_id"])
            total += k["amount"]
        return {"scheme_id": sid, "type": "kickback",
                "entities": [f"RFC:{v['rfc']}", emp["emp_id"]],
                "supporting_invoices": invs, "supporting_txns": txns,
                "peso_amount": round(total, 2), "difficulty": diff}

    def s_round_tripping(self, sid: str, diff: str, shared: dict) -> dict:
        rng = self.rng
        v = self.add_vendor(rng.choice(["Materias primas", "Tecnología"]),
                            rdate(rng, date(2022, 1, 1), date(2024, 12, 31)))
        invs, txns, total = [], [], 0.0
        d = rdate(rng, date(2026, 1, 5), date(2026, 2, 15))
        for _ in range(rng.randint(2, 3)):
            amt = round(rng.uniform(250_000, 900_000), 2)
            r = self.purchase(v, amt, d, pay_delay=(5, 12))
            pay = r["payment"]
            back_d = date.fromisoformat(pay["date"]) + timedelta(days=rng.randint(2, 9))
            back = round(amt * rng.uniform(0.9, 0.98), 2)
            s = self.sale(v["rfc"], None, back, back_d - timedelta(days=1), collect=False,
                          concepto="Venta de excedente de material")
            ret = self.txn(back_d, v["bank_clabe"], self.company_clabe, back, f"Cobro {s['invoice']['uuid']}")
            invs.append(r["invoice"]["uuid"]); txns += [pay["txn_id"], ret["txn_id"]]
            total += amt
            d += timedelta(days=rng.randint(25, 45))
        return {"scheme_id": sid, "type": "round_tripping", "entities": [f"RFC:{v['rfc']}"],
                "supporting_invoices": invs, "supporting_txns": txns,
                "peso_amount": round(total, 2), "difficulty": diff}

    def s_threshold_splitting(self, sid: str, diff: str, shared: dict) -> dict:
        rng = self.rng
        v = shared.get("vendor") or self.add_vendor(
            rng.choice(["Refacciones", "Mantenimiento"]), rdate(rng, date(2015, 1, 1), date(2023, 1, 1)))
        approver = rng.choice(self.by_role("Gerente de Compras"))
        req = self.requester()
        start = rdate(rng, date(2026, 1, 15), date(2026, 5, 10))
        span = 19 if diff == "hard" else 8
        invs, txns, total = [], [], 0.0
        n = rng.randint(3, 5)
        for i in range(n):
            pd = start + timedelta(days=round(span * i / (n - 1)))
            amt = round(rng.uniform(0.88, 0.995) * APPROVAL_LIMIT, 2)
            r = self.purchase(v, amt, pd + timedelta(days=rng.randint(1, 3)), approver=approver,
                              requester=req if diff != "hard" else self.requester(), po_date=pd,
                              concepto="Refacciones línea de troquelado")
            invs.append(r["invoice"]["uuid"]); txns.append(r["payment"]["txn_id"])
            total += amt
        return {"scheme_id": sid, "type": "threshold_splitting", "entities": [f"RFC:{v['rfc']}"],
                "supporting_invoices": invs, "supporting_txns": txns,
                "peso_amount": round(total, 2), "difficulty": diff}

    def s_revenue_inflation(self, sid: str, diff: str, shared: dict) -> dict:
        rng = self.rng
        if diff == "hard":
            c = self.rng.choice(list(self.customers.values()))
        else:
            c = self.add_customer()
        qend = rng.choice([date(2026, 3, 31), date(2026, 6, 30)])
        invs, total = [], 0.0
        for _ in range(rng.randint(2, 4)):
            s = self.sale(c["rfc"], c["clabe"], round(rng.uniform(150_000, 520_000), 2),
                          qend - timedelta(days=rng.randint(0, 5)), collect=False,
                          status="cancelado" if diff == "easy" else "vigente")
            invs.append(s["invoice"]["uuid"])
            total += s["invoice"]["total"]
        return {"scheme_id": sid, "type": "revenue_inflation", "entities": [f"RFC:{c['rfc']}"],
                "supporting_invoices": invs, "supporting_txns": [],
                "peso_amount": round(total, 2), "difficulty": diff}

    # ---- señuelos --------------------------------------------------------
    def decoy(self, kind: str) -> dict:
        return getattr(self, f"d_{kind}")()

    def d_new_vendor_documented(self) -> dict:
        rng = self.rng
        first = rdate(rng, date(2026, 2, 1), date(2026, 4, 30))
        v = self.add_vendor("Seguridad", first - timedelta(days=rng.randint(15, 50)))
        ctr = self.add_contract(v, first - timedelta(days=5), 58_000 * 12, "Contrato de seguridad privada")
        invs = [self.purchase(v, 58_000.0, first + timedelta(days=30 * i))["invoice"]["uuid"]
                for i in range(rng.randint(2, 4))]
        return {"entity": f"RFC:{v['rfc']}", "signal": "recently_registered_vendor",
                "why_innocent": f"Signed contract {ctr['contract_id']} and an approved purchase order back every invoice.",
                "invoices": invs}

    def d_efos_presunto_backed(self) -> dict:
        rng = self.rng
        v = self.add_vendor("Logística", rdate(rng, date(2012, 1, 1), date(2020, 1, 1)))
        ctr = self.add_contract(v, date(2025, 3, 1), 90_000 * 12, "Contrato de fletes")
        invs = [self.purchase(v, round(rng.uniform(60_000, 90_000), 2),
                              rdate(rng, date(2026, 1, 5), date(2026, 3, 31)))["invoice"]["uuid"]
                for _ in range(3)]
        self.efos.append({"rfc": v["rfc"], "legal_name": v["legal_name"], "status": "presunto",
                          "publication_date": iso(date(2026, 6, rng.randint(5, 25)))})
        return {"entity": f"RFC:{v['rfc']}", "signal": "efos_list_match",
                "why_innocent": f"Only 'presunto' status published after the last invoice; contract {ctr['contract_id']} and POs document real deliveries.",
                "invoices": invs}

    def d_same_bank(self) -> dict:
        rng = self.rng
        emp = rng.choice(self.by_role("Gerente de Compras"))
        v = self.add_vendor("Refacciones", rdate(rng, date(2014, 1, 1), date(2022, 1, 1)),
                            bank=emp["bank_clabe"][:3], branch=emp["bank_clabe"][3:6])
        invs = [self.purchase(v, round(rng.uniform(0.2, 0.8) * APPROVAL_LIMIT, 2),
                              rdate(rng, PERIOD_START, PERIOD_END), approver=emp)["invoice"]["uuid"]
                for _ in range(3)]
        return {"entity": f"RFC:{v['rfc']}", "signal": "employee_vendor_shared_bank",
                "why_innocent": f"{emp['emp_id']} banks at the same institution and branch, but no transfer ever moves between the two accounts.",
                "invoices": invs}

    def d_monthly_fixed_fee(self) -> dict:
        rng = self.rng
        v = self.add_vendor("Mantenimiento", rdate(rng, date(2012, 1, 1), date(2020, 1, 1)))
        fee = round(rng.uniform(0.9, 0.98) * APPROVAL_LIMIT, 2)
        ctr = self.add_contract(v, date(2025, 1, 1), fee * 12, "Contrato marco, cuota mensual fija de mantenimiento")
        invs = []
        for m in range(1, 7):
            d = date(2026, m, rng.randint(3, 6))
            invs.append(self.purchase(v, fee, d, po_date=d - timedelta(days=2))["invoice"]["uuid"])
        return {"entity": f"RFC:{v['rfc']}", "signal": "po_below_approval_limit",
                "why_innocent": f"Fixed monthly fee under contract {ctr['contract_id']}; one order per month, not a split purchase.",
                "invoices": invs}

    def d_quarter_end_ppd(self) -> dict:
        rng = self.rng
        c = self.add_customer()
        qend = rng.choice([date(2026, 3, 31), date(2026, 6, 30)])
        invs = [self.sale(c["rfc"], c["clabe"], round(rng.uniform(200_000, 600_000), 2),
                          qend - timedelta(days=rng.randint(0, 4)), metodo="PPD",
                          delay=(40, 60))["invoice"]["uuid"] for _ in range(2)]
        return {"entity": f"RFC:{c['rfc']}", "signal": "quarter_end_revenue",
                "why_innocent": "Credit-term (PPD) quarter-end sales that were collected in full by bank transfer.",
                "invoices": invs}

    def d_reciprocal_customer(self) -> dict:
        rng = self.rng
        v = self.add_vendor("Materias primas", rdate(rng, date(2010, 1, 1), date(2019, 1, 1)))
        self.add_contract(v, date(2025, 1, 1), 1_800_000, "Suministro anual de lámina")
        invs = [self.purchase(v, round(rng.uniform(120_000, 300_000), 2),
                              rdate(rng, date(2026, 1, 5), date(2026, 2, 28)))["invoice"]["uuid"]
                for _ in range(2)]
        invs.append(self.sale(v["rfc"], v["bank_clabe"], round(rng.uniform(15_000, 40_000), 2),
                              rdate(rng, date(2026, 5, 1), date(2026, 6, 15)),
                              concepto="Venta de chatarra de acero")["invoice"]["uuid"])
        return {"entity": f"RFC:{v['rfc']}", "signal": "vendor_is_customer",
                "why_innocent": "Scrap sales to a steel supplier: small, months apart, collected, unrelated to purchase payments.",
                "invoices": invs}

    def d_refund_cancelled(self) -> dict:
        rng = self.rng
        v = self.add_vendor("Tecnología", rdate(rng, date(2013, 1, 1), date(2021, 1, 1)))
        r = self.purchase(v, round(rng.uniform(80_000, 250_000), 2),
                          rdate(rng, date(2026, 1, 10), date(2026, 4, 30)), status="cancelado",
                          pay_delay=(5, 10))
        pd = date.fromisoformat(r["payment"]["date"])
        self.txn(pd + timedelta(days=rng.randint(3, 9)), v["bank_clabe"], self.company_clabe,
                 r["invoice"]["total"], f"Devolución factura cancelada {r['invoice']['uuid']}")
        others = [self.purchase(v, round(rng.uniform(30_000, 90_000), 2),
                                rdate(rng, PERIOD_START, PERIOD_END))["invoice"]["uuid"] for _ in range(2)]
        return {"entity": f"RFC:{v['rfc']}", "signal": "funds_returned_to_company",
                "why_innocent": "Full refund of a cancelled CFDI; no revenue was booked for the returned funds.",
                "invoices": [r["invoice"]["uuid"]] + others}

    # ---- escritura -------------------------------------------------------
    def write(self, out: Path):
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            out.unlink()
        conn = sqlite3.connect(out)
        conn.executescript(SCHEMA.read_text())
        conn.executemany("INSERT INTO vendors VALUES (?,?,?,?,?,?,?)",
                         [tuple(v.values()) for v in sorted(self.vendors.values(), key=lambda x: x["rfc"])])
        conn.executemany("INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                         [tuple(i.values()) for i in sorted(self.invoices, key=lambda x: (x["issue_date"], x["uuid"]))])
        ledger = sorted(self.ledger, key=lambda r: (r["date"], r["_ord"]))
        conn.executemany("INSERT INTO ledger VALUES (?,?,?,?,?,?,?,?,?,?)",
                         [(n + 1, r["date"], r["account_code"], r["account_name"], r["debit"], r["credit"],
                           r["description"], r["invoice_uuid"], r["cost_center"], r["approver"])
                          for n, r in enumerate(ledger)])
        conn.executemany("INSERT INTO bank_txns VALUES (?,?,?,?,?,?,?)",
                         [tuple(t.values()) for t in sorted(self.bank, key=lambda x: (x["date"], x["txn_id"]))])
        conn.executemany("INSERT INTO purchase_orders VALUES (?,?,?,?,?,?,?)",
                         [tuple(p.values()) for p in sorted(self.pos, key=lambda x: (x["date"], x["po_id"]))])
        conn.executemany("INSERT INTO contracts VALUES (?,?,?,?,?)",
                         [tuple(c.values()) for c in sorted(self.contracts, key=lambda x: x["contract_id"])])
        conn.executemany("INSERT INTO employees VALUES (?,?,?,?,?)",
                         [tuple(e.values()) for e in self.employees])
        conn.executemany("INSERT INTO efos_list VALUES (?,?,?,?)",
                         [tuple(e.values()) for e in sorted(self.efos, key=lambda x: x["rfc"])])
        conn.commit()
        conn.close()


DECOY_KINDS = ["new_vendor_documented", "efos_presunto_backed", "same_bank", "monthly_fixed_fee",
               "quarter_end_ppd", "reciprocal_customer", "refund_cancelled"]


def build(seed: int, n_schemes: int | None = None, n_decoys: int | None = None, scale: int = 1) -> Estate:
    est = Estate(seed)
    est.baseline(scale)
    rng = est.rng
    n_schemes = n_schemes if n_schemes is not None else rng.randint(3, 5)
    n_decoys = n_decoys if n_decoys is not None else rng.randint(4, 10)
    types = rng.sample(SCHEME_TYPES, n_schemes)
    shared: dict = {}
    # entrelazado: un kickback o fraccionamiento reutiliza al proveedor fantasma
    if "phantom_vendor" in types:
        types.remove("phantom_vendor")
        types.insert(0, "phantom_vendor")
    partner = next((t for t in types if t in ("kickback", "threshold_splitting")), None)
    entangle = partner is not None and "phantom_vendor" in types and rng.random() < 0.6
    for i, t in enumerate(types, start=1):
        diff = rng.choice(["easy", "medium", "medium", "hard"])
        use = shared if t == "phantom_vendor" or (entangle and t == partner) else {}
        est.schemes.append(est.scheme(t, i, diff, use))
    kinds = [DECOY_KINDS[i % len(DECOY_KINDS)] for i in range(n_decoys)]
    rng.shuffle(kinds)
    for k in kinds:
        est.decoys.append(est.decoy(k))
    return est


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--out", required=True, help="ruta del estate .db")
    ap.add_argument("--key", required=True, help="ruta de la clave de evaluación (fuera de src/)")
    ap.add_argument("--schemes", type=int)
    ap.add_argument("--decoys", type=int)
    ap.add_argument("--normal-scale", type=int, default=1, help="multiplica proveedores y clientes legítimos")
    a = ap.parse_args()
    est = build(a.seed, a.schemes, a.decoys, a.normal_scale)
    est.write(Path(a.out))
    key = {"seed": a.seed, "company_rfc": COMPANY_RFC, "schemes": est.schemes, "decoys": est.decoys}
    Path(a.key).parent.mkdir(parents=True, exist_ok=True)
    Path(a.key).write_text(json.dumps({"ground_truth": key}, indent=2, ensure_ascii=False))
    print(f"seed={a.seed} schemes={len(est.schemes)} decoys={len(est.decoys)} "
          f"invoices={len(est.invoices)} txns={len(est.bank)} -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
