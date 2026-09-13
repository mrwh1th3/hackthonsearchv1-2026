#!/usr/bin/env python3
"""Mutaciones estructurales de un estate canónico (prueba de robustez del agente de estructura).

Toma un estate con el esquema de estate_schema.sql y escribe una variante que otro generador podría
producir "según el esquema": nombres de tablas/columnas distintos, orden, columnas extra, formatos de
fecha y monto, catálogos alternos, prefijos en RFC/emp_id, CLABE numérica, nulls textuales, o
combinaciones. Determinista: misma entrada + kind + seed + vocab = mismos bytes.

    python3 generator/forensic/mutate.py --estate in.db --out out.db --kind combo --seed 3 \
        --manifest out.json [--vocab tuning|heldout]

El manifiesto dice qué se cambió, cómo traducir entidades e ids del estate original al mutado (para
puntuar con la misma clave) y qué se espera: `identical` (misma información, otra forma), `degraded`
(se quitó información opcional: debe declararse, no fallar) o `error` (se quitó algo imprescindible:
el auditor debe salir con error claro). Stdlib; no importa nada de src/."""
from __future__ import annotations

import argparse
import json
import random
import sqlite3
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

TABLE_COLS = {
    "vendors": ["rfc", "legal_name", "registered_date", "address", "bank_clabe", "category", "contact_email"],
    "invoices": ["uuid", "issuer_rfc", "receiver_rfc", "issue_date", "subtotal", "iva", "total", "concepto_text",
                 "uso_cfdi", "forma_pago", "metodo_pago", "status"],
    "ledger": ["entry_id", "date", "account_code", "account_name", "debit", "credit", "description", "invoice_uuid",
               "cost_center", "approver"],
    "bank_txns": ["txn_id", "date", "from_clabe", "to_clabe", "amount", "reference", "channel"],
    "purchase_orders": ["po_id", "vendor_rfc", "date", "amount", "requester", "approver", "description"],
    "contracts": ["contract_id", "vendor_rfc", "start_date", "value", "scope_text"],
    "employees": ["emp_id", "name", "role", "bank_clabe", "hire_date"],
    "efos_list": ["rfc", "legal_name", "status", "publication_date"],
}
ID_COL = {"ledger": "entry_id", "invoices": "uuid", "bank_txns": "txn_id", "vendors": "rfc", "efos_list": "rfc",
          "purchase_orders": "po_id", "contracts": "contract_id", "employees": "emp_id"}
AMOUNT_COL = {"invoices": "total", "bank_txns": "amount", "purchase_orders": "amount", "contracts": "value"}
DATE_COLS = {"vendors": ["registered_date"], "invoices": ["issue_date"], "ledger": ["date"], "bank_txns": ["date"],
             "purchase_orders": ["date"], "contracts": ["start_date"], "employees": ["hire_date"],
             "efos_list": ["publication_date"]}
MONEY_COLS = {"invoices": ["subtotal", "iva", "total"], "ledger": ["debit", "credit"], "bank_txns": ["amount"],
              "purchase_orders": ["amount"], "contracts": ["value"]}
RFC_COLS = {"vendors": ["rfc"], "invoices": ["issuer_rfc", "receiver_rfc"], "purchase_orders": ["vendor_rfc"],
            "contracts": ["vendor_rfc"], "efos_list": ["rfc"]}
CLABE_COLS = {"vendors": ["bank_clabe"], "bank_txns": ["from_clabe", "to_clabe"], "employees": ["bank_clabe"]}
PERSON_COLS = {"purchase_orders": ["requester", "approver"], "ledger": ["approver"]}

