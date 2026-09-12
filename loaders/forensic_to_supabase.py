#!/usr/bin/env python3
"""Sube estates Forensic Auditor (SQLite) a Supabase, schema public, una fila por registro
con `dataset_id`. Las claves de evaluación NO se suben: quedan solo en data/forensic/keys/.

    python3 loaders/forensic_to_supabase.py data/forensic/test_sets/seed_401/estate.db ...

Escribe el SQL a stdout con --dry-run; si no, lo aplica con psql usando SUPABASE_DB_URL de .env."""
from __future__ import annotations

import argparse
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DDL = """
CREATE TABLE IF NOT EXISTS public.estate_datasets (
  dataset_id text PRIMARY KEY, seed int, description text, source_file text,
  vendors int, invoices int, ledger int, bank_txns int, purchase_orders int,
  contracts int, employees int, efos_list int, loaded_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.vendors (dataset_id text REFERENCES public.estate_datasets ON DELETE CASCADE,
  rfc text, legal_name text, registered_date date, address text, bank_clabe text, category text, contact_email text,
  PRIMARY KEY (dataset_id, rfc));
CREATE TABLE IF NOT EXISTS public.invoices (dataset_id text REFERENCES public.estate_datasets ON DELETE CASCADE,
  uuid text, issuer_rfc text, receiver_rfc text, issue_date date, subtotal numeric(14,2), iva numeric(14,2),
  total numeric(14,2), concepto_text text, uso_cfdi text, forma_pago text, metodo_pago text, status text,
  PRIMARY KEY (dataset_id, uuid));
CREATE TABLE IF NOT EXISTS public.ledger (dataset_id text REFERENCES public.estate_datasets ON DELETE CASCADE,
  entry_id int, date date, account_code text, account_name text, debit numeric(14,2), credit numeric(14,2),
  description text, invoice_uuid text, cost_center text, approver text, PRIMARY KEY (dataset_id, entry_id));
CREATE TABLE IF NOT EXISTS public.bank_txns (dataset_id text REFERENCES public.estate_datasets ON DELETE CASCADE,
  txn_id text, date date, from_clabe text, to_clabe text, amount numeric(14,2), reference text, channel text,
  PRIMARY KEY (dataset_id, txn_id));
CREATE TABLE IF NOT EXISTS public.purchase_orders (dataset_id text REFERENCES public.estate_datasets ON DELETE CASCADE,
  po_id text, vendor_rfc text, date date, amount numeric(14,2), requester text, approver text, description text,
  PRIMARY KEY (dataset_id, po_id));
CREATE TABLE IF NOT EXISTS public.contracts (dataset_id text REFERENCES public.estate_datasets ON DELETE CASCADE,
  contract_id text, vendor_rfc text, start_date date, value numeric(14,2), scope_text text,
  PRIMARY KEY (dataset_id, contract_id));
CREATE TABLE IF NOT EXISTS public.employees (dataset_id text REFERENCES public.estate_datasets ON DELETE CASCADE,
  emp_id text, name text, role text, bank_clabe text, hire_date date, PRIMARY KEY (dataset_id, emp_id));
CREATE TABLE IF NOT EXISTS public.efos_list (dataset_id text REFERENCES public.estate_datasets ON DELETE CASCADE,
  rfc text, legal_name text, status text, publication_date date, PRIMARY KEY (dataset_id, rfc));
"""
TABLES = ["vendors", "invoices", "ledger", "bank_txns", "purchase_orders", "contracts", "employees", "efos_list"]


def lit(v) -> str:
    if v is None or v == "":
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def dataset_sql(db: Path, dataset_id: str, seed: int, description: str) -> str:
    conn = sqlite3.connect(db)
    counts = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLES}
    out = [f"DELETE FROM public.estate_datasets WHERE dataset_id = {lit(dataset_id)};",
           "INSERT INTO public.estate_datasets (dataset_id, seed, description, source_file, "
           + ", ".join(TABLES) + f") VALUES ({lit(dataset_id)}, {seed}, {lit(description)}, "
           f"{lit(str(db.relative_to(ROOT)))}, " + ", ".join(str(counts[t]) for t in TABLES) + ");"]
    for t in TABLES:
        cur = conn.execute(f"SELECT * FROM {t}")
        cols = [c[0] for c in cur.description]
        rows = cur.fetchall()
        for i in range(0, len(rows), 500):
            vals = ",\n".join("(" + ", ".join([lit(dataset_id)] + [lit(v) for v in r]) + ")" for r in rows[i:i + 500])
            out.append(f"INSERT INTO public.{t} (dataset_id, {', '.join(cols)}) VALUES\n{vals};")
    conn.close()
    return "\n".join(out)


def db_url() -> str:
    if os.environ.get("SUPABASE_DB_URL"):
        return os.environ["SUPABASE_DB_URL"]
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("SUPABASE_DB_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("SUPABASE_DB_URL not set")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("estates", nargs="+")
    ap.add_argument("--description", default="Forensic Auditor test set: 4 fraud schemes, 6 non-fraud anomalies")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    parts = ["BEGIN;", DDL]
    for t in ["estate_datasets"] + TABLES:
        parts.append(f"ALTER TABLE public.{t} ENABLE ROW LEVEL SECURITY;")
    for e in a.estates:
        p = Path(e).resolve()
        seed = int(p.parent.name.split("_")[-1])
        parts.append(dataset_sql(p, f"test_seed_{seed}", seed, a.description))
    parts.append("COMMIT;")
    sql = "\n".join(parts)
    if a.dry_run:
        sys.stdout.write(sql)
        return 0
    r = subprocess.run(["psql", db_url(), "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, text=True,
                       capture_output=True)
    if r.returncode:
        sys.stderr.write(r.stderr[-2000:])
        return r.returncode
    print(f"loaded {len(a.estates)} datasets into public.*")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
