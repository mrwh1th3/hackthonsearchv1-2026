"""Construye el estate canónico (SQLite en memoria, determinista) a partir del mapeo.

Todas las filas pasan por el normalizador del tipo canónico de su columna. Se registra, por columna,
cuántos valores cambió cada regla y hasta tres ejemplos (nunca de texto libre). Los ids citables que
cambian (p. ej. RFC con prefijo, entry_id textual) quedan en `id_maps` canónico → original, para que
`record_id` en submission.json siga resolviendo contra el estate que entregó el juez."""
from __future__ import annotations

import re
import sqlite3
from collections import Counter, OrderedDict

from .mapper import q_ident
from .schema import CANONICAL, canonical_ddl
from .signatures import (CHANNEL, EFOS_STATUS, INVOICE_STATUS, METODO_PAGO, as_text, catalog, detect_date_format,
                         emp_digits, is_null, norm_amount, norm_clabe, norm_date, norm_forma_pago, norm_rfc,
                         strip_accents)

FREE_KINDS = {"freetext", "email"}


def _original_rows(conn: sqlite3.Connection, table: str, cols: list[str]) -> list[tuple]:
    sel = ", ".join(q_ident(c) for c in cols)
    try:
        return conn.execute(f"SELECT {sel} FROM {q_ident(table)} ORDER BY rowid").fetchall()
    except sqlite3.OperationalError:
        return conn.execute(f"SELECT {sel} FROM {q_ident(table)}").fetchall()


def _same(a, b) -> bool:
    return type(a) is type(b) and a == b


class ColumnStats:
    def __init__(self):
        self.changed = 0
        self.nulls = 0
        self.rules: Counter = Counter()
        self.examples: list = []

    def note(self, orig, new, rule: str, free: bool):
        if _same(orig, new):
            return
        if new is None and is_null(orig):
            self.nulls += 1
            if orig is None:
                return
            rule = "null_token"
        self.changed += 1
        self.rules[rule] += 1
        if not free and len(self.examples) < 3 and str(orig) not in {e[0] for e in self.examples}:
            self.examples.append((str(orig)[:40], None if new is None else str(new)[:40]))

    def as_dict(self) -> dict:
        d = {"changed": self.changed}
        if self.rules:
            d["rules"] = dict(sorted(self.rules.items()))
        if self.examples:
            d["examples"] = [list(e) for e in self.examples]
        return d


def _rule_for(kind: str, orig, new) -> str:
    if kind == "rfc":
        s = str(orig)
        if re.match(r"(?i)^\s*rfc", s):
            return "rfc_prefix_removed"
        return "rfc_case_or_spacing"
    if kind == "clabe":
        if isinstance(orig, (int, float)) or (isinstance(new, str) and len(re.sub(r"\D", "", str(orig))) < 18):
            return "clabe_zero_padded"
        return "clabe_separators_removed"
    if kind == "date":
        return "date_reformatted"
    if kind == "amount":
        return "amount_text_parsed" if isinstance(orig, str) else "amount_cast"
    if kind in ("invoice_status", "efos_status", "metodo_pago", "channel"):
        return "catalog_mapped"
    if kind == "forma_pago":
        return "forma_pago_zero_padded"
    if kind == "person":
        return "person_ref_resolved"
    if kind in ("id", "int_id", "emp_id"):
        return "id_trimmed_or_cast"
    return "trimmed"