# Vocabularios independientes: `tuning` se usó para ajustar; `heldout` solo para el reporte final.
VOCAB = {
    "tuning": {
        "tables": {"vendors": ["Vendors", "VENDORS", "proveedores", "Suppliers"],
                   "invoices": ["Invoices", "facturas", "CFDI", "INVOICES"],
                   "ledger": ["Ledger", "general_ledger", "polizas", "GL"],
                   "bank_txns": ["BankTxns", "bank_transactions", "movimientos_bancarios", "BANK_TXNS"],
                   "purchase_orders": ["PurchaseOrders", "ordenes_compra", "PO", "purchase_order"],
                   "contracts": ["Contracts", "contratos", "CONTRACTS", "agreements"],
                   "employees": ["Employees", "empleados", "Staff", "EMPLOYEES"],
                   "efos_list": ["EfosList", "efos", "lista_69b", "EFOS_LIST"]},
        "columns": {
            "vendors": {"rfc": ["RFC", "vendor_rfc", "rfc_proveedor"], "legal_name": ["razon_social", "Name"],
                        "registered_date": ["fecha_alta", "RegistrationDate"], "address": ["direccion", "Address"],
                        "bank_clabe": ["clabe", "BankClabe"], "category": ["categoria", "Category"],
                        "contact_email": ["email", "ContactEmail"]},
            "invoices": {"uuid": ["UUID", "invoice_id", "uuid_cfdi"], "issuer_rfc": ["rfc_emisor", "IssuerRFC"],
                         "receiver_rfc": ["rfc_receptor", "ReceiverRFC"], "issue_date": ["fecha_emision", "InvoiceDate"],
                         "subtotal": ["SubTotal", "sub_total"], "iva": ["IVA", "vat"],
                         "total": ["Total", "monto_total", "importe_total"], "concepto_text": ["concepto", "Description"],
                         "uso_cfdi": ["UsoCFDI", "uso"], "forma_pago": ["FormaPago", "payment_form"],
                         "metodo_pago": ["MetodoPago", "payment_method"], "status": ["estatus", "Status"]},
            "ledger": {"entry_id": ["EntryID", "id_poliza"], "date": ["fecha", "PostingDate"],
                       "account_code": ["cuenta", "AccountCode"], "account_name": ["nombre_cuenta", "AccountName"],
                       "debit": ["cargo", "Debit"], "credit": ["abono", "Credit"], "description": ["descripcion", "Memo"],
                       "invoice_uuid": ["uuid_factura", "InvoiceUUID"], "cost_center": ["centro_costo", "CostCenter"],
                       "approver": ["aprobador", "ApprovedBy"]},
            "bank_txns": {"txn_id": ["TxnID", "id_movimiento"], "date": ["fecha", "TxnDate"],
                          "from_clabe": ["clabe_origen", "FromClabe"], "to_clabe": ["clabe_destino", "ToClabe"],
                          "amount": ["monto", "Amount"], "reference": ["referencia", "Reference"],
                          "channel": ["canal", "Channel"]},
            "purchase_orders": {"po_id": ["POID", "orden_id"], "vendor_rfc": ["rfc_proveedor", "VendorRFC"],
                                "date": ["fecha", "OrderDate"], "amount": ["monto", "Amount"],
                                "requester": ["solicitante", "RequestedBy"], "approver": ["aprobador", "ApprovedBy"],
                                "description": ["descripcion", "Description"]},
            "contracts": {"contract_id": ["ContractID", "id_contrato"], "vendor_rfc": ["rfc_proveedor", "VendorRFC"],
                          "start_date": ["fecha_inicio", "StartDate"], "value": ["monto", "ContractValue"],
                          "scope_text": ["alcance", "Scope"]},
            "employees": {"emp_id": ["EmployeeID", "id_empleado"], "name": ["nombre", "FullName"],
                          "role": ["puesto", "JobTitle"], "bank_clabe": ["clabe", "BankClabe"],
                          "hire_date": ["fecha_ingreso", "HireDate"]},
            "efos_list": {"rfc": ["RFC", "rfc_contribuyente"], "legal_name": ["razon_social", "Name"],
                          "status": ["situacion", "Status"], "publication_date": ["fecha_publicacion", "PublishedDate"]},
        },
        "date_formats": ["%d/%m/%Y", "%Y-%m-%dT%H:%M:%S", "%Y%m%d", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d 00:00:00",
                         "%d %b %Y", "%m/%d/%Y"],
        "amount_styles": ["dollar_comma", "suffix_mxn", "prefix_mxn", "decimal_comma"],
        "invoice_status": {"vigente": ["VIGENTE", "Vigente", "active", "valid"],
                           "cancelado": ["CANCELADO", "Cancelada", "cancelled", "canceled"]},
        "efos_status": {"definitivo": ["DEFINITIVO", "Definitive", "definitiva"],
                        "presunto": ["PRESUNTO", "Presunta", "presumed"]},
        "metodo_pago": {"PUE": ["pue", "Pue"], "PPD": ["ppd", "Ppd"]},
        "channel": {"SPEI": ["spei", "Spei", "transferencia"], "cheque": ["CHEQUE", "check"],
                    "efectivo": ["EFECTIVO", "cash"]},
        "rfc_styles": ["prefix_colon", "lower_spaced", "hyphen"],
        "emp_styles": ["digits", "e_zero", "emp_hyphen"],
        "null_tokens": ["N/A", "null", "NULL", "None"],
        "extra_columns": ["id", "created_at", "notes", "is_active"],
        "name_styles": ["as_is", "upper", "lower"],
    },
    "heldout": {
        "tables": {"vendors": ["tbl_proveedores", "SupplierMaster", "vendor_list", "Padron Proveedores"],
                   "invoices": ["cfdi_recibidos_emitidos", "InvoiceHeader", "tbl_facturas", "comprobantes_fiscales"],
                   "ledger": ["libro_diario", "GLEntries", "tbl_polizas", "asientos_contables"],
                   "bank_txns": ["estado_de_cuenta", "BankStatementLines", "tbl_movimientos", "spei_transfers"],
                   "purchase_orders": ["ordenes_de_compra", "PurchaseOrderHeader", "tbl_oc", "po_register"],
                   "contracts": ["tbl_contratos", "ContractRegister", "contratos_marco"],
                   "employees": ["tbl_empleados", "EmployeeMaster", "plantilla_personal"],
                   "efos_list": ["lista_efos_sat", "SAT69B", "tbl_69b", "efos_publicados"]},
        "columns": {
            "vendors": {"rfc": ["RFC Proveedor", "SupplierTaxID", "rfc_prov"],
                        "legal_name": ["Nombre o Razon Social", "SupplierName"],
                        "registered_date": ["Fecha de Alta", "OnboardingDate"], "address": ["Domicilio Fiscal", "Street"],
                        "bank_clabe": ["CLABE Interbancaria", "SupplierBankAccount"],
                        "category": ["Giro", "Segment"], "contact_email": ["Correo Electronico", "EMail"]},
            "invoices": {"uuid": ["Folio Fiscal", "CfdiUuid", "uuid_comprobante"],
                         "issuer_rfc": ["RFC Emisor", "EmisorRfc"], "receiver_rfc": ["RFC Receptor", "ReceptorRfc"],
                         "issue_date": ["Fecha de Emision", "IssuedAt"], "subtotal": ["Sub Total", "NetAmount"],
                         "iva": ["IVA Trasladado", "TaxAmount"], "total": ["Importe Total", "GrandTotal"],
                         "concepto_text": ["Concepto", "LineDescription"], "uso_cfdi": ["Uso CFDI", "CfdiUse"],
                         "forma_pago": ["Forma de Pago", "PaymentForm"], "metodo_pago": ["Metodo de Pago", "PaymentMethod"],
                         "status": ["Estatus CFDI", "InvoiceState"]},
            "ledger": {"entry_id": ["Numero de Asiento", "JournalLineId"], "date": ["Fecha Poliza", "EntryDate"],
                       "account_code": ["Codigo de Cuenta", "GlAccount"], "account_name": ["Nombre de Cuenta", "AccountTitle"],
                       "debit": ["Debe", "DebitAmount"], "credit": ["Haber", "CreditAmount"],
                       "description": ["Concepto Poliza", "Narrative"], "invoice_uuid": ["Folio Fiscal", "CfdiUuid"],
                       "cost_center": ["Centro de Costo", "Department"], "approver": ["Autorizado Por", "Signer"]},
            "bank_txns": {"txn_id": ["Folio Movimiento", "TransferId"], "date": ["Fecha Operacion", "ValueDate"],
                          "from_clabe": ["Cuenta Ordenante", "DebtorAccount"],
                          "to_clabe": ["Cuenta Beneficiario", "BeneficiaryAccount"],
                          "amount": ["Importe", "TransactionAmount"], "reference": ["Concepto de Pago", "Memo"],
                          "channel": ["Medio", "PaymentChannel"]},
            "purchase_orders": {"po_id": ["Numero de Orden", "PoNumber"], "vendor_rfc": ["RFC Proveedor", "SupplierRfc"],
                                "date": ["Fecha de Orden", "PoDate"], "amount": ["Importe Orden", "PoAmount"],
                                "requester": ["Solicitado Por", "Requestor"], "approver": ["Autorizado Por", "Signer"],
                                "description": ["Detalle", "Memo"]},
            "contracts": {"contract_id": ["Numero de Contrato", "ContractNumber"],
                          "vendor_rfc": ["RFC Proveedor", "SupplierRfc"], "start_date": ["Fecha de Inicio", "EffectiveDate"],
                          "value": ["Valor del Contrato", "ContractAmount"], "scope_text": ["Objeto del Contrato", "Scope"]},
            "employees": {"emp_id": ["Numero de Empleado", "EmployeeNumber"], "name": ["Nombre Completo", "EmployeeName"],
                          "role": ["Puesto", "Position"], "bank_clabe": ["CLABE Nomina", "PayrollAccount"],
                          "hire_date": ["Fecha de Ingreso", "HiredAt"]},
            "efos_list": {"rfc": ["RFC Contribuyente", "TaxpayerRfc"], "legal_name": ["Nombre del Contribuyente", "TaxpayerName"],
                          "status": ["Situacion del Contribuyente", "ListingStatus"],
                          "publication_date": ["Fecha Publicacion DOF", "PublishedOn"]},
        },
        "date_formats": ["epoch", "%d.%m.%Y", "spanish_month", "%Y-%m-%dT%H:%M:%SZ", "%d/%m/%Y %H:%M",
                         "%Y-%m-%dT%H:%M:%S-06:00", "%b %d, %Y"],
        "amount_styles": ["dollar_space", "thousands_dot_decimal_comma", "mxn_suffix_nospace", "parens_none"],
        "invoice_status": {"vigente": ["Vigente (SAT)", "VALIDA", "Emitida"],
                           "cancelado": ["CANCELADA POR SAT", "Anulada", "Void"]},
        "efos_status": {"definitivo": ["Definitivos", "FINAL"], "presunto": ["Presuntos", "Alleged"]},
        "metodo_pago": {"PUE": ["PUE - Pago en una sola exhibicion", "Pago en una sola exhibición"],
                        "PPD": ["PPD - Pago en parcialidades o diferido", "Pago en parcialidades o diferido"]},
        "channel": {"SPEI": ["Transferencia SPEI", "wire"], "cheque": ["Cheque nominativo", "Cheque"],
                    "efectivo": ["Efectivo", "Cash"]},
        "rfc_styles": ["prefix_space", "lower_spaced", "dotted"],
        "emp_styles": ["hash_digits", "empl_zero", "zero_padded"],
        "null_tokens": ["#N/A", "-", "nd", "NaN"],
        "extra_columns": ["row_uuid", "updated_by", "fecha_captura", "activo", "monto_usd"],
        "name_styles": ["as_is", "title", "upper"],
    },
}
NAME_KINDS = ["rename_tables", "rename_columns", "reorder_columns", "extra_columns"]
VALUE_KINDS = ["date_formats", "amount_text", "status_alternates", "rfc_prefix", "emp_id_format", "emp_ref_format",
               "clabe_numeric", "null_tokens", "id_formats"]
