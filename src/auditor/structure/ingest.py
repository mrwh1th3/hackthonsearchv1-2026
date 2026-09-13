"""Entrada multi-formato: SQLite, directorio de CSV, CSV suelto, XLSX y ZIP (CSV o XLSX dentro).

El formato se detecta por contenido (cabecera "SQLite format 3", firma ZIP con xl/workbook.xml), no solo
por extensión. Todo lo que no es SQLite se carga en un SQLite de staging determinista (`staging.db`) con:
  * una tabla por archivo/hoja (nombre normalizado), columnas con el encabezado tal como venía;
  * todos los valores como TEXT crudo: ningún parser convierte una CLABE, un RFC o un id en número;
  * `_ingest_sources`: de dónde salió cada tabla (archivo, hoja, codificación, delimitador, fila de
    encabezado, filas omitidas) y `_ingest_suspect_cells`: celdas numéricas de Excel con más dígitos
    de los que un double conserva (posible pérdida de precisión en CLABE/ids).
Después el staging pasa por el mismo mapeo y normalización que un SQLite. Stdlib; openpyxl no se usa."""
from __future__ import annotations

import csv
import hashlib
import io
import re
import sqlite3
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

from .signatures import norm_name

SQLITE_MAGIC = b"SQLite format 3\x00"
ZIP_MAGIC = b"PK\x03\x04"
DELIMS = [",", ";", "\t", "|"]
META_PREFIX = "_ingest"


class IngestError(Exception):
    pass


# ---------------------------------------------------------------- detección
def detect_format(path: Path) -> str:
    p = Path(path)
    if p.is_dir():
        files = sorted(x for x in p.iterdir() if x.is_file() and not x.name.startswith("."))
        if any(_head(x).startswith(SQLITE_MAGIC) for x in files if x.suffix.lower() in (".db", ".sqlite", ".sqlite3")) \
                and not any(x.suffix.lower() in (".csv", ".txt", ".tsv") for x in files):
            raise IngestError(f"{p} is a directory with a SQLite file inside; pass the .db file itself")
        if any(x.suffix.lower() in (".xlsx",) for x in files) and not any(x.suffix.lower() in (".csv", ".tsv", ".txt")
                                                                           for x in files):
            return "xlsx_dir"
        return "csv_dir"
    head = _head(p)
    if head.startswith(SQLITE_MAGIC):
        return "sqlite"
    if head.startswith(ZIP_MAGIC):
        with zipfile.ZipFile(p) as z:
            names = z.namelist()
        return "xlsx" if "xl/workbook.xml" in names else "zip"
    if not head:
        raise IngestError(f"{p} is empty")
    return "csv"


def _head(p: Path) -> bytes:
    try:
        with open(p, "rb") as fh:
            return fh.read(16)
    except OSError:
        return b""


def input_sha256(path: Path) -> str:
    p = Path(path)
    h = hashlib.sha256()
    files = sorted(x for x in p.rglob("*") if x.is_file()) if p.is_dir() else [p]
    for f in files:
        if p.is_dir():
            h.update(str(f.relative_to(p)).encode() + b"\0")
        with open(f, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 16), b""):
                h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- CSV
def decode(raw: bytes) -> tuple[str, str]:
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", errors="replace"), "utf-8-sig"
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16"), "utf-16"
    try:
        return raw.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        pass
    try:
        return raw.decode("cp1252"), "cp1252"
    except UnicodeDecodeError:
        return raw.decode("latin-1"), "latin-1"


def sniff_delimiter(text: str) -> str:
    lines = [ln for ln in text.splitlines() if ln.strip()][:40]
    best = (-1.0, 0, ",")
    for dl in DELIMS:
        counts = [len(r) for r in csv.reader(lines, delimiter=dl)]
        if not counts:
            continue
        mode = max(set(counts), key=lambda c: (counts.count(c), c))
        if mode < 2:
            continue
        cons = counts.count(mode) / len(counts)
        cand = (cons, mode, dl)
        if (cand[0], cand[1]) > (best[0], best[1]):
            best = cand
    return best[2]


NUMERICISH = re.compile(r"^[\s$()+\-]*[\d.,/:\-\sTZ]+(?:\s*(?:MXN|USD|%))?$", re.I)


def _texty(cells: list[str]) -> float:
    vals = [c for c in cells if c is not None and str(c).strip()]
    if not vals:
        return 0.0
    return sum(1 for c in vals if not NUMERICISH.match(str(c).strip())) / len(vals)


