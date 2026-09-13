"""Firmas de columna y normalizadores de valor. Deterministas y sin estado.

La firma se calcula sobre una muestra acotada (N filas fijas por columna): el costo de inspeccionar
no crece con el dataset. La normalización, en cambio, se aplica a todas las filas al construir el
estate canónico (normalize.py), con el formato decidido una vez por columna."""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timezone

NULL_TOKENS = {"", "n/a", "na", "null", "none", "nan", "nil", "-", "--", "s/d", "sin dato", "nd", "n.d.", "#n/a"}

RFC_RE = re.compile(r"^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$")
UUID_RE = re.compile(r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$")
PREFIXED_ID_RE = re.compile(r"^[A-Za-z]{1,6}[-_:]?\d+$")
EMP_RE = re.compile(r"^(?:EMP|EMPL|EMPLEADO|E|EMPLOYEE|ID|NO)?\s*[:#\-_ ]?\s*0*(\d+)$", re.I)
USO_RE = re.compile(r"^(?:[GIDPS]\d{2}|CP01|CN01|S01)$")
SAMPLE_ROWS = 200

MONTHS = {"jan": 1, "ene": 1, "january": 1, "enero": 1, "feb": 2, "february": 2, "febrero": 2, "mar": 3, "march": 3,
          "marzo": 3, "apr": 4, "abr": 4, "april": 4, "abril": 4, "may": 5, "mayo": 5, "jun": 6, "june": 6, "junio": 6,
          "jul": 7, "july": 7, "julio": 7, "aug": 8, "ago": 8, "august": 8, "agosto": 8, "sep": 9, "sept": 9,
          "set": 9, "september": 9, "septiembre": 9, "oct": 10, "october": 10, "octubre": 10, "nov": 11,
          "november": 11, "noviembre": 11, "dec": 12, "dic": 12, "december": 12, "diciembre": 12}


def strip_accents(s: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))


def norm_name(name: str) -> str:
    """`Invoice ID` / `invoiceId` / `Fecha-Emisión` -> invoice_id / invoice_id / fecha_emision"""
    s = strip_accents(str(name)).strip()
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").lower()
    return re.sub(r"_+", "_", s)


def singular(tok: str) -> str:
    for suf, rep in (("ies", "y"), ("es", ""), ("s", "")):
        if tok.endswith(suf) and len(tok) > len(suf) + 2:
            return tok[: -len(suf)] + rep
    return tok


def is_null(v) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and v != v:
        return True
    return isinstance(v, str) and v.strip().lower() in NULL_TOKENS


# ---------------------------------------------------------------- normalizadores de valor
def as_text(v) -> str | None:
    if is_null(v):
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def norm_rfc(v) -> str | None:
    s = as_text(v)
    if s is None:
        return None
    s = strip_accents(s.upper()).replace("Ñ", "Ñ")
    s = re.sub(r"^\s*RFC\s*[:#\-]?\s*", "", s)
    return re.sub(r"[\s\-_.]", "", s)


def norm_clabe(v) -> str | None:
    if is_null(v):
        return None
    if isinstance(v, (int,)) or (isinstance(v, float) and v.is_integer()):
        s = str(int(v))
    else:
        s = re.sub(r"[\s\-_.]", "", str(v).strip())
        if re.fullmatch(r"\d+\.0+", s):
            s = s.split(".")[0]
    if s.isdigit() and 14 <= len(s) < 18:
        s = s.zfill(18)   # CLABE guardada como número: se perdieron ceros a la izquierda
    return s


def clabe_ok(s: str | None) -> bool:
    return bool(s) and len(s) == 18 and s.isdigit()


AMOUNT_JUNK = re.compile(r"(?i)(mxn|mxp|usd|pesos?|m\.n\.|\$|\s)")


def norm_amount(v) -> float | None:
    if is_null(v):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = AMOUNT_JUNK.sub("", str(v))
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if not s:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")      # 1.234,56
        else:
            s = s.replace(",", "")                        # 1,234.56
    elif "," in s:
        head, _, tail = s.rpartition(",")
        s = s.replace(",", "") if len(tail) == 3 else head.replace(",", "") + "." + tail   # 1,234 | 12,5
    try:
        x = float(s)
    except ValueError:
        return None
    return -x if neg else x


# fechas: cada formato devuelve date o None
def _ymd(y, m, d_):
    try:
        return date(int(y), int(m), int(d_))
    except ValueError:
        return None


