"""Read-only adapter of the existing auditor's persisted contract."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

TABLE_IDS = {
    "vendors": "rfc", "invoices": "uuid", "bank_txns": "txn_id", "ledger": "entry_id",
    "purchase_orders": "po_id", "contracts": "contract_id", "employees": "emp_id", "efos_list": "rfc",
}


def evidence_key(table: str, record_id) -> str:
    if table not in TABLE_IDS or record_id is None or not str(record_id).strip():
        raise ValueError("Evidence must identify an allowed source table and a nonempty record ID")
    return f"{table}:{record_id}"


def compact_record(row: dict) -> dict:
    refs = []
    for ref in row.get("record_ids", []):
        try:
            refs.append(evidence_key(ref.get("source_table"), ref.get("record_id")))
        except ValueError:
            continue
    return {
        "subject_id": row["subject_id"], "subject_type": row.get("subject_type", "unknown"),
        "rule_id": row.get("scheme_type"), "status": row["status"],
        "confidence": row.get("confidence"), "score": row.get("score"),
        "signals": row.get("signals", [])[:12], "reason_untrusted": str(row.get("reason") or "")[:1800],
        "peso_amount": row.get("peso_amount"), "evidence_ids": refs[:20],
        "related_subjects": row.get("related_subjects", [])[:20], "closed_by": row.get("closed_by"),
        "activity_stats": row.get("activity_stats", {}),
    }


@dataclass
class LogicalEngineResult:
    path: Path
    raw: dict
    records: list[dict]
    limitations: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, path: str | Path) -> "LogicalEngineResult":
        path = Path(path).resolve()
        raw = json.loads(path.read_text())
        if not isinstance(raw, dict) or not isinstance(raw.get("findings"), list):
            raise ValueError("Expected auditor run_log.json with findings[]")
        triage = raw.get("triage") or {}
        limits = []
        if "records" not in triage and triage.get("file"):
            ref = (path.parent / triage["file"]).resolve()
            if ref.parent != path.parent:
                raise ValueError("Triage reference must remain beside the engine output")
            if ref.is_file():
                body = ref.read_bytes()
                if triage.get("sha256") and hashlib.sha256(body).hexdigest() != triage["sha256"]:
                    raise ValueError("Triage hash does not match the engine snapshot")
                triage = json.loads(body)
        records = list(triage.get("records") or [])
        if not records:
            limits.append("No triage universe is available; residual coverage cannot be inferred.")
            for finding in raw["findings"]:
                for subject in finding.get("entities", []):
                    records.append({"subject_id": subject, "status": "finding", "scheme_type": finding.get("scheme_type"),
                                    "record_ids": finding.get("exhibits", []), "reason": finding.get("narrative", ""),
                                    "confidence": finding.get("confidence"), "score": finding.get("scoring"),
                                    "signals": finding.get("signals", []), "peso_amount": finding.get("peso_amount"),
                                    "related_subjects": [sid for sid in finding.get("entities", []) if sid != subject]})
            for lead in raw.get("leads", []):
                records.append({"subject_id": lead["entity"], "status": "closed_lead", "scheme_type": lead.get("investigated_as"),
                                "record_ids": [], "reason": lead.get("reason", ""), "signals": [lead.get("signal", "")],
                                "closed_by": lead.get("closed_by")})
        for row in records:
            if row.get("status") not in {"finding", "closed_lead", "no_signal"} or not isinstance(row.get("subject_id"), str):
                raise ValueError("Invalid triage record status/subject_id")
        disabled = triage.get("disabled_schemes") or raw.get("structure_report", {}).get("disabled_schemes")
        if disabled:
            limits.append("Motor coverage is incomplete because some schemes lack required data: " + json.dumps(disabled))
        return cls(path, raw, records, limits)

    def add_estate_universe(self, estate_path: str) -> None:
        """Recover the unexamined universe from canonical masters without running detectors."""
        path = Path(estate_path).resolve()
        conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
        try:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            columns = {table: {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}
                       for table in TABLE_IDS if table in tables}
            universe = []
            if "rfc" in columns.get("vendors", set()):
                universe += [(f"RFC:{row[0]}", "vendor", "vendors", str(row[0])) for row in conn.execute("SELECT rfc FROM vendors WHERE rfc IS NOT NULL ORDER BY rfc")]
            if "emp_id" in columns.get("employees", set()):
                universe += [(str(row[0]) if str(row[0]).startswith("EMP:") else f"EMP:{row[0]}", "employee", "employees", str(row[0]))
                             for row in conn.execute("SELECT emp_id FROM employees ORDER BY emp_id")]
            company = self.raw.get("company_rfc")
            if company and {"issuer_rfc", "receiver_rfc"} <= columns.get("invoices", set()):
                universe += [(f"RFC:{row[0]}", "customer", None, None) for row in conn.execute(
                    "SELECT DISTINCT receiver_rfc FROM invoices WHERE issuer_rfc = ? AND receiver_rfc IS NOT NULL ORDER BY receiver_rfc", (company,)) if row[0] != company]
            seen = self.known_subjects
            for sid, typ, table, record in universe:
                if sid in seen:
                    continue
                seen.add(sid)
                self.records.append({"subject_id": sid, "subject_type": typ, "scheme_type": None,
                                     "status": "no_signal", "fraud_flag": False, "signals": [],
                                     "record_ids": [{"source_table": table, "record_id": record}] if table else [],
                                     "related_subjects": [], "reason": "No engine finding or closed lead for this subject in this snapshot; not investigated, not cleared."})
            # Aggregate metadata ranks capped residual samples; these statistics do not allege fraud.
            counts, received = {}, {}
            if "issuer_rfc" in columns.get("invoices", set()):
                counts = {f"RFC:{rfc}": count for rfc, count in conn.execute("SELECT issuer_rfc, count(*) FROM invoices GROUP BY issuer_rfc")}
            if "receiver_rfc" in columns.get("invoices", set()):
                received = {f"RFC:{rfc}": count for rfc, count in conn.execute("SELECT receiver_rfc, count(*) FROM invoices GROUP BY receiver_rfc")}
            subject_accounts, account_owners = {}, {}
            for table, key in (("vendors", "rfc"), ("employees", "emp_id")):
                if {key, "bank_clabe"} <= columns.get(table, set()):
                    for identity, account in conn.execute(f'SELECT "{key}", bank_clabe FROM "{table}" WHERE bank_clabe IS NOT NULL'):
                        sid = f"RFC:{identity}" if table == "vendors" else str(identity) if str(identity).startswith("EMP:") else f"EMP:{identity}"
                        subject_accounts[sid] = account
                        account_owners.setdefault(account, set()).add(sid)
            account_activity = {}
            if {"txn_id", "from_clabe", "to_clabe"} <= columns.get("bank_txns", set()):
                # UNION deduplicates a self-transfer endpoint. These are activity counts,
                # not fraud scores or money exposure; only capped selected rows reach LLMs.
                rows = conn.execute("SELECT account, count(*), count(DISTINCT peer) FROM ("
                                    "SELECT from_clabe AS account, to_clabe AS peer, txn_id FROM bank_txns "
                                    "UNION SELECT to_clabe AS account, from_clabe AS peer, txn_id FROM bank_txns) GROUP BY account")
                account_activity = {account: (count, peers) for account, count, peers in rows}
            for row in self.records:
                sid = row["subject_id"]
                account = subject_accounts.get(sid)
                activity = account_activity.get(account, (0, 0))
                row["activity_stats"] = {"issued_invoice_count": counts.get(sid, 0), "received_invoice_count": received.get(sid, 0),
                                         "bank_txn_count": activity[0], "bank_counterparty_count": activity[1],
                                         "master_account_owner_count": len(account_owners.get(account, set()))}
            if universe:
                self.limitations = [limit for limit in self.limitations if not limit.startswith("No triage universe")]
        finally:
            conn.close()

    @property
    def zones(self) -> dict[str, list[str]]:
        tagged = {row["subject_id"] for row in self.records if row["status"] == "finding"}
        closed = {row["subject_id"] for row in self.records if row["status"] == "closed_lead"}
        residual = {row["subject_id"] for row in self.records if row["status"] == "no_signal"} - tagged - closed
        return {"tagged": sorted(tagged), "closed_lead": sorted(closed), "no_signal": sorted(residual)}

    @property
    def known_subjects(self) -> set[str]:
        return {row["subject_id"] for row in self.records}

    @property
    def known_evidence(self) -> set[str]:
        refs = set()
        for row in self.records:
            refs.update(compact_record(row)["evidence_ids"])
        for finding in self.raw["findings"]:
            for exhibit in finding.get("exhibits", []):
                try:
                    refs.add(evidence_key(exhibit.get("source_table"), exhibit.get("record_id")))
                except ValueError:
                    continue
        return refs

    def records_for(self, ids: list[str], limit: int = 30) -> list[dict]:
        allowed = set(ids)
        return [compact_record(row) for row in self.records if row["subject_id"] in allowed][:limit]

    def graph_paths(self, ids: list[str], max_hops: int = 4) -> dict:
        allowed = set(ids)
        paths = []
        for finding in self.raw["findings"]:
            if allowed.intersection(finding.get("entities", [])):
                paths.append({"rule_id": finding.get("scheme_type"), "entities": finding.get("entities", [])[:12],
                              "hops": finding.get("money_trail", [])[:max_hops],
                              "evidence_ids": [evidence_key(x["source_table"], x["record_id"])
                                               for x in finding.get("exhibits", []) if x.get("source_table") in TABLE_IDS][:20]})
        return {"status": "ready" if paths else "unavailable", "paths": paths[:8],
                "scope": "Only paths already calculated and persisted by the engine; not an exhaustive graph."}