def find_header(rows: list[list], width: int) -> tuple[int, list[str], list[int]]:
    """Fila de encabezado: la primera fila con ≥60% del ancho lleno, ≥80% de celdas no numéricas y valores
    distintos entre sí. Así se saltan filas en blanco, títulos (una celda, o combinada: el mismo valor
    repetido) y filas de grupo combinadas. Si el encabezado tiene huecos y la fila anterior es de grupo,
    los huecos toman el nombre del grupo."""
    probe = rows[:25]
    skipped = []
    header_idx = None
    for i, r in enumerate(probe):
        vals = [str(c).strip() for c in r if c is not None and str(c).strip()]
        if len(vals) < max(2, 0.6 * width) or _texty(r) < 0.8 or len(set(vals)) < 0.8 * len(vals):
            skipped.append(i)
            continue
        header_idx = i
        break
    if header_idx is None:
        header_idx = next((i for i, r in enumerate(rows) if any(c is not None and str(c).strip() for c in r)), 0)
        skipped = list(range(header_idx))
    header = [str(c).strip() if c is not None else "" for c in rows[header_idx]]
    if header_idx > 0 and any(not h for h in header):
        upper = rows[header_idx - 1]
        header = [h or (str(upper[k]).strip() if k < len(upper) and upper[k] is not None else "")
                  for k, h in enumerate(header)]
    return header_idx, header, skipped


def table_from_rows(rows: list[list]) -> tuple[list[str], list[list], dict]:
    rows = [list(r) for r in rows]
    width = max((len(r) for r in rows), default=0)
    if width == 0:
        return [], [], {"empty": True}
    hidx, header, skipped = find_header(rows, width)
    data = rows[hidx + 1:]
    # columnas totalmente vacías (encabezado y datos): se descartan
    keep = [k for k in range(width) if (k < len(header) and header[k]) or
            any(k < len(r) and r[k] is not None and str(r[k]).strip() for r in data)]
    names, seen = [], {}
    for k in keep:
        n = header[k] if k < len(header) and header[k] else f"col_{k + 1}"
        base, i = n, 2
        while n.lower() in seen:
            n = f"{base}_{i}"
            i += 1
        seen[n.lower()] = k
        names.append(n)
    out = []
    for r in data:
        vals = [r[k] if k < len(r) else None for k in keep]
        if not any(v is not None and str(v).strip() for v in vals):
            continue   # filas vacías (incluidas las del final)
        out.append(["" if v is None else str(v) for v in vals])
    return names, out, {"header_row": hidx + 1, "skipped_rows_before_header": [i + 1 for i in skipped],
                        "dropped_empty_columns": width - len(keep)}


def read_csv_bytes(raw: bytes) -> tuple[list[str], list[list], dict]:
    text, enc = decode(raw)
    dl = sniff_delimiter(text)
    rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=dl))
    names, data, meta = table_from_rows(rows)
    meta.update({"encoding": enc, "delimiter": {"\t": "tab"}.get(dl, dl)})
    return names, data, meta


# ---------------------------------------------------------------- XLSX (stdlib)
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
BUILTIN_DATE_FMTS = set(range(14, 23)) | {27, 30, 36, 45, 46, 47, 50, 57}


def _col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _cell_rc(ref: str) -> tuple[int, int]:
    m = re.match(r"([A-Z]+)(\d+)", ref)
    return int(m.group(2)) - 1, _col_index(m.group(1))


def excel_serial(v: float, date1904: bool) -> str:
    base = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 30)
    dt = base + timedelta(days=float(v))
    if abs(float(v) - round(float(v))) < 1e-9:
        return dt.date().isoformat()
    return dt.replace(microsecond=0).isoformat()