DATE_PATTERNS = [
    ("iso", re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$"), lambda g: _ymd(g[0], g[1], g[2])),
    ("iso_datetime", re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$"),
     None),
    ("ymd_slash", re.compile(r"^(\d{4})/(\d{1,2})/(\d{1,2})$"), lambda g: _ymd(g[0], g[1], g[2])),
    ("compact", re.compile(r"^(\d{4})(\d{2})(\d{2})$"), lambda g: _ymd(g[0], g[1], g[2])),
    ("dmy", re.compile(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$"), lambda g: _ymd(g[2], g[1], g[0])),
    ("mdy", re.compile(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$"), lambda g: _ymd(g[2], g[0], g[1])),
    ("d_mon_y", re.compile(r"^(\d{1,2})[\s\-/]+([A-Za-z]{3,10})\.?[\s\-/,]+(\d{4})$"), None),
    ("mon_d_y", re.compile(r"^([A-Za-z]{3,10})\.?\s+(\d{1,2}),?\s+(\d{4})$"), None),
]


def _parse_with(fmt: str, s: str) -> date | None:
    for name, rx, fn in DATE_PATTERNS:
        if name != fmt:
            continue
        m = rx.match(s)
        if not m:
            return None
        g = m.groups()
        if name == "iso_datetime":
            # la fecha contable es la escrita en el registro: la hora y la zona no la mueven de día
            return _ymd(g[0], g[1], g[2])
        if name in ("d_mon_y", "mon_d_y"):
            dd, mon, yy = (g[0], g[1], g[2]) if name == "d_mon_y" else (g[1], g[0], g[2])
            mo = MONTHS.get(strip_accents(mon).lower())
            return _ymd(yy, mo, dd) if mo else None
        return fn(g)
    return None


def epoch_date(v) -> date | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if 1e11 < x < 1e14:
        x /= 1000.0
    if 3e8 < x < 5e9:
        return datetime.fromtimestamp(x, tz=timezone.utc).date()
    return None


def detect_date_format(values: list) -> dict:
    """Formato dominante en la muestra. DD/MM vs MM/DD se decide por evidencia (un campo > 12);
    sin evidencia se asume DD/MM (convención mexicana) y se declara."""
    counts = {}
    texts = [str(v).strip() for v in values if not is_null(v)]
    if not texts:
        return {"format": None, "ratio": 0.0, "assumed": False}
    for name, _, _ in DATE_PATTERNS:
        counts[name] = sum(1 for s in texts if _parse_with(name, s))
    counts["epoch"] = sum(1 for v in values if not is_null(v) and not isinstance(v, str) and epoch_date(v)) + \
        sum(1 for s in texts if re.fullmatch(r"\d{9,13}(\.\d+)?", s) and epoch_date(s))
    assumed = False
    if counts["dmy"] and counts["mdy"]:
        slash = [re.match(r"^(\d{1,2})[/.\-](\d{1,2})", s) for s in texts]
        first_big = any(m and int(m.group(1)) > 12 for m in slash)
        second_big = any(m and int(m.group(2)) > 12 for m in slash)
        if second_big and not first_big:
            counts["dmy"] = 0
        else:
            assumed = not first_big
            counts["mdy"] = 0
    best = max(counts.items(), key=lambda kv: (kv[1], -list(counts).index(kv[0])))
    return {"format": best[0] if best[1] else None, "ratio": round(best[1] / len(texts), 3),
            "assumed_day_first": assumed}


def norm_date(v, fmt: str | None) -> str | None:
    if is_null(v):
        return None
    if fmt == "epoch" or (not isinstance(v, str) and fmt is None):
        x = epoch_date(v)
        return x.isoformat() if x else as_text(v)
    s = str(v).strip()
    x = _parse_with(fmt, s) if fmt else None
    if x is None:
        for name, _, _ in DATE_PATTERNS:   # fila fuera del formato dominante
            if name == "mdy":
                continue
            x = _parse_with(name, s)
            if x:
                break
    if x is None and re.fullmatch(r"\d{9,13}(\.\d+)?", s):
        x = epoch_date(s)
    return x.isoformat() if x else s


# catálogos
INVOICE_STATUS = {"vigente": "vigente", "vigentes": "vigente", "valid": "vigente", "valida": "vigente",
                  "valido": "vigente", "active": "vigente", "activo": "vigente", "activa": "vigente", "v": "vigente",
                  "current": "vigente", "ok": "vigente", "issued": "vigente", "emitida": "vigente", "timbrada": "vigente",
                  "cancelado": "cancelado", "cancelada": "cancelado", "cancelled": "cancelado", "canceled": "cancelado",
                  "cancel": "cancelado", "cancelados": "cancelado", "c": "cancelado", "void": "cancelado",
                  "voided": "cancelado", "anulada": "cancelado", "anulado": "cancelado"}
EFOS_STATUS = {"definitivo": "definitivo", "definitiva": "definitivo", "definitive": "definitivo", "final": "definitivo",
               "definitivos": "definitivo", "confirmed": "definitivo", "firme": "definitivo",
               "presunto": "presunto", "presunta": "presunto", "presumed": "presunto", "presumptive": "presunto",
               "alleged": "presunto", "suspected": "presunto", "presuntos": "presunto", "presunto_69b": "presunto",
               "desvirtuado": "desvirtuado", "desvirtuada": "desvirtuado", "rebutted": "desvirtuado",
               "sentencia_favorable": "sentencia_favorable", "favorable_ruling": "sentencia_favorable"}
METODO_PAGO = {"pue": "PUE", "ppd": "PPD", "pago_en_una_sola_exhibicion": "PUE", "una_sola_exhibicion": "PUE",
               "single_payment": "PUE", "pago_en_parcialidades_o_diferido": "PPD", "parcialidades": "PPD",
               "diferido": "PPD", "installments": "PPD", "deferred": "PPD"}
CHANNEL = {"spei": "SPEI", "cheque": "cheque", "check": "cheque", "cheq": "cheque", "efectivo": "efectivo",
           "cash": "efectivo", "transferencia": "SPEI", "transfer": "SPEI", "wire": "SPEI"}


def catalog(table: dict, v, keep_case_if_unknown: bool = True) -> str | None:
    s = as_text(v)
    if s is None:
        return None
    if len(s) > 48:
        return s if keep_case_if_unknown else None
    k = norm_name(s)
    if k in table:
        return table[k]
    k2 = k.split("_")[0] if k else k          # "CANCELADA POR SAT", "PPD - Pago en parcialidades"
    if k2 in table:
        return table[k2]
    return s if keep_case_if_unknown else None


def norm_forma_pago(v) -> str | None:
    s = as_text(v)
    if s is None:
        return None
    return s.zfill(2) if s.isdigit() and len(s) < 2 else s


def emp_digits(v) -> str | None:
    s = as_text(v)
    if s is None:
        return None
    m = EMP_RE.match(s)
    return str(int(m.group(1))) if m else None


# ---------------------------------------------------------------- firma de columna
def kind_ratio(kind: str, values: list) -> float:
    """Proporción de la muestra no nula compatible con el tipo canónico. Texto: siempre 1."""
    vals = [v for v in values if not is_null(v)]
    if not vals:
        return 0.0
    if kind in ("freetext", "text", "person"):
        return 1.0
    ok = 0
    for v in vals:
        if kind == "rfc":
            ok += bool(RFC_RE.match(norm_rfc(v) or ""))
        elif kind == "clabe":
            # una CLABE que Excel guardó como número en notación exponencial sigue siendo "la columna CLABE":
            # se mapea y la normalización la descarta por pérdida de precisión (no se adivinan dígitos)
            ok += clabe_ok(norm_clabe(v)) or bool(re.fullmatch(r"\s*1?\d(?:\.\d+)?[eE][+]?1[5-7]\s*", str(v)))
        elif kind == "amount":
            ok += norm_amount(v) is not None
        elif kind == "date":
            s = str(v).strip()
            ok += any(_parse_with(n, s) for n, _, _ in DATE_PATTERNS) or bool(epoch_date(v))
        elif kind == "email":
            ok += "@" in str(v)
        elif kind == "invoice_status":
            ok += catalog(INVOICE_STATUS, v, False) is not None
        elif kind == "efos_status":
            ok += catalog(EFOS_STATUS, v, False) is not None
        elif kind == "metodo_pago":
            ok += catalog(METODO_PAGO, v, False) is not None
        elif kind == "forma_pago":
            ok += bool(re.fullmatch(r"\d{1,2}", as_text(v) or ""))
        elif kind == "uso_cfdi":
            ok += bool(USO_RE.match((as_text(v) or "").upper()))
        elif kind == "channel":
            ok += catalog(CHANNEL, v, False) is not None
        elif kind == "account_code":
            ok += bool(re.fullmatch(r"\d{3,6}(?:[-.]\d+)*", as_text(v) or ""))
        elif kind == "emp_id":
            ok += emp_digits(v) is not None
        elif kind == "int_id":
            s = as_text(v) or ""
            ok += bool(re.fullmatch(r"\d+", s) or PREFIXED_ID_RE.match(s))
        elif kind == "id":
            s = as_text(v) or ""
            ok += bool(UUID_RE.match(s) or PREFIXED_ID_RE.match(s) or re.fullmatch(r"[A-Za-z0-9\-_:]{3,40}", s))
    return ok / len(vals)


def signature(values: list, declared_type: str) -> dict:
    """Firma agregada de una muestra: lo que ve el mapeo (y, si hace falta, el asistente LLM).
    No incluye valores de texto libre."""
    vals = [v for v in values if not is_null(v)]
    n = len(vals)
    kinds = ("rfc", "clabe", "amount", "date", "email", "invoice_status", "efos_status", "metodo_pago",
             "forma_pago", "uso_cfdi", "channel", "account_code", "emp_id", "id")
    sig = {"declared_type": declared_type or "", "sample_n": len(values), "non_null": n,
           "null_tokens": sum(1 for v in values if isinstance(v, str) and is_null(v) and v != ""),
           "distinct_ratio": round(len({str(v) for v in vals}) / n, 3) if n else 0.0,
           "kinds": {k: round(kind_ratio(k, values), 3) for k in kinds}}
    if n:
        sig["date_format"] = detect_date_format(vals)["format"] if sig["kinds"]["date"] >= 0.6 else None
        lens = sorted(len(str(v)) for v in vals)
        sig["len_median"] = lens[len(lens) // 2]
    return sig
