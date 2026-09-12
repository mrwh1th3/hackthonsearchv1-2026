#!/usr/bin/env python3
"""Estate grande para prueba manual del sistema de IA (esquema de los jueces).

~5x el estate más grande generado antes (105 proveedores, 595 facturas, 2,370 pólizas),
seis fraudes extensos y 21 señuelos. Cuatro fraudes disparan los detectores SQL; dos
están construidos para que NINGÚN detector de src/auditor/detectors.py abra un lead:
solo se encuentran siguiendo el dinero en más de un salto.

    python3 generator/forensic/mega_estate.py --seed 5005 \
        --out data/forensic/mega/estate.db --key data/forensic/keys/mega_5005.json

La clave (--key) describe los seis esquemas; nunca va dentro de src/ ni del estate.
Stdlib, determinista: la misma semilla produce bytes idénticos.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from estate import (APPROVAL_LIMIT, BANKS, COMPANY_RFC, DECOY_KINDS, PERIOD_END, PERIOD_START,  # noqa: E402
                    Estate, iso, rdate)

NORMAL_SCALE = 16          # 32*16 proveedores y 14*16 clientes legítimos
EXTRA_EMPLOYEES = 58       # 22 del generador base + 58 = 80 empleados
EXTRA_EFOS = 40            # ruido de la lista 69-B sin relación con la empresa
DECOYS_PER_KIND = 3        # 7 tipos x 3 = 21 señuelos
EXTRA_ROLES = ["Operador de Producción", "Técnico de Mantenimiento", "Auxiliar de Almacén", "Chofer",
               "Analista de Calidad", "Asistente Administrativo", "Ejecutivo de Cobranza", "Soporte de TI"]


class MegaEstate(Estate):
    def add_employees(self, n: int):
        super().add_employees(n)
        from estate import FIRST, LAST
        for i in range(EXTRA_EMPLOYEES):
            self.employees.append({
                "emp_id": f"EMP:{len(self.employees) + 1:04d}",
                "name": f"{self.rng.choice(FIRST)} {self.rng.choice(LAST)} {self.rng.choice(LAST)}",
                "role": EXTRA_ROLES[i % len(EXTRA_ROLES)],
                "bank_clabe": self.clabe(),
                "hire_date": iso(rdate(self.rng, date(2012, 1, 1), date(2025, 12, 31))),
            })

    def bank_excluding(self, *clabes: str) -> str:
        banned = {c[:3] for c in clabes if c}
        return self.rng.choice([b for b in BANKS if b not in banned])

    # ------------------------------------------------------------------ F1 (detectable)
    def f1_phantom_ring(self) -> dict:
        """Anillo de tres consultoras fantasma: alta en la misma quincena, mismo domicilio,
        correo gratuito, sin órdenes de compra ni contrato, pólizas sin aprobador. Una ya
        está en la 69-B como definitivo. Dos pasan parte de lo cobrado a la tercera, que
        lo saca a una cuenta ajena."""
        rng = self.rng
        reg = date(2025, 11, rng.randint(3, 12))
        addr = f"Calle Zaragoza {rng.randint(100, 999)} Int. 4, Guadalupe"
        ring = []
        for _ in range(3):
            v = self.add_vendor("Consultoría", reg + timedelta(days=rng.randint(0, 9)), email_free=True)
            v["address"] = addr
            ring.append(v)
        concepts = ["Servicios de consultoría integral", "Asesoría administrativa",
                    "Servicios profesionales diversos", "Estudio de optimización de procesos"]
        invs, txns, total = [], [], 0.0
        payments: dict[str, list[dict]] = {}
        for v in ring:
            d = rdate(rng, date(2026, 1, 8), date(2026, 1, 31))
            payments[v["rfc"]] = []
            for _ in range(rng.randint(6, 8)):
                if d > date(2026, 6, 20):
                    break
                amt = round(rng.randint(4, 17) * 10_000 * 1.16, 2)
                r = self.purchase(v, amt, d, concepto=rng.choice(concepts), po=False, ledger_approver="")
                invs.append(r["invoice"]["uuid"]); txns.append(r["payment"]["txn_id"])
                payments[v["rfc"]].append(r["payment"])
                total += r["invoice"]["total"]
                d += timedelta(days=rng.randint(14, 24))
        hub, sink = ring[2], self.clabe()
        for v in ring[:2]:
            for pay in payments[v["rfc"]][::2]:
                pd = date.fromisoformat(pay["date"]) + timedelta(days=rng.randint(2, 5))
                t = self.txn(pd, v["bank_clabe"], hub["bank_clabe"], round(pay["amount"] * rng.uniform(0.85, 0.92), 2),
                             "Servicios compartidos")
                out = self.txn(pd + timedelta(days=rng.randint(1, 3)), hub["bank_clabe"], sink,
                               round(t["amount"] * rng.uniform(0.94, 0.97), 2), "Retiro")
                txns += [t["txn_id"], out["txn_id"]]
        self.efos.append({"rfc": ring[0]["rfc"], "legal_name": ring[0]["legal_name"], "status": "definitivo",
                          "publication_date": iso(date(2026, 3, rng.randint(10, 20)))})
        return {"scheme_id": "S1_phantom_vendor_1", "type": "phantom_vendor",
                "entities": [f"RFC:{v['rfc']}" for v in ring],
                "supporting_invoices": invs, "supporting_txns": txns,
                "peso_amount": round(total, 2), "difficulty": "medium",
                "detectable_by_rules": True,
                "notes": "Anillo de 3 RFC con mismo domicilio y alta en la misma quincena; uno EFOS definitivo. "
                         "Las reglas abren un hallazgo por RFC; el anillo y la capa hacia la cuenta ajena "
                         f"({sink}) solo se ven cruzando bank_txns entre proveedores."}

    # ------------------------------------------------------------------ F2 (detectable)
    def f2_kickback(self, emp: dict) -> dict:
        """Proveedor de fletes antiguo, con contrato, al que el Gerente de Compras aprueba diez
        órdenes; tras cada pago la cuenta del proveedor le transfiere 8-12%."""
        rng = self.rng
        v = self.add_vendor("Logística", rdate(rng, date(2015, 1, 1), date(2019, 1, 1)))
        self.add_contract(v, date(2025, 3, 1), 900_000, "Contrato de fletes terrestres")
        dates = sorted(rdate(rng, date(2026, 1, 10), date(2026, 6, 5)) for _ in range(10))
        refs = ["Comisión", "Asesoría externa", "Préstamo personal", "", "Reembolso gastos"]
        invs, txns, total = [], [], 0.0
        for d in dates:
            amt = round(rng.uniform(0.52, 0.80) * APPROVAL_LIMIT, 2)
            r = self.purchase(v, amt, d, approver=emp, concepto="Servicio de flete terrestre")
            invs.append(r["invoice"]["uuid"])
            kd = date.fromisoformat(r["payment"]["date"]) + timedelta(days=rng.randint(2, 7))
            k = self.txn(kd, v["bank_clabe"], emp["bank_clabe"], round(amt * rng.uniform(0.08, 0.12), 2),
                         rng.choice(refs))
            txns.append(k["txn_id"])
            total += k["amount"]
        return {"scheme_id": "S2_kickback_2", "type": "kickback", "entities": [f"RFC:{v['rfc']}", emp["emp_id"]],
                "supporting_invoices": invs, "supporting_txns": txns,
                "peso_amount": round(total, 2), "difficulty": "medium", "detectable_by_rules": True,
                "notes": "Transferencia directa proveedor -> cuenta personal del aprobador tras cada pago. "
                         "El mismo gerente firma el fraccionamiento S3."}

    # ------------------------------------------------------------------ F3 (detectable)
    def f3_threshold_splitting(self, approver: dict) -> dict:
        """Una compra de ~MXN 750k de refacciones partida en 8 órdenes justo debajo de 100k en
        11 días, mismo solicitante y mismo aprobador (el del kickback S2)."""
        rng = self.rng
        v = self.add_vendor("Refacciones", rdate(rng, date(2014, 1, 1), date(2021, 1, 1)))
        req = self.requester()
        start = rdate(rng, date(2026, 2, 2), date(2026, 4, 20))
        invs, txns, pos, total = [], [], [], 0.0
        for i in range(8):
            pd = start + timedelta(days=round(11 * i / 7))
            amt = round(rng.uniform(0.88, 0.995) * APPROVAL_LIMIT, 2)
            r = self.purchase(v, amt, pd + timedelta(days=rng.randint(1, 3)), approver=approver, requester=req,
                              po_date=pd, concepto="Refacciones línea de troquelado, proyecto prensa 7")
            invs.append(r["invoice"]["uuid"]); txns.append(r["payment"]["txn_id"]); pos.append(r["po"]["po_id"])
            total += amt
        return {"scheme_id": "S3_threshold_splitting_3", "type": "threshold_splitting",
                "entities": [f"RFC:{v['rfc']}"], "supporting_invoices": invs, "supporting_txns": txns,
                "supporting_pos": pos, "peso_amount": round(total, 2), "difficulty": "easy",
                "detectable_by_rules": True,
                "notes": f"8 órdenes 88-99.5% del límite en 11 días, aprobador {approver['emp_id']}."}

    # ------------------------------------------------------------------ F4 (detectable)
    def f4_revenue_inflation(self) -> dict:
        """Cliente nuevo con una venta chica real cobrada en febrero y siete ventas grandes
        en los últimos días de marzo y junio que nunca se cobran; dos se cancelan."""
        rng = self.rng
        c = self.add_customer()
        self.sale(c["rfc"], c["clabe"], round(rng.uniform(30_000, 45_000), 2),
                  rdate(rng, date(2026, 2, 3), date(2026, 2, 20)), delay=(5, 15))
        invs, total = [], 0.0
        fake = [date(2026, 3, rng.randint(26, 31)) for _ in range(4)] + \
               [date(2026, 6, rng.randint(25, 30)) for _ in range(3)]
        for k, d in enumerate(sorted(fake)):
            s = self.sale(c["rfc"], None, round(rng.uniform(280_000, 720_000), 2), d, collect=False,
                          status="cancelado" if k < 2 else "vigente",
                          concepto="Venta de piezas troqueladas, pedido especial")
            invs.append(s["invoice"]["uuid"])
            total += s["invoice"]["total"]
        return {"scheme_id": "S4_revenue_inflation_4", "type": "revenue_inflation", "entities": [f"RFC:{c['rfc']}"],
                "supporting_invoices": invs, "supporting_txns": [], "peso_amount": round(total, 2),
                "difficulty": "medium", "detectable_by_rules": True,
                "notes": "7 ventas de cierre de trimestre sin cobro (2 canceladas); una venta chica de febrero sí se cobró y es legítima."}

    # ------------------------------------------------------------------ F5 (oculto)
    def f5_layered_kickback(self, emp: dict, other_approvers: list[dict]) -> dict:
        """Kickback en dos saltos. Proveedor de mantenimiento con 12 años, contrato y orden de
        compra para cada factura. En marzo el segundo Gerente de Compras toma sus aprobaciones y
        el precio del mismo servicio sube ~2x. El proveedor paga ~16% a una CLABE que no es de
        ningún proveedor ni empleado, y esa cuenta reenvía ~95% a la cuenta personal del gerente.

        Por qué ninguna regla lo ve: el dinero nunca va de la CLABE del proveedor a la de un
        empleado (vendor_to_employee_transfer), el banco del proveedor difiere del de sus
        aprobadores (employee_vendor_shared_bank), tiene contrato y POs (undocumented_purchases),
        alta antigua, no está en 69-B, no es cliente, no devuelve a la empresa y ningún monto
        cae entre 85% y 100% de un límite."""
        rng = self.rng
        v = self.add_vendor("Mantenimiento", rdate(rng, date(2013, 1, 1), date(2016, 1, 1)),
                            bank=self.bank_excluding(emp["bank_clabe"], *[a["bank_clabe"] for a in other_approvers]))
        ctr = self.add_contract(v, date(2025, 2, 1), 1_100_000, "Contrato de mantenimiento preventivo y correctivo de prensas")
        mule = self.clabe(self.bank_excluding(v["bank_clabe"], emp["bank_clabe"]))
        concept = "Mantenimiento correctivo a prensa hidráulica"
        invs, txns, total, before, after = [], [], 0.0, [], []
        for d in sorted(rdate(rng, date(2026, 1, 8), date(2026, 2, 26)) for _ in range(3)):
            r = self.purchase(v, round(rng.uniform(26_000, 34_000), 2), d, approver=other_approvers[0], concepto=concept)
            before.append(r["invoice"]["total"])
        for d in sorted(rdate(rng, date(2026, 3, 3), date(2026, 6, 12)) for _ in range(7)):
            amt = round(rng.uniform(56_000, 78_000), 2)
            r = self.purchase(v, amt, d, approver=emp, concepto=concept)
            invs.append(r["invoice"]["uuid"])
            after.append(amt)
            pd = date.fromisoformat(r["payment"]["date"])
            hop1 = self.txn(pd + timedelta(days=rng.randint(3, 6)), v["bank_clabe"], mule,
                            round(amt * rng.uniform(0.14, 0.18), 2),
                            rng.choice(["Servicios de asesoría técnica", "Honorarios", "Subcontrato"]))
            hop2 = self.txn(date.fromisoformat(hop1["date"]) + timedelta(days=rng.randint(1, 3)), mule,
                            emp["bank_clabe"], round(hop1["amount"] * rng.uniform(0.93, 0.97), 2),
                            rng.choice(["Pago de renta", "Transferencia", "Préstamo"]))
            txns += [r["payment"]["txn_id"], hop1["txn_id"], hop2["txn_id"]]
            total += hop2["amount"]
        return {"scheme_id": "S5_kickback_5", "type": "kickback", "entities": [f"RFC:{v['rfc']}", emp["emp_id"]],
                "supporting_invoices": invs, "supporting_txns": txns, "peso_amount": round(total, 2),
                "difficulty": "hard", "detectable_by_rules": False,
                "notes": (f"Cuenta puente {mule} (sin dueño en vendors/employees). Proveedor -> puente 3-6 días tras "
                          f"cada pago (~16%), puente -> {emp['emp_id']} 1-3 días después (~95%). Mismo concepto bajo "
                          f"el contrato {ctr['contract_id']}: promedio antes de marzo MXN {sum(before) / len(before):,.0f}, "
                          f"después MXN {sum(after) / len(after):,.0f}, cuando {emp['emp_id']} empezó a aprobar.")}

    # ------------------------------------------------------------------ F6 (oculto)
    def f6_triangular_round_trip(self, director: dict) -> dict:
        """Round-tripping en triángulo que infla ingresos. La empresa paga cinco facturas de un
        proveedor de TI con contrato y PO firmadas por Finanzas; días después el proveedor
        transfiere ~91% a un "cliente" que solo existe para eso, y el cliente paga a la empresa
        ventas emitidas a mitad de mes. El dinero sale y vuelve como ingreso cobrado.

        Por qué ninguna regla lo ve: el retorno no sale de la CLABE del proveedor sino de la del
        cliente (funds_returned_to_company), el cliente es otro RFC (vendor_is_customer), las
        ventas están vigentes, cobradas y fuera del cierre de trimestre (quarter_end_revenue,
        cancelled_sales_invoice), y el proveedor tiene contrato, POs y alta antigua."""
        rng = self.rng
        v = self.add_vendor("Tecnología", rdate(rng, date(2017, 1, 1), date(2019, 6, 1)),
                            bank=self.bank_excluding(director["bank_clabe"]))
        ctr = self.add_contract(v, date(2025, 7, 1), 3_200_000, "Implementación y licenciamiento de ERP")
        c = self.add_customer()
        amounts = [612_480, 348_900, 781_200, 529_700, 402_150]
        buy_dates = [date(2026, 1, 12), date(2026, 2, 9), date(2026, 3, 2), date(2026, 4, 13), date(2026, 5, 11)]
        mgr = self.by_role("Gerente de Ventas")[0]["name"]
        invs, txns, total = [], [], 0.0
        for base_amt, d in zip(amounts, buy_dates):
            amt = base_amt + rng.randint(0, 99) / 100
            r = self.purchase(v, amt, d, approver=director, pay_delay=(6, 12),
                              concepto=rng.choice(["Licencias ERP módulo manufactura", "Implementación ERP fase",
                                                   "Soporte y parametrización ERP"]))
            pd = date.fromisoformat(r["payment"]["date"])
            hop = self.txn(pd + timedelta(days=rng.randint(2, 5)), v["bank_clabe"], c["clabe"],
                           round(amt * rng.uniform(0.88, 0.94), 2), "Anticipo distribución")
            hd = date.fromisoformat(hop["date"])
            s = self.sale(c["rfc"], None, round(hop["amount"] * rng.uniform(0.97, 0.99), 2),
                          hd + timedelta(days=rng.randint(1, 2)), collect=False,
                          concepto="Venta de piezas troqueladas")
            sd = date.fromisoformat(s["invoice"]["issue_date"])
            rd = sd + timedelta(days=rng.randint(1, 3))
            back = self.txn(rd, c["clabe"], self.company_clabe, s["invoice"]["total"], f"Cobro {s['invoice']['uuid']}")
            self.ledger_row(rd, "1020", "Bancos", s["invoice"]["total"], 0, "Cobro a cliente", s["invoice"]["uuid"],
                            "CC-400 Ventas", mgr)
            self.ledger_row(rd, "1100", "Clientes", 0, s["invoice"]["total"], "Cobro a cliente", s["invoice"]["uuid"],
                            "CC-400 Ventas", mgr)
            invs += [r["invoice"]["uuid"], s["invoice"]["uuid"]]
            txns += [r["payment"]["txn_id"], hop["txn_id"], back["txn_id"]]
            total += amt
        return {"scheme_id": "S6_round_tripping_6", "type": "round_tripping",
                "entities": [f"RFC:{v['rfc']}", f"RFC:{c['rfc']}"],
                "supporting_invoices": invs, "supporting_txns": txns, "peso_amount": round(total, 2),
                "difficulty": "hard", "detectable_by_rules": False,
                "notes": (f"Empresa -> proveedor (contrato {ctr['contract_id']}) -> cliente RFC:{c['rfc']} -> empresa, "
                          f"5 ciclos de 2-5 + 1-2 + 1-3 días, retorno ~85-93%. La CLABE del cliente solo recibe dinero "
                          f"del proveedor y solo paga a la empresa; sus ventas son ingreso cobrado con dinero propio.")}


def build(seed: int) -> MegaEstate:
    est = MegaEstate(seed)
    est.baseline(NORMAL_SCALE)
    rng = est.rng
    for _ in range(EXTRA_EFOS):
        name = est.company_name()
        est.efos.append({"rfc": est.rfc(name), "legal_name": name,
                         "status": rng.choice(["definitivo", "presunto"]),
                         "publication_date": iso(rdate(rng, date(2022, 1, 1), date(2026, 5, 1)))})
    g1, g2 = est.by_role("Gerente de Compras")[:2]
    director = est.by_role("Director de Finanzas")[0]
    est.schemes = [
        est.f1_phantom_ring(),
        est.f2_kickback(g1),
        est.f3_threshold_splitting(g1),
        est.f4_revenue_inflation(),
        est.f5_layered_kickback(g2, [g1, director]),
        est.f6_triangular_round_trip(director),
    ]
    kinds = [k for k in DECOY_KINDS for _ in range(DECOYS_PER_KIND)]
    rng.shuffle(kinds)
    est.decoys = [est.decoy(k) for k in kinds]
    return est


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=5005)
    ap.add_argument("--out", required=True, help="ruta del estate .db")
    ap.add_argument("--key", required=True, help="ruta de la clave de evaluación (fuera de src/)")
    a = ap.parse_args()
    est = build(a.seed)
    assert all(PERIOD_START <= date.fromisoformat(i["issue_date"]) <= PERIOD_END for i in est.invoices), \
        "factura fuera del periodo"
    est.write(Path(a.out))
    key = {"seed": a.seed, "company_rfc": COMPANY_RFC, "schemes": est.schemes, "decoys": est.decoys}
    Path(a.key).parent.mkdir(parents=True, exist_ok=True)
    Path(a.key).write_text(json.dumps({"ground_truth": key}, indent=2, ensure_ascii=False))
    print(f"seed={a.seed} vendors={len(est.vendors)} customers={len(est.customers)} employees={len(est.employees)} "
          f"invoices={len(est.invoices)} ledger={len(est.ledger)} txns={len(est.bank)} pos={len(est.pos)} "
          f"contracts={len(est.contracts)} schemes={len(est.schemes)} decoys={len(est.decoys)} -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
