"""Whitelisted, capped data tools. The model never supplies SQL."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from ..adapter import LogicalEngineResult, TABLE_IDS, evidence_key

UNTRUSTED = {"legal_name", "name", "address", "category", "concepto_text", "description", "reference", "account_name", "cost_center"}


class DataTools:
    def __init__(self, engine: LogicalEngineResult, estate_path: str | None = None, context=None):
        self.engine, self.context = engine, context
        self.estate_path = estate_path
        self.graph_estate = None
        self.conn = None
        self.columns = {}
        self.allowed_evidence = set(engine.known_evidence)
        self.allowed_subjects = set(engine.known_subjects)
        if estate_path:
            path = Path(estate_path).resolve()
            if not path.is_file():
                raise ValueError("Estate file does not exist")
            self.conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA query_only=ON")
            names = {row[0] for row in self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table in TABLE_IDS:
                if table in names:
                    self.columns[table] = {row[1] for row in self.conn.execute(f'PRAGMA table_info("{table}")')}

    def close(self):
        if self.conn:
            self.conn.close()
        if self.graph_estate:
            self.graph_estate.conn.close()

    def _rows(self, table: str, where: str, args: tuple, limit: int = 12) -> list[dict]:
        if not self.conn or table not in self.columns or TABLE_IDS[table] not in self.columns[table]:
            return []
        rows = self.conn.execute(f'SELECT * FROM "{table}" WHERE {where} ORDER BY "{TABLE_IDS[table]}" LIMIT ?', (*args, min(limit, 30))).fetchall()
        result = []
        for row in rows:
            key = evidence_key(table, row[TABLE_IDS[table]])
            self.allowed_evidence.add(key)
            result.append({"evidence_id": key, **{name + ("_untrusted" if name in UNTRUSTED else ""): value[:600] if isinstance(value, str) else value
                                                for name, value in dict(row).items()}})
        return result

    def _require_ids(self, ids: list[str], subjects_only=False) -> None:
        if not isinstance(ids, list) or len(ids) > 10 or any(not isinstance(x, str) for x in ids):
            raise ValueError("Tool requests accept at most 10 string IDs")
        allowed = self.allowed_subjects if subjects_only else self.allowed_subjects | self.allowed_evidence
        if set(ids) - allowed:
            raise ValueError("Tool request contains unknown IDs; use IDs returned by the engine or a previous tool")

    def call(self, name: str, ids: list[str] | None = None, giro: str = "", max_hops: int = 4) -> dict:
        ids = ids or []
        if name == "context":
            if not giro.strip() or len(giro) > 200:
                raise ValueError("Context requires a nonempty giro under 200 characters")
            return self.context.get(giro) if self.context else {"status": "unavailable", "mechanisms": [], "sources": [], "normal_operations": []}
        if name == "subject_slice":
            self._require_ids(ids, subjects_only=True)
            result = {"status": "ready", "subjects": self.engine.records_for(ids)}
            profiles = []
            for subject in ids:
                if subject.startswith("RFC:"):
                    profiles.extend(self._rows("vendors", '"rfc" = ?', (subject[4:],), 1))
                elif subject.startswith("EMP:"):
                    profiles.extend(self._rows("employees", '"emp_id" IN (?, ?)', (subject, subject[4:]), 1))
            result["profiles"] = profiles
            result["profile_status"] = "ready" if self.conn else "unavailable"
            return result
        if name == "graph_paths":
            self._require_ids(ids, subjects_only=True)
            if type(max_hops) is not int or not 1 <= max_hops <= 4:
                raise ValueError("Graph hop limit is 1..4")
            persisted = self.engine.graph_paths(ids, max_hops)
            if not self.estate_path:
                return persisted
            # Reuse the existing canonical cycle detector; never rebuild chain logic here.
            from src.auditor.estate import Estate
            if self.graph_estate is None:
                self.graph_estate = Estate(self.estate_path)
            estate = self.graph_estate
            accounts = set()
            for ref in ids:
                if ref.startswith("RFC:"):
                    accounts.add(estate.vendors.get(ref[4:], {}).get("bank_clabe"))
                elif ref.startswith("CLABE:"):
                    accounts.add(ref[6:])
                elif ref.startswith("EMP:"):
                    accounts.update(emp.get("bank_clabe") for emp in estate.employees if Estate.emp_ref(emp) == ref)
            accounts.discard(None)
            cycles = []
            for cycle in estate.cycles():
                if len(cycle) > max_hops or not any(txn["from_clabe"] in accounts or txn["to_clabe"] in accounts for txn in cycle):
                    continue
                hops = []
                for txn in cycle:
                    key = evidence_key("bank_txns", txn["txn_id"])
                    self.allowed_evidence.add(key)
                    from_id, to_id = f"CLABE:{txn['from_clabe']}", f"CLABE:{txn['to_clabe']}"
                    self.allowed_subjects.update((from_id, to_id))
                    hops.append({"evidence_id": key, "from": from_id, "to": to_id,
                                 "amount": txn["amount"], "date": txn["date"]})
                cycles.append({"hops": hops, "evidence_ids": [hop["evidence_id"] for hop in hops]})
                if len(cycles) >= 8:
                    break
            return {"status": "ready", "paths": persisted["paths"], "canonical_cycles": cycles,
                    "scope": "Persisted engine paths plus existing Estate.cycles(), at most 8 matching cycles. No claim of exhaustive network exploration."}
        if name == "evidence_rows":
            self._require_ids(ids)
            if not self.conn:
                return {"status": "unavailable", "reason": "No canonical SQLite estate attached", "rows": []}
            rows, absent = [], []
            for ref in ids:
                table, _, identifier = ref.partition(":")
                if table not in TABLE_IDS:
                    absent.append(ref)
                    continue
                found = self._rows(table, f'"{TABLE_IDS[table]}" = ?', (identifier,), 1)
                rows.extend(found)
                if not found:
                    absent.append(ref)
            return {"status": "ready" if not absent else "partial", "rows": rows, "missing_ids": absent}
        if name == "cfdi_bank_join":
            self._require_ids(ids)
            if not self.conn:
                return {"status": "unavailable", "reason": "No canonical SQLite estate attached", "subjects": []}
            results = []
            for ref in ids[:5]:
                if not ref.startswith(("RFC:", "EMP:")):
                    continue
                is_vendor = ref.startswith("RFC:")
                rfc = ref[4:]
                vendors = self._rows("vendors", '"rfc" = ?', (rfc,), 1) if is_vendor else []
                employees = self._rows("employees", '"emp_id" IN (?, ?)', (ref, ref[4:]), 1) if not is_vendor else []
                invoices = self._rows("invoices", '"issuer_rfc" = ? OR "receiver_rfc" = ?', (rfc, rfc), 8) if is_vendor and {"issuer_rfc", "receiver_rfc"} <= self.columns.get("invoices", set()) else []
                bank, joins = [], []
                masters = vendors or employees
                clabe = masters[0].get("bank_clabe") if masters else None
                if clabe and {"from_clabe", "to_clabe"} <= self.columns.get("bank_txns", set()):
                    bank = self._rows("bank_txns", '"from_clabe" = ? OR "to_clabe" = ?', (clabe, clabe), 12)
                # Explicit UUID references are candidates, not proof of settlement or legitimacy.
                for invoice in invoices:
                    for txn in bank:
                        if str(invoice.get("uuid")) in str(txn.get("reference_untrusted", "")):
                            joins.append({"invoice_id": invoice["evidence_id"], "txn_id": txn["evidence_id"],
                                          "method": "explicit_reference_untrusted", "settlement_proven": False})
                results.append({"subject_id": ref, "vendors": vendors, "employees": employees, "invoices": invoices, "bank_txns": bank, "links": joins[:12],
                                "sample_totals": {"invoice_total": round(sum(float(x.get("total") or 0) for x in invoices), 2),
                                                  "bank_amount": round(sum(float(x.get("amount") or 0) for x in bank), 2)},
                                "scope": "Capped rows; totals describe this sample only. Missing link does not prove no payment."})
            return {"status": "ready" if results else "partial", "subjects": results,
                    "scope": "RFC and EMP subjects supported; other IDs need subject_slice or graph_paths."}
        raise ValueError("Tool is not allowlisted")