KINDS = NAME_KINDS + VALUE_KINDS + ["combo", "drop_optional", "drop_required"]
FORMATS = ["sqlite", "csv_dir", "csv_messy", "csv_bom_tab", "csv_zip", "xlsx", "xlsx_messy", "xlsx_zip",
           "xlsx_numeric_clabe", "single_csv"]
FORMAT_EXPECT = {"xlsx_numeric_clabe": "degraded", "single_csv": "degraded"}


def strip_accents(s: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))


class Model:
    def __init__(self, path: Path):
        c = sqlite3.connect(path)
        self.tables = {}
        for t, cols in TABLE_COLS.items():
            rows = [list(r) for r in c.execute(f"SELECT {', '.join(cols)} FROM {t} ORDER BY rowid")]
            self.tables[t] = {"name": t, "cols": list(cols), "names": {x: x for x in cols},
                              "types": {x: _decl(c, t, x) for x in cols}, "rows": rows, "extra": []}
        c.close()
        self.entity_map: dict[str, str] = {}
        self.id_maps: dict[str, dict[str, str]] = {}
        self.applied: list[str] = []
        self.expect = "identical"
        self.notes: list[str] = []
        self.dropped_tables: list[str] = []

    def col(self, t: str, cname: str) -> int:
        return TABLE_COLS[t].index(cname)

    def map_id(self, t: str, old, new):
        if str(old) != str(new):
            self.id_maps.setdefault(t, {})[str(old)] = new if isinstance(new, str) else str(new)


