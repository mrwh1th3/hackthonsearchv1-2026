"""Provider JSON schemas and deterministic post-generation gates."""
from __future__ import annotations

import json
import math


def obj(properties: dict) -> dict:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


def array(items: dict, maximum: int = 30) -> dict:
    return {"type": "array", "items": items, "maxItems": maximum}


TEXT = {"type": "string", "maxLength": 2400}
ID = {"type": "string", "minLength": 1, "maxLength": 240}
IDS = array(ID, 40)
CONFIDENCE = {"type": "number", "minimum": 0, "maximum": 1}
REASONING = array(obj({"n": {"type": "integer", "minimum": 1},
                       "action": {"type": "string", "enum": ["observe", "question", "tool", "hypothesize", "refute", "conclude"]},
                       "claim": {**TEXT, "minLength": 1}, "evidence_ids": IDS, "open_question": TEXT}), 12)
REASONING["minItems"] = 1
TOOL_REQUESTS = array(obj({"name": {"type": "string", "enum": ["subject_slice", "evidence_rows", "graph_paths", "cfdi_bank_join", "context"]},
                           "ids": array(ID, 10), "giro": TEXT,
                           "max_hops": {"type": "integer", "minimum": 1, "maximum": 4}, "purpose": TEXT}), 2)

A_REVIEW = obj({"rule_id": ID, "tag_ids": IDS, "group_size": {"type": "integer", "minimum": 0},
                "exemplar_ids": IDS, "verdict": {"type": "string", "enum": ["sostiene", "parte", "tumba", "dato_insuficiente"]},
                "reasoning_steps": REASONING, "licit_explanation_considered": TEXT,
                "new_lead": obj({"ids": IDS, "hypothesis": TEXT}),
                "compiler_proposal": {"type": "string", "enum": ["none", "anti_patron", "ajuste_regla", "regla_nueva"]},
                "confidence": CONFIDENCE, "missing_datum_to_close": TEXT})
A_SCHEMA = obj({"reviews": array(A_REVIEW, 4), "reasoning_steps": REASONING, "tool_requests": TOOL_REQUESTS})
B_FINDING = obj({"finding_id": ID, "mechanism_one_liner": TEXT, "ids": IDS, "evidence_ids": IDS,
                 "why_engine_missed": TEXT, "bridge_to_tags": IDS,
                 "compiler_proposal": {"type": "string", "enum": ["none", "regla_nueva", "ajuste_regla"]},
                 "reasoning_steps": REASONING, "confidence": CONFIDENCE,
                 "licit_explanation_considered": TEXT, "missing_datum_to_close": TEXT})
B_SCHEMA = obj({"findings": array(B_FINDING, 8), "reasoning_steps": REASONING, "tool_requests": TOOL_REQUESTS})

# Atomic fields describe an executable candidate; none is executed by this laboratory.
FIELDS = ["invoices.total", "invoices.subtotal", "invoices.iva", "invoices.status", "invoices.metodo_pago",
          "invoices.issue_date", "invoices.issuer_rfc", "invoices.receiver_rfc", "bank_txns.amount", "bank_txns.date",
          "bank_txns.from_clabe", "bank_txns.to_clabe", "vendors.registered_date", "vendors.bank_clabe",
          "purchase_orders.amount", "purchase_orders.approver", "contracts.start_date", "employees.bank_clabe",
          "ledger.debit", "ledger.credit", "ledger.approver", "efos_list.status",
          "derived.invoice_count", "derived.txn_count", "derived.amount_ratio", "derived.elapsed_days",
          "derived.shared_account_count", "derived.document_coverage_ratio", "derived.distinct_approvers"]
FIELDS += ["derived.phantom_score", "derived.undocumented_invoice_count", "derived.exculpatory_documentation",
           "derived.order_limit_ratio", "derived.order_count", "derived.order_window_days", "derived.order_sum_limit_ratio",
           "derived.same_requester_or_approver", "derived.approver_authorized_above_limit", "derived.return_amount_ratio",
           "derived.return_elapsed_days", "derived.return_cycle_count", "derived.return_booked_as_revenue",
           "derived.refund_documented", "derived.employee_approval_relationship", "derived.employee_payment_elapsed_days",
           "derived.invoice_age_days", "derived.collection_ratio", "derived.payment_grace_expired"]
