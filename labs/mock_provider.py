"""Explicit offline provider: demonstrates plumbing, never invents a fraud finding."""
import json
import time


class MockProvider:
    name = "mock"

    def call(self, actor: str, prompt: str, schema: dict) -> dict:
        start = time.monotonic()
        payload = json.loads(prompt.split("RECORTE_JSON_NO_CONFIABLE:\n", 1)[1])
        step = {"n": 1, "action": "conclude", "claim": "Simulación offline: se verificó el recorrido sin inferir fraude ni fabricar propuestas.",
                "evidence_ids": [], "open_question": "Ejecutar el proveedor real con evidencia suficiente para una investigación."}
        if actor == "sector_selector":
            output = {"giro": "operaciones empresariales generales", "basis": "Simulación sin inferencia sectorial.", "certainty": "unknown", "reasoning_steps": [step]}
        elif actor == "agent_a":
            reviews = []
            for group in payload.get("groups", []):
                examples = group.get("exemplars", [])
                evidence = sorted({x for row in examples for x in row.get("evidence_ids", [])})
                step_schema = schema["properties"]["reviews"]["items"]["properties"]["reasoning_steps"]
                refs_per_step = step_schema["items"]["properties"]["evidence_ids"].get("maxItems", 40)
                max_steps = step_schema.get("maxItems", 12)
                # Rich groups can contain 8 × 20 references. Preserve those references
                # across bounded public steps instead of violating the per-step contract.
                chunks = [evidence[i:i + refs_per_step] for i in range(0, len(evidence), refs_per_step)] or [[]]
                public_steps = [dict(step, n=index + 1, evidence_ids=refs,
                                     claim=f"Simulación offline: lote {index + 1} de referencias del recorte recibido; no se infiere fraude ni se fabrican propuestas.")
                                for index, refs in enumerate(chunks[:max_steps])]
                reviews.append({"rule_id": group["rule_id"], "tag_ids": [row["subject_id"] for row in examples if row["status"] == "finding"],
                                "group_size": group["group_size"], "exemplar_ids": [row["subject_id"] for row in examples],
                                "verdict": "dato_insuficiente", "reasoning_steps": public_steps,
                                "licit_explanation_considered": "Las órdenes, contratos y operaciones legítimas deben contrastarse; el mock no evalúa su validez.",
                                "new_lead": {"ids": [], "hypothesis": ""}, "compiler_proposal": "none", "confidence": 0,
                                "missing_datum_to_close": "Investigación real del recorte y su documentación."})
            output = {"reviews": reviews, "reasoning_steps": [step], "tool_requests": []}
        elif actor == "agent_b":
            output = {"findings": [], "reasoning_steps": [step], "tool_requests": []}
        else:
            output = {"proposals": [], "notes": [{"title": "Recorrido de demostración", "reason": "El proveedor mock no genera conclusiones ni propuestas de regla.", "evidence_ids": []}],
                      "rejected_echoes": [], "reasoning_steps": [step]}
        return {"output": output, "tokens_in": 0, "tokens_out": 0, "tokens_estimated": False,
                "model": "mock-offline", "duration_ms": round((time.monotonic() - start) * 1000)}