def _decl(c, t, col):
    for r in c.execute(f"PRAGMA table_info({t})"):
        if r[1] == col:
            return r[2] or "TEXT"
    return "TEXT"


def _d(s) -> date | None:
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


SPANISH = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def fmt_date(v, fmt: str):
    x = _d(v)
    if x is None:
        return v
    if fmt == "epoch":
        return int(datetime(x.year, x.month, x.day, 12, tzinfo=timezone.utc).timestamp())
    if fmt == "spanish_month":
        return f"{x.day:02d}-{SPANISH[x.month - 1]}-{x.year}"
    return datetime(x.year, x.month, x.day, 10, 30).strftime(fmt)


def fmt_amount(v, style: str):
    if v is None:
        return v
    x = float(v)
    if style == "dollar_comma":
        return f"${x:,.2f}"
    if style == "suffix_mxn":
        return f"{x:,.2f} MXN"
    if style == "prefix_mxn":
        return f"MXN {x:.2f}"
    if style == "decimal_comma":
        return f"{x:.2f}".replace(".", ",")
    if style == "dollar_space":
        return f"$ {x:,.2f}"
    if style == "thousands_dot_decimal_comma":
        return f"{x:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    if style == "mxn_suffix_nospace":
        return f"{x:.2f}MXN"
    return f"{x:,.2f}"


def fmt_rfc(v, style: str, rng: random.Random):
    if v is None:
        return v
    s = str(v)
    if rng.random() < 0.3:      # formato mixto por fila, como en capturas manuales
        return s
    if style == "prefix_colon":
        return f"RFC:{s}"
    if style == "prefix_space":
        return f"RFC {s}"
    if style == "lower_spaced":
        return f" {s.lower()} "
    if style == "hyphen":
        return f"{s[:-9]}-{s[-9:-3]}-{s[-3:]}"
    if style == "dotted":
        return f"{s[:-9]}.{s[-9:-3]}.{s[-3:]}"
    return s


def fmt_emp(eid: str, style: str) -> str:
    digits = "".join(ch for ch in str(eid) if ch.isdigit())
    n = int(digits) if digits else 0
    return {"digits": str(n), "e_zero": f"E{n:04d}", "emp_hyphen": f"EMP-{n:04d}", "hash_digits": f"#{n}",
            "empl_zero": f"EMPL{n:05d}", "zero_padded": f"{n:06d}"}[style]


def emp_ref(eid: str) -> str:
    return eid if str(eid).upper().startswith("EMP:") else f"EMP:{eid}"


# ---------------------------------------------------------------- mutaciones
def m_rename_tables(m: Model, rng, V):
    for t in TABLE_COLS:
        m.tables[t]["name"] = rng.choice(V["tables"][t])


def m_rename_columns(m: Model, rng, V):
    style = rng.choice(V["name_styles"])
    for t, cols in TABLE_COLS.items():
        for c in cols:
            if rng.random() < 0.75:
                n = rng.choice(V["columns"][t][c])
                n = {"upper": n.upper(), "lower": n.lower(), "title": n.title()}.get(style, n)
                m.tables[t]["names"][c] = n
    for t in TABLE_COLS:   # nombres únicos por tabla
        seen = {}
        for c in TABLE_COLS[t]:
            n = m.tables[t]["names"][c]
            key = n.lower()
            if key in seen:
                m.tables[t]["names"][c] = c
            seen[m.tables[t]["names"][c].lower()] = c


def m_reorder_columns(m: Model, rng, V):
    for t in TABLE_COLS:
        order = list(TABLE_COLS[t])
        rng.shuffle(order)
        m.tables[t]["cols"] = order


def m_extra_columns(m: Model, rng, V):
    for t in TABLE_COLS:
        k = rng.randint(1, 3)
        for name in rng.sample(V["extra_columns"], k):
            m.tables[t]["extra"].append(name)


def extra_value(name: str, i: int, row: list, t: str):
    if name in ("id",):
        return i + 1
    if name == "row_uuid":
        return f"{(i * 2654435761) % (1 << 32):08x}-0000-4000-8000-{i:012d}"
    if name in ("created_at", "fecha_captura"):
        return f"2026-07-01T0{i % 10}:00:00"
    if name == "notes":
        return "" if i % 3 else "revisado"
    if name in ("is_active", "activo"):
        return ["true", "false", "S", "N", "1"][i % 5]
    if name == "updated_by":
        return "sistema"
    if name == "monto_usd":
        amt = AMOUNT_COL.get(t)
        v = row[TABLE_COLS[t].index(amt)] if amt else None
        return round(float(v) / 18.0, 2) if isinstance(v, (int, float)) else None
    return None