def read_xlsx_bytes(raw: bytes) -> list[tuple[str, list[str], list[list], dict, list]]:
    """[(sheet_name, header, rows, meta, suspects)] para las hojas visibles y no vacías."""
    z = zipfile.ZipFile(io.BytesIO(raw))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    pr = wb.find("m:workbookPr", NS)
    date1904 = pr is not None and pr.get("date1904") in ("1", "true")
    rels = {}
    if "xl/_rels/workbook.xml.rels" in z.namelist():
        for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).findall("rel:Relationship", NS):
            t = r.get("Target")
            rels[r.get("Id")] = t.lstrip("/") if t.startswith("/") else "xl/" + t
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    date_styles = set()
    if "xl/styles.xml" in z.namelist():
        st = ET.fromstring(z.read("xl/styles.xml"))
        custom = {}
        nf = st.find("m:numFmts", NS)
        if nf is not None:
            for f in nf.findall("m:numFmt", NS):
                code = re.sub(r'"[^"]*"|\[[^\]]*\]', "", f.get("formatCode", "")).lower()
                custom[int(f.get("numFmtId"))] = bool(re.search(r"[dy]", code) or re.search(r"m{1,4}", code)
                                                      and not re.search(r"[h:s]", code))
        xfs = st.find("m:cellXfs", NS)
        if xfs is not None:
            for i, xf in enumerate(xfs.findall("m:xf", NS)):
                fid = int(xf.get("numFmtId", "0"))
                if fid in BUILTIN_DATE_FMTS or custom.get(fid):
                    date_styles.add(i)
    out = []
    for sh in wb.find("m:sheets", NS).findall("m:sheet", NS):
        if sh.get("state") in ("hidden", "veryHidden"):
            continue
        target = rels.get(sh.get(f"{{{NS['r']}}}id"))
        if not target or target not in z.namelist():
            continue
        root = ET.fromstring(z.read(target))
        grid: dict[int, dict[int, str]] = {}
        suspects = []
        for c in root.iter(f"{{{NS['m']}}}c"):
            ref = c.get("r")
            if not ref:
                continue
            ri, ci = _cell_rc(ref)
            t = c.get("t", "n")
            v = c.find("m:v", NS)
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
            elif t in ("str",) and v is not None:
                val = v.text or ""
            elif t == "b" and v is not None:
                val = "TRUE" if v.text == "1" else "FALSE"
            elif t == "e":
                val = None
            elif v is not None and v.text is not None:
                txt = v.text.strip()
                if int(c.get("s", "0")) in date_styles:
                    val = excel_serial(float(txt), date1904)
                else:
                    val = _excel_number_text(txt)
                    digits = re.sub(r"\D", "", txt.split("E")[0].split("e")[0])
                    if "e" in txt.lower() or len(digits.lstrip("0")) >= 16:
                        suspects.append((ri, ci, txt))
            else:
                val = None
            if val is not None:
                grid.setdefault(ri, {})[ci] = val
        merged = root.find("m:mergeCells", NS)
        if merged is not None:
            for mc in merged.findall("m:mergeCell", NS):
                a, b = mc.get("ref").split(":")
                (r0, c0), (r1, c1) = _cell_rc(a), _cell_rc(b)
                top = grid.get(r0, {}).get(c0)
                if top is None:
                    continue
                for rr in range(r0, r1 + 1):
                    for cc in range(c0, c1 + 1):
                        grid.setdefault(rr, {}).setdefault(cc, top)
        if not grid:
            continue
        nrows = max(grid) + 1
        ncols = max(max(r) for r in grid.values()) + 1
        rows = [[grid.get(i, {}).get(j) for j in range(ncols)] for i in range(nrows)]
        header, data, meta = table_from_rows(rows)
        if not header or not data and not any(header):
            continue
        # sospechosas: fila de datos (índice relativo al staging) y nombre de columna
        hrow = meta["header_row"] - 1
        keep_names = header
        sus = []
        if suspects:
            col_by_index = _kept_columns(rows, meta, header)
            data_rows = [i for i in range(hrow + 1, nrows)
                         if any(v is not None and str(v).strip() for v in rows[i])]
            pos = {ri: k + 1 for k, ri in enumerate(data_rows)}
            for ri, ci, txt in suspects:
                if ri in pos and ci in col_by_index:
                    sus.append((pos[ri], col_by_index[ci], txt))
        meta.update({"sheet": sh.get("name"), "date1904": date1904})
        out.append((sh.get("name"), keep_names, data, meta, sus))
    return out


def _kept_columns(rows, meta, header) -> dict:
    width = max(len(r) for r in rows)
    hidx = meta["header_row"] - 1
    data = rows[hidx + 1:]
    hdr = rows[hidx]
    keep = [k for k in range(width) if (k < len(hdr) and hdr[k] is not None and str(hdr[k]).strip()) or
            any(k < len(r) and r[k] is not None and str(r[k]).strip() for r in data)]
    return {k: header[i] for i, k in enumerate(keep) if i < len(header)}


def _excel_number_text(txt: str) -> str:
    """Número de Excel como texto sin adornos: "12345" se queda, "12345.0" → "12345", 1.5 → "1.5"."""
    try:
        x = float(txt)
    except ValueError:
        return txt
    if "e" in txt.lower():
        return txt          # se conserva la notación: la pérdida de precisión se reporta, no se esconde
    if x.is_integer() and "." in txt:
        return str(int(x))
    return txt


