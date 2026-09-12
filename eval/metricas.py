#!/usr/bin/env python3
"""eval/metricas.py — métricas de una corrida sobre el carril de datos (docs/10).

Calcula las métricas que NO dependen de que los agentes hayan investigado:

  * baseline_dos_pistas   — "positivo = todo RFC con >=2 pistas disparadas,
                             sin agentes" (docs/10 §Baseline). Es la regla
                             base explícita contra la que se compara.
  * selector_dos_familias — el selector determinista de forense.score_entidad,
                             que exige dos familias distintas. Aísla cuánto
                             aporta exigir familias en vez de contar pistas.
  * agente                — forense.v_metricas_corrida(), que mide los
                             dictámenes ya persistidos. Si la corrida todavía
                             no tiene casos, sus cocientes salen en null: un
                             denominador cero NUNCA se publica como 0%.

Reglas que el script respeta y que no son negociables (docs/10):
  - Denominador cero => null, nunca un 0% ficticio.
  - El recall conservador usa el total de RFC de fraude como denominador:
    un fraude que no se investigó cuenta como FN.
  - La FPR sobre trampas se publica con numerador y denominador visibles
    ("1/8"), más el rango [FP/N, (FP+sin_conclusion)/N] mientras haya
    trampas sin conclusión.
  - Nada de esto toca la corrida: solo lee.

Uso:
    python3 eval/metricas.py --corrida gen-v1
    python3 eval/metricas.py --corrida gen-v1 --json
    PGDATABASE=forense_test_123 python3 eval/metricas.py --corrida gen-v1

No requiere dependencias: habla con Postgres por `psql`.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

PSQL = os.environ.get("PSQL") or shutil.which("psql") or "/opt/homebrew/opt/postgresql@17/bin/psql"

# ---------------------------------------------------------------------------
# SQL. Una sola consulta, un solo jsonb: lo que se mide es exactamente lo que
# el script imprime, sin post-proceso en Python que pueda divergir del SQL.
# ---------------------------------------------------------------------------
SQL_CARRIL = r"""
set search_path = '';
with corrida as (
  select id, nombre, dataset, dataset_hash, fecha_corte, corrida_origen_id,
         version_prompts, version_reglas, estado
    from forense.corridas
   where id::text = %(clave)s or nombre = %(clave)s
   limit 1
),
gt as (
  select g.rfc, g.es_fraude, g.es_trampa_legitima, g.tipologia
    from forense.ground_truth g, corrida c
   where g.corrida_id = c.id
),
-- Pistas realmente disparadas: las marcadas `no_evaluable` declaran una
-- limitación, no una señal, y no pueden sumar al baseline.
disparadas as (
  select p.rfc, p.codigo, p.familia, p.score
    from forense.pistas p, corrida c
   where p.corrida_id = c.id
     and coalesce(p.estado, 'abierta') <> 'no_evaluable'
),
base_rfc as (
  select rfc, count(distinct codigo) as n_pistas, count(distinct familia) as n_familias
    from disparadas group by rfc
),
baseline as (            -- >=2 pistas disparadas
  select rfc from base_rfc where n_pistas >= 2
),
selector as (            -- selector determinista de 003/005
  select s.rfc from corrida c, forense.score_entidad(c.id) s
),
-- Matriz de confusión de una regla determinista: no hay `sin_conclusion`,
-- toda la cohorte recibe predicción, así que el recall selectivo y el
-- conservador coinciden. Se publican los dos igual, con nombres distintos.
m as (
  select 'baseline_dos_pistas'::text as regla, g.rfc, g.es_fraude, g.es_trampa_legitima,
         (g.rfc in (select rfc from baseline)) as positivo from gt g
  union all
  select 'selector_dos_familias', g.rfc, g.es_fraude, g.es_trampa_legitima,
         (g.rfc in (select rfc from selector)) from gt g
),
agg as (
  select regla,
         count(*) as n,
         count(*) filter (where es_fraude) as n_fraude,
         count(*) filter (where es_trampa_legitima) as n_trampas,
         count(*) filter (where positivo and es_fraude) as tp,
         count(*) filter (where positivo and not es_fraude) as fp,
         count(*) filter (where not positivo and es_fraude) as fn,
         count(*) filter (where not positivo and not es_fraude) as tn,
         count(*) filter (where positivo and es_trampa_legitima) as trampas_fp
    from m group by regla
),
por_tipologia as (
  select regla, jsonb_object_agg(tipologia, jsonb_build_object(
           'n', n, 'detectados', det,
           'recall', case when n > 0 then round(det::numeric / n, 4) end)) as j
    from (
      select m.regla, coalesce(g.tipologia, 'sin_tipologia') as tipologia,
             count(*) as n, count(*) filter (where m.positivo) as det
        from m join gt g on g.rfc = m.rfc
       where m.es_fraude
       group by 1, 2
    ) t group by regla
)
select jsonb_build_object(
  'corrida', (select jsonb_build_object(
      'corrida_id', c.id, 'nombre', c.nombre, 'dataset', c.dataset,
      'dataset_hash', c.dataset_hash, 'fecha_corte', c.fecha_corte,
      'corrida_origen_id', c.corrida_origen_id, 'version_prompts', c.version_prompts,
      'version_reglas', c.version_reglas, 'estado', c.estado) from corrida c),
  'cohorte', (select jsonb_build_object(
      'total_ground_truth', count(*),
      'total_fraude', count(*) filter (where es_fraude),
      'total_trampas', count(*) filter (where es_trampa_legitima)) from gt),
  'pistas', (select jsonb_build_object(
      'filas', count(*), 'rfcs', count(distinct rfc),
      'por_codigo', coalesce(jsonb_object_agg(codigo, n order by codigo), '{}'::jsonb))
      from (select codigo, rfc, count(*) over (partition by codigo) as n
              from disparadas) z),
  'no_evaluables', (select coalesce(jsonb_agg(distinct p.codigo order by p.codigo), '[]'::jsonb)
      from forense.pistas p, corrida c
     where p.corrida_id = c.id and p.estado = 'no_evaluable'),
  'carril_datos', (select jsonb_object_agg(a.regla, jsonb_build_object(
      'tp', a.tp, 'fp', a.fp, 'fn_selectivo', a.fn, 'tn', a.tn,
      'precision', case when (a.tp + a.fp) > 0 then round(a.tp::numeric / (a.tp + a.fp), 4) end,
      'recall',    case when (a.tp + a.fn) > 0 then round(a.tp::numeric / (a.tp + a.fn), 4) end,
      'f1', case when (2 * a.tp + a.fp + a.fn) > 0
                 then round((2.0 * a.tp) / (2 * a.tp + a.fp + a.fn), 4) end,
      'fn_conservador', a.n_fraude - a.tp,
      'recall_conservador', case when a.n_fraude > 0
                                 then round(a.tp::numeric / a.n_fraude, 4) end,
      'cobertura', jsonb_build_object('concluyentes', a.n, 'ratio', 1.0,
        'nota', 'una regla determinista concluye sobre toda la cohorte'),
      'fpr_trampas', jsonb_build_object(
        'fp', a.trampas_fp, 'n', a.n_trampas,
        'sin_conclusion', 0,
        'texto', case when a.n_trampas > 0
                      then a.trampas_fp::text || '/' || a.n_trampas::text end,
        'fpr', case when a.n_trampas > 0
                    then round(a.trampas_fp::numeric / a.n_trampas, 4) end,
        'rango_min', case when a.n_trampas > 0
                          then round(a.trampas_fp::numeric / a.n_trampas, 4) end,
        'rango_max', case when a.n_trampas > 0
                          then round(a.trampas_fp::numeric / a.n_trampas, 4) end),
      'recall_por_tipologia', coalesce(pt.j, '{}'::jsonb)))
      from agg a left join por_tipologia pt on pt.regla = a.regla),
  'agente', (select forense.v_metricas_corrida(c.id) from corrida c)
);
"""


def psql_json(sql: str, db: str, params: dict) -> dict:
    """Ejecuta SQL que devuelve un único jsonb y lo regresa como dict."""
    for clave, valor in params.items():
        # Los parámetros son identificadores de corrida, no texto libre del
        # contribuyente; aun así se escapan con quote_literal de psql.
        sql = sql.replace("%(" + clave + ")s", "'" + str(valor).replace("'", "''") + "'")
    cmd = [PSQL, "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        raise SystemExit("psql falló (%s)" % r.returncode)
    salida = r.stdout.strip()
    if not salida:
        raise SystemExit("la consulta no devolvió filas")
    return json.loads(salida)


def metricas(corrida: str, db: str) -> dict:
    m = psql_json(SQL_CARRIL, db, {"clave": corrida})
    if m.get("corrida") is None:
        raise SystemExit("no existe la corrida %r en la base %r" % (corrida, db))
    return m


def _pct(x):
    return "null" if x is None else ("%.1f%%" % (float(x) * 100))


def imprimir(m: dict) -> None:
    c, co = m["corrida"], m["cohorte"]
    print("corrida     %s (%s)" % (c["nombre"], c["corrida_id"]))
    print("dataset     %s  hash %s" % (c["dataset"], (c["dataset_hash"] or "")[:16]))
    print("corte       %s   estado %s   reglas %s"
          % (c["fecha_corte"], c["estado"], c["version_reglas"]))
    print("cohorte     %s RFC con ground truth · %s fraude · %s trampas legítimas"
          % (co["total_ground_truth"], co["total_fraude"], co["total_trampas"]))
    p = m["pistas"]
    print("pistas      %s filas sobre %s RFC" % (p["filas"], p["rfcs"]))
    print("            " + "  ".join("%s=%s" % (k, v) for k, v in sorted(p["por_codigo"].items())))
    if m["no_evaluables"]:
        print("no evaluables: %s (declaradas, no cuentan como señal)"
              % ", ".join(m["no_evaluables"]))
    print()
    for regla, d in sorted(m["carril_datos"].items()):
        print("── %s" % regla)
        print("   TP %-4s FP %-4s FN %-4s TN %-4s" % (d["tp"], d["fp"], d["fn_selectivo"], d["tn"]))
        print("   precisión %s   recall %s   F1 %s"
              % (_pct(d["precision"]), _pct(d["recall"]), _pct(d["f1"])))
        print("   recall conservador %s (FN conservador %s de %s fraudes)"
              % (_pct(d["recall_conservador"]), d["fn_conservador"], co["total_fraude"]))
        f = d["fpr_trampas"]
        print("   FPR sobre trampas %s = %s   (meta docs/10: ≤ 15.0%%)"
              % (f["texto"], _pct(f["fpr"])))
        for tip, t in sorted(d["recall_por_tipologia"].items()):
            print("   tipología %-24s %s/%s  %s" % (tip, t["detectados"], t["n"], _pct(t["recall"])))
        print()
    a = m.get("agente") or {}
    if a.get("error"):
        print("agentes     %s" % a["error"])
        return
    op = a.get("operacion", {})
    if not op.get("casos"):
        print("agentes     0 casos en la corrida: las métricas de dictamen quedan en null")
        print("            (denominador cero no se publica como 0%; docs/10 §2)")
        return
    sel, e2e, cob, fpr = (a.get("selectivas", {}), a.get("extremo_a_extremo", {}),
                          a.get("cobertura", {}), a.get("fpr_trampas", {}))
    print("── agentes (dictámenes persistidos)")
    print("   TP %-4s FP %-4s FN %-4s TN %-4s   precisión %s recall %s F1 %s"
          % (sel.get("tp"), sel.get("fp"), sel.get("fn_selectivo"), sel.get("tn"),
             _pct(sel.get("precision")), _pct(sel.get("recall")), _pct(sel.get("f1"))))
    print("   recall conservador %s   cobertura %s"
          % (_pct(e2e.get("recall_conservador")), _pct(cob.get("ratio"))))
    print("   FPR sobre trampas %s = %s   rango [%s, %s]"
          % (fpr.get("texto"), _pct(fpr.get("fpr_concluyentes")),
             _pct(fpr.get("rango_min")), _pct(fpr.get("rango_max"))))
    print("   casos %s · reintentos %s · presupuesto agotado %s · p50 %s ms"
          % (op.get("casos"), op.get("reintentos"), op.get("presupuesto_agotado"),
             op.get("duracion_ms_p50")))


def main() -> int:
    ap = argparse.ArgumentParser(description="Métricas de una corrida (docs/10)")
    ap.add_argument("--corrida", required=True, help="uuid o nombre de la corrida")
    ap.add_argument("--db", default=os.environ.get("PGDATABASE", "forense"))
    ap.add_argument("--json", action="store_true", help="imprime el jsonb crudo")
    a = ap.parse_args()
    m = metricas(a.corrida, a.db)
    if a.json:
        print(json.dumps(m, indent=2, ensure_ascii=False))
    else:
        imprimir(m)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