def m_date_formats(m: Model, rng, V):
    for t, cols in DATE_COLS.items():
        for c in cols:
            fmt = rng.choice(V["date_formats"])
            j = m.col(t, c)
            for r in m.tables[t]["rows"]:
                r[j] = fmt_date(r[j], fmt)
            m.tables[t]["types"][c] = "INTEGER" if fmt == "epoch" else "TEXT"
            m.notes.append(f"{t}.{c} as {fmt}")


def m_amount_text(m: Model, rng, V):
    style = rng.choice(V["amount_styles"])
    for t, cols in MONEY_COLS.items():
        for c in cols:
            j = m.col(t, c)
            for r in m.tables[t]["rows"]:
                r[j] = fmt_amount(r[j], style)
            m.tables[t]["types"][c] = "TEXT"
    m.notes.append(f"amounts as text, style {style}")


def m_status_alternates(m: Model, rng, V):
    def swap(t, c, table):
        j = m.col(t, c)
        for r in m.tables[t]["rows"]:
            if r[j] in table:
                r[j] = rng.choice(table[r[j]])
    swap("invoices", "status", V["invoice_status"])
    swap("efos_list", "status", V["efos_status"])
    swap("invoices", "metodo_pago", V["metodo_pago"])
    swap("bank_txns", "channel", V["channel"])
    j = m.col("invoices", "forma_pago")
    for r in m.tables["invoices"]["rows"]:
        if isinstance(r[j], str) and r[j].isdigit():
            r[j] = int(r[j])
    m.tables["invoices"]["types"]["forma_pago"] = "INTEGER"
    j = m.col("invoices", "uso_cfdi")
    for r in m.tables["invoices"]["rows"]:
        if isinstance(r[j], str):
            r[j] = r[j].lower()


def m_rfc_prefix(m: Model, rng, V):
    style = rng.choice(V["rfc_styles"])
    for t, cols in RFC_COLS.items():
        for c in cols:
            j = m.col(t, c)
            for r in m.tables[t]["rows"]:
                new = fmt_rfc(r[j], style, rng)
                if c == ID_COL.get(t):
                    m.map_id(t, r[j], new)
                r[j] = new
    m.notes.append(f"RFC style {style}")


def _emp_rewrite(m: Model, style: str, refs_too: bool, ids_too: bool):
    emp = m.tables["employees"]
    j = m.col("employees", "emp_id")
    old_ids = {r[j]: fmt_emp(r[j], style) for r in emp["rows"]}
    if ids_too:
        for r in emp["rows"]:
            new = old_ids[r[j]]
            m.map_id("employees", r[j], new)
            m.entity_map[emp_ref(r[j])] = emp_ref(new)
            r[j] = new
    if refs_too:
        for t, cols in PERSON_COLS.items():
            for c in cols:
                k = m.col(t, c)
                for r in m.tables[t]["rows"]:
                    if r[k] in old_ids:
                        r[k] = old_ids[r[k]] if (ids_too or style != "keep") else r[k]
    return old_ids


def m_emp_id_format(m: Model, rng, V):
    style = rng.choice(V["emp_styles"])
    _emp_rewrite(m, style, refs_too=True, ids_too=True)
    m.notes.append(f"emp_id style {style} (employees and references)")


def m_emp_ref_format(m: Model, rng, V):
    """employees conserva sus ids; las referencias cambian de forma (ids como dígitos, nombres sin acentos/mayúsculas)."""
    style = rng.choice(V["emp_styles"])
    emp = m.tables["employees"]
    j, n = m.col("employees", "emp_id"), m.col("employees", "name")
    ids = {r[j]: fmt_emp(r[j], style) for r in emp["rows"]}
    names = {r[n]: r[n] for r in emp["rows"] if r[n]}
    counts = {}
    for r in emp["rows"]:
        if r[n]:
            k = " ".join(strip_accents(r[n]).lower().split())
            counts[k] = counts.get(k, 0) + 1
    for t, cols in PERSON_COLS.items():
        for c in cols:
            k = m.col(t, c)
            for r in m.tables[t]["rows"]:
                v = r[k]
                if v in ids:
                    r[k] = ids[v]
                elif v in names:
                    key = " ".join(strip_accents(v).lower().split())
                    if counts.get(key) == 1:   # homónimos: no se tocan (la referencia sería ambigua)
                        r[k] = rng.choice([strip_accents(v).upper(), "  " + v.lower() + " ", strip_accents(v)])
    m.notes.append(f"person references restyled ({style} for ids; case/accents for names)")


def m_clabe_numeric(m: Model, rng, V):
    for t, cols in CLABE_COLS.items():
        for c in cols:
            j = m.col(t, c)
            as_int = rng.random() < 0.6
            for r in m.tables[t]["rows"]:
                if r[j] is None:
                    continue
                s = str(r[j])
                r[j] = int(s) if as_int and s.isdigit() else f"{s[:4]} {s[4:8]} {s[8:12]} {s[12:16]} {s[16:]}"
            m.tables[t]["types"][c] = "INTEGER" if as_int else "TEXT"
            m.notes.append(f"{t}.{c} as {'INTEGER (leading zeros lost)' if as_int else 'spaced text'}")


def m_null_tokens(m: Model, rng, V):
    for t, cols in TABLE_COLS.items():
        for c in cols:
            if c == ID_COL.get(t):
                continue
            j = m.col(t, c)
            tok = rng.choice(V["null_tokens"])
            for r in m.tables[t]["rows"]:
                if r[j] is None or r[j] == "":
                    r[j] = tok


