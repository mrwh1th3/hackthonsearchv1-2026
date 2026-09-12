#!/usr/bin/env python3
"""Publica cada resultado de forense.auditor_resultados como investigación completa en las
tablas que ya lee la webapp, para que aparezca en el panel izquierdo y se abra en
/documentos/[id] con la UI existente.

Por corrida auditada:
- investigaciones: una fila modo `corrida`, estado `investigacion_completa`, del perfil demo.
  `reporte_manifest` lista los casos.
- Por cada hallazgo:
  - clusters + casos: nivel `presuncion_alta` (proven) o `presuncion` (probable).
  - evidencia: una fila por exhibit, con el record_id original como referencia.
  - defensas: los argumentos del revisor adversarial.
  - expedientes: Markdown con las secciones del catálogo del editor.
  - bitácora: el recorrido del caso.
- Por cada lead cerrado: un caso `anomalia_explicada` (o `no_concluyente` si lo cerró el
  validador) con su motivo, para que el descarte también se vea.

Idempotente: borra y recrea lo que publicó antes para esa corrida (idempotency_key `auditor:`).
El nivel sale del auditor determinista; nunca se escribe "definitivo" (regla 7).

    python3 loaders/auditor_to_investigaciones.py            # todas las corridas auditadas
    python3 loaders/auditor_to_investigaciones.py <corrida_id> ...
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from forensic_to_supabase import db_url, lit  # noqa: E402

NS = uuid.UUID("6f1c9d2e-0000-4000-8000-0000000f0a02")
ESQUEMA = {"phantom_vendor": "Proveedor fantasma", "kickback": "Kickback", "round_tripping": "Round-tripping",
           "threshold_splitting": "Fraccionamiento de compras", "revenue_inflation": "Ingresos inflados"}
TIPOLOGIA = {"phantom_vendor": "efos_sin_sustancia", "round_tripping": "retorno"}
REF_PREFIJO = {"invoices": "CFDI", "bank_txns": "MOV", "vendors": "ATR", "efos_list": "LISTA", "ledger": "ATR",
               "purchase_orders": "ATR", "contracts": "ATR", "employees": "ATR"}
CERRADO = {"investigator": "Investigador", "challenger": "Revisor adversarial", "validator": "Validador"}


def psql(sql: str, *flags: str) -> str:
    r = subprocess.run(["psql", db_url(), "-v", "ON_ERROR_STOP=1", "-q", *flags, "-f", "-"], input=sql, text=True,
                       capture_output=True)
    if r.returncode:
        raise SystemExit(r.stderr[-3000:])
    return r.stdout


def u(*partes) -> str:
    return str(uuid.uuid5(NS, ":".join(str(p) for p in partes)))


def mxn(v: float) -> str:
    return f"{v:,.2f} MXN"


def referencia(table: str, rid: str) -> str:
    pref = REF_PREFIJO.get(table, "ATR")
    return f"{pref}:{rid}" if pref in ("CFDI", "MOV") else f"{pref}:{table}:{rid}"


def markdown_hallazgo(f: dict, run: dict, corrida_id: str) -> str:
    ents = ", ".join(f["entities"])
    nivel = "presuncion_alta" if f["confidence"] == "proven" else "presuncion"
    trail = "\n".join(f"| {i + 1} | {p['from']} | {p['to']} | {mxn(p['amount'])} | {p['date']} | {p['exhibit_id']} |"
                      for i, p in enumerate(f["money_trail"]))
    exhibits = "\n".join(f"| {x['exhibit_id']} | {x['source_table']} | {x['record_id']} | {x['note']} |" for x in f["exhibits"])
    rec = " + ".join(f"{mxn(v)} ({k})" for k, v in f["reconciliation"]["items"])
    total = sum(v for _, v in f["reconciliation"]["items"])
    defensa = "\n".join(f"- **Argumento:** {d['argument']} — **Se sostiene el hallazgo:** {d['why']}" for d in f["defense"])
    md = run["run_metadata"]
    return f"""# {ESQUEMA.get(f['scheme_type'], f['scheme_type'])} — {f['subject_name']}

**Nivel: {nivel}** (confianza del auditor: {f['confidence']}). La determinación de operaciones inexistentes corresponde a la autoridad.

## Resumen
{f['narrative']}

Monto: **{mxn(f['peso_amount'])}**.

## Contribuyente
{ents} · empresa auditada {run['company_rfc']} · periodo {run['period'][0]} a {run['period'][1]}.

