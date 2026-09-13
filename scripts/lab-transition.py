"""Inspect or retire the automatic legacy IA complement without deleting history.

python3 scripts/lab-transition.py             # read-only status
python3 scripts/lab-transition.py --apply     # disable auto complement + its webhook
Writes a reversible configuration snapshot under data/labs before mutation.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    cfg = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            cfg[key.strip()] = value.strip().strip("\"'")

    def request(service, route, method="GET", body=None):
        if service == "n8n":
            base = cfg["N8N_BASE"].rstrip("/") + "/api/v1"
            headers = {"X-N8N-API-KEY": cfg["N8N_API_KEY"]}
        else:
            base = cfg["SUPABASE_URL"].rstrip("/") + "/rest/v1"
            headers = {"apikey": cfg["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": "Bearer " + cfg["SUPABASE_SERVICE_ROLE_KEY"],
                       "Accept-Profile": "forense", "Content-Profile": "forense", "Prefer": "return=representation"}
        headers["Content-Type"] = "application/json"
        req = urllib.request.Request(base + route, headers=headers, method=method,
                                     data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    workflows = request("n8n", "/workflows?limit=100")["data"]
    matches = [w for w in workflows if w["name"] == "FORENSE_ia_complemento"]
    if len(matches) != 1:
        raise RuntimeError("No se identificó un único workflow FORENSE_ia_complemento; no se modifica nada.")
    workflow = matches[0]
    setting = request("db", "/config_presupuesto?clave=eq.ia_complemento_auto&select=clave,valor,nota")
    if len(setting) != 1:
        raise RuntimeError("Falta la configuración ia_complemento_auto; no se modifica nada.")
    active = request("n8n", "/executions?status=running&limit=100").get("data", [])
    ongoing = [x["id"] for x in active if x.get("workflowId") in
               {w["id"] for w in workflows if w["name"] in {"FORENSE_ia_complemento", "FORENSE_ejecutar_agente"}}]
    snapshot = {"checked_at": datetime.now(timezone.utc).isoformat(), "workflow":
                {"id": workflow["id"], "name": workflow["name"], "active": workflow["active"]},
                "settings": setting, "running_executions": ongoing}
    print(json.dumps(snapshot, ensure_ascii=False))
    if not args.apply:
        return
    if ongoing:
        raise RuntimeError("Hay ejecuciones activas: se pospone la transición para conservar su cierre.")
    directory = ROOT / "data" / "labs" / "transitions"
    directory.mkdir(parents=True, exist_ok=True)
    backup = directory / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + ".json")
    backup.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False))
    request("db", "/config_presupuesto?clave=eq.ia_complemento_auto", "PATCH", {"valor": 0})
    try:
        if workflow["active"]:
            request("n8n", f"/workflows/{workflow['id']}/deactivate", "POST")
    except Exception:
        request("db", "/config_presupuesto?clave=eq.ia_complemento_auto", "PATCH", {"valor": setting[0]["valor"]})
        raise
    current = request("n8n", f"/workflows/{workflow['id']}")
    current_setting = request("db", "/config_presupuesto?clave=eq.ia_complemento_auto&select=valor")
    if current["active"] or current_setting[0]["valor"] != 0:
        raise RuntimeError("No se pudo verificar el estado final; consulta el respaldo de transición.")
    print(json.dumps({"legacy_auto_disabled": True, "history_preserved": True, "backup": str(backup)}))


if __name__ == "__main__":
    main()