def m_id_formats(m: Model, rng, V):
    """entry_id textual y ids con espacios alrededor, consistentes entre tablas."""
    j = m.col("ledger", "entry_id")
    for r in m.tables["ledger"]["rows"]:
        new = f"GL-{int(r[j]):06d}"
        m.map_id("ledger", r[j], new)
        r[j] = new
    m.tables["ledger"]["types"]["entry_id"] = "TEXT"
    ju, jl = m.col("invoices", "uuid"), m.col("ledger", "invoice_uuid")
    pad = {r[ju]: f"{r[ju]} " for r in m.tables["invoices"]["rows"]}
    for r in m.tables["invoices"]["rows"]:
        m.map_id("invoices", r[ju], pad[r[ju]])
        r[ju] = pad[r[ju]]
    for r in m.tables["ledger"]["rows"]:
        if r[jl] in pad:
            r[jl] = pad[r[jl]]
    jt = m.col("bank_txns", "txn_id")
    for r in m.tables["bank_txns"]["rows"]:
        new = f" {r[jt]}"
        m.map_id("bank_txns", r[jt], new)
        r[jt] = new


def m_drop_optional(m: Model, rng, V):
    choice = rng.choice(["contracts_table", "po_requester", "invoice_metodo_pago", "employees_clabe"])
    if choice == "contracts_table":
        m.dropped_tables.append("contracts")
    elif choice == "po_requester":
        _drop_col(m, "purchase_orders", "requester")
    elif choice == "invoice_metodo_pago":
        _drop_col(m, "invoices", "metodo_pago")
    else:
        _drop_col(m, "employees", "bank_clabe")
    m.expect = "degraded"
    m.notes.append(f"dropped {choice}")


def m_drop_required(m: Model, rng, V):
    choice = rng.choice(["invoice_total", "invoices_table", "invoice_issuer"])
    if choice == "invoices_table":
        m.dropped_tables.append("invoices")
    else:
        _drop_col(m, "invoices", {"invoice_total": "total", "invoice_issuer": "issuer_rfc"}[choice])
    m.expect = "error"
    m.notes.append(f"dropped {choice}")


def _drop_col(m: Model, t: str, c: str):
    m.tables[t].setdefault("dropped", []).append(c)
    if c in m.tables[t]["cols"]:
        m.tables[t]["cols"].remove(c)


FUNCS = {k: globals()[f"m_{k}"] for k in KINDS if k != "combo"}
FUNCS["none"] = lambda m, rng, V: None


def mutate(src: Path, out: Path, kind: str, seed: int, vocab: str = "tuning", fmt: str = "sqlite") -> dict:
    rng = random.Random(f"mutate-{vocab}-{kind}-{seed}")
    V = VOCAB[vocab]
    m = Model(src)
    if kind == "combo":
        kinds = rng.sample(VALUE_KINDS, 3) + rng.sample(NAME_KINDS, 2)
        kinds = [k for k in VALUE_KINDS + NAME_KINDS if k in kinds]
        if "emp_id_format" in kinds and "emp_ref_format" in kinds:
            kinds.remove("emp_ref_format")
    else:
        kinds = [kind]
    for k in kinds:
        FUNCS[k](m, random.Random(f"mutate-{vocab}-{kind}-{k}-{seed}"), V)
        if k != "none":
            m.applied.append(k)
    if fmt == "sqlite":
        write(m, out)
    else:
        export(m, out, fmt)
        if fmt in FORMAT_EXPECT and m.expect == "identical":
            m.expect = FORMAT_EXPECT[fmt]
    man = manifest(m, src, out, kind, seed, vocab)
    man["format"] = fmt
    if fmt != "sqlite":
        man["official_validator_compatible"] = False
        man["validator_incompatible_because"] = [f"input is {fmt}, not SQLite"] + man["validator_incompatible_because"]
    return man


def write(m: Model, out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    c = sqlite3.connect(out)
    for t, spec in m.tables.items():
        if t in m.dropped_tables:
            continue
        cols = spec["cols"]
        decl = ", ".join(f'"{spec["names"][x]}" {spec["types"][x]}' for x in cols)
        extra = "".join(f', "{x}" {"INTEGER" if x == "id" else ("REAL" if x == "monto_usd" else "TEXT")}'
                        for x in spec["extra"])
        c.execute(f'CREATE TABLE "{spec["name"]}" ({decl}{extra})')
        rows = []
        for i, r in enumerate(spec["rows"]):
            vals = [r[TABLE_COLS[t].index(x)] for x in cols] + [extra_value(x, i, r, t) for x in spec["extra"]]
            rows.append(vals)
        if rows:
            c.executemany(f'INSERT INTO "{spec["name"]}" VALUES ({",".join("?" * len(rows[0]))})', rows)
    c.commit()
    c.close()


# ---------------------------------------------------------------- exportación CSV / XLSX / ZIP
def _table_grid(m: Model, t: str) -> tuple:
    spec = m.tables[t]
    cols = spec["cols"]
    header = [spec["names"][x] for x in cols] + spec["extra"]
    rows = []
    for i, r in enumerate(spec["rows"]):
        rows.append([r[TABLE_COLS[t].index(x)] for x in cols] + [extra_value(x, i, r, t) for x in spec["extra"]])
    return spec["name"], header, rows


def _csv_text(v, decimal_comma: bool = False) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return (f"{v:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")) if decimal_comma else repr(v)
    return str(v)