# ---------------------------------------------------------------- staging
def stage(path: Path, work_dir: Path) -> tuple[Path, dict]:
    """Carga cualquier entrada no SQLite en work_dir/staging.db. Devuelve (ruta, reporte de ingesta)."""
    p = Path(path)
    fmt = detect_format(p)
    tables: list[tuple[str, list[str], list[list], dict, list]] = []
    if fmt == "csv_dir":
        files = sorted(x for x in p.iterdir() if x.is_file() and x.suffix.lower() in (".csv", ".tsv", ".txt"))
        if not files:
            raise IngestError(f"{p}: directory has no .csv files")
        for f in files:
            h, d, m = read_csv_bytes(f.read_bytes())
            tables.append((f.stem, h, d, dict(m, file=f.name), []))
    elif fmt == "xlsx_dir":
        for f in sorted(x for x in p.iterdir() if x.suffix.lower() == ".xlsx"):
            for name, h, d, m, s in read_xlsx_bytes(f.read_bytes()):
                tables.append((name, h, d, dict(m, file=f.name), s))
    elif fmt == "csv":
        h, d, m = read_csv_bytes(p.read_bytes())
        tables.append((p.stem, h, d, dict(m, file=p.name), []))
    elif fmt == "xlsx":
        for name, h, d, m, s in read_xlsx_bytes(p.read_bytes()):
            tables.append((name, h, d, dict(m, file=p.name), s))
    elif fmt == "zip":
        with zipfile.ZipFile(p) as z:
            members = sorted(n for n in z.namelist() if not n.endswith("/") and "__MACOSX" not in n
                             and not Path(n).name.startswith("."))
            for n in members:
                suf = Path(n).suffix.lower()
                if suf in (".csv", ".tsv", ".txt"):
                    h, d, m = read_csv_bytes(z.read(n))
                    tables.append((Path(n).stem, h, d, dict(m, file=n), []))
                elif suf == ".xlsx":
                    for name, h, d, m, s in read_xlsx_bytes(z.read(n)):
                        tables.append((name, h, d, dict(m, file=n), s))
        if not tables:
            raise IngestError(f"{p}: zip has no .csv or .xlsx members")
    else:
        raise IngestError(f"unsupported input format {fmt}")

    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    out = work_dir / "staging.db"
    if out.exists():
        out.unlink()
    conn = sqlite3.connect(out)
    conn.execute(f"CREATE TABLE {META_PREFIX}_sources (table_name TEXT, source TEXT, sheet TEXT, encoding TEXT, "
                 f"delimiter TEXT, header_row INTEGER, skipped_rows TEXT, dropped_empty_columns INTEGER, rows INTEGER)")
    conn.execute(f"CREATE TABLE {META_PREFIX}_suspect_cells (table_name TEXT, row_index INTEGER, column_name TEXT, "
                 f"raw TEXT)")
    used, report = set(), []
    for name, header, data, meta, sus in tables:
        if not header:
            report.append({"source": meta.get("file"), "sheet": meta.get("sheet"), "skipped": "empty"})
            continue
        tname = norm_name(name) or "table"
        base, i = tname, 2
        while tname in used or tname.startswith(META_PREFIX):
            tname = f"{base}_{i}"
            i += 1
        used.add(tname)
        cols = ", ".join('"' + h.replace('"', '""') + '" TEXT' for h in header)
        conn.execute(f'CREATE TABLE "{tname}" ({cols})')
        if data:
            conn.executemany(f'INSERT INTO "{tname}" VALUES ({",".join("?" * len(header))})', data)
        conn.execute(f"INSERT INTO {META_PREFIX}_sources VALUES (?,?,?,?,?,?,?,?,?)",
                     (tname, meta.get("file"), meta.get("sheet"), meta.get("encoding"), meta.get("delimiter"),
                      meta.get("header_row"), ",".join(map(str, meta.get("skipped_rows_before_header", []))),
                      meta.get("dropped_empty_columns", 0), len(data)))
        for ri, col, raw in sus:
            conn.execute(f"INSERT INTO {META_PREFIX}_suspect_cells VALUES (?,?,?,?)", (tname, ri, col, raw))
        report.append({"table": tname, "source": meta.get("file"), "sheet": meta.get("sheet"),
                       "encoding": meta.get("encoding"), "delimiter": meta.get("delimiter"),
                       "header_row": meta.get("header_row"),
                       "skipped_rows_before_header": meta.get("skipped_rows_before_header", []),
                       "dropped_empty_columns": meta.get("dropped_empty_columns", 0), "rows": len(data),
                       "excel_precision_suspects": len(sus)})
    conn.commit()
    conn.close()
    return out, {"input_format": fmt, "staging": out.name, "tables": report}


def suspect_cells(conn: sqlite3.Connection) -> dict:
    """{(tabla, columna): {row_index: raw}} desde el staging (vacío para SQLite nativo)."""
    try:
        rows = conn.execute(f"SELECT table_name, column_name, row_index, raw FROM {META_PREFIX}_suspect_cells").fetchall()
    except sqlite3.OperationalError:
        return {}
    out: dict = {}
    for t, c, ri, raw in rows:
        out.setdefault((t, c), {})[ri] = raw
    return out
