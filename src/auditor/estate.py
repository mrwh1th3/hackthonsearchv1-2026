"""Acceso de solo lectura al estate SQLite. Cada consulta del investigador pasa por
`Tools`, que registra el nombre de la herramienta: así un lead cerrado muestra qué
se examinó, y uno saltado no aparece con herramientas."""
from __future__ import annotations

import re
import sqlite3
from collections import Counter
from datetime import date, timedelta
from pathlib import Path


def d(s: str) -> date:
    return date.fromisoformat(str(s)[:10])


class Estate:
    def __init__(self, path: str):
        p = Path(path)
        if not p.is_file():
            raise FileNotFoundError(f"estate not found: {path}")
        self.path = str(p)
        self.conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
        self.conn.row_factory = sqlite3.Row
        self.tables = {r[0] for r in self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.vendors = {r["rfc"]: dict(r) for r in self.q("SELECT * FROM vendors ORDER BY rfc")}
        self.employees = [dict(r) for r in self.q("SELECT * FROM employees ORDER BY emp_id")]
        self.company_rfc = self._company_rfc()
        self.company_clabes = self._company_clabes()
        self.clabe_owner: dict[str, str] = {}
        for v in self.vendors.values():
            if v.get("bank_clabe"):
                self.clabe_owner[v["bank_clabe"]] = f"RFC:{v['rfc']}"
        for e in self.employees:
            if e.get("bank_clabe"):
                self.clabe_owner[e["bank_clabe"]] = self.emp_ref(e)
        for c in self.company_clabes:
            self.clabe_owner[c] = "COMPANY"
        dates = [r[0] for r in self.q("SELECT max(date) FROM bank_txns")]
        self.bank_horizon = d(dates[0]) if dates and dates[0] else date.today()
        span = self.q("SELECT min(issue_date), max(issue_date) FROM invoices")[0]
        self.period = (span[0], span[1])

    def q(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        if not sql.lstrip().upper().startswith("SELECT"):
            raise PermissionError("estate is read-only")
        tbls = [t for t in ("ledger", "invoices", "bank_txns", "vendors", "efos_list",
                            "purchase_orders", "contracts", "employees") if t in sql]
        if any(t not in self.tables for t in tbls):
            return []
        return self.conn.execute(sql, args).fetchall()

    @staticmethod
    def emp_ref(e: dict) -> str:
        eid = str(e["emp_id"])
        return eid if eid.upper().startswith("EMP:") else f"EMP:{eid}"

    def _company_rfc(self) -> str:
        rows = self.q("SELECT receiver_rfc, count(*) n FROM invoices GROUP BY receiver_rfc "
                      "UNION ALL SELECT issuer_rfc, count(*) FROM invoices GROUP BY issuer_rfc")
        c: Counter = Counter()
        for r in rows:
            if r[0] not in self.vendors:
                c[r[0]] += r[1]
        return sorted(c.items(), key=lambda x: (-x[1], x[0]))[0][0] if c else ""

    def _company_clabes(self) -> set[str]:
        vclabes = {v["bank_clabe"] for v in self.vendors.values()}
        c: Counter = Counter()
        for r in self.q("SELECT from_clabe, to_clabe FROM bank_txns"):
            if r["to_clabe"] in vclabes:
                c[r["from_clabe"]] += 1
        if not c:
            return set()
        top = max(c.values())
        return {k for k, n in c.items() if n >= max(3, top * 0.2) and k not in vclabes}


class Tools:
    """Herramientas del investigador. Todas registran su nombre en `calls`."""

    def __init__(self, estate: Estate):
        self.e = estate
        self.calls: list[str] = []
        self._uuids: set[str] | None = None

    def _log(self, name: str):
        self.calls.append(name)

    def take_calls(self) -> list[str]:
        out, self.calls = list(dict.fromkeys(self.calls)), []
        return out

    def vendor_profile(self, rfc: str) -> dict | None:
        self._log("vendor_profile")
        return self.e.vendors.get(rfc)

    def efos_status(self, rfc: str) -> dict | None:
        self._log("efos_status")
        r = self.e.q("SELECT * FROM efos_list WHERE rfc = ?", (rfc,))
        return dict(r[0]) if r else None

    def invoices_from_vendor(self, rfc: str) -> list[dict]:
        self._log("invoices_from_vendor")
        return [dict(r) for r in self.e.q(
            "SELECT * FROM invoices WHERE issuer_rfc = ? AND receiver_rfc = ? ORDER BY issue_date, uuid",
            (rfc, self.e.company_rfc))]

    def invoices_to_customer(self, rfc: str) -> list[dict]:
        self._log("invoices_to_customer")
        return [dict(r) for r in self.e.q(
            "SELECT * FROM invoices WHERE issuer_rfc = ? AND receiver_rfc = ? ORDER BY issue_date, uuid",
            (self.e.company_rfc, rfc))]

    def purchase_orders(self, rfc: str) -> list[dict]:
        self._log("purchase_orders")
        return [dict(r) for r in self.e.q(
            "SELECT * FROM purchase_orders WHERE vendor_rfc = ? ORDER BY date, po_id", (rfc,))]

    def contracts(self, rfc: str) -> list[dict]:
        self._log("contracts")
        return [dict(r) for r in self.e.q(
            "SELECT * FROM contracts WHERE vendor_rfc = ? ORDER BY start_date, contract_id", (rfc,))]

    def ledger_for_invoice(self, uuid: str) -> list[dict]:
        self._log("ledger_for_invoice")
        return [dict(r) for r in self.e.q(
            "SELECT * FROM ledger WHERE invoice_uuid = ? ORDER BY entry_id", (uuid,))]

    def txns_between(self, frm: set[str] | str, to: set[str] | str) -> list[dict]:
        self._log("bank_txns_between")
        frm = {frm} if isinstance(frm, str) else set(frm)
        to = {to} if isinstance(to, str) else set(to)
        if not frm or not to:
            return []
        sql = (f"SELECT * FROM bank_txns WHERE from_clabe IN ({','.join('?' * len(frm))}) "
               f"AND to_clabe IN ({','.join('?' * len(to))}) ORDER BY date, txn_id")
        return [dict(r) for r in self.e.q(sql, tuple(sorted(frm)) + tuple(sorted(to)))]

    def payment_for_invoice(self, inv: dict, to_clabe: str, used: set[str]) -> dict | None:
        """Pago de la empresa que liquida la factura: referencia al UUID o, si no la hay,
        mismo monto (±0.5%) dentro de 120 días."""
        self._log("payment_for_invoice")
        pays = self.txns_between(self.e.company_clabes, to_clabe)
        for t in pays:
            if t["txn_id"] not in used and inv["uuid"] in str(t.get("reference") or ""):
                return t
        for t in pays:
            if t["txn_id"] in used or self._cites_other_invoice(t, inv["uuid"]):
                continue
            if abs(t["amount"] - inv["total"]) <= 0.005 * inv["total"] and \
                    0 <= (d(t["date"]) - d(inv["issue_date"])).days <= 120:
                return t
        return None

    def receipt_for_invoice(self, inv: dict, used: set[str]) -> dict | None:
        """Cobro que liquida una factura emitida por la empresa."""
        self._log("receipt_for_invoice")
        if not self.e.company_clabes:
            return None
        rows = [dict(r) for r in self.e.q(
            f"SELECT * FROM bank_txns WHERE to_clabe IN ({','.join('?' * len(self.e.company_clabes))}) "
            f"ORDER BY date, txn_id", tuple(sorted(self.e.company_clabes)))]
        for t in rows:
            if t["txn_id"] not in used and inv["uuid"] in str(t.get("reference") or ""):
                return t
        # sin referencia al UUID: mismo monto, y la transferencia no liquida otra factura por nombre
        for t in rows:
            if t["txn_id"] in used or self._cites_other_invoice(t, inv["uuid"]):
                continue
            if abs(t["amount"] - inv["total"]) <= 0.005 * inv["total"] and \
                    0 <= (d(t["date"]) - d(inv["issue_date"])).days <= 120:
                return t
        return None

    def _cites_other_invoice(self, t: dict, uuid: str) -> bool:
        if self._uuids is None:
            self._uuids = {r[0] for r in self.e.q("SELECT uuid FROM invoices")}
        ref = str(t.get("reference") or "")
        return any(tok != uuid and tok in self._uuids for tok in re.findall(r"[A-Za-z0-9-]{6,}", ref))

    def employee_by_name(self, name: str) -> dict | None:
        self._log("employee_lookup")
        for e in self.e.employees:
            if e["name"].strip().lower() == str(name or "").strip().lower():
                return e
        return None

    def approvals_by(self, approver: str) -> list[dict]:
        self._log("approvals_by")
        return [dict(r) for r in self.e.q(
            "SELECT * FROM purchase_orders WHERE approver = ? ORDER BY date, po_id", (approver,))]


def days_between(a: str, b: str) -> int:
    return (d(b) - d(a)).days


def within(a: str, b: str, lo: int, hi: int) -> bool:
    return lo <= days_between(a, b) <= hi


__all__ = ["Estate", "Tools", "d", "days_between", "within", "timedelta"]