def export(m: Model, out: Path, fmt: str):
    import csv
    import io
    import shutil
    import zipfile
    tables = [t for t in TABLE_COLS if t not in m.dropped_tables]
    if out.exists():
        if out.is_dir():
            shutil.rmtree(out)
        else:
            out.unlink()
    out.parent.mkdir(parents=True, exist_ok=True)
    if fmt in ("csv_dir", "csv_messy", "csv_bom_tab", "csv_zip", "single_csv"):
        files = {}
        for t in (["invoices"] if fmt == "single_csv" else tables):
            name, header, rows = _table_grid(m, t)
            buf = io.StringIO(newline="")
            if fmt == "csv_messy":
                w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
                w.writerow([f"Exportación del sistema contable — {name}"] + [""] * (len(header) - 1))
                w.writerow([])
                w.writerow(header + [""])
                for r in rows:
                    w.writerow([_csv_text(v, decimal_comma=True) for v in r] + [""])
                w.writerow([])
                data = buf.getvalue().encode("cp1252", errors="replace")
            elif fmt == "csv_bom_tab":
                w = csv.writer(buf, delimiter="\t", lineterminator="\n")
                w.writerow(header)
                for r in rows:
                    w.writerow([_csv_text(v) for v in r])
                data = b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")
            else:
                w = csv.writer(buf, lineterminator="\n")
                w.writerow(header)
                for r in rows:
                    w.writerow([_csv_text(v) for v in r])
                data = buf.getvalue().encode("utf-8")
            files[f"{name}.csv"] = data
        if fmt == "single_csv":
            out.write_bytes(next(iter(files.values())))
        elif fmt == "csv_zip":
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
                for n in sorted(files):
                    z.writestr(zipfile.ZipInfo(f"export/{n}", date_time=(2026, 7, 1, 0, 0, 0)), files[n])
        else:
            out.mkdir(parents=True)
            for n, data in files.items():
                (out / n).write_bytes(data)
        return
    if fmt in ("xlsx", "xlsx_messy", "xlsx_numeric_clabe", "xlsx_zip"):
        data = xlsx_bytes(m, tables, messy=fmt == "xlsx_messy", numeric_clabe=fmt == "xlsx_numeric_clabe")
        if fmt == "xlsx_zip":
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr(zipfile.ZipInfo("estate.xlsx", date_time=(2026, 7, 1, 0, 0, 0)), data)
        else:
            out.write_bytes(data)
        return
    raise ValueError(fmt)