## Hipótesis
**Regla incumplida:** {f['rule_broken']}

## Pistas
{chr(10).join(f'- {e}' for e in f['evidence'])}

Señales que abrieron el lead: {', '.join(f.get('signals') or [])}.

## Evidencia
| Exhibit | Tabla | Registro | Qué prueba |
|---|---|---|---|
{exhibits}

**Conciliación ({f['reconciliation']['table']}):** {rec} = **{mxn(total)}** · validador: dentro de 2%, todos los registros existen.

## Análisis del Defensor
{defensa}

## Dictamen
{nivel} · {mxn(f['peso_amount'])} · {len(f['exhibits'])} exhibits · herramientas: {', '.join(f.get('tool_calls') or [])}.

## Trayectoria
Rastro del dinero (diagrama en el expediente entregable: /auditoria/{corrida_id}/expediente):

| Paso | De | A | Monto | Fecha | Exhibit |
|---|---|---|---|---|---|
{trail}

## Cadena de explicación
1. Qué disparó: {', '.join(f.get('signals') or [])}.
2. Qué registros: {', '.join(x['record_id'] for x in f['exhibits'][:8])}{'…' if len(f['exhibits']) > 8 else ''}.
3. Qué regla: {f['rule_broken']}
4. A dónde fue el dinero: {' → '.join(dict.fromkeys([p['from'] for p in f['money_trail']] + [f['money_trail'][-1]['to']])) if f['money_trail'] else 'sin movimientos'}.
5. Por qué se concluye: {len(f['evidence'])} hechos verificados por SQL; el revisor adversarial no logró romperlo.

