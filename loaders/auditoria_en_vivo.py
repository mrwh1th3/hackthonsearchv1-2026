#!/usr/bin/env python3
"""Corre la auditoría de una corrida por fases, escribiendo cada fase en `forense` al
terminarla, para que el canvas (/analisis/[casoId]) la dibuje en vivo. Lo lanza
`POST /api/auditoria`; también se puede correr a mano.

    python3 loaders/auditoria_en_vivo.py --corrida <uuid> --estate <estate.db> \
        --investigacion <uuid> --caso <uuid> --perfil <uuid> [--paso-ms 600] [--llm off]

Fases, en el vocabulario del canvas (lib/analisis/arbol.ts):
  ronda 1        detectores SQL + un investigador determinista por tipología
  ronda 2        agentes n8n (FORENSE_investigar_cluster) sobre cada hallazgo determinista:
                 se siembran sus pistas y el pipeline multi-agente intenta ampliarlo o refutarlo
                 (--agentes n8n, consume tokens en n8n); con --agentes off queda `omitida`
  auditoría      consolidación y confianza por reglas
  defensa        revisor adversarial: explicaciones inocentes probadas
  auditor final  validador: cada record_id existe y el monto concilia al 2%
  redacción      submission, expediente y publicación como investigación

El caso ancla (`origen = 'auditoria'`, `origen_valor` = id de la investigación) es el que
sondea el canvas; al quedar `dictaminado` la UI abre la investigación. `--paso-ms` es una
pausa declarada entre fases (se escribe en la bitácora), no tiempo fingido de cómputo.
El nivel y los montos salen solo de reglas y SQL; el LLM no los cambia (regla 4).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from auditor.detectors import group_leads, run_detectors  # noqa: E402
from auditor.estate import Estate  # noqa: E402
from auditor.investigate import Investigator  # noqa: E402
from auditor.llm import LLM  # noqa: E402
from auditor.pipeline import file_sha256, write_outputs  # noqa: E402
from auditor.validate import validate_finding  # noqa: E402
from auditor_to_investigaciones import ESQUEMA, psql, publicar  # noqa: E402
from forensic_to_supabase import lit  # noqa: E402

INVESTIGADORES = [("phantom_vendor", "proveedor_fantasma"), ("kickback", "kickback"),
                  ("round_tripping", "round_tripping"), ("threshold_splitting", "fraccionamiento"),
                  ("revenue_inflation", "ingresos_inflados")]
ESPECIALISTAS_LLM = ["documental", "financiero", "relacional", "temporal", "externo"]
NIVEL_ORDEN = ["sin_hallazgos", "anomalia_explicada", "no_concluyente", "presuncion", "presuncion_alta"]
LLM_SYSTEM = ("Eres un especialista forense {rol}. Recibes hallazgos ya verificados por SQL. Propón en máximo 80 "
              "palabras qué otra relación o registro revisar para ampliar o refutar, citando solo ids dados. "
              "No cambies montos ni niveles.")


class Vivo:
    def __init__(self, a):
        self.a = a
        self.seq = 0
        self.tareas: dict[str, str] = {}
        self.cluster = str(uuid.uuid5(uuid.UUID(a.caso), "ancla"))
        self.t0 = time.monotonic()

    def sql(self, *sentencias: str):
        psql("BEGIN;\n" + "\n".join(sentencias) + "\nCOMMIT;")

    def evento(self, tipo: str, agente: str, payload: dict, tarea: str | None = None, ronda: int = 1,
               tokens: tuple[int, int] | None = None, modelo: str | None = None) -> str:
        self.seq += 1
        tid = self.tareas.get(tarea) if tarea else None
        return ("INSERT INTO forense.bitacora (corrida_id, caso_id, cluster_id, seq, ronda, tarea_id, agente, tipo_evento, "
                f"payload, tokens_in, tokens_out, modelo) VALUES ({lit(self.a.corrida)}, {lit(self.a.caso)}, {lit(self.cluster)}, "
                f"{self.seq}, {ronda}, {lit(tid)}, {lit(agente)}, {lit(tipo)}, {lit(json.dumps(payload, ensure_ascii=False))}::jsonb, "
                f"{tokens[0] if tokens else 'NULL'}, {tokens[1] if tokens else 'NULL'}, {lit(modelo)});")

    def tarea(self, clave: str, estado: str, tool_calls: int | None = None, resultado: dict | None = None) -> str:
        sets = [f"estado = {lit(estado)}"]
        if estado == "ejecutando":
            sets.append("iniciado = now()")
        if estado in ("completada", "omitida", "error"):
            sets.append("terminado = now()")
            sets.append("iniciado = coalesce(iniciado, now())")
        if tool_calls is not None:
            sets.append(f"tool_calls = {tool_calls}")
        if resultado is not None:
            sets.append(f"resultado = {lit(json.dumps(resultado, ensure_ascii=False))}::jsonb")
        return f"UPDATE forense.tareas_agente SET {', '.join(sets)} WHERE id = {lit(self.tareas[clave])};"

    def caso(self, estado: str, **extra) -> str:
        sets = [f"estado = {lit(estado)}", f"bitacora_seq = {self.seq}"] + [f"{k} = {v}" for k, v in extra.items()]
        return f"UPDATE forense.casos SET {', '.join(sets)} WHERE id = {lit(self.a.caso)};"

    def pausa(self):
        if self.a.paso_ms > 0:
            time.sleep(self.a.paso_ms / 1000)


FAMILIA = {"phantom_vendor": "E", "kickback": "F", "round_tripping": "R", "threshold_splitting": "T",
           "revenue_inflation": "D"}
TERMINALES = {"dictaminado", "error", "parcial", "cerrado"}


def env(nombre: str) -> str:
    import os
    if os.environ.get(nombre):
        return os.environ[nombre]
    for linea in (ROOT / ".env").read_text().splitlines():
        if linea.startswith(nombre + "="):
            return linea.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"falta {nombre} en el entorno o en .env")


def referencias_canonicas(corrida: str, exhibits: list[dict]) -> list[str]:
    """Los agentes n8n validan citas contra ids canónicos (CFDI:<uuid>, MOV:<id>), no contra los del estate."""
    inv = [x["record_id"] for x in exhibits if x["source_table"] == "invoices"]
    mov = [x["record_id"] for x in exhibits if x["source_table"] == "bank_txns"]
    refs: list[str] = []
    if inv:
        refs += ["CFDI:" + u for u in psql(
            f"SELECT uuid FROM forense.cfdi WHERE corrida_id = {lit(corrida)} AND id_origen IN ({','.join(lit(x) for x in inv)}) "
            "ORDER BY fecha;", "-At").split()]
    if mov:
        refs += ["MOV:" + m for m in psql(
            f"SELECT id FROM forense.movimientos WHERE corrida_id = {lit(corrida)} AND id_origen IN ({','.join(lit(x) for x in mov)}) "
            "ORDER BY fecha;", "-At").split()]
    return refs[:40]


def despachar(cuerpo: dict) -> dict:
    import urllib.request
    req = urllib.request.Request(env("N8N_WEBHOOK_BASE").rstrip("/") + "/investigar", data=json.dumps(cuerpo).encode(),
                                 method="POST", headers={"content-type": "application/json",
                                                         "X-Internal-Webhook-Secret": env("INTERNAL_WEBHOOK_SECRET")})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b"{}")


def agentes_n8n(v: "Vivo", e: Estate, candidatos: list) -> list[str]:
    """Un despacho de FORENSE_investigar_cluster por hallazgo. El cluster y las pistas se siembran con lo
    que el determinista ya probó; los agentes investigan con sus herramientas y su dictamen se registra
    aparte: no cambia el nivel ni el monto del hallazgo determinista (regla 4)."""
    a = v.a
    despachos = []
    for n, (g, _, r) in enumerate(candidatos, start=1):
        agente = f"n8n_{n}_{g['kind']}"
        tid = str(uuid.uuid4())
        v.tareas[agente] = tid
        rfcs = [x.split(":", 1)[1] for x in r["entities"] if x.startswith("RFC:")] or [e.company_rfc]
        cluster = str(uuid.uuid5(uuid.UUID(a.caso), f"agentes:{n}"))
        refs = referencias_canonicas(a.corrida, r["exhibits"])
        detalle = {"resumen": f"[auditor determinista] {r['narrative']}", "referencias": refs, "fuente": "auditor_determinista",
                   "esquema": r["scheme_type"], "monto": r["peso_amount"], "confianza": r["confidence"]}
        v.sql("INSERT INTO forense.clusters (id, corrida_id, rfcs, rfc_semilla, n_rfcs, score, huella, estado) VALUES "
              f"({lit(cluster)}, {lit(a.corrida)}, ARRAY[{','.join(lit(x) for x in rfcs)}]::text[], {lit(rfcs[0])}, {len(rfcs)}, "
              f"{1.0 if r['confidence'] == 'proven' else 0.8}, {lit('agentes:' + a.caso + ':' + str(n))}, 'pendiente');",
              "INSERT INTO forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella) VALUES "
              f"({lit(a.corrida)}, {lit('AUD_' + r['scheme_type'].upper())}, {lit(FAMILIA[r['scheme_type']])}, {lit(rfcs[0])}, "
              f"{1.0 if r['confidence'] == 'proven' else 0.8}, {lit(json.dumps(detalle, ensure_ascii=False))}::jsonb, "
              f"{lit('agentes:' + a.caso + ':' + str(n))});",
              "INSERT INTO forense.tareas_agente (id, caso_id, corrida_id, cluster_id, agente, ronda, estado, idempotency_key, iniciado) "
              f"VALUES ({lit(tid)}, {lit(a.caso)}, {lit(a.corrida)}, {lit(v.cluster)}, {lit(agente)}, 2, 'ejecutando', "
              f"{lit('auditoria:' + a.caso + ':' + agente)}, now());")
        # Contrato del webhook FORENSE_investigar_cluster (n8n/runtime/nodos/normalizar-investigacion.mjs):
        # corrida y cluster explícitos, sin texto de sistema ni niveles; el mismo idempotency_key da el mismo caso.
        cuerpo = {"corrida_id": a.corrida, "cluster_id": cluster, "idempotency_key": str(uuid.uuid5(uuid.UUID(a.caso), agente))}
        try:
            resp = despachar(cuerpo)
            caso = resp.get("caso_id")
            v.sql(v.evento("paso_en_cola", agente, {"resumen": f"Despachado a n8n: {', '.join(r['entities'])}"
                                                              + (f" · caso {caso[:8]}" if caso else " · en cola"),
                                                   "caso_n8n": caso, "referencias_sembradas": len(refs)}, agente, ronda=2))
            despachos.append((agente, caso))
        except Exception as err:  # noqa: BLE001 — un despacho caído no tumba la auditoría
            v.sql(v.evento("error", agente, {"resumen": f"n8n no aceptó el despacho: {str(err)[:200]}"}, agente, ronda=2),
                  v.tarea(agente, "error"))

    limite = time.monotonic() + a.agentes_timeout
    pendientes = {ag: c for ag, c in despachos if c}
    for ag, c in despachos:
        if not c:
            v.sql(v.tarea(ag, "error"))
    vistos: dict[str, str] = {}
    while pendientes and time.monotonic() < limite:
        ids = ",".join(lit(c) for c in pendientes.values())
        filas = psql(f"SELECT id, estado, coalesce(nivel,''), coalesce(tokens_total,0) FROM forense.casos WHERE id IN ({ids});",
                     "-At", "-F", "|").splitlines()
        sentencias = []
        for fila in filas:
            cid, estado, nivel, tokens = fila.split("|")
            ag = next(k for k, x in pendientes.items() if x == cid)
            if vistos.get(ag) != estado:
                vistos[ag] = estado
                sentencias.append(v.evento("razonamiento", ag, {"resumen": f"Agentes n8n en {estado.replace('_', ' ')}"
                                                                           + (f" · nivel {nivel}" if nivel else ""),
                                                               "caso_n8n": cid}, ag, ronda=2,
                                           tokens=(int(tokens), 0) if estado in TERMINALES else None))
            if estado in TERMINALES:
                sentencias.append(v.tarea(ag, "completada" if estado == "dictaminado" else "error",
                                          resultado={"caso_n8n": cid, "estado": estado, "nivel": nivel or None}))
                del pendientes[ag]
        if sentencias:
            v.sql(*sentencias)
        if pendientes:
            time.sleep(5)
    for ag, c in pendientes.items():
        v.sql(v.evento("presupuesto_agotado", ag, {"resumen": f"Sin dictamen de n8n en {a.agentes_timeout}s; se sigue sin él",
                                                   "caso_n8n": c}, ag, ronda=2), v.tarea(ag, "timeout"))
    return [c for _, c in despachos if c]


def preparar(v: Vivo, e: Estate):
    a = v.a
    ronda2 = [(r, 2) for r in ESPECIALISTAS_LLM] if a.agentes == "off" else []
    claves = [("detectores", 1)] + [(ag, 1) for _, ag in INVESTIGADORES] + ronda2 + \
             [("auditor", 3), ("defensor", 3), ("auditor_final", 3), ("redactor", 3)]
    sentencias = [
        # una auditoría nueva reemplaza a la anterior de la misma corrida
        f"DELETE FROM forense.investigaciones WHERE corrida_id = {lit(a.corrida)} AND idempotency_key LIKE 'auditor:%' AND id <> {lit(a.investigacion)};",
        f"DELETE FROM forense.clusters WHERE corrida_id = {lit(a.corrida)} AND (huella LIKE 'auditor:%' OR huella LIKE 'ancla:%' OR huella LIKE 'agentes:%');",
        f"DELETE FROM forense.pistas WHERE corrida_id = {lit(a.corrida)} AND huella LIKE 'agentes:%';",
        "INSERT INTO forense.clusters (id, corrida_id, rfcs, rfc_semilla, n_rfcs, huella, estado) VALUES "
        f"({lit(v.cluster)}, {lit(a.corrida)}, ARRAY[{lit(e.company_rfc)}]::text[], {lit(e.company_rfc)}, 1, "
        f"{lit('ancla:' + a.caso)}, 'ronda1');",
        "INSERT INTO forense.casos (id, corrida_id, cluster_id, rfc_principal, rfcs_satelite, origen, origen_valor, estado, "
        f"hipotesis, idempotency_key) VALUES ({lit(a.caso)}, {lit(a.corrida)}, {lit(v.cluster)}, {lit(e.company_rfc)}, "
        f"ARRAY[]::text[], 'auditoria', {lit(a.investigacion)}, 'en_cola', 'Auditoría forense del estate completo', "
        f"{lit('ancla:' + a.caso)});",
        "INSERT INTO forense.investigaciones (id, perfil_id, modo, corrida_id, caso_id, estado, mensaje, idempotency_key) VALUES "
        f"({lit(a.investigacion)}, {lit(a.perfil)}, 'caso', {lit(a.corrida)}, {lit(a.caso)}, 'investigando', "
        f"{lit('Auditoría en curso · ' + Path(a.estate).name)}, {lit('auditor:' + a.corrida + ':' + a.investigacion)}) "
        "ON CONFLICT (id) DO UPDATE SET estado = 'investigando', actualizado = now();",
    ]
    for agente, ronda in claves:
        tid = str(uuid.uuid4())
        v.tareas[agente] = tid
        sentencias.append("INSERT INTO forense.tareas_agente (id, caso_id, corrida_id, cluster_id, agente, ronda, estado, "
                          f"idempotency_key) VALUES ({lit(tid)}, {lit(a.caso)}, {lit(a.corrida)}, {lit(v.cluster)}, "
                          f"{lit(agente)}, {ronda}, 'pendiente', {lit('auditoria:' + a.caso + ':' + agente)});")
    sentencias.append(v.evento("caso_creado", "auditoria", {
        "resumen": f"Auditoría de {Path(a.estate).name}", "empresa": e.company_rfc,
        "paso_visible_ms": a.paso_ms, "llm": a.llm}))
    v.sql(*sentencias)


def correr(a) -> int:
    e = Estate(a.estate)
    v = Vivo(a)
    preparar(v, e)
    llm = LLM(a.llm, a.cassette)

    # ronda 1 · detectores
    v.pausa()
    v.sql(v.caso("ronda1"), v.tarea("detectores", "ejecutando"))
    raw = run_detectors(e)
    grupos = group_leads(raw)
    por_senal: dict[str, int] = {}
    for l in raw:
        por_senal[l["signal"]] = por_senal.get(l["signal"], 0) + 1
    v.sql(*[v.evento("pista_cargada", "detectores", {"resumen": f"{s}: {n} alertas", "senal": s, "alertas": n}, "detectores")
            for s, n in sorted(por_senal.items())],
          v.tarea("detectores", "completada", resultado={"alertas": len(raw), "leads": len(grupos)}))

    # ronda 1 · investigadores por tipología
    inv = Investigator(e)
    candidatos, leads = [], []
    for kind, agente in INVESTIGADORES:
        v.pausa()
        v.sql(v.tarea(agente, "ejecutando"))
        eventos, llamadas, propios = [], 0, [g for g in grupos if g["kind"] == kind]
        for g in propios:
            res = inv.investigate(g)
            llamadas += len(res["tool_calls"])
            eventos.append(v.evento("tool_call", agente, {"resumen": f"{g['entity']}: {', '.join(res['tool_calls'])}",
                                                          "herramientas": res["tool_calls"]}, agente))
            base = {"entity": g["entity"], "signal": ", ".join(g["signals"]), "signal_detail": "; ".join(g["details"]),
                    "investigated_as": kind, "tool_calls_made": res["tool_calls"]}
            if res["closed"]:
                leads.append({**base, "reason": res["reason"], "closed_by": res["closed_by"], "defense": res.get("defense", [])})
                eventos.append(v.evento("razonamiento", agente, {"resumen": f"{g['entity']} cerrado: {res['reason'][:160]}"}, agente))
            else:
                res["signals"] = g["signals"]
                candidatos.append((g, base, res))
                eventos.append(v.evento("senal_escrita", agente, {
                    "resumen": f"{g['entity']}: candidato {ESQUEMA[kind].lower()} · {res['confidence']} · MXN {res['peso_amount']:,.2f}"}, agente))
        eventos.append(v.tarea(agente, "completada", tool_calls=llamadas,
                               resultado={"leads": len(propios), "candidatos": sum(1 for g, _, _ in candidatos if g["kind"] == kind)}))
        v.sql(*eventos)

    # ronda 2 · agentes n8n sobre la base determinista
    v.pausa()
    v.sql(v.caso("ronda2"))
    casos_agentes: list[str] = []
    if a.agentes == "off":
        for rol in ESPECIALISTAS_LLM:
            v.sql(v.evento("razonamiento", rol, {"resumen": "Omitida: agentes n8n desactivados (--agentes off). "
                                                            "Se activan con FORENSE_AGENTES=n8n y consumen tokens."}, rol, ronda=2),
                  v.tarea(rol, "omitida"))
    else:
        casos_agentes = agentes_n8n(v, e, candidatos)

    # auditoría · consolidación
    v.pausa()
    v.sql(v.caso("auditando"), v.tarea("auditor", "ejecutando"))
    v.sql(*[v.evento("auditoria", "auditor", {"resumen": f"{ESQUEMA[r['scheme_type']]} {', '.join(r['entities'])}: "
                                                         f"confianza {r['confidence']} por {len(r['evidence'])} hechos"}, "auditor", ronda=3)
            for _, _, r in candidatos],
          v.tarea("auditor", "completada", resultado={"candidatos": len(candidatos)}))

    # defensa · revisor adversarial
    v.pausa()
    v.sql(v.caso("defendiendo"), v.tarea("defensor", "ejecutando"))
    ev = [v.evento("defensa_argumento", "defensor", {"resumen": f"{', '.join(r['entities'])}: {d['argument'][:140]} → se sostiene"},
                   "defensor", ronda=3) for _, _, r in candidatos for d in r["defense"]]
    cerrados = [l for l in leads if l["closed_by"] == "challenger"]
    ev += [v.evento("evidencia_descartada", "defensor", {"resumen": f"{l['entity']}: {l['reason'][:160]}"}, "defensor", ronda=3)
           for l in cerrados]
    v.sql(*ev, v.tarea("defensor", "completada", resultado={"sostenidos": len(candidatos), "descartados": len(cerrados)}))

    # auditor final · validador
    v.pausa()
    v.sql(v.caso("validando"), v.tarea("auditor_final", "ejecutando"))
    hallazgos, ev = [], []
    for g, base, r in candidatos:
        errs = validate_finding(e, r)
        if errs:
            leads.append({**base, "reason": "Falló validación antes de imprimirse: " + "; ".join(errs), "closed_by": "validator", "defense": []})
            ev.append(v.evento("evidencia_descartada", "auditor_final", {"resumen": f"{g['entity']}: {'; '.join(errs)[:160]}"}, "auditor_final", ronda=3))
        else:
            r["tool_calls"] = r["tool_calls"] + ["validate_finding"]
            hallazgos.append(r)
            ev.append(v.evento("validacion", "auditor_final", {
                "resumen": f"{', '.join(r['entities'])}: {len(r['exhibits'])} registros existen; concilia contra "
                           f"{r['reconciled_against']['table']}"}, "auditor_final", ronda=3))
    v.sql(*ev, v.tarea("auditor_final", "completada", resultado={"validos": len(hallazgos)}))

    # redacción · salidas y publicación
    v.pausa()
    v.sql(v.caso("redactando"), v.tarea("redactor", "ejecutando"))
    acusados = {(f["scheme_type"], ent) for f in hallazgos for ent in f["entities"]}
    leads = [l for l in leads if (l["investigated_as"], l["entity"]) not in acusados]
    hallazgos.sort(key=lambda f: (-f["peso_amount"], f["scheme_type"], f["entities"]))
    run = {"seed": a.seed, "estate_path": a.estate, "estate_sha256": file_sha256(a.estate), "company_rfc": e.company_rfc,
           "period": e.period, "bank_horizon": e.bank_horizon.isoformat(), "detector_hits": len(raw),
           "leads_investigated": len(grupos), "findings": hallazgos, "leads": leads,
           "run_metadata": {"llm_calls": llm.calls, "mxn_cost": round(llm.cost_mxn, 4),
                            "wall_clock_seconds": round(time.monotonic() - v.t0, 3),
                            "cost_by_role": {k: round(x, 4) for k, x in sorted(llm.by_role.items())},
                            "deterministic": a.llm != "record", "llm_mode": a.llm,
                            "paso_visible_ms": a.paso_ms}}
    out = ROOT / "data" / "forensic" / "runs" / a.corrida
    rutas = write_outputs(run, str(out))
    v.sql("INSERT INTO forense.auditor_resultados (corrida_id, seed, fingerprint, estate_sha256, submission, run_log, case_file_html) "
          f"VALUES ({lit(a.corrida)}, {a.seed}, {lit(run['fingerprint'])}, {lit(run['estate_sha256'])}, "
          f"{lit(Path(rutas['submission']).read_text())}::jsonb, {lit(json.dumps(run, ensure_ascii=False, default=str))}::jsonb, "
          f"{lit(Path(rutas['case_file']).read_text())}) ON CONFLICT (corrida_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, "
          "submission = EXCLUDED.submission, run_log = EXCLUDED.run_log, case_file_html = EXCLUDED.case_file_html, generado_at = now();")
    run = json.loads(Path(rutas["run_log"]).read_text())
    nombre = psql(f"SELECT nombre FROM forense.corridas WHERE id = {lit(a.corrida)};", "-At").strip()
    publicar(a.corrida, run, a.perfil, inv_id=a.investigacion, actualizar=True, casos_extra=casos_agentes,
             etiqueta=f"seed {a.seed}" if a.seed else (nombre.replace("Estate · ", "") or None))

    niveles = ["presuncion_alta" if f["confidence"] == "proven" else "presuncion" for f in hallazgos] or ["sin_hallazgos"]
    nivel = max(niveles, key=NIVEL_ORDEN.index)
    total = round(sum(f["peso_amount"] for f in hallazgos), 2)
    duracion = int((time.monotonic() - v.t0) * 1000)
    v.sql(v.evento("redaccion_fin", "redactor", {"resumen": f"{len(hallazgos)} hallazgos · MXN {total:,.2f} · "
                                                            f"{len(leads)} leads cerrados · huella {run['fingerprint'][:16]}"}, "redactor", ronda=3),
          v.tarea("redactor", "completada", resultado={"submission": rutas["submission"], "case_file": rutas["case_file"]}),
          v.evento("dictamen", "auditoria", {"resumen": f"Dictamen: {nivel} · {len(hallazgos)} hallazgos", "nivel": nivel}),
          v.caso("dictaminado", nivel=lit(nivel), monto_en_riesgo=total, cobertura_completa="true",
                 tool_calls=sum(len(f.get("tool_calls") or []) for f in hallazgos) + sum(len(l["tool_calls_made"]) for l in leads),
                 duracion_ms=duracion, terminado="now()",
                 hipotesis=lit(f"Auditoría: {len(hallazgos)} hallazgos, {len(leads)} leads cerrados")),
          f"UPDATE forense.clusters SET estado = 'cerrado' WHERE id = {lit(v.cluster)};")
    print(json.dumps({"investigacion": a.investigacion, "caso": a.caso, "hallazgos": len(hallazgos), "leads": len(leads)}))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corrida", required=True)
    ap.add_argument("--estate", required=True)
    ap.add_argument("--investigacion", required=True)
    ap.add_argument("--caso", required=True)
    ap.add_argument("--perfil", required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--paso-ms", type=int, default=600)
    ap.add_argument("--llm", default="off", choices=["off", "record", "replay"])
    ap.add_argument("--agentes", default="off", choices=["off", "n8n"])
    ap.add_argument("--agentes-timeout", type=int, default=1800)
    ap.add_argument("--cassette")
    a = ap.parse_args()
    try:
        return correr(a)
    except BaseException as err:  # noqa: BLE001 — cualquier fallo deja rastro y estado error
        detalle = (str(err) or traceback.format_exc())[-800:]
        try:
            psql("BEGIN;\n"
                 f"UPDATE forense.casos SET estado = 'error', terminado = now() WHERE id = {lit(a.caso)};\n"
                 f"UPDATE forense.tareas_agente SET estado = 'error', terminado = now() WHERE caso_id = {lit(a.caso)} AND estado = 'ejecutando';\n"
                 f"UPDATE forense.investigaciones SET estado = 'error', actualizado = now() WHERE id = {lit(a.investigacion)};\n"
                 "INSERT INTO forense.bitacora (corrida_id, caso_id, agente, tipo_evento, payload) VALUES "
                 f"({lit(a.corrida)}, {lit(a.caso)}, 'auditoria', 'error', {lit(json.dumps({'resumen': detalle}))}::jsonb);\nCOMMIT;")
        except BaseException:  # noqa: BLE001
            pass
        print(detalle, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