PREDICATE = obj({"field": {"type": "string", "enum": FIELDS},
                 "operator": {"type": "string", "enum": ["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "exists", "not_exists"]},
                 "value": {"type": ["string", "number", "boolean", "null", "array"], "items": {"type": ["string", "number"]}},
                 "description": TEXT})
PROPOSAL = obj({"id": ID, "tipo": {"type": "string", "enum": ["nueva", "anti_patron", "ajuste"]},
                "sobre_regla": {"type": ["string", "null"]}, "nombre": TEXT, "predicados": array(PREDICATE, 12),
                "ventanas_y_umbrales": array(obj({"name": TEXT, "value": {"type": "number"}, "unit": TEXT}), 10),
                "segmento": TEXT, "no_aplica_si": array(TEXT, 8), "evidencia_ids": IDS,
                "cobertura_estimada": TEXT, "confianza": CONFIDENCE, "contraejemplo_que_la_tumba": TEXT,
                "dato_faltante_para_promover": TEXT, "status": {"type": "string", "enum": ["pending_human"]},
                "version_propuesta": {"type": "string", "enum": ["v1"]}, "novelty_summary": TEXT})
NOTE = obj({"title": TEXT, "reason": TEXT, "evidence_ids": IDS})
COMPILER_SCHEMA = obj({"proposals": array(PROPOSAL, 12), "notes": array(NOTE, 20),
                       "rejected_echoes": array(TEXT, 20), "reasoning_steps": REASONING})


def validate_schema(value, schema: dict, path: str = "$") -> None:
    types = schema.get("type", [])
    types = [types] if isinstance(types, str) else types
    checks = {"object": isinstance(value, dict), "array": isinstance(value, list), "string": isinstance(value, str),
              "number": type(value) in (int, float) and math.isfinite(value), "integer": type(value) is int,
              "boolean": type(value) is bool, "null": value is None}
    if types and not any(checks.get(t, False) for t in types):
        raise ValueError(f"{path}: wrong JSON type")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path}: value outside enum")
    if isinstance(value, dict):
        if any(key not in value for key in schema.get("required", [])):
            raise ValueError(f"{path}: missing required fields")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False and set(value) - set(properties):
            raise ValueError(f"{path}: unknown fields")
        for key, item in value.items():
            if key in properties:
                validate_schema(item, properties[key], f"{path}.{key}")
    if isinstance(value, list):
        if not schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", 10000):
            raise ValueError(f"{path}: item count outside required limits")
        for index, item in enumerate(value):
            validate_schema(item, schema.get("items", {}), f"{path}[{index}]")
    if isinstance(value, str) and not schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", 100000):
        raise ValueError(f"{path}: string length outside limits")
    if type(value) in (int, float) and (value < schema.get("minimum", float("-inf")) or value > schema.get("maximum", float("inf"))):
        raise ValueError(f"{path}: numeric bound exceeded")


def cited_ids(value, keys=("evidence_ids", "evidencia_ids")) -> set[str]:
    result = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key in keys and isinstance(item, list):
                result.update(item)
            else:
                result.update(cited_ids(item, keys))
    elif isinstance(value, list):
        for item in value:
            result.update(cited_ids(item, keys))
    return result


def normalize_public_steps(output: dict) -> bool:
    """Lift already-written public steps; never fabricate an explanation or another model call."""
    if output.get("reasoning_steps"):
        return False
    steps = []
    for key in ("reviews", "findings"):
        for artifact in output.get(key, []):
            for step in artifact.get("reasoning_steps", []):
                if isinstance(step, dict):
                    steps.append(dict(step, n=len(steps) + 1))
                if len(steps) == 12:
                    break
            if len(steps) == 12:
                break
    if not steps:
        return False
    output["reasoning_steps"] = steps
    return True


def validate_references(output: dict, evidence: set[str], subjects: set[str]) -> None:
    missing = cited_ids(output) - evidence
    if missing:
        raise ValueError("Unseen or unknown evidence citations: " + ", ".join(sorted(missing)[:5]))
    for key in ("reviews", "findings"):
        for item in output.get(key, []):
            refs = set(item.get("ids", [])) | set(item.get("tag_ids", [])) | set(item.get("exemplar_ids", [])) | set(item.get("bridge_to_tags", []))
            refs.update(item.get("new_lead", {}).get("ids", []))
            if refs - subjects:
                raise ValueError("Unknown investigation subject ID")
            if not item.get("reasoning_steps") or not item.get("licit_explanation_considered", "").strip():
                raise ValueError("Investigation needs public evidence steps and a licit explanation")
            if item.get("compiler_proposal") != "none" and not cited_ids(item):
                raise ValueError("An actionable hypothesis requires cited local evidence")
    if not output.get("reasoning_steps"):
        raise ValueError("Public investigation/compilation steps are required")


def predicate_signature(predicates: list[dict]) -> str:
    def normalized(value):
        if type(value) in (int, float):
            return float(value)
        if isinstance(value, list):
            return sorted((normalized(item) for item in value), key=lambda item: json.dumps(item))
        return value
    atoms = [{"field": p.get("field"), "operator": p.get("operator"), "value": normalized(p.get("value"))} for p in predicates]
    return json.dumps(sorted(atoms, key=lambda a: json.dumps(a, sort_keys=True)), sort_keys=True)


def gate_proposals(output: dict, evidence: set[str], memory: dict) -> tuple[list, list]:
    notes, accepted = list(output.get("notes", [])), []
    blocked = {predicate_signature(item["predicados"]) for kind in ("canonical_typologies", "rejected", "absorbed")
               for item in memory.get(kind, []) if item.get("predicados")}
    known_rules = {x.get("rule_id", x.get("id")) for x in memory.get("canonical_typologies", [])}
    seen = set()
    for proposal in output.get("proposals", []):
        reason = None
        signature = predicate_signature(proposal.get("predicados", []))
        if not proposal.get("predicados"):
            reason = "Sin predicados atómicos: queda como nota, no como regla."
        elif not proposal.get("evidencia_ids") or set(proposal["evidencia_ids"]) - evidence:
            reason = "La propuesta no tiene evidencia local recibida y verificable."
        elif signature in blocked or signature in seen:
            reason = "Predicados ya canónicos, rechazados o repetidos en esta corrida."
        elif proposal["tipo"] in {"ajuste", "anti_patron"} and proposal.get("sobre_regla") not in known_rules:
            reason = "El ajuste o anti-patrón no identifica una regla canónica existente."
        elif proposal["tipo"] == "nueva" and proposal.get("sobre_regla") in known_rules and not proposal.get("novelty_summary", "").strip():
            reason = "Repetición de una regla existente sin novedad identificable."
        elif not proposal.get("contraejemplo_que_la_tumba", "").strip() or not proposal.get("novelty_summary", "").strip():
            reason = "Falta un contraejemplo verificable o la diferencia frente a lo canónico."
        elif any((p["operator"] in {"in", "not_in"}) != isinstance(p["value"], list) for p in proposal["predicados"]):
            reason = "Tipo de valor incompatible con el operador del predicado."
        elif any(p["operator"] in {"gt", "gte", "lt", "lte"} and type(p["value"]) not in (int, float) for p in proposal["predicados"]):
            reason = "Las comparaciones de umbral requieren valores numéricos."
        if reason:
            notes.append({"title": proposal.get("nombre", "Propuesta incompleta"), "reason": reason,
                          "evidence_ids": sorted(set(proposal.get("evidencia_ids", [])) & evidence)})
        else:
            accepted.append(dict(proposal, status="pending_human"))
            seen.add(signature)
    return accepted, notes
