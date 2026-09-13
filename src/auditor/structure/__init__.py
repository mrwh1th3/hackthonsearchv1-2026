"""Agente de análisis de estructura: corre antes de cargar el Estate.

    prep = prepare(estate_path, llm)
    Estate(estate_path, conn=prep.conn)        # conn None = el estate ya es canónico; se abre el original

Pasos: inspección acotada → mapeo determinista (nombre, firma, relaciones; LLM solo para ambigüedades y
validado) → normalización a un SQLite canónico en memoria → reporte auditable (`structure_report`).
Si un estate ya coincide exactamente con estate_schema.sql y ningún valor cambia al normalizar, el
auditor abre el archivo original y el resultado es idéntico al de antes de existir este módulo."""
from __future__ import annotations

import sqlite3
import tempfile
import zipfile
from xml.etree import ElementTree as ET
from collections import OrderedDict
from pathlib import Path

from .ingest import IngestError, detect_format, input_sha256, stage, suspect_cells
from .mapper import CONFIDENT, LLMAssist, inspect_db, map_estate, q_ident
from .normalize import build_canonical
from .schema import CANONICAL, GLOBAL_REQUIRED, SCHEME_REQUIRES
from .signatures import SAMPLE_ROWS


class StructureError(Exception):
    """Falta algo imprescindible: el auditor no puede correr con honestidad."""


class Prepared:
    def __init__(self, conn, src, identity: bool, report: dict, id_maps: dict, disabled: dict, tmap: dict,
                 input_format: str = "sqlite", staging: str | None = None):
        self.conn, self.src, self.identity = conn, src, identity
        self.report, self.id_maps, self.disabled, self.tmap = report, id_maps, disabled, tmap
        self.input_format, self.staging = input_format, staging

    def export_validator_estate(self, dest: str) -> str:
        """SQLite con los nombres canónicos que exige spec/forensic-auditor/validate_format.py, montos numéricos
        y, en cada columna id, el id tal como viene en la entrada original (el mismo que cita submission.json).
        Sirve para correr el validador oficial cuando la entrada es CSV/XLSX o usa otros nombres."""
        out = Path(dest)
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            out.unlink()
        target = sqlite3.connect(out)
        if self.conn is None:
            sqlite3.connect(f"file:{self.src_path}?mode=ro", uri=True).backup(target)
        else:
            self.conn.backup(target)
        for t, m in sorted(self.id_maps.items()):
            col = CANONICAL[t]["id"]
            target.executemany(f"UPDATE {t} SET {col} = ? WHERE {col} = ?",
                               [(orig, key) for key, orig in sorted(m.items())])
        target.commit()
        target.close()
        return str(out)

    def original_id(self, table: str, record_id) -> str:
        return self.id_maps.get(table, {}).get(str(record_id), str(record_id))

    def original_exists(self, table: str, record_id) -> bool:
        """¿La cita resuelve en el estate original (tabla y columna id tal como las escribe el estate)?"""
        m = self.tmap.get(table)
        if not m:
            return False
        col = m["columns"].get(CANONICAL[table]["id"], {}).get("column")
        if not col:
            return False
        rid = self.original_id(table, record_id)
        args = [rid] + ([int(rid)] if rid.lstrip("-").isdigit() else [])
        for a in args:
            if self.src.execute(f"SELECT 1 FROM {q_ident(m['table'])} WHERE {q_ident(col)} = ? LIMIT 1", (a,)).fetchone():
                return True
        return False


def _exact(info: dict) -> bool:
    for ct, spec in CANONICAL.items():
        t = info.get(ct)
        if t is None or t["type"] != "table" or {c for c, _ in t["columns"]} != set(spec["columns"]):
            return False
    return True


def _identity_map(info: dict) -> dict:
    return OrderedDict((ct, {"table": ct, "score": 1.0, "name_score": 1.0, "ambiguous": [],
                             "columns": OrderedDict((cc, {"column": cc, "score": 1.0, "method": "exact"})
                                                    for cc in spec["columns"])})
                       for ct, spec in CANONICAL.items())


def prepare(estate_path: str, llm=None, work_dir: str | None = None) -> Prepared:
    """work_dir: dónde escribir staging.db si la entrada no es SQLite (por defecto, un directorio temporal)."""
    p = Path(estate_path)
    if not p.exists():
        raise FileNotFoundError(f"estate not found: {estate_path}")
    try:
        fmt = detect_format(p)
    except IngestError as exc:
        raise StructureError(f"estate structure: {exc}") from exc
    ingest_report, staging = None, None
    src_path = p
    if fmt != "sqlite":
        try:
            staging, ingest_report = stage(p, Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="auditor_")))
        except (IngestError, zipfile.BadZipFile, ET.ParseError, UnicodeError, ValueError) as exc:
            raise StructureError(f"estate structure: could not read {fmt} input {estate_path}: {exc}") from exc
        src_path = staging
    try:
        src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
        info = inspect_db(src)
    except sqlite3.DatabaseError as exc:
        raise StructureError(f"estate structure: {estate_path} is not a readable SQLite database: {exc}") from exc
    exact = fmt == "sqlite" and _exact(info)
    assist = LLMAssist(llm)
    tmap = _identity_map(info) if exact else map_estate(src, info, assist)
    for ct, m in tmap.items():
        m["usable"] = all(c in m["columns"] for c in CANONICAL[ct]["core"])

    fatal = [f"{t}.{c}" for t, c in GLOBAL_REQUIRED if not (tmap.get(t) and c in tmap[t]["columns"])]
    if fatal:
        raise StructureError(_fatal_message(fatal, info, tmap))

    built = build_canonical(src, tmap, info, suspect_cells(src))
    rows = {ct: info[m["table"]]["rows"] for ct, m in tmap.items()}

    def have(t: str, c: str) -> bool:
        m = tmap.get(t)
        if not m or not m["usable"] or c not in m["columns"]:
            return False
        return rows[t] == 0 or built["non_null"].get((t, c), 0) > 0

    empty_required = [f"{t}.{c}" for t, c in GLOBAL_REQUIRED if not have(t, c)]
    if empty_required:
        raise StructureError(_fatal_message(empty_required, info, tmap, empty=True))
    disabled = OrderedDict((s, [f"{t}.{c}" for t, c in reqs if not have(t, c)]) for s, reqs in SCHEME_REQUIRES.items())
    disabled = OrderedDict((s, miss) for s, miss in disabled.items() if miss)
    identity = exact and built["identity_values"] and not built["collisions"]
    report = _report(info, tmap, built, disabled, identity, assist)
    report["input"] = ingest_report or {"input_format": "sqlite"}
    if identity:
        built["conn"].close()
    prep = Prepared(None if identity else built["conn"], src, identity, report, built["id_maps"], disabled, tmap,
                    fmt, str(staging) if staging else None)
    prep.src_path = str(src_path)
    return prep