## Anexo
Corrida determinista · llamadas LLM {md['llm_calls']} · MXN {md['mxn_cost']:.2f} · {md['wall_clock_seconds']:.2f} s · huella {run['fingerprint'][:16]}.
"""


ORDEN_TABLAS = ["forense.clusters", "forense.casos", "forense.bitacora", "forense.evidencia", "forense.defensas",
                "forense.expedientes", "forense.investigaciones"]


def agrupar(sentencias: list[str]) -> list[str]:
    """Por el pooler cada sentencia es un viaje de red y una auditoría publica cientos: los
    DELETE van primero, luego un INSERT multi-fila por tabla en orden de llaves foráneas, y al
    final lo demás (UPDATE) en su orden original."""
    borrados, otros = [], []
    grupos: dict[str, list[str]] = {}
    for st in sentencias:
        k = st.find(") VALUES ") if st.startswith("INSERT INTO ") else -1
        if k >= 0 and st.endswith(");") and " ON CONFLICT " not in st:
            grupos.setdefault(st[: k + 1], []).append(st[k + len(") VALUES "):-1])
        elif st.startswith("DELETE "):
            borrados.append(st)
        else:
            otros.append(st)

    def prioridad(cabeza: str) -> int:
        tabla = cabeza.split()[2]
        return ORDEN_TABLAS.index(tabla) if tabla in ORDEN_TABLAS else len(ORDEN_TABLAS)

    inserts = []
    for cabeza in sorted(grupos, key=prioridad):
        filas = grupos[cabeza]
        for n in range(0, len(filas), 500):
            inserts.append(f"{cabeza} VALUES\n" + ",\n".join(filas[n:n + 500]) + ";")
    return borrados + inserts + otros


def publicar(corrida_id: str, run: dict, perfil_id: str, inv_id: str | None = None, actualizar: bool = False,
             etiqueta: str | None = None, casos_extra: list[str] | None = None) -> str:
    """`actualizar=True`: la investigación ya existe (la creó el runner en vivo) y pasa a
    `investigacion_completa` con UPDATE, para que su trigger emita la notificación."""
    inv_id = inv_id or u("inv", corrida_id)
    sql = [f"DELETE FROM forense.clusters WHERE corrida_id = {lit(corrida_id)} AND huella LIKE 'auditor:%';"]
    if not actualizar:
        sql.insert(0, f"DELETE FROM forense.investigaciones WHERE id = {lit(inv_id)};")
    manifest, casos = [], []

    def cluster_y_caso(clave: str, rfcs: list[str], score: float, caso: dict) -> str:
        cl = u("cluster", corrida_id, clave)
        cs = u("caso", corrida_id, clave)
        principal = rfcs[0] if rfcs else ""
        sql.append("INSERT INTO forense.clusters (id, corrida_id, rfcs, rfc_semilla, n_rfcs, score, huella, estado) VALUES "
                   f"({lit(cl)}, {lit(corrida_id)}, ARRAY[{','.join(lit(r) for r in rfcs) or 'NULL'}]::text[], {lit(principal)}, "
                   f"{len(rfcs)}, {score}, {lit('auditor:' + hashlib.sha1(clave.encode()).hexdigest())}, 'cerrado');")
        sql.append("INSERT INTO forense.casos (id, corrida_id, cluster_id, rfc_principal, rfcs_satelite, origen, origen_valor, estado, "
                   "nivel, tipologia, hipotesis, monto_en_riesgo, cobertura_completa, tool_calls, bitacora_seq, creado, terminado, "
                   f"idempotency_key) VALUES ({lit(cs)}, {lit(corrida_id)}, {lit(cl)}, {lit(principal)}, "
                   f"ARRAY[{','.join(lit(r) for r in rfcs[1:]) or ''}]::text[], 'auditor', {lit(caso['origen_valor'])}, "
                   f"{lit(caso['estado'])}, {lit(caso['nivel'])}, {lit(caso.get('tipologia'))}, {lit(caso['hipotesis'])}, "
                   f"{caso.get('monto', 'NULL')}, true, {caso['tool_calls']}, {len(caso['eventos'])}, now(), now(), "
                   f"{lit('auditor:' + cs)});")
        for seq, (tipo, agente, payload) in enumerate(caso["eventos"], start=1):
            sql.append("INSERT INTO forense.bitacora (corrida_id, caso_id, cluster_id, seq, ronda, agente, tipo_evento, payload) VALUES "
                       f"({lit(corrida_id)}, {lit(cs)}, {lit(cl)}, {seq}, 1, {lit(agente)}, {lit(tipo)}, "
                       f"{lit(json.dumps(payload, ensure_ascii=False))}::jsonb);")
        return cs

    for i, f in enumerate(run["findings"]):
        clave = f"finding:{i}:{f['scheme_type']}:{','.join(f['entities'])}"
        rfcs = [e.split(":", 1)[1] if e.startswith("RFC:") else e for e in f["entities"]]
        nivel = "presuncion_alta" if f["confidence"] == "proven" else "presuncion"
        eventos = [("caso_creado", "auditor", {"esquema": f["scheme_type"], "señales": f.get("signals")}),
                   ("pista_cargada", "detectores", {"señales": f.get("signals")})]
        eventos += [("tool_call", "investigador", {"herramienta": t}) for t in (f.get("tool_calls") or [])]
        eventos += [("validacion", "validador", {"exhibits": len(f["exhibits"]), "conciliacion": f.get("reconciled_against")})]
        eventos += [("defensa_argumento", "revisor_adversarial", {"argumento": d["argument"], "sostiene": d["why"]}) for d in f["defense"]]
        eventos += [("dictamen", "auditor", {"nivel": nivel, "monto": f["peso_amount"], "confianza": f["confidence"]}),
                    ("redaccion_fin", "redactor", {"secciones": 10})]
        cs = cluster_y_caso(clave, rfcs, 1.0 if f["confidence"] == "proven" else 0.8, {
            "origen_valor": f["scheme_type"], "estado": "dictaminado", "nivel": nivel,
            "tipologia": TIPOLOGIA.get(f["scheme_type"]),
            "hipotesis": f"{ESQUEMA.get(f['scheme_type'])}: {f['narrative']}", "monto": f["peso_amount"],
            "tool_calls": len(f.get("tool_calls") or []), "eventos": eventos})
        montos = dict((str(k), v) for k, v in f["reconciliation"]["items"])
        for x in f["exhibits"]:
            ref = referencia(x["source_table"], x["record_id"])
            hecho = {"referencias": [ref], "source_table": x["source_table"], "record_id": x["record_id"], "exhibit_id": x["exhibit_id"]}
            sql.append("INSERT INTO forense.evidencia (caso_id, idempotency_key, tipo, ref_id, monto, rfcs_afectados, descripcion, agente, "
                       "ronda, valida_tecnica, validada, hecho_validado) VALUES "
                       f"({lit(cs)}, {lit('auditor:' + cs + ':' + x['exhibit_id'])}, {lit(x['source_table'])}, {lit(ref)}, "
                       f"{montos.get(x['record_id'], 'NULL')}, ARRAY[{','.join(lit(r) for r in rfcs)}]::text[], {lit(x['note'])}, "
                       f"'investigador', 1, true, true, {lit(json.dumps(hecho, ensure_ascii=False))}::jsonb);")
        for j, d in enumerate(f["defense"]):
            sql.append("INSERT INTO forense.defensas (caso_id, idempotency_key, trampa_codigo, argumento, resultado, respuesta_investigador, "
                       f"aceptado) VALUES ({lit(cs)}, {lit('auditor:' + cs + f':def{j}')}, {lit(f['scheme_type'])}, {lit(d['argument'])}, "
                       f"'no_refuta', {lit(d['why'])}, false);")
        sql.append("INSERT INTO forense.expedientes (caso_id, idempotency_key, version, markdown, autor, estado_revision) VALUES "
                   f"({lit(cs)}, {lit('auditor:' + cs + ':v1')}, 1, {lit(markdown_hallazgo(f, run, corrida_id))}, 'redactor', 'validado');")
        manifest.append({"caso_id": cs, "version": 1, "estado_revision": "validado"})
        casos.append(cs)

    for n, l in enumerate(run["leads"]):
        # varios leads pueden compartir entidad y tipología (p.ej. kickback con dos empleados)
        clave = f"lead:{n}:{l['investigated_as']}:{l['entity']}:{l['signal']}"
        rfc = l["entity"].split(":", 1)[1] if l["entity"].startswith("RFC:") else l["entity"]
        nivel = "no_concluyente" if l["closed_by"] == "validator" else "anomalia_explicada"
        eventos = [("caso_creado", "auditor", {"esquema": l["investigated_as"], "señal": l["signal"]})]
        eventos += [("tool_call", "investigador", {"herramienta": t}) for t in l["tool_calls_made"]]
        eventos += [("evidencia_descartada", CERRADO[l["closed_by"]], {"motivo": l["reason"]}),
                    ("dictamen", "auditor", {"nivel": nivel, "cerrado_por": l["closed_by"]})]
        cluster_y_caso(clave, [rfc], 0.2, {
            "origen_valor": l["signal"], "estado": "cerrado", "nivel": nivel,
            "hipotesis": f"Lead {ESQUEMA.get(l['investigated_as'], l['investigated_as']).lower()} cerrado por "
                         f"{CERRADO[l['closed_by']].lower()}: {l['reason']}",
            "tool_calls": len(l["tool_calls_made"]), "eventos": eventos})

    # casos de los agentes n8n con reporte: se muestran junto a los deterministas
    for c in casos_extra or []:
        manifest.append({"caso_id": c, "version": 1, "estado_revision": "validado"})
    total = sum(f["peso_amount"] for f in run["findings"])
    titulo = (f"Auditoría {etiqueta or 'seed ' + str(run['seed'])}: {len(run['findings'])} hallazgos · {mxn(total)} · "
              f"{len(run['leads'])} leads cerrados")
    if actualizar:
        sql.append(f"UPDATE forense.investigaciones SET estado = 'investigacion_completa', modo = 'corrida', caso_id = NULL, mensaje = {lit(titulo)}, "
                   f"reporte_manifest = {lit(json.dumps(manifest))}::jsonb, version_entregada = 1, completada_at = now(), "
                   f"actualizado = now() WHERE id = {lit(inv_id)};")
    else:
        sql.append("INSERT INTO forense.investigaciones (id, perfil_id, modo, corrida_id, estado, mensaje, idempotency_key, "
                   "reporte_manifest, version_entregada, completada_at) VALUES "
                   f"({lit(inv_id)}, {lit(perfil_id)}, 'corrida', {lit(corrida_id)}, 'investigacion_completa', {lit(titulo)}, "
                   f"{lit('auditor:' + corrida_id)}, {lit(json.dumps(manifest))}::jsonb, 1, now());")
    psql("BEGIN;\n" + "\n".join(agrupar(sql)) + "\nCOMMIT;")
    return f"{inv_id} {titulo} (casos: {len(casos)} hallazgos + {len(run['leads'])} descartes)"


def main() -> int:
    perfiles = psql("SELECT id FROM forense.perfiles ORDER BY creado NULLS LAST, id;", "-At").split()
    if not perfiles:
        raise SystemExit("no hay perfiles en forense.perfiles")
    ids = sys.argv[1:] or psql("SELECT corrida_id FROM forense.auditor_resultados ORDER BY seed;", "-At").split()
    for cid in ids:
        raw = psql(f"SELECT run_log::text FROM forense.auditor_resultados WHERE corrida_id = {lit(cid)};", "-At")
        if not raw.strip():
            print(f"{cid}: sin resultado del auditor, se omite")
            continue
        print(publicar(cid, json.loads(raw), perfiles[0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
