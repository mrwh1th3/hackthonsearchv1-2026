#!/usr/bin/env python3
"""Adaptador del estate SQLite de jueces (spec/forensic-auditor/estate_schema.sql) al
esquema `forense`. Cada estate queda como una corrida en estado `lista`.

    python3 loaders/forensic_to_forense.py <estate.db> [<estate.db> ...] [--seed N] [--nombre TEXTO]
    python3 loaders/forensic_to_forense.py data/forensic/test_sets/seed_40{1,2,3,4,5}/estate.db

Flujo, todo en una transacción:
1. Valida el estate: las 8 tablas y cada columna del spec. Si falta algo se detiene.
2. Carga:
   vendors + RFC de facturas → contribuyentes
   CLABE de proveedores, empleados y empresa → cuentas
   invoices → cfdi
   bank_txns → movimientos
   efos_list → listas_sat
   employees → empleados
   ledger → polizas
   purchase_orders → ordenes_compra
   contracts → contratos
3. Conserva cada id original (INV-…, BNK-…, entry_id, EMP:…) en `id_origen` o en la
   llave de la tabla nueva: los exhibits citan esos ids tal cual.
4. Compara los conteos cargados contra el SQLite. Si difieren, revierte todo.
5. Deja `corrida_cargada` en la bitácora.

Si el mismo estate (seed + sha256) ya está cargado como corrida `lista`, no se toca: se
reutiliza para no borrar sus investigaciones. `--recargar` fuerza el borrado y la recarga.

La clave de evaluación nunca se carga: forense.ground_truth queda vacía para estas corridas.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from forensic_to_supabase import db_url, lit  # noqa: E402

NS = uuid.UUID("6f1c9d2e-0000-4000-8000-0000000f0a01")
SPEC = ROOT / "spec" / "forensic-auditor" / "estate_schema.sql"
BANCOS = {"002": "Banamex", "012": "BBVA", "014": "Santander", "021": "HSBC", "030": "Bajío", "036": "Inbursa",
          "044": "Scotiabank", "058": "Banregio", "072": "Banorte", "127": "Azteca", "137": "BanCoppel"}
LOTE = 500


class EstateInvalido(Exception):
    pass


def spec_columnas() -> dict[str, list[str]]:
    """Tablas y columnas exigidas, leídas del spec (no de una copia a mano)."""
    out: dict[str, list[str]] = {}
    for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", SPEC.read_text(), re.S):
        cols = [ln.strip().split()[0] for ln in m.group(2).splitlines() if ln.strip() and not ln.strip().startswith("--")]
        out[m.group(1)] = cols
    return out


def validar(conn: sqlite3.Connection) -> None:
    errores = []
    tablas = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for t, cols in spec_columnas().items():
        if t not in tablas:
            errores.append(f"falta la tabla {t}")
            continue
        tiene = {r[1] for r in conn.execute(f"PRAGMA table_info({t})")}
        faltan = [c for c in cols if c not in tiene]
        if faltan:
            errores.append(f"{t}: faltan columnas {', '.join(faltan)}")
    if errores:
        raise EstateInvalido("; ".join(errores))


def filas(conn: sqlite3.Connection, sql: str) -> list[dict]:
    cur = conn.execute(sql)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def ts(fecha: str | None) -> str:
    return "NULL" if not fecha else lit(f"{str(fecha)[:10]}T12:00:00-06:00")


def num(v) -> str:
    return "NULL" if v is None or v == "" else repr(float(v))


def insertar(tabla: str, columnas: str, valores: list[str]) -> list[str]:
    return [f"INSERT INTO forense.{tabla} ({columnas}) VALUES\n" + ",\n".join(valores[i:i + LOTE]) + ";"
            for i in range(0, len(valores), LOTE)]


def uuid_cfdi(seed: int, id_origen: str) -> str:
    try:
        return str(uuid.UUID(id_origen))
    except ValueError:
        return str(uuid.uuid5(NS, f"inv:{seed}:{id_origen}"))


def corrida_id(seed: int, digest: str) -> str:
    return str(uuid.uuid5(NS, f"corrida:{seed}:{digest}"))


def seed_de(path: Path) -> int:
    m = re.search(r"(\d+)$", path.parent.name) or re.search(r"(\d+)", path.stem)
    return int(m.group(1)) if m else 0


def estate_sql(db: Path, seed: int, nombre: str | None) -> tuple[str, str, dict]:
    digest = hashlib.sha256(db.read_bytes()).hexdigest()
    cid = corrida_id(seed, digest)
    dataset = f"forensic-estate-{seed}-{digest[:8]}"
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    validar(conn)
    vendors = filas(conn, "SELECT * FROM vendors ORDER BY rfc")
    invoices = filas(conn, "SELECT * FROM invoices ORDER BY issue_date, uuid")
    txns = filas(conn, "SELECT * FROM bank_txns ORDER BY date, txn_id")
    employees = filas(conn, "SELECT * FROM employees ORDER BY emp_id")
    efos = filas(conn, "SELECT * FROM efos_list ORDER BY rfc")
    ledger = filas(conn, "SELECT * FROM ledger ORDER BY entry_id")
    pos = filas(conn, "SELECT * FROM purchase_orders ORDER BY date, po_id")
    contracts = filas(conn, "SELECT * FROM contracts ORDER BY contract_id")
    conn.close()
    if not invoices:
        raise EstateInvalido("invoices está vacía: no se puede inferir la empresa auditada")
    if any(r["entry_id"] is None for r in ledger):
        raise EstateInvalido("ledger.entry_id vacío en alguna fila; forense.polizas.entry_id es obligatorio")
    no_enteros = [r["entry_id"] for r in ledger if not re.fullmatch(r"-?\d+", str(r["entry_id"]).strip())]
    if no_enteros:
        raise EstateInvalido(f"ledger.entry_id no numérico en {len(no_enteros)} fila(s) (p. ej. {no_enteros[0]!r}); "
                             "forense.polizas.entry_id es entero y el id original se conserva tal cual")

    vrfc = {v["rfc"] for v in vendors}
    menciones: dict[str, int] = {}
    for i in invoices:
        for r in (i["issuer_rfc"], i["receiver_rfc"]):
            if r:
                menciones[r] = menciones.get(r, 0) + 1
    empresa = max((r for r in menciones if r not in vrfc), key=lambda r: (menciones[r], r), default="")
    conteos = {"contribuyentes": 0, "cuentas": 0, "cfdi": len(invoices), "movimientos": len(txns),
               "listas_sat": len(efos), "empleados": len(employees), "polizas": len(ledger),
               "ordenes_compra": len(pos), "contratos": len(contracts)}
    nombre = nombre or f"Estate jueces · seed {seed}"
    fecha_corte = max((t["date"] for t in txns if t["date"]), default=invoices[-1]["issue_date"])

    sql = [f"DELETE FROM forense.corridas WHERE id = {lit(cid)};",
           "INSERT INTO forense.corridas (id, nombre, dataset, dataset_hash, fecha_corte, inicio, estado, modo, version_reglas, "
           f"notas, idempotency_key) VALUES ({lit(cid)}, {lit(nombre)}, {lit(dataset)}, {lit(digest)}, "
           f"{lit(str(fecha_corte)[:10] + 'T23:59:59-06:00')}, {ts(invoices[0]['issue_date'])}, 'preparando', 'fiscal', 'forensic-auditor-v1', "
           f"{lit(f'Estate SQLite {db.name} ({SPEC.name}). Empresa auditada inferida: {empresa}.')}, "
           f"{lit(f'{dataset}')});"]

    contrib = [f"({lit(cid)}, {lit(v['rfc'])}, {lit(v['legal_name'])}, {lit(v['category'])}, 'moral', "
               f"{lit(str(v['registered_date'] or '')[:10])}, {lit(v['address'])}, {lit(v['contact_email'])})" for v in vendors]
    if empresa:
        contrib.append(f"({lit(cid)}, {lit(empresa)}, 'Empresa auditada', NULL, 'moral', NULL, NULL, NULL)")
    for r in sorted(set(menciones) - vrfc - {empresa}):
        contrib.append(f"({lit(cid)}, {lit(r)}, NULL, 'Cliente', 'moral', NULL, NULL, NULL)")
    conteos["contribuyentes"] = len(contrib)
    sql += insertar("contribuyentes", "corrida_id, rfc, razon_social, giro, tipo_persona, fecha_alta, domicilio, email", contrib)

    pagos_a_proveedor: dict[str, int] = {}
    vclabes = {v["bank_clabe"] for v in vendors if v["bank_clabe"]}
    for t in txns:
        if t["to_clabe"] in vclabes and t["from_clabe"] not in vclabes:
            pagos_a_proveedor[t["from_clabe"]] = pagos_a_proveedor.get(t["from_clabe"], 0) + 1
    cuentas: dict[str, tuple[str, str]] = {}
    for v in vendors:
        if v["bank_clabe"]:
            cuentas[v["bank_clabe"]] = (v["rfc"], "proveedor")
    for e in employees:
        if e["bank_clabe"]:
            cuentas[e["bank_clabe"]] = (e["emp_id"], "empleado")
    if pagos_a_proveedor and empresa:
        tope = max(pagos_a_proveedor.values())
        for c, n in pagos_a_proveedor.items():
            if n >= max(3, tope * 0.2):
                cuentas[c] = (empresa, "empresa")
    conteos["cuentas"] = len(cuentas)
    sql += insertar("cuentas", "corrida_id, clabe, rfc_titular, banco, tipo, moneda",
                    [f"({lit(cid)}, {lit(k)}, {lit(o)}, {lit(BANCOS.get(k[:3], k[:3]))}, {lit(tp)}, 'MXN')"
                     for k, (o, tp) in sorted(cuentas.items())])

    sql += insertar("cfdi", "corrida_id, uuid, id_origen, tipo, emisor_rfc, receptor_rfc, fecha, subtotal, iva, total, moneda, "
                            "metodo_pago, forma_pago, uso_cfdi, descripcion, cancelado",
                    [f"({lit(cid)}, {lit(uuid_cfdi(seed, str(i['uuid'])))}, {lit(str(i['uuid']))}, 'I', {lit(i['issuer_rfc'])}, "
                     f"{lit(i['receiver_rfc'])}, {ts(i['issue_date'])}, {num(i['subtotal'])}, {num(i['iva'])}, {num(i['total'])}, "
                     f"'MXN', {lit(i['metodo_pago'])}, {lit(i['forma_pago'])}, {lit(i['uso_cfdi'])}, {lit(i['concepto_text'])}, "
                     f"{'true' if str(i['status']).lower() == 'cancelado' else 'false'})" for i in invoices])

    sql += insertar("movimientos", "corrida_id, id, id_origen, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, canal, referencia",
                    [f"({lit(cid)}, {n}, {lit(str(t['txn_id']))}, {lit(t['from_clabe'])}, {lit(t['to_clabe'])}, {ts(t['date'])}, "
                     f"{num(t['amount'])}, 'MXN', 'transferencia', {lit(t['channel'])}, {lit(t['reference'])})"
                     for n, t in enumerate(txns, start=1)])

    if efos:
        sql += insertar("listas_sat", "corrida_id, rfc, lista, estatus, fecha_publicacion, razon_social",
                        [f"({lit(cid)}, {lit(e['rfc'])}, '69-B', {lit(e['status'])}, {lit(str(e['publication_date'])[:10])}, "
                         f"{lit(e['legal_name'])})" for e in efos])
    if employees:
        sql += insertar("empleados", "corrida_id, emp_id, nombre, puesto, clabe, fecha_alta",
                        [f"({lit(cid)}, {lit(str(e['emp_id']))}, {lit(e['name'])}, {lit(e['role'])}, {lit(e['bank_clabe'])}, "
                         f"{lit(str(e['hire_date'] or '')[:10])})" for e in employees])
    if ledger:
        sql += insertar("polizas", "corrida_id, entry_id, fecha, cuenta_codigo, cuenta_nombre, cargo, abono, descripcion, "
                                   "cfdi_id_origen, centro_costo, aprobador",
                        [f"({lit(cid)}, {int(r['entry_id'])}, {lit(str(r['date'] or '')[:10])}, {lit(r['account_code'])}, "
                         f"{lit(r['account_name'])}, {num(r['debit'] or 0)}, {num(r['credit'] or 0)}, {lit(r['description'])}, "
                         f"{lit(r['invoice_uuid'])}, {lit(r['cost_center'])}, {lit(r['approver'])})" for r in ledger])
    if pos:
        sql += insertar("ordenes_compra", "corrida_id, po_id, proveedor_rfc, fecha, monto, solicitante, aprobador, descripcion",
                        [f"({lit(cid)}, {lit(str(p['po_id']))}, {lit(p['vendor_rfc'])}, {lit(str(p['date'] or '')[:10])}, "
                         f"{num(p['amount'])}, {lit(p['requester'])}, {lit(p['approver'])}, {lit(p['description'])})" for p in pos])
    if contracts:
        sql += insertar("contratos", "corrida_id, contract_id, proveedor_rfc, fecha_inicio, valor, alcance",
                        [f"({lit(cid)}, {lit(str(c['contract_id']))}, {lit(c['vendor_rfc'])}, {lit(str(c['start_date'] or '')[:10])}, "
                         f"{num(c['value'])}, {lit(c['scope_text'])})" for c in contracts])

    # Validar el snapshot cargado contra el SQLite antes de marcarlo `lista`.
    checks = " OR ".join(f"(SELECT count(*) FROM forense.{t} WHERE corrida_id = {lit(cid)}) <> {n}" for t, n in conteos.items())
    sql.append(f"DO $$ BEGIN IF {checks} THEN RAISE EXCEPTION 'conteos cargados no coinciden con el estate {db.name}'; "
               f"END IF; END $$;")
    sql.append(f"UPDATE forense.corridas SET estado = 'lista' WHERE id = {lit(cid)};")
    payload = {"loader": "forensic_to_forense", "estate": db.name, "sha256": digest, "seed": seed,
               "empresa_rfc": empresa, "conteos": conteos, "ground_truth_cargado": False}
    sql.append(f"INSERT INTO forense.bitacora (corrida_id, agente, tipo_evento, payload) VALUES ({lit(cid)}, 'loader', "
               f"'corrida_cargada', {lit(json.dumps(payload, ensure_ascii=False))}::jsonb);")
    return cid, "\n".join(sql), conteos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("estates", nargs="+")
    ap.add_argument("--seed", type=int, help="por omisión se toma del nombre de la carpeta (seed_401 → 401)")
    ap.add_argument("--nombre", help="nombre visible de la corrida (solo con un estate)")
    ap.add_argument("--dry-run", action="store_true", help="valida y escribe el SQL a stdout sin cargar")
    ap.add_argument("--recargar", action="store_true",
                    help="borra y recarga la corrida aunque ya exista (se lleva sus investigaciones en cascada)")
    a = ap.parse_args()
    if a.nombre and len(a.estates) > 1:
        ap.error("--nombre solo aplica a un estate")
    partes, resumen, existentes = ["BEGIN;"], [], []
    for e in a.estates:
        db = Path(e).resolve()
        if not db.is_file():
            print(f"FAIL {e}: no existe", file=sys.stderr)
            return 2
        seed = a.seed if a.seed is not None else seed_de(db)
        if not (a.recargar or a.dry_run):
            # El mismo estate ya cargado se reutiliza: recargarlo borraría en cascada las
            # investigaciones previas de la corrida. Cada "Inspeccionar" abre una nueva sobre ella.
            cid = corrida_id(seed, hashlib.sha256(db.read_bytes()).hexdigest())
            r = subprocess.run(["psql", db_url(), "-v", "ON_ERROR_STOP=1", "-At", "-c",
                                f"SELECT estado FROM forense.corridas WHERE id = {lit(cid)};"], text=True, capture_output=True)
            if r.returncode:
                sys.stderr.write(r.stderr[-3000:])
                return r.returncode
            if r.stdout.strip() == "lista":
                existentes.append(cid)
                continue
        nombre = a.nombre or (f"Prueba jueces · seed {seed} · 4 fraudes / 6 anomalías" if "test_sets" in db.parts else None)
        try:
            cid, sql, conteos = estate_sql(db, seed, nombre)
        except EstateInvalido as err:
            print(f"FAIL {e}: {err}", file=sys.stderr)
            return 2
        partes.append(sql)
        resumen.append((cid, seed, conteos))
    partes.append("COMMIT;")
    if a.dry_run:
        sys.stdout.write("\n".join(partes))
        return 0
    for cid in existentes:
        print(f"{cid} ya_cargada")
    if not resumen:
        return 0
    r = subprocess.run(["psql", db_url(), "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input="\n".join(partes),
                       text=True, capture_output=True)
    if r.returncode:
        sys.stderr.write(r.stderr[-3000:])
        return r.returncode
    for cid, seed, conteos in resumen:
        print(f"{cid} seed={seed} " + " ".join(f"{k}={v}" for k, v in conteos.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