def build_canonical(conn: sqlite3.Connection, tmap: dict, info: dict) -> dict:
    """Devuelve {"conn", "id_maps", "column_stats", "collisions", "identity_values", "non_null"}."""
    out = sqlite3.connect(":memory:")
    out.executescript(canonical_ddl())
    present = set()
    id_maps: dict[str, dict[str, str]] = {}
    stats: dict[str, dict[str, dict]] = {}
    collisions: dict[str, int] = {}
    non_null: dict[tuple, int] = {}
    identity_values = True

    # empleados primero: las referencias a personas se resuelven contra sus ids
    order = ["employees"] + [t for t in CANONICAL if t != "employees"]
    emp_ids: set[str] = set()
    emp_names: dict[str, list[str]] = {}
    emp_by_digits: dict[str, list[str]] = {}

    for ct in order:
        m = tmap.get(ct)
        if not m or not m.get("usable"):
            out.execute(f"DROP TABLE {ct}")
            continue
        present.add(ct)
        spec = CANONICAL[ct]["columns"]
        mapped = [(cc, m["columns"][cc]["column"]) for cc in spec if cc in m["columns"]]
        rows = _original_rows(conn, m["table"], [oc for _, oc in mapped])
        fmts = {}
        for j, (cc, _) in enumerate(mapped):
            if spec[cc]["kind"] == "date":
                fmts[cc] = detect_date_format([r[j] for r in rows])
        col_stats = {cc: ColumnStats() for cc, _ in mapped}
        id_col = CANONICAL[ct]["id"]
        seen_ids: dict = {}
        new_rows = []
        for r in rows:
            vals = {}
            for j, (cc, _) in enumerate(mapped):
                kind = spec[cc]["kind"]
                v = r[j]
                nv = _normalize(kind, v, fmts.get(cc, {}).get("format"), emp_ids, emp_names, emp_by_digits)
                vals[cc] = nv
                if not _same(v, nv):
                    identity_values = False
                    col_stats[cc].note(v, nv, _rule_for(kind, v, nv), kind in FREE_KINDS)
                if nv is not None:
                    non_null[(ct, cc)] = non_null.get((ct, cc), 0) + 1
            if id_col in vals and vals[id_col] is not None:
                orig = r[[cc for cc, _ in mapped].index(id_col)]
                key = str(vals[id_col])
                if key in seen_ids and seen_ids[key] != orig:
                    collisions[ct] = collisions.get(ct, 0) + 1
                seen_ids.setdefault(key, orig)
                o = orig if isinstance(orig, str) else as_text(orig)
                if o != key:
                    id_maps.setdefault(ct, {}).setdefault(key, o)
            new_rows.append(tuple(vals.get(cc) for cc in spec))
        out.executemany(f"INSERT INTO {ct} VALUES ({','.join('?' * len(spec))})", new_rows)
        if ct == "employees":
            for eid, name in ((row[0], row[1]) for row in new_rows):
                if eid is not None:
                    emp_ids.add(str(eid))
                    dg = emp_digits(eid)
                    if dg:
                        emp_by_digits.setdefault(dg, []).append(str(eid))
                if name:
                    emp_names.setdefault(_person_key(name), []).append(str(name))
        stats[ct] = {cc: dict(col_stats[cc].as_dict(), **({"date_format": fmts[cc]["format"]}
                                                            if cc in fmts and fmts[cc]["format"] else {}),
                              **({"assumed_day_first": True} if fmts.get(cc, {}).get("assumed_day_first") else {}))
                     for cc, _ in mapped}
        idx_cols = {id_col} | {c for c in ("issuer_rfc", "receiver_rfc", "invoice_uuid", "from_clabe", "to_clabe",
                                           "vendor_rfc") if c in spec}
        for c in sorted(idx_cols):
            out.execute(f"CREATE INDEX ix_{ct}_{c} ON {ct}({c})")
    out.commit()
    return {"conn": out, "present": present, "id_maps": id_maps, "column_stats": stats, "collisions": collisions,
            "identity_values": identity_values, "non_null": non_null}


def _person_key(name) -> str:
    return " ".join(strip_accents(str(name)).lower().split())


def _normalize(kind: str, v, date_fmt, emp_ids, emp_names, emp_by_digits):
    if kind in FREE_KINDS:
        return v
    if kind == "rfc":
        return norm_rfc(v)
    if kind == "clabe":
        return norm_clabe(v)
    if kind == "amount":
        return norm_amount(v)
    if kind == "date":
        return norm_date(v, date_fmt)
    if kind == "invoice_status":
        s = catalog(INVOICE_STATUS, v)
        return s if s in ("vigente", "cancelado") or s is None else s.lower()
    if kind == "efos_status":
        s = catalog(EFOS_STATUS, v)
        return s if s is None else (s if s in EFOS_STATUS.values() else s.lower())
    if kind == "metodo_pago":
        return catalog(METODO_PAGO, v)
    if kind == "channel":
        return catalog(CHANNEL, v)
    if kind == "forma_pago":
        return norm_forma_pago(v)
    if kind == "uso_cfdi":
        s = as_text(v)
        return s.upper() if s else s
    if kind == "int_id":
        if isinstance(v, int):
            return v
        s = as_text(v)
        return int(s) if s is not None and s.isdigit() else s
    if kind == "person":
        if v is None or v == "":
            return v          # aprobador vacío: es evidencia de que nadie firmó, se conserva tal cual
        s = as_text(v)
        if s is None:
            return None       # "N/A", "null": nadie firmó
        if s in emp_ids:
            return s
        names = emp_names.get(_person_key(s), [])
        if names:
            # "ANA  GARCIA" / "ana garcía" -> "Ana García" tal como está en employees (si es único)
            # siempre la grafía de employees: agrupar por aprobador en SQL depende de que sea idéntica
            return s if len(set(names)) > 1 else names[0]
        dg = emp_digits(s)
        if dg and len(emp_by_digits.get(dg, [])) == 1:
            return emp_by_digits[dg][0]   # "0022" / "22" / "E-0022" -> el emp_id tal como lo escribe employees
        return s
    # id, emp_id, account_code
    if isinstance(v, str):
        return v.strip() if not is_null(v) else None
    return as_text(v)
