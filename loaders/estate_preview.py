#!/usr/bin/env python3
"""Preview de solo lectura de un estate SQLite para la tabla tipo hoja de cálculo de la UI.

    python3 loaders/estate_preview.py <estate.db> <tabla> <offset> <limit>

Imprime JSON: conteo por tabla del esquema de los jueces y una página de filas de la tabla
pedida. Abre la base con mode=ro; la tabla sale de una lista cerrada, nunca se interpola
texto del cliente en el SQL.
"""
from __future__ import annotations

import json
import sqlite3
import sys

TABLAS = ["vendors", "invoices", "ledger", "bank_txns", "purchase_orders", "contracts", "employees", "efos_list"]
MAX_LIMIT = 500


def main() -> int:
    if len(sys.argv) != 5:
        print("uso: estate_preview.py <estate.db> <tabla> <offset> <limit>", file=sys.stderr)
        return 2
    ruta, tabla = sys.argv[1], sys.argv[2]
    offset, limit = max(0, int(sys.argv[3])), min(MAX_LIMIT, max(1, int(sys.argv[4])))
    if tabla not in TABLAS:
        print(f"tabla no permitida: {tabla}", file=sys.stderr)
        return 2
    conn = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
    existentes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    tablas = [{"nombre": t, "filas": conn.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]}
              for t in TABLAS if t in existentes]
    columnas: list[str] = []
    filas: list[list] = []
    total = 0
    if tabla in existentes:
        cur = conn.execute(f'SELECT * FROM "{tabla}" LIMIT ? OFFSET ?', (limit, offset))
        columnas = [c[0] for c in cur.description]
        filas = [list(r) for r in cur.fetchall()]
        total = next(t["filas"] for t in tablas if t["nombre"] == tabla)
    conn.close()
    print(json.dumps({"tablas": tablas, "tabla": tabla, "columnas": columnas, "filas": filas,
                      "total": total, "offset": offset, "limit": limit}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