def _fatal_message(missing: list, info: dict, tmap: dict, empty: bool = False) -> str:
    have = {t: [c for c, _ in v["columns"]] for t, v in info.items()}
    what = "are empty in every row" if empty else "could not be located"
    if not info:
        return "estate structure: no tables found in the input."
    return (f"estate structure: required fields {', '.join(missing)} {what}. Without them no finding can cite or "
            f"reconcile an invoice, so the run stops instead of guessing. Tables seen: "
            + "; ".join(f"{t}({', '.join(cols[:14])}{'…' if len(cols) > 14 else ''})" for t, cols in have.items())
            + ". Mapped: " + ", ".join(f"{ct}←{m['table']}" for ct, m in tmap.items()))


def _report(info, tmap, built, disabled, identity, assist) -> dict:
    if identity:
        return {"status": "identity",
                "summary": "Estate matches estate_schema.sql exactly (tables, columns and value formats); "
                           "opened as-is, no adaptation.",
                "tables": {ct: ct for ct in CANONICAL}, "disabled_schemes": {}, "llm_assist": []}
    tables = OrderedDict()
    used_tables = set()
    low = []
    for ct, spec in CANONICAL.items():
        m = tmap.get(ct)
        if not m:
            tables[ct] = {"source": None, "usable": False, "missing_columns": list(spec["columns"])}
            continue
        used_tables.add(m["table"])
        stats = built["column_stats"].get(ct, {})
        cols = OrderedDict()
        for cc in spec["columns"]:
            if cc not in m["columns"]:
                continue
            x = m["columns"][cc]
            entry = {"source": x["column"], "confidence": round(min(x["score"], 1.0), 3), "method": x["method"]}
            if x.get("detail"):
                entry["evidence"] = x["detail"]
            entry.update(stats.get(cc, {}))
            if x["score"] < CONFIDENT or x["method"].startswith("deterministic_"):
                low.append(f"{ct}.{cc}")
            cols[cc] = entry
        src_cols = [c for c, _ in info[m["table"]]["columns"]]
        mapped_src = {v["column"] for v in m["columns"].values()}
        tables[ct] = {"source": m["table"], "confidence": round(min(m["score"], 1.0), 3), "usable": m["usable"],
                      "rows": info[m["table"]]["rows"], "columns": cols,
                      "missing_columns": [c for c in spec["columns"] if c not in m["columns"]],
                      "missing_core": [c for c in spec["core"] if c not in m["columns"]],
                      "unmapped_source_columns": [c for c in src_cols if c not in mapped_src]}
    transforms = {}
    for ct, cols in built["column_stats"].items():
        for cc, s in cols.items():
            for rule, n in s.get("rules", {}).items():
                transforms[rule] = transforms.get(rule, 0) + n
    return {"status": "adapted",
            "summary": _summary(tables, disabled, transforms, low),
            "sample_rows_per_table": SAMPLE_ROWS,
            "tables": tables,
            "unmapped_source_tables": [t for t in info if t not in used_tables],
            "missing_tables": [ct for ct in CANONICAL if not tmap.get(ct) or not tmap[ct]["usable"]],
            "transforms": dict(sorted(transforms.items())),
            "ids_remapped": {t: len(v) for t, v in sorted(built["id_maps"].items())},
            "id_collisions": dict(sorted(built["collisions"].items())),
            "low_confidence": low,
            "precision_lost": dict(sorted(built["precision_lost"].items())),
            "disabled_schemes": dict(disabled),
            "llm_assist": assist.log}


def _summary(tables, disabled, transforms, low) -> str:
    renamed = sum(1 for ct, t in tables.items() if t.get("source") and t["source"] != ct)
    cols = sum(1 for t in tables.values() for cc, c in t.get("columns", {}).items() if c["source"] != cc)
    parts = [f"{renamed} table(s) and {cols} column(s) mapped from other names"]
    if transforms:
        parts.append("values normalized: " + ", ".join(f"{k} ×{v}" for k, v in sorted(transforms.items())))
    if low:
        parts.append(f"low-confidence mappings: {', '.join(low)}")
    if "precision_lost" in transforms:
        parts.append(f"{transforms['precision_lost']} identifier/CLABE value(s) discarded for numeric precision loss")
    if disabled:
        parts.append("disabled for missing data: " + "; ".join(f"{s} ({', '.join(m)})" for s, m in disabled.items()))
    return ". ".join(parts) + "."


__all__ = ["prepare", "Prepared", "StructureError", "input_sha256", "detect_format"]
