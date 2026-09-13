"""Ciclos de dinero en el grafo de CLABEs.

Un round-trip disfrazado sale de una cuenta de la empresa como pago a un proveedor registrado,
pasa por uno o más terceros y vuelve a una cuenta de la empresa, perdiendo poco en cada salto y
en pocas semanas. Se buscan ciclos de 3 a `ROUND_TRIP_MAX_HOPS` transferencias; el ciclo directo
de 2 (empresa → proveedor → empresa) lo evalúa el investigador con sus propias reglas.

Exclusiones estructurales:
  * el primer salto debe llegar a la CLABE de un proveedor del padrón (un traspaso entre cuentas
    propias nunca abre ciclo, porque la cuenta destino es de la empresa);
  * ningún nodo intermedio puede ser cuenta de la empresa;
  * cada salto conserva entre `ROUND_TRIP_HOP_MIN_RATIO` y 100% del anterior y ocurre después de él.
Solo se usan montos, fechas y CLABEs: la referencia bancaria no participa."""
from __future__ import annotations

from collections import defaultdict

from .config import ROUND_TRIP_CHAIN_MAX_DAYS, ROUND_TRIP_HOP_MIN_RATIO, ROUND_TRIP_MAX_HOPS
from .estate import Estate, days_between


def money_cycles(e: Estate) -> list[list[dict]]:
    own = e.company_clabes
    vendor_clabes = {v["bank_clabe"] for v in e.vendors.values() if v.get("bank_clabe")}
    txns = [dict(r) for r in e.q("SELECT * FROM bank_txns ORDER BY date, txn_id")]
    by_from = defaultdict(list)
    for t in txns:
        by_from[t["from_clabe"]].append(t)

    found: list[list[dict]] = []

    def walk(path: list[dict], nodes: set[str]):
        last, first = path[-1], path[0]
        for nxt in by_from.get(last["to_clabe"], []):
            if nxt["date"] < last["date"] or days_between(first["date"], nxt["date"]) > ROUND_TRIP_CHAIN_MAX_DAYS:
                continue
            if not last["amount"] or not (ROUND_TRIP_HOP_MIN_RATIO <= nxt["amount"] / last["amount"] <= 1.0):
                continue
            if nxt["to_clabe"] in own:
                if len(path) + 1 >= 3:
                    found.append(path + [nxt])
                continue
            if nxt["to_clabe"] in nodes or len(path) + 1 >= ROUND_TRIP_MAX_HOPS:
                continue
            walk(path + [nxt], nodes | {nxt["to_clabe"]})

    for t in txns:
        if t["from_clabe"] in own and t["to_clabe"] in vendor_clabes and t["to_clabe"] not in own:
            walk([t], {t["from_clabe"], t["to_clabe"]})

    # Sin reutilizar transferencias: priorizar el cierre temporal del ciclo antes
    # que sus IDs. Un ID lexicográficamente menor en un pago posterior no debe
    # enlazar una salida antigua con el retorno de una operación posterior y
    # consumir ambos ciclos. Los IDs sólo desempatan recorridos con iguales fechas.
    found.sort(key=lambda c: (len(c), c[0]["date"], c[-1]["date"],
                              tuple(x["date"] for x in c[1:-1]),
                              tuple(x["txn_id"] for x in c)))
    used: set[str] = set()
    out = []
    for c in found:
        ids = {x["txn_id"] for x in c}
        if ids & used:
            continue
        used |= ids
        out.append(c)
    return out
