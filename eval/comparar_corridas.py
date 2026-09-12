#!/usr/bin/env python3
"""eval/comparar_corridas.py — compara dos corridas aisladas (docs/10).

Responde la única pregunta que importa entre dos iteraciones: ¿bajó la FPR
sobre trampas sin regalar recall? Compara el mismo bloque de métricas para
las dos corridas y marca las regresiones contra las metas de docs/10.

No mezcla corridas (regla 10): lee cada una por separado y las pone lado a
lado. Si las dos no comparten `dataset_hash`, lo dice: comparar métricas
sobre datasets distintos no mide el cambio de reglas, mide el cambio de
datos.

Uso:
    python3 eval/comparar_corridas.py --base gen-v1 --nueva gen-v1-inyectada
    python3 eval/comparar_corridas.py --base <uuid> --nueva <uuid> --json
"""
from __future__ import annotations

import argparse
import json
import os

from metricas import metricas  # mismo directorio

# Metas de docs/10 §Umbrales. Bajar FPR pesa más que subir recall.
METAS = {"fpr_trampas": 0.15, "recall_conservador": 0.65}

REGLAS = ("baseline_dos_pistas", "selector_dos_familias")


def _f(x):
    return None if x is None else float(x)


def _pct(x):
    return "  null" if x is None else "%5.1f%%" % (float(x) * 100)


def _delta(nuevo, base, mejor_alto=True):
    if nuevo is None or base is None:
        return "     —"
    d = float(nuevo) - float(base)
    signo = "+" if d >= 0 else "−"
    bueno = (d > 0) if mejor_alto else (d < 0)
    marca = " " if abs(d) < 1e-9 else ("✓" if bueno else "!")
    return "%s%s%4.1f pp" % (marca, signo, abs(d) * 100)


def comparar(base: dict, nueva: dict) -> list[str]:
    out = []
    cb, cn = base["corrida"], nueva["corrida"]
    out.append("base   %s  %s  hash %s" % (cb["nombre"], cb["corrida_id"], (cb["dataset_hash"] or "")[:16]))
    out.append("nueva  %s  %s  hash %s" % (cn["nombre"], cn["corrida_id"], (cn["dataset_hash"] or "")[:16]))
    if cb["dataset_hash"] != cn["dataset_hash"]:
        out.append("AVISO: distinto dataset_hash. La diferencia mezcla cambio de reglas y")
        out.append("       cambio de datos; no la leas como efecto de las reglas.")
    if cn.get("corrida_origen_id") == cb["corrida_id"]:
        out.append("nueva clonada de base (corrida_origen_id): cohortes comparables.")
    ob, on = base["cohorte"], nueva["cohorte"]
    if (ob["total_fraude"], ob["total_trampas"]) != (on["total_fraude"], on["total_trampas"]):
        out.append("AVISO: cohortes distintas — fraude %s→%s, trampas %s→%s."
                   % (ob["total_fraude"], on["total_fraude"],
                      ob["total_trampas"], on["total_trampas"]))
    out.append("")

    for regla in REGLAS:
        b, n = base["carril_datos"].get(regla), nueva["carril_datos"].get(regla)
        if not b or not n:
            continue
        out.append("── %s" % regla)
        out.append("   %-22s %7s %7s   %s" % ("", "base", "nueva", "delta"))
        filas = [
            ("precisión", _f(b["precision"]), _f(n["precision"]), True),
            ("recall", _f(b["recall"]), _f(n["recall"]), True),
            ("recall conservador", _f(b["recall_conservador"]), _f(n["recall_conservador"]), True),
            ("F1", _f(b["f1"]), _f(n["f1"]), True),
            ("FPR sobre trampas", _f(b["fpr_trampas"]["fpr"]), _f(n["fpr_trampas"]["fpr"]), False),
        ]
        for nombre, vb, vn, alto in filas:
            out.append("   %-22s %7s %7s   %s" % (nombre, _pct(vb), _pct(vn), _delta(vn, vb, alto)))
        out.append("   %-22s %7s %7s" % ("trampas marcadas",
                                         b["fpr_trampas"]["texto"], n["fpr_trampas"]["texto"]))
        avisos = []
        if _f(n["fpr_trampas"]["fpr"]) is not None and _f(n["fpr_trampas"]["fpr"]) > METAS["fpr_trampas"]:
            avisos.append("FPR sobre trampas por encima de la meta (%.0f%%)" % (METAS["fpr_trampas"] * 100))
        if _f(n["recall_conservador"]) is not None and _f(n["recall_conservador"]) < METAS["recall_conservador"]:
            avisos.append("recall conservador por debajo de la meta (%.0f%%)" % (METAS["recall_conservador"] * 100))
        for a in avisos:
            out.append("   META: " + a)
        out.append("")

    ab, an = base.get("agente") or {}, nueva.get("agente") or {}
    cb_casos = (ab.get("operacion") or {}).get("casos") or 0
    cn_casos = (an.get("operacion") or {}).get("casos") or 0
    out.append("── agentes (dictámenes persistidos)")
    if not cb_casos and not cn_casos:
        out.append("   ninguna de las dos corridas tiene casos: sin métricas de dictamen.")
    else:
        for etiqueta, a in (("base", ab), ("nueva", an)):
            sel = a.get("selectivas", {})
            e2e = a.get("extremo_a_extremo", {})
            fpr = a.get("fpr_trampas", {})
            cob = a.get("cobertura", {})
            out.append("   %-6s casos %-4s recall conservador %s  FPR %s  cobertura %s"
                       % (etiqueta, (a.get("operacion") or {}).get("casos"),
                          _pct(_f(e2e.get("recall_conservador"))),
                          fpr.get("texto") or "—", _pct(_f(cob.get("ratio")))))
            out.append("          precisión %s recall %s F1 %s"
                       % (_pct(_f(sel.get("precision"))), _pct(_f(sel.get("recall"))),
                          _pct(_f(sel.get("f1")))))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Compara dos corridas (docs/10)")
    ap.add_argument("--base", required=True)
    ap.add_argument("--nueva", required=True)
    ap.add_argument("--db", default=os.environ.get("PGDATABASE", "forense"))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    base, nueva = metricas(a.base, a.db), metricas(a.nueva, a.db)
    if a.json:
        print(json.dumps({"base": base, "nueva": nueva}, indent=2, ensure_ascii=False))
    else:
        print("\n".join(comparar(base, nueva)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