def _xml(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _col_letter(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def xlsx_bytes(m: Model, tables: list, messy: bool, numeric_clabe: bool) -> bytes:
    """XLSX mínimo con stdlib: sharedStrings, fechas como número de serie con estilo de fecha, montos numéricos,
    CLABE/RFC/ids como texto (o CLABE numérica si numeric_clabe, que en Excel pierde dígitos). `messy` agrega
    fila de título combinada, fila de grupo combinada, hoja oculta, hoja vacía y sistema de fechas 1904."""
    import io
    import zipfile
    date1904 = messy
    shared, sidx = [], {}

    def si(text: str) -> int:
        if text not in sidx:
            sidx[text] = len(shared)
            shared.append(text)
        return sidx[text]

    def serial(v):
        x = _d(v)
        if x is None:
            return None
        base = date(1904, 1, 1) if date1904 else date(1899, 12, 30)
        return (x - base).days

    sheets = []
    if messy:
        sheets.append(("Config", "hidden", f'<sheetData><row r="1"><c r="A1" t="s"><v>{si("no usar")}</v></c></row></sheetData>'))
    for t in tables:
        name, header, rows = _table_grid(m, t)
        cols = m.tables[t]["cols"]
        force_text = {ID_COL[t]} | set(RFC_COLS.get(t, [])) | ({"emp_id"} if t == "employees" else set())
        clabes = set(CLABE_COLS.get(t, []))
        dates = set(DATE_COLS.get(t, []))
        xml_rows, r0, merges = [], 1, []
        last = _col_letter(len(header) - 1)
        if messy:
            xml_rows.append(f'<row r="1"><c r="A1" t="s"><v>{si("Reporte " + name)}</v></c></row>')
            merges.append(f"A1:{last}1")
            xml_rows.append(f'<row r="3"><c r="A3" t="s"><v>{si("Datos del registro")}</v></c></row>')
            merges.append(f"A3:{last}3")
            r0 = 4
        cells = "".join(f'<c r="{_col_letter(j)}{r0}" t="s"><v>{si(h)}</v></c>' for j, h in enumerate(header))
        xml_rows.append(f'<row r="{r0}">{cells}</row>')
        for i, r in enumerate(rows):
            rn = r0 + 1 + i
            cs = []
            for j, v in enumerate(r):
                ref = f"{_col_letter(j)}{rn}"
                c = cols[j] if j < len(cols) else None
                if v is None or v == "":
                    continue
                if c in dates and serial(v) is not None:
                    cs.append(f'<c r="{ref}" s="1"><v>{serial(v)}</v></c>')
                elif c in clabes and numeric_clabe and str(v).strip().isdigit():
                    cs.append(f'<c r="{ref}"><v>{repr(float(int(str(v))))}</v></c>')
                elif isinstance(v, (int, float)) and not isinstance(v, bool) and c not in force_text and c not in clabes:
                    cs.append(f'<c r="{ref}"><v>{repr(v)}</v></c>')
                else:
                    cs.append(f'<c r="{ref}" t="s"><v>{si(str(v))}</v></c>')
            xml_rows.append(f'<row r="{rn}">{"".join(cs)}</row>')
        body = "<sheetData>" + "".join(xml_rows) + "</sheetData>"
        if merges:
            body += f'<mergeCells count="{len(merges)}">' + "".join(f'<mergeCell ref="{x}"/>' for x in merges) + "</mergeCells>"
        sheets.append((name[:31], "visible", body))
    if messy:
        sheets.append(("Notas", "visible", "<sheetData/>"))

    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rns = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    ct_main = "application/vnd.openxmlformats-officedocument.spreadsheetml"
    rel_t = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    buf = io.BytesIO()

    def zi(n):
        return zipfile.ZipInfo(n, date_time=(2026, 7, 1, 0, 0, 0))

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zi("[Content_Types].xml"),
                   '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   f'<Override PartName="/xl/workbook.xml" ContentType="{ct_main}.sheet.main+xml"/>'
                   f'<Override PartName="/xl/styles.xml" ContentType="{ct_main}.styles+xml"/>'
                   f'<Override PartName="/xl/sharedStrings.xml" ContentType="{ct_main}.sharedStrings+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="{ct_main}.worksheet+xml"/>'
                             for i in range(len(sheets))) + "</Types>")
        z.writestr(zi("_rels/.rels"),
                   '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   f'<Relationship Id="rId1" Type="{rel_t}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        pr = '<workbookPr date1904="1"/>' if date1904 else "<workbookPr/>"
        z.writestr(zi("xl/workbook.xml"),
                   f'<?xml version="1.0" encoding="UTF-8"?><workbook {ns} {rns}>{pr}<sheets>'
                   + "".join(f'<sheet name="{_xml(n)}" sheetId="{i + 1}" r:id="rId{i + 1}"'
                             + (' state="hidden"' if st == "hidden" else "") + "/>" for i, (n, st, _) in enumerate(sheets))
                   + "</sheets></workbook>")
        z.writestr(zi("xl/_rels/workbook.xml.rels"),
                   '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i + 1}" Type="{rel_t}/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                             for i in range(len(sheets)))
                   + f'<Relationship Id="rId{len(sheets) + 1}" Type="{rel_t}/styles" Target="styles.xml"/>'
                   + f'<Relationship Id="rId{len(sheets) + 2}" Type="{rel_t}/sharedStrings" Target="sharedStrings.xml"/>'
                   + "</Relationships>")
        z.writestr(zi("xl/styles.xml"),
                   f'<?xml version="1.0" encoding="UTF-8"?><styleSheet {ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>'
                   '<fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>'
                   '<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/>'
                   f'<xf numFmtId="{164 if messy else 14}" applyNumberFormat="1"/></cellXfs></styleSheet>')
        for i, (_, _, body) in enumerate(sheets):
            z.writestr(zi(f"xl/worksheets/sheet{i + 1}.xml"),
                       f'<?xml version="1.0" encoding="UTF-8"?><worksheet {ns} {rns}>{body}</worksheet>')
        z.writestr(zi("xl/sharedStrings.xml"),
                   f'<?xml version="1.0" encoding="UTF-8"?><sst {ns} count="{len(shared)}" uniqueCount="{len(shared)}">'
                   + "".join(f'<si><t xml:space="preserve">{_xml(x)}</t></si>' for x in shared) + "</sst>")
    return buf.getvalue()


def manifest(m: Model, src: Path, out: Path, kind: str, seed: int, vocab: str) -> dict:
    compat, why = True, []
    for t, spec in m.tables.items():
        if t in m.dropped_tables:
            compat = False
            why.append(f"table {t} dropped")
            continue
        if spec["name"].lower() != t:
            compat = False
            why.append(f"table {t} renamed to {spec['name']!r}")
        idc = ID_COL[t]
        if spec["names"][idc].lower() != idc:
            compat = False
            why.append(f"{t}.{idc} renamed to {spec['names'][idc]!r}")
        amt = AMOUNT_COL.get(t)
        if amt and (spec["names"][amt].lower() != amt or amt in spec.get("dropped", [])):
            compat = False
            why.append(f"{t}.{amt} renamed/dropped")
        if amt and spec["types"][amt] == "TEXT" and any(isinstance(r[TABLE_COLS[t].index(amt)], str) for r in spec["rows"][:5]):
            compat = False
            why.append(f"{t}.{amt} stored as text")
    return {"kind": kind, "seed": seed, "vocab": vocab, "applied": m.applied, "source": str(src), "estate": str(out),
            "expect": m.expect, "notes": m.notes,
            "tables": {t: s["name"] for t, s in m.tables.items() if t not in m.dropped_tables},
            "columns": {t: {c: n for c, n in s["names"].items() if n != c} for t, s in m.tables.items()},
            "extra_columns": {t: s["extra"] for t, s in m.tables.items() if s["extra"]},
            "dropped": {"tables": m.dropped_tables,
                        "columns": {t: s["dropped"] for t, s in m.tables.items() if s.get("dropped")}},
            "entity_map": m.entity_map, "id_maps": m.id_maps,
            "official_validator_compatible": compat, "validator_incompatible_because": why[:6]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--estate", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--kind", required=True, choices=KINDS + ["none"])
    ap.add_argument("--format", default="sqlite", choices=FORMATS,
                    help="formato de salida: SQLite o exportación CSV/XLSX/ZIP (tras las mutaciones)")
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--vocab", default="tuning", choices=list(VOCAB))
    ap.add_argument("--manifest")
    a = ap.parse_args()
    man = mutate(Path(a.estate), Path(a.out), a.kind, a.seed, a.vocab, a.format)
    if a.manifest:
        Path(a.manifest).parent.mkdir(parents=True, exist_ok=True)
        Path(a.manifest).write_text(json.dumps(man, indent=2, ensure_ascii=False, sort_keys=True))
    print(f"{a.kind} format={a.format} seed={a.seed} vocab={a.vocab} applied={','.join(man['applied'])} "
          f"expect={man['expect']} -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
