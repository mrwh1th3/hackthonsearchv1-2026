"""Esquema canónico (spec/forensic-auditor/estate_schema.sql) descrito para el mapeo.

Para cada columna: el tipo de valor que se espera (`kind`, que decide la firma y la normalización)
y sinónimos de nombre en español e inglés. Por tabla: las columnas `core` (sin ellas la tabla no
se puede usar y se trata como ausente) y la columna id que se cita en `record_id`.

`SCHEME_REQUIRES` declara qué necesita cada tipología para no acusar con datos incompletos: si falta
algo, la tipología se desactiva y se declara en límites. `GLOBAL_REQUIRED` es lo imprescindible para
correr: sin ello el auditor sale con error claro."""
from __future__ import annotations

from collections import OrderedDict

# kind -> familia de firma (signatures.py)
#   id, rfc, clabe, emp_id, date, amount, text, freetext, email, invoice_status, efos_status,
#   metodo_pago, forma_pago, uso_cfdi, account_code, channel, person, int_id


def _cols(*items):
    return OrderedDict((name, {"kind": kind, "syn": list(syn)}) for name, kind, syn in items)


CANONICAL = OrderedDict([
    ("vendors", {
        "syn": ["vendor", "proveedores", "proveedor", "suppliers", "supplier", "vendor_master", "padron_proveedores",
                "catalogo_proveedores", "vendedores"],
        "id": "rfc",
        "core": ["rfc"],
        "columns": _cols(
            ("rfc", "rfc", ["vendor_rfc", "rfc_proveedor", "tax_id", "taxid", "supplier_rfc", "rfc_vendor", "id_fiscal"]),
            ("legal_name", "freetext", ["name", "razon_social", "nombre", "vendor_name", "supplier_name", "nombre_proveedor",
                                         "business_name", "company_name"]),
            ("registered_date", "date", ["registration_date", "fecha_alta", "fecha_registro", "alta", "created",
                                          "date_registered", "onboarding_date", "registered", "fecha_de_alta"]),
            ("address", "freetext", ["direccion", "domicilio", "domicilio_fiscal", "street_address"]),
            ("bank_clabe", "clabe", ["clabe", "cuenta_clabe", "bank_account", "account_clabe", "clabe_interbancaria",
                                      "cuenta", "vendor_clabe"]),
            ("category", "freetext", ["categoria", "giro", "tipo", "segment", "vendor_category"]),
            ("contact_email", "email", ["email", "correo", "correo_electronico", "e_mail", "mail", "contacto"]),
        )}),
    ("invoices", {
        "syn": ["invoice", "facturas", "factura", "cfdi", "cfdis", "comprobantes", "comprobante", "bills", "cfdi_invoices"],
        "id": "uuid",
        "core": ["uuid", "issuer_rfc", "receiver_rfc", "issue_date", "total"],
        "columns": _cols(
            ("uuid", "id", ["invoice_id", "invoice_uuid", "uuid_cfdi", "cfdi_uuid", "folio", "folio_fiscal", "id_factura",
                            "invoice_number", "id", "factura_id"]),
            ("issuer_rfc", "rfc", ["rfc_emisor", "emisor_rfc", "emisor", "issuer", "seller_rfc", "rfc_issuer", "from_rfc",
                                    "supplier_rfc", "vendor_rfc"]),
            ("receiver_rfc", "rfc", ["rfc_receptor", "receptor_rfc", "receptor", "receiver", "buyer_rfc", "rfc_receiver",
                                      "to_rfc", "customer_rfc", "recipient_rfc"]),
            ("issue_date", "date", ["fecha", "fecha_emision", "date", "invoice_date", "issued", "issued_at",
                                     "fecha_de_emision", "emission_date"]),
            ("subtotal", "amount", ["sub_total", "importe", "base", "net_amount", "monto_sin_iva", "amount_before_tax"]),
            ("iva", "amount", ["vat", "tax", "impuesto", "iva_trasladado", "tax_amount", "impuestos"]),
            ("total", "amount", ["monto_total", "importe_total", "amount", "monto", "grand_total", "total_amount",
                                  "invoice_total"]),
            ("concepto_text", "freetext", ["concepto", "descripcion", "description", "concept", "line_description",
                                            "detalle"]),
            ("uso_cfdi", "uso_cfdi", ["uso", "cfdi_use", "usocfdi"]),
            ("forma_pago", "forma_pago", ["payment_form", "formapago", "forma_de_pago"]),
            ("metodo_pago", "metodo_pago", ["payment_method", "metodopago", "metodo_de_pago"]),
            ("status", "invoice_status", ["estatus", "estado", "state", "invoice_status", "status_cfdi", "estatus_cfdi"]),
        )}),
    ("ledger", {
        "syn": ["general_ledger", "gl", "journal", "journal_entries", "polizas", "poliza", "libro_mayor", "contabilidad",
                "asientos", "gl_entries", "accounting_entries", "ledger_entries", "diario"],
        "id": "entry_id",
        "core": ["entry_id", "date", "debit", "credit", "invoice_uuid"],
        "columns": _cols(
            ("entry_id", "int_id", ["id", "entry", "id_poliza", "poliza_id", "journal_id", "line_id", "asiento",
                                     "id_asiento", "gl_id"]),
            ("date", "date", ["fecha", "posting_date", "entry_date", "fecha_poliza", "booked"]),
            ("account_code", "account_code", ["cuenta", "account", "codigo_cuenta", "account_number", "gl_account",
                                               "num_cuenta"]),
            ("account_name", "freetext", ["nombre_cuenta", "account_desc", "cuenta_nombre", "account_title"]),
            ("debit", "amount", ["debe", "cargo", "debito", "dr", "debit_amount", "cargos"]),
            ("credit", "amount", ["haber", "abono", "credito", "cr", "credit_amount", "abonos"]),
            ("description", "freetext", ["descripcion", "concepto", "memo", "narrative", "detalle"]),
            ("invoice_uuid", "id", ["uuid", "invoice_id", "factura", "uuid_factura", "cfdi_uuid", "invoice", "folio"]),
            ("cost_center", "freetext", ["centro_costo", "centro_de_costo", "cc", "costcenter", "department"]),
            ("approver", "person", ["aprobador", "approved_by", "autorizo", "autorizado_por", "aprobado_por", "signer"]),
        )}),
    ("bank_txns", {
        "syn": ["bank_transactions", "transactions", "bank", "movimientos", "movimientos_bancarios", "transferencias",
                "payments", "bank_movements", "txns", "banco", "spei", "pagos"],
        "id": "txn_id",
        "core": ["txn_id", "date", "from_clabe", "to_clabe", "amount"],
        "columns": _cols(
            ("txn_id", "id", ["id", "transaction_id", "id_movimiento", "movimiento_id", "tx_id", "folio", "trx_id",
                              "transfer_id"]),
            ("date", "date", ["fecha", "value_date", "txn_date", "fecha_operacion", "transaction_date", "booked"]),
            ("from_clabe", "clabe", ["clabe_origen", "origen", "source_clabe", "from_account", "cuenta_origen",
                                      "sender_clabe", "debtor_account", "ordenante", "clabe_ordenante"]),
            ("to_clabe", "clabe", ["clabe_destino", "destino", "dest_clabe", "to_account", "cuenta_destino",
                                    "receiver_clabe", "beneficiary_account", "beneficiario", "clabe_beneficiario"]),
            ("amount", "amount", ["monto", "importe", "value", "amt", "transaction_amount", "cantidad"]),
            ("reference", "freetext", ["referencia", "ref", "concepto", "concepto_pago", "memo", "description"]),
            ("channel", "channel", ["canal", "medio", "tipo", "method", "payment_channel", "instrumento"]),
        )}),
    ("purchase_orders", {
        "syn": ["purchase_order", "po", "pos", "ordenes_compra", "ordenes_de_compra", "orden_compra", "orders",
                "purchasing", "compras", "ordenes"],
        "id": "po_id",
        "core": ["po_id", "vendor_rfc", "date", "amount"],
        "columns": _cols(
            ("po_id", "id", ["id", "order_id", "orden_id", "id_orden", "po_number", "numero_orden", "folio", "po"]),
            ("vendor_rfc", "rfc", ["rfc", "rfc_proveedor", "supplier_rfc", "proveedor", "vendor", "proveedor_rfc"]),
            ("date", "date", ["fecha", "order_date", "fecha_orden", "po_date", "created"]),
            ("amount", "amount", ["monto", "importe", "total", "value", "po_amount", "monto_orden"]),
            ("requester", "person", ["solicitante", "requested_by", "solicito", "requestor", "pedido_por"]),
            ("approver", "person", ["aprobador", "approved_by", "autorizo", "autorizado_por", "aprobado_por", "signer"]),
            ("description", "freetext", ["descripcion", "concepto", "detalle", "memo"]),
        )}),
    ("contracts", {
        "syn": ["contract", "contratos", "contrato", "agreements", "agreement"],
        "id": "contract_id",
        "core": ["contract_id", "vendor_rfc", "start_date"],
        "columns": _cols(
            ("contract_id", "id", ["id", "contrato_id", "id_contrato", "numero_contrato", "contract_number", "folio"]),
            ("vendor_rfc", "rfc", ["rfc", "rfc_proveedor", "supplier_rfc", "proveedor", "vendor", "proveedor_rfc"]),
            ("start_date", "date", ["fecha_inicio", "inicio", "start", "effective_date", "fecha", "date", "begin_date"]),
            ("value", "amount", ["monto", "importe", "valor", "amount", "contract_value", "total"]),
            ("scope_text", "freetext", ["alcance", "scope", "objeto", "descripcion", "description", "objeto_contrato"]),
        )}),
    ("employees", {
        "syn": ["employee", "empleados", "empleado", "staff", "personal", "workers", "nomina", "colaboradores", "hr"],
        "id": "emp_id",
        "core": ["emp_id"],
        "columns": _cols(
            ("emp_id", "emp_id", ["id", "employee_id", "empleado_id", "id_empleado", "numero_empleado", "employee_number",
                                  "empid", "no_empleado"]),
            ("name", "freetext", ["nombre", "full_name", "employee_name", "nombre_completo", "nombre_empleado"]),
            ("role", "freetext", ["puesto", "cargo", "position", "title", "job_title", "rol"]),
            ("bank_clabe", "clabe", ["clabe", "cuenta_clabe", "bank_account", "cuenta", "clabe_interbancaria",
                                      "employee_clabe"]),
            ("hire_date", "date", ["fecha_ingreso", "fecha_contratacion", "hired", "start_date", "ingreso",
                                    "hired_at", "fecha_alta"]),
        )}),
    ("efos_list", {
        "syn": ["efos", "lista_69b", "sat_69b", "blacklist", "efos_69b", "lista_negra", "list_69b", "art69b", "sat_list",
                "listado_69b", "efos_sat"],
        "id": "rfc",
        "core": ["rfc", "status", "publication_date"],
        "columns": _cols(
            ("rfc", "rfc", ["rfc_contribuyente", "tax_id", "taxpayer_rfc", "contribuyente"]),
            ("legal_name", "freetext", ["razon_social", "nombre", "name", "nombre_contribuyente", "taxpayer_name"]),
            ("status", "efos_status", ["estatus", "situacion", "situacion_contribuyente", "estado", "state", "efos_status"]),
            ("publication_date", "date", ["fecha_publicacion", "published", "published_date", "fecha_dof",
                                           "publication", "fecha", "date"]),
        )}),
])

