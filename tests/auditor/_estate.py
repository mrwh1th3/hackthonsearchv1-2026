"""Estates mínimos para pruebas unitarias del auditor: el esquema oficial y solo las filas que la
prueba necesita, más un fondo de proveedores normales para que la cuenta de la empresa se detecte."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
SCHEMA = ROOT / "spec" / "forensic-auditor" / "estate_schema.sql"

CO = "EMP920101AB1"
CO_CLABE = "012180000000000019"


class Builder:
    def __init__(self, path: Path, po_base: str = "total", person: str = "name"):
        self.path = Path(path)
        self.po_base, self.person = po_base, person
        self.rows: dict[str, list[tuple]] = {t: [] for t in ("vendors", "invoices", "ledger", "bank_txns",
                                                            "purchase_orders", "contracts", "employees", "efos_list")}
        self.n = {"INV": 0, "BNK": 0, "PO": 0, "CTR": 0, "LED": 0}
        self.emps = []
        for i, (name, role) in enumerate([("Ana Uno", "Gerente de Compras"), ("Luis Dos", "Gerente de Compras"),
                                          ("Eva Tres", "Director de Finanzas"), ("Raul Cuatro", "Analista"),
                                          ("Sara Cinco", "Contador General")], start=1):
            e = (f"EMP:{i:04d}", name, role, f"0441800000000005{i:02d}", "2020-01-01")
            self.emps.append(e)
            self.rows["employees"].append(e)
        # fondo: tres proveedores normales, con orden de compra y pago
        for k in range(3):
            v = self.vendor(f"NRM0{k}0101AA{k}", registered="2012-01-01")
            for m in range(1, 4):
                self.purchase(v, 23_200.0 + 1000 * k, f"2026-0{m}-1{k}", approver=self.emps[0], requester=self.emps[3])

    def ref(self, emp):
        return emp[0] if self.person == "emp_id" else emp[1]

    def nid(self, p):
        self.n[p] += 1
        return f"{p}-{self.n[p]:05d}"

    def vendor(self, rfc, registered="2015-01-01", clabe=None):
        clabe = clabe or ("072" + str(int.from_bytes(rfc.encode(), "big") % 10**15).zfill(15))
        self.rows["vendors"].append((rfc, f"Proveedor {rfc}", registered, "Calle 1", clabe, "Servicios", "a@b.mx"))
        return {"rfc": rfc, "clabe": clabe}

    def txn(self, date, frm, to, amount, ref=""):
        t = self.nid("BNK")
        self.rows["bank_txns"].append((t, date, frm, to, round(amount, 2), ref, "SPEI"))
        return t

    def purchase(self, v, total, date, po=True, approver=None, requester=None, pay=True, po_date=None,
                 ledger_approver=None):
        approver, requester = approver or self.emps[0], requester or self.emps[3]
        uuid = self.nid("INV")
        sub = round(total / 1.16, 2)
        self.rows["invoices"].append((uuid, v["rfc"], CO, date, sub, round(total - sub, 2), total, "Servicio", "G03",
                                      "03", "PUE", "vigente"))
        if po:
            amt = sub if self.po_base == "subtotal" else total
            self.rows["purchase_orders"].append((self.nid("PO"), v["rfc"], po_date or date, amt, self.ref(requester),
                                                 self.ref(approver), "Servicio"))
        la = self.ref(approver) if ledger_approver is None else ledger_approver
        self.ledger(date, "5000", total, 0, uuid, la)
        self.ledger(date, "2100", 0, total, uuid, la)
        if pay:
            self.txn(date, CO_CLABE, v["clabe"], total, f"Pago factura {uuid}")
        return uuid

    def sale(self, rfc, total, date, metodo="PPD"):
        uuid = self.nid("INV")
        sub = round(total / 1.16, 2)
        self.rows["invoices"].append((uuid, CO, rfc, date, sub, round(total - sub, 2), total, "Venta", "G01",
                                      "99" if metodo == "PPD" else "03", metodo, "vigente"))
        self.ledger(date, "1100", total, 0, uuid, "Sara Cinco")
        self.ledger(date, "4000", 0, total, uuid, "Sara Cinco")
        return uuid

    def ledger(self, date, code, debit, credit, uuid, approver):
        self.n["LED"] += 1
        self.rows["ledger"].append((self.n["LED"], date, code, "Cuenta", debit, credit, "Registro", uuid, "CC-1", approver))

    def contract(self, rfc, start, value):
        self.rows["contracts"].append((self.nid("CTR"), rfc, start, value, "Contrato marco"))

    def efos(self, rfc, status, pub):
        self.rows["efos_list"].append((rfc, f"Proveedor {rfc}", status, pub))

    def write(self) -> str:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            self.path.unlink()
        c = sqlite3.connect(self.path)
        c.executescript(SCHEMA.read_text())
        for t, rows in self.rows.items():
            if rows:
                c.executemany(f"INSERT INTO {t} VALUES ({','.join('?' * len(rows[0]))})", rows)
        c.commit()
        c.close()
        return str(self.path)
