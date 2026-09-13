"""Deterministic, capped slices; sampling never decides a fraud finding."""
import hashlib
from collections import defaultdict, deque

from .adapter import LogicalEngineResult, compact_record


def numeric_score(row: dict) -> float:
    score = row.get("score")
    if isinstance(score, dict):
        score = score.get("score", score.get("total", 0))
    if isinstance(score, (float, int)):
        return float(score)
    return {"high": 3, "medium": 2, "low": 1, "alta": 3, "media": 2, "baja": 1,
            "proven": 3, "probable": 2, "possible": 1}.get(str(row.get("confidence")), 0)


def sample(engine: LogicalEngineResult, max_groups: int = 2, a_k: int = 8, b_k: int = 30) -> dict:
    if not 1 <= a_k <= 8 or not 1 <= b_k <= 30 or not 1 <= max_groups <= 4:
        raise ValueError("Sampling bounds exceeded")
    groups = defaultdict(list)
    for row in engine.records:
        if row["status"] in {"finding", "closed_lead"} and row.get("scheme_type"):
            groups[row["scheme_type"]].append(row)
    ranked_rules = sorted(groups, key=lambda rule: (-sum(r["status"] == "finding" for r in groups[rule]), -len(groups[rule]), rule))
    a = []
    for rule in ranked_rules[:max_groups]:
        rows = sorted(groups[rule], key=lambda row: (-numeric_score(row), row["subject_id"], row["status"]))
        candidates = []
        # Include one engine-closed example, then alternate high/low evidence scores.
        closed = next((row for row in rows if row["status"] == "closed_lead"), None)
        if closed:
            candidates.append(closed)
        for left, right in zip(rows, reversed(rows)):
            for row in (left, right):
                if row not in candidates:
                    candidates.append(row)
        a.append({"rule_id": rule, "group_size": len(rows),
                  "group_size_unit": "subject-check participations, not unique entities or closed investigations",
                  "unique_subjects": len({row["subject_id"] for row in rows}),
                  "stats": {"findings": sum(r["status"] == "finding" for r in rows),
                            "closed_leads": sum(r["status"] == "closed_lead" for r in rows)},
                  "exemplars": [compact_record(row) for row in candidates[:a_k]]})
    residual_ids = set(engine.zones["no_signal"])
    residual = [row for row in engine.records if row["subject_id"] in residual_ids
                and row.get("subject_type") != "company_account"]
    by_type = defaultdict(dict)
    for row in residual:
        by_type[row.get("subject_type", "unknown")][row["subject_id"]] = row
    queues = {}
    for typ, indexed in by_type.items():
        rows = list(indexed.values())
        def activity(row):
            stats = row.get("activity_stats", {})
            return (max((stats.get("master_account_owner_count") or 0) - 1, 0),
                    stats.get("bank_counterparty_count") or 0, stats.get("bank_txn_count") or 0,
                    (stats.get("issued_invoice_count") or 0) + (stats.get("received_invoice_count") or 0),
                    len(row.get("related_subjects", [])))
        def digest(row):
            return hashlib.sha256(row["subject_id"].encode()).hexdigest()
        high = sorted(rows, key=lambda row: (*(-value for value in activity(row)), digest(row)))
        low = sorted(rows, key=lambda row: (activity(row), digest(row)))
        dispersed = sorted(rows, key=digest)
        ranked, seen = [], set()
        # Within each type alternate high activity, low activity and a stable dispersed
        # control. Equal scores cannot collapse the sample into the first lexical IDs.
        iterators = [iter(high), iter(low), iter(dispersed)]
        for _ in rows:
            for position, iterator in enumerate(iterators):
                row = next((item for item in iterator if item["subject_id"] not in seen), None)
                if row:
                    seen.add(row["subject_id"])
                    ranked.append((row, ["high_activity", "low_activity_control", "stable_dispersion"][position]))
            if len(seen) == len(rows):
                break
        queues[typ] = deque(ranked)
    # Round-robin strata guarantee representation while preserving the same hard cap.
    # Vendors/customers are business entities; employees never exhaust all 30 slots.
    ordered_types = sorted(queues, key=lambda typ: ({"vendor": 0, "customer": 1, "employee": 2}.get(typ, 3), typ))
    b = []
    while len(b) < b_k and any(queues.values()):
        for typ in ordered_types:
            if queues[typ] and len(b) < b_k:
                row, reason = queues[typ].popleft()
                b.append(dict(compact_record(row), sampling_reason=reason))
    type_coverage = {typ: {"total": len(rows), "sampled": sum(row["subject_type"] == typ for row in b)} for typ, rows in by_type.items()}
    return {"sample_for_a": a, "sample_for_b": b, "a_groups_total": len(groups),
            "unexplored_groups": ranked_rules[max_groups:], "residual_total": len({r["subject_id"] for r in residual}),
            "residual_by_type": type_coverage,
            "residual_excluded_company_accounts": len(residual_ids - {r["subject_id"] for r in residual}),
            "sampling_method": "A: closed counterexample plus high/low scores. B: round-robin subject-type strata, high/low activity and stable hash dispersion; company accounts excluded. Sampling signals are not fraud labels."}