TABLES = list(CANONICAL)

GLOBAL_REQUIRED = [("invoices", c) for c in CANONICAL["invoices"]["core"]]

# lo que cada tipología lee para decidir; sin ello no investiga (se declara, no se adivina)
SCHEME_REQUIRES = OrderedDict([
    ("phantom_vendor", [("vendors", "rfc"), ("invoices", "status"), ("purchase_orders", "po_id"), ("purchase_orders", "vendor_rfc"),
                        ("purchase_orders", "date"), ("purchase_orders", "amount"), ("contracts", "contract_id"),
                        ("contracts", "vendor_rfc"), ("contracts", "start_date")]),
    ("kickback", [("bank_txns", "txn_id"), ("bank_txns", "from_clabe"), ("bank_txns", "to_clabe"),
                  ("bank_txns", "amount"), ("bank_txns", "date"), ("employees", "emp_id"),
                  ("employees", "bank_clabe"), ("vendors", "rfc"), ("vendors", "bank_clabe")]),
    ("round_tripping", [("bank_txns", "txn_id"), ("bank_txns", "from_clabe"), ("bank_txns", "to_clabe"),
                        ("bank_txns", "amount"), ("bank_txns", "date"), ("vendors", "rfc"), ("vendors", "bank_clabe"),
                        ("invoices", "status")]),
    ("threshold_splitting", [("vendors", "rfc"), ("purchase_orders", "po_id"), ("purchase_orders", "vendor_rfc"),
                             ("purchase_orders", "date"), ("purchase_orders", "amount"),
                             ("purchase_orders", "approver"), ("purchase_orders", "requester"),
                             ("contracts", "value")]),
    ("revenue_inflation", [("bank_txns", "txn_id"), ("bank_txns", "from_clabe"), ("bank_txns", "to_clabe"),
                           ("bank_txns", "amount"), ("bank_txns", "date"), ("invoices", "status"),
                           ("invoices", "metodo_pago")]),
])

# relaciones usadas para desempatar y para puntuar (hijo -> padre)
RELATIONS = [
    (("invoices", "issuer_rfc"), ("vendors", "rfc")),
    (("purchase_orders", "vendor_rfc"), ("vendors", "rfc")),
    (("contracts", "vendor_rfc"), ("vendors", "rfc")),
    (("ledger", "invoice_uuid"), ("invoices", "uuid")),
    (("bank_txns", "to_clabe"), ("vendors", "bank_clabe")),
    (("efos_list", "rfc"), ("vendors", "rfc")),
    (("purchase_orders", "approver"), ("employees", "emp_id")),
]


def canonical_ddl() -> str:
    """DDL canónico sin restricciones: la normalización puede producir ids repetidos y eso se reporta,
    no debe abortar la carga. Nombres, orden y tipos salen de estate_schema.sql."""
    types = {"int_id": "INTEGER", "amount": "REAL"}
    out = []
    for t, spec in CANONICAL.items():
        cols = ",\n    ".join(f"{c} {types.get(m['kind'], 'TEXT')}" for c, m in spec["columns"].items())
        out.append(f"CREATE TABLE {t} (\n    {cols}\n);")
    return "\n".join(out)
