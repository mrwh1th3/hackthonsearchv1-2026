"""Code-only, bounded A/B investigation and final compilation.

    python -m labs.runner run --engine-output run_log.json --giro construccion --out data/labs/runs --provider mock
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .adapter import LogicalEngineResult
from .agents import a_questioner, b_residual
from .compiler import compile as compiler
from .contracts import A_SCHEMA, B_SCHEMA, COMPILER_SCHEMA, cited_ids, gate_proposals, normalize_public_steps, validate_references, validate_schema
from .memory_store import MemoryStore
from .mock_provider import MockProvider
from .sampling import sample
from .tools import DataTools
from .tracing import Tracer, now, usage_metadata, write_json


def collect_evidence(value) -> set[str]:
    result = cited_ids(value)
    if isinstance(value, dict):
        if isinstance(value.get("evidence_id"), str):
            result.add(value["evidence_id"])
        for item in value.values():
            result.update(collect_evidence(item))
    elif isinstance(value, list):
        for item in value:
            result.update(collect_evidence(item))
    return result


def string_values(value) -> set[str]:
    if isinstance(value, str):
        return {value}
    if isinstance(value, dict):
        return set().union(*(string_values(item) for item in value.values())) if value else set()
    if isinstance(value, list):
        return set().union(*(string_values(item) for item in value)) if value else set()
    return set()


def compact_context(context: dict) -> dict:
    """Repeat only a bounded research brief in prompts; complete sources stay on disk."""
    def phrases(values, count=3, length=180):
        return [str(value)[:length] for value in (values or [])[:count]]

    sources = [{key: source.get(key, "") for key in ("title", "url", "published_at", "event_date", "legal_status", "verification")}
               for source in context.get("sources", [])[:5] if isinstance(source, dict)]
    mechanisms = []
    for mechanism in context.get("mechanisms", [])[:5]:
        if not isinstance(mechanism, dict):
            continue
        mechanisms.append({**{key: str(mechanism.get(key, ""))[:240] for key in ("name", "vulnerability", "distinctive_detail")},
                           **{key: phrases(mechanism.get(key, [])) for key in ("actions", "concealment", "observable_signals", "licit_alternatives", "disconfirming_evidence")},
                           "source_urls": mechanism.get("source_urls", [])[:5]})
    return {**{key: context.get(key) for key in ("status", "giro", "origin", "reference_status", "freshness", "as_of", "researched_at", "refresh_after")},
            "mechanisms": mechanisms, "normal_operations": phrases(context.get("normal_operations", []), 6),
            "sources": sources, "limitations": phrases(context.get("limitations", []), 6, 400),
            "excerpt_scope": "At most five mechanisms/sources, six normal operations and three short entries per mechanism list. Full context is stored in the context tool artifact; omissions do not establish absence."}


class Runner:
    def __init__(self, engine_output: str, giro: str, out: str, provider=None, context=None,
                 estate: str | None = None, run_id: str | None = None, max_calls: int = 6,
                 max_groups: int = 2, memory_dir: str | None = None, focus: str = "", focus_from: str = "", focus_to: str = ""):
        if type(max_calls) is not int or not 3 <= max_calls <= 6:
            raise ValueError("max_calls must be 3..6")
        if type(max_groups) is not int or not 1 <= max_groups <= 4:
            raise ValueError("max_groups must be 1..4")
        self.run_id = str(uuid.UUID(run_id)) if run_id else str(uuid.uuid4())
        if len(giro) > 120:
            raise ValueError("giro must contain at most 120 characters")
        if len(focus) > 4000:
            raise ValueError("focus exceeds 4000 characters")
        if bool(focus_from) != bool(focus_to):
            raise ValueError("Both focus dates are required")
        if focus_from:
            from datetime import date
            if date.fromisoformat(focus_from) > date.fromisoformat(focus_to):
                raise ValueError("Invalid focus period")
        if not giro.strip() and max_calls < 4:
            raise ValueError("Automatic sector selection requires at least four calls")
        self.focus = {"message": focus.strip(), "from": focus_from, "to_inclusive": focus_to,
                      "scope": "Prioritize these dates and this focus in agent investigation and presentation. The motor covers the full estate; cross-period relationships remain available. User focus is not evidence and must never suppress contradictory findings."}
        self.giro, self.input, self.estate = giro.strip(), engine_output, estate
        self.directory = Path(out).resolve() / self.run_id
        if self.directory.exists():
            allowed_prepared = {"launch.json", "worker.json", "engine_input.json", "worker.log", "engine", "engine_trace.json"}
            if not (self.directory / "launch.json").is_file() or any(p.name not in allowed_prepared for p in self.directory.iterdir()):
                raise ValueError("Run already exists or directory is not a prepared web launch")
            if (self.directory / "engine").exists() and ((self.directory / "engine").is_symlink() or not (self.directory / "engine").is_dir()):
                raise ValueError("Prepared engine artifacts must be a regular directory")
            launch = json.loads((self.directory / "launch.json").read_text())
            if launch.get("status") not in {"queued", "running"}:
                raise ValueError("Only a queued/running prepared launch may start the runner")
        else:
            self.directory.mkdir(parents=True, exist_ok=False)
        # Exclusive creation fences concurrent invocations, including prepared UI directories.
        (self.directory / ".runner.lock").open("x").close()
        (self.directory / "prompts").mkdir()
        self.provider = provider or MockProvider()
        self.provider_name = getattr(self.provider, "name", "codex")
        if context is None:
            from .context import ContextStore
            context = ContextStore(provider=self.provider if self.provider_name == "codex" else None)
        self.context = context
        self.max_calls = max_calls
        self.max_groups = max_groups
        self.calls = 0
        self.lock = threading.RLock()
        self.trace = Tracer(self.run_id, self.directory)
        self.memory = MemoryStore(Path(memory_dir) if memory_dir else Path(out).resolve().parent / "memory")
        self.started_at, self.started_clock = now(), time.monotonic()
        self.errors, self.limitations, self.context_usages = [], [], []
        self.followups = {actor: {"status": "not_requested", "requested_tools": 0, "executed_tools": 0, "review_completed": False}
                          for actor in ("agent_a", "agent_b")}
        self.stages = [{"id": key, "label": label, "status": "pending", "detail": ""} for key, label in (
            ("load", "Leer motor y memoria"), ("context", "Contexto del giro"), ("sample", "Delimitar muestras"),
            ("agent_a", "A · Cuestionar señales"), ("agent_b", "B · Explorar lo restante"),
            ("handoff", "Conectar evidencia incidental"), ("compiler", "Formalizar propuestas"), ("persist", "Guardar para revisión"))]
        self.brief, self.proposals, self.notes = {}, [], []
        self.a = {"reviews": [], "reasoning_steps": [], "tool_requests": []}
        self.b = {"findings": [], "reasoning_steps": [], "tool_requests": []}
        self.compiled = {"proposals": [], "notes": [], "rejected_echoes": [], "reasoning_steps": []}
        self.status = "running"
        self.persist_summary()

    def stage(self, key: str, status: str, detail: str = ""):
        for item in self.stages:
            if item["id"] == key:
                item.update(status=status, detail=detail)
        self.persist_summary()

    def persist_summary(self) -> dict:
        with self.lock:
            return self._persist_summary()

    def _persist_summary(self) -> dict:
        counts = self.brief.get("counts", {})
        context_cache_unknown = any(x.get("cached_tokens_in") is None for x in self.context_usages)
        summary = {"schema_version": 1, "run_id": self.run_id, "status": self.status,
                   "provider": self.provider_name, "giro": self.giro, "started_at": self.started_at,
                   "completed_at": now() if self.status != "running" else None,
                   "total_duration_ms": round((time.monotonic() - self.started_clock) * 1000),
                   "llm_calls": self.calls, "max_llm_calls": self.max_calls, **self.trace.totals(),
                   "call_allocation": "One batched A review and one B review; one evidence follow-up each; compiler reserved. B takes the first available follow-up slot under a smaller budget.",
                   "tool_followups": self.followups,
                   "counts": {**counts, "a_groups": len(self.brief.get("sample_for_a", [])),
                              "a_reviews": len(self.a["reviews"]), "b_findings": len(self.b["findings"]),
                              "proposals": len(self.proposals), "notes": len(self.notes)},
                   "coverage": {**self.brief.get("coverage", {}), "limitations": list(dict.fromkeys(self.limitations))},
                   "sector_research": {"calls": len(self.context_usages),
                                       "tokens_in": sum(x.get("tokens_in") or 0 for x in self.context_usages),
                                       "tokens_out": sum(x.get("tokens_out") or 0 for x in self.context_usages),
                                       "cached_tokens_in": None if context_cache_unknown else sum(x.get("cached_tokens_in") or 0 for x in self.context_usages),
                                       "cached_usage_incomplete": context_cache_unknown,
                                       "tokens_estimated": any(x.get("tokens_estimated") for x in self.context_usages),
                                       "usage_unknown": any(x.get("usage_unknown") for x in self.context_usages),
                                       "cost_usd_est": None, "budget_separate": True},
                   "stages": self.stages, "errors": self.errors,
                   "artifacts": {"brief": "brief.json", "agent_a": "agent_a.json", "agent_b": "agent_b.json",
                                 "compiler": "compiler.json", "proposals": "proposals.json", "notes": "notes.json", "traces": "traces.jsonl"},
                   "decision_policy": "Laboratory hypotheses only. Original engine findings unchanged; every rule proposal requires human review."}
        summary["usage_incomplete"] = summary["usage_incomplete"] or summary["sector_research"]["usage_unknown"]
        write_json(self.directory / "summary.json", summary)
        return summary

    def call_llm(self, actor: str, payload: dict, prompt_fn, schema: dict, step="think") -> dict | None:
        with self.lock:
            if self.calls >= self.max_calls or actor != "compiler" and self.calls >= self.max_calls - 1:
                self.limitations.append(f"Call budget prevented an additional {actor} step.")
                return None
            self.calls += 1
            sequence = self.calls
        self.persist_summary()
        if actor == "agent_b":
            # Labels are limited to subjects already visible in B's bounded neighborhood,
            # including fresh tool results. The complete tagged universe stays in code.
            tagged = set(self.engine.zones["tagged"])
            payload = dict(payload, tagged_ids_in_scope=sorted(string_values(payload) & tagged),
                           tagged_subjects_total=len(tagged))
        prompt = prompt_fn(payload)
        schema = copy.deepcopy(schema)
        if "tool_requests" in schema["properties"]:
            # Strict output schemas expose only IDs already offered in this bounded slice.
            # A typo must not become a fabricated lookup or make nine valid IDs disappear.
            offered = sorted(string_values(payload) & (self.tools.allowed_subjects | self.tools.allowed_evidence))
            request_ids = schema["properties"]["tool_requests"]["items"]["properties"]["ids"]
            if offered:
                request_ids["items"] = {**request_ids["items"], "enum": offered}
            else:
                request_ids["maxItems"] = 0
        if actor == "agent_a":
            rules = [group["rule_id"] for group in payload.get("groups", [])]
            reviews = schema["properties"]["reviews"]
            reviews.update(minItems=len(rules), maxItems=len(rules))
            if rules:
                properties = reviews["items"]["properties"]
                properties["rule_id"] = {**properties["rule_id"], "enum": rules}
        prompt_ref = f"prompts/{sequence:02d}_{actor}.txt"
        (self.directory / prompt_ref).write_text(prompt)
        write_json(self.directory / f"prompts/{sequence:02d}_{actor}.schema.json", schema)
        # Memory may mention IDs from earlier snapshots. It is context, not current evidence.
        visible = collect_evidence(payload) & self.tools.allowed_evidence
        try:
            if len(prompt.encode()) > 150_000:
                raise ValueError("Bounded prompt exceeded 150 KB; reduce samples/context")
            result = self.trace.run(actor, step, f"{actor}: contrastar el recorte recibido y devolver conclusiones citadas conforme al contrato.",
                                    lambda: self.provider.call(actor, prompt, schema), input_ref=prompt_ref,
                                    output_ref=f"responses/{sequence:02d}_{actor}.json", ids=sorted(visible))
            output = result["output"]
            if normalize_public_steps(output):
                self.trace.run("runner", "normalize", "Conservar los pasos públicos que el modelo ya escribió en sus revisiones; reflejarlos también en el resumen raíz sin inventar explicaciones.",
                               lambda: {"actor": actor, "source": "nested_public_steps", "steps": len(output["reasoning_steps"])},
                               output_ref=f"normalizations/{sequence:02d}_{actor}.json")
            validate_schema(output, schema)
            validate_references(output, visible, self.tools.allowed_subjects)
            if actor == "agent_a":
                expected = {group["rule_id"] for group in payload.get("groups", [])}
                actual = {review["rule_id"] for review in output["reviews"]}
                if expected != actual or len(output["reviews"]) != len(expected):
                    raise ValueError("A must return exactly one review for each supplied rule group")
                for review in output["reviews"]:
                    group = next(group for group in payload["groups"] if group["rule_id"] == review["rule_id"])
                    review["group_size"] = group["group_size"]
                    review["tag_ids"] = sorted({row["subject_id"] for row in group["exemplars"] if row["status"] == "finding"})
                    review["exemplar_ids"] = [row["subject_id"] for row in group["exemplars"]]
                    if review["verdict"] == "sostiene" and not review["new_lead"]["ids"]:
                        review["compiler_proposal"] = "none"
            write_json(self.directory / f"validated/{sequence:02d}_{actor}.json", output)
            return output
        except Exception as exc:
            self.errors.append({"actor": actor, "step": step, "message": str(exc)[:1600]})
            self.trace.run("runner", "validate", "La salida inválida queda excluida de hallazgos y del compilador.",
                           lambda: {"status": "rejected", "actor": actor, "error": str(exc)[:1600]},
                           output_ref=f"rejected/{sequence:02d}_{actor}.json")
            return None
        finally:
            self.persist_summary()

    def execute_tool(self, name: str, ids=None, giro="", max_hops=4, purpose="Obtener evidencia acotada") -> dict:
        index = len(self.trace.events) + 1
        requested = ids or []
        allowed = self.tools.allowed_subjects if name in {"subject_slice", "graph_paths"} else self.tools.allowed_subjects | self.tools.allowed_evidence
        accepted = [ref for ref in requested if ref in allowed]
        rejected = [ref for ref in requested if ref not in allowed]

        def perform():
            if name != "context" and requested and not accepted:
                raise ValueError("All requested IDs are unknown; no ID was guessed or silently corrected")
            value = self.tools.call(name, ids=accepted, giro=giro, max_hops=max_hops)
            if rejected:
                value = dict(value, rejected_ids=rejected, status="partial" if value.get("status") == "ready" else value.get("status"))
                self.limitations.append(f"Tool {name} rejected {len(rejected)} unknown IDs and processed {len(accepted)} valid IDs.")
            return value

        try:
            value = self.trace.run(f"tool:{name}", "tool", purpose,
                                   perform,
                                   input_ref="sha256:" + hashlib.sha256(json.dumps([name, ids, giro, max_hops]).encode()).hexdigest(),
                                   output_ref=f"tools/{index:03d}_{name}.json", ids=ids)
            if name == "context" and value.get("current_usage"):
                # Only this invocation's research is charged; a cache hit may
                # retain historical research_usage but has no current_usage.
                metadata = usage_metadata(value["current_usage"], value.get("search_events", []))
                self.context_usages.append({**value["current_usage"], **metadata,
                                            "usage_unknown": metadata["tokens_unknown"] or metadata["usage_incomplete"]})
            return value
        except Exception as exc:
            self.limitations.append(f"Tool {name} unavailable: {str(exc)[:180]}")
            return {"status": "unavailable", "error": str(exc)[:300]}

    def run(self) -> dict:
        try:
            self.stage("load", "running")
            self.engine = self.trace.run("runner", "load", "Leer snapshot del motor sin alterar sus resultados.", lambda: LogicalEngineResult.load(self.input), input_ref=str(Path(self.input).resolve()))
            if self.estate:
                self.trace.run("tool:estate_universe", "load", "Recuperar sujetos sin señal del padrón canónico; no vuelve a ejecutar detectores.",
                               lambda: self.engine.add_estate_universe(self.estate), input_ref=str(Path(self.estate).resolve()))
            memory = self.trace.run("tool:memory_lookup", "load", "Consultar reglas canónicas, excepciones y propuestas previas.", self.memory.load, output_ref="memory_snapshot.json")
            self.limitations.extend(self.engine.limitations)
            self.tools = DataTools(self.engine, self.estate, self.context)
            if not self.estate:
                self.limitations.append("No canonical estate attached: row-level SQL evidence tools are unavailable.")
            self.stage("load", "completed", f"{len(self.engine.records)} registros de clasificación del motor")
            self.stage("context", "running")
            if not self.giro:
                from .focus import sector_inputs, sector_prompt, SECTOR_SCHEMA
                inputs = self.trace.run("tool:sector_inputs", "prepare", "Leer actividades acotadas para orientar la herramienta sectorial.",
                                        lambda: sector_inputs(self.estate, self.engine.raw), output_ref="tools/sector_inputs.json")
                selection = self.call_llm("sector_selector", dict(inputs, user_focus=self.focus), sector_prompt, SECTOR_SCHEMA, "prepare")
                self.giro = selection["giro"] if selection else "operaciones empresariales generales"
                if not selection or selection["certainty"] == "unknown":
                    self.limitations.append("Sector could not be inferred; general context was used.")
                write_json(self.directory / "sector_selection.json", selection or {"giro": self.giro, "certainty": "unknown"})
            context = self.execute_tool("context", giro=self.giro, purpose="Consulta obligatoria inicial del giro para A y B; separar mecanismos externos de evidencia local.")
            if context.get("status") != "ready":
                self.limitations.append("Sector context is " + context.get("status", "unavailable") + "; external cases must not be assumed verified.")
            self.stage("context", "completed" if context.get("status") == "ready" else "partial", context.get("status", "unavailable"))
            self.stage("sample", "running")
            sampled = self.trace.run("runner", "sample", "Seleccionar grupos de señales y sujetos residuales con límites reproducibles.", lambda: sample(self.engine, self.max_groups), output_ref="sampling.json")
            zones = self.engine.zones
            coverage = {"a_groups_total": sampled["a_groups_total"], "a_groups_sampled": len(sampled["sample_for_a"]),
                        "residual_total": sampled["residual_total"], "residual_sampled": len(sampled["sample_for_b"]),
                        "residual_by_type": sampled["residual_by_type"],
                        "residual_excluded_company_accounts": sampled["residual_excluded_company_accounts"],
                        "unexplored_groups": sampled["unexplored_groups"], "context_status": context.get("status", "unavailable")}
            self.brief = {"schema_version": 1, "run_id": self.run_id, "giro": self.giro, "period": self.engine.raw.get("period"),
                          "count_units": {"counts": "Unique subjects per zone. closed_leads counts subjects, not investigations.",
                                          "sample_for_a": "group_size and stats count subject-check participations; a subject can participate more than once. unique_subjects deduplicates the group.",
                                          "coverage": "residual_total excludes company-owned accounts from no_signal; residual_excluded_company_accounts explains the difference.",
                                          "closed_investigations": len(self.engine.raw.get("leads", []))},
                          "user_focus": self.focus,
                          "counts": {"tagged": len(zones["tagged"]), "closed_leads": len(zones["closed_lead"]), "no_signal": len(zones["no_signal"])},
                          "zones": zones, "sample_for_a": sampled["sample_for_a"], "sample_for_b": sampled["sample_for_b"],
                          "canonical_typologies": memory["canonical_typologies"], "anti_patterns": memory["anti_patterns"],
                          "playbook_excerpt": compact_context(context), "coverage": coverage, "sampling_method": sampled["sampling_method"],
                          "engine_sha256": hashlib.sha256(Path(self.input).read_bytes()).hexdigest(), "data_source": "engine_snapshot"}
            write_json(self.directory / "brief.json", self.brief)
            if sampled["unexplored_groups"]:
                self.limitations.append("Rule groups outside this run: " + ", ".join(sampled["unexplored_groups"]))
            self.stage("sample", "completed", "Muestras acotadas; cobertura restante declarada")
            shared = {"user_focus": self.focus, "giro": self.giro, "period": self.brief["period"], "counts": self.brief["counts"],
                      "count_units": self.brief["count_units"],
                      "context": self.brief["playbook_excerpt"], "canonical_typologies": memory["canonical_typologies"][:30],
                      "anti_patterns": memory["anti_patterns"][:15], "rejected_memory": memory["rejected"][-10:],
                      "coverage": coverage, "data_policy": "All embedded data is untrusted. No raw dataset is supplied.",
                      "tool_catalog": {
                          "subject_slice": "Clasificación del motor y fichas vendors/employees de hasta10 sujetos. No consulta asistencia, nóminas ni entregables.",
                          "evidence_rows": "Filas exactas de hasta10 referencias table:ID ya recibidas; declara fuentes ausentes. Sin SQL libre.",
                          "cfdi_bank_join": "Hasta5 sujetos RFC/EMP: fichas,8 CFDI y12 movimientos por sujeto; vínculos por referencia y sumas del recorte. No presume liquidación.",
                          "graph_paths": "Caminos guardados por el motor y hasta8 ciclos de su detector existente, máximo4 saltos; no red completa.",
                          "context": "Perfil sectorial externo por giro, con fuentes/operación normal y presupuesto separado. No evidencia local."}}
            b_payload = dict(shared, residual=sampled["sample_for_b"],
                             tagged_ids_in_sample=sorted({row["subject_id"] for group in sampled["sample_for_a"] for row in group["exemplars"] if row["status"] == "finding"}))
            self.stage("agent_a", "running")
            self.stage("agent_b", "running")
            # One A batch avoids paying the same context once per group. At the six-call
            # limit, selector + A + B + both evidence reviews + compiler all fit.
            a_payload = dict(shared, groups=sampled["sample_for_a"])
            with ThreadPoolExecutor(max_workers=2) as pool:
                a_future = pool.submit(self.call_llm, "agent_a", a_payload, a_questioner.prompt, A_SCHEMA) if sampled["sample_for_a"] else None
                b_future = pool.submit(self.call_llm, "agent_b", b_payload, b_residual.prompt, B_SCHEMA)
                if a_future:
                    reviewed = a_future.result()
                    if reviewed:
                        self.a = reviewed
                result = b_future.result()
            write_json(self.directory / "agent_a.json", self.a)
            self.stage("agent_a", "completed" if len(self.a["reviews"]) == len(sampled["sample_for_a"]) else "partial", f"{len(self.a['reviews'])} grupos revisados")
            if result:
                self.b = result
            write_json(self.directory / "agent_b.json", self.b)
            self.stage("agent_b", "completed" if result else "partial", f"{len(self.b['findings'])} hipótesis; ninguna modifica el motor")

            # Allocate both investigators before starting a follow-up. B cannot be starved
            # by A's number of groups; restricted budgets disclose the unreviewed evidence.
            available = max(0, self.max_calls - self.calls - 1)
            prepared = []
            for actor, artifact, payload, prompt_fn, schema in (("agent_b", self.b, b_payload, b_residual.prompt, B_SCHEMA),
                                                               ("agent_a", self.a, a_payload, a_questioner.prompt, A_SCHEMA)):
                requests = artifact.get("tool_requests", [])[:2]
                progress = self.followups[actor]
                progress["requested_tools"] = len(requests)
                if requests and available:
                    available -= 1
                    progress["status"] = "running"
                    self.stage(actor, "running", "Obtener evidencia para la revisión final")
                    responses = [{"request": req, "result": self.execute_tool(req["name"], req["ids"], req["giro"], req["max_hops"], req["purpose"])} for req in requests]
                    progress["executed_tools"] = len(responses)
                    follow = dict(payload, prior_artifact=artifact, tool_results=responses, instruction="Última ronda: concluye y deja tool_requests vacío.")
                    prepared.append((actor, follow, prompt_fn, schema))
                elif requests:
                    progress["status"] = "skipped_budget"
                    self.limitations.append(f"Unexecuted {actor} tool requests: call budget reserved for compiler.")
                    self.stage(actor, "partial", "Sin cupo para revisar herramientas; no se ejecutaron esas solicitudes")
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [(actor, pool.submit(self.call_llm, actor, payload, prompt_fn, schema, "conclude"))
                           for actor, payload, prompt_fn, schema in prepared]
                for actor, future in futures:
                    updated = future.result()
                    progress = self.followups[actor]
                    progress.update(status="completed" if updated else "failed", review_completed=bool(updated))
                    if updated:
                        if actor == "agent_a":
                            self.a = updated
                        else:
                            self.b = updated
                        write_json(self.directory / f"{actor}.json", updated)
                    if updated and updated.get("tool_requests"):
                        self.limitations.append(f"Further {actor} tool requests not executed: one-round limit.")
                        progress["status"] = "limited_one_round"
                    self.stage(actor, "completed" if progress["status"] == "completed" else "partial",
                               "Evidencia revisada en la ronda final" if updated else "Herramientas ejecutadas; revisión final inválida o incompleta")

            bridge_ids = set()
            for review in self.a["reviews"]:
                bridge_ids.update(set(review["new_lead"]["ids"]) & set(zones["no_signal"]))
            for finding in self.b["findings"]:
                if set(finding["bridge_to_tags"]) & set(zones["tagged"]):
                    bridge_ids.update(finding["bridge_to_tags"])
                    bridge_ids.update(finding["ids"])
            bridge_ids = sorted(bridge_ids & self.tools.allowed_subjects)[:10]
            if bridge_ids and self.calls < self.max_calls - 1:
                self.stage("handoff", "running", "IDs cruzados detectados por código")
                handoff = self.execute_tool("subject_slice", bridge_ids, purpose="Obtener únicamente los sujetos de la conexión incidental.")
                result = self.call_llm("agent_a", dict(shared, groups=[], bridge_ids=bridge_ids, bridge_slice=handoff,
                                                       prior_a=self.a, prior_b=self.b, instruction="Conexión incidental única: groups vacío, devuelve reviews=[] y reasoning_steps sobre la conexión."), a_questioner.prompt, A_SCHEMA, "handoff")
                write_json(self.directory / "handoff.json", {"ids": bridge_ids, "recipient": "agent_a", "artifact": result,
                                                             "status": "completed" if result else "failed"})
                if result:
                    self.a["reasoning_steps"].extend(result["reasoning_steps"])
                    write_json(self.directory / "agent_a.json", self.a)
                self.stage("handoff", "completed" if result else "partial", "Una fase acotada de conexión")
            else:
                self.stage("handoff", "skipped", "Sin cruces incidentales" if not bridge_ids else "Presupuesto reservado para compilador")
                if bridge_ids:
                    self.limitations.append("Incidental bridge found but handoff omitted to preserve compiler budget.")

            self.stage("compiler", "running")
            compile_payload = dict(shared, agent_a=self.a, agent_b=self.b, limitations=self.limitations,
                                   observed_evidence=sorted(collect_evidence(self.a) | collect_evidence(self.b)),
                                   previous_proposals=memory["pending"][-10:])
            result = self.call_llm("compiler", compile_payload, compiler.prompt, COMPILER_SCHEMA, "compile")
            if result:
                self.compiled = result
                self.proposals, self.notes = gate_proposals(result, collect_evidence(self.a) | collect_evidence(self.b), memory)
                for proposal in self.proposals:
                    proposal["id"] = str(uuid.uuid5(uuid.UUID(self.run_id), proposal["id"]))
            else:
                self.notes = [{"title": "Compilación incompleta", "reason": "No se obtuvo una salida válida; no se promovió ninguna propuesta.", "evidence_ids": []}]
            write_json(self.directory / "compiler.json", self.compiled)
            self.stage("compiler", "completed" if result else "partial", f"{len(self.proposals)} propuestas con predicados validados")
            self.stage("persist", "running")
            write_json(self.directory / "proposals.json", self.proposals)
            write_json(self.directory / "notes.json", self.notes)
            self.trace.run("runner", "persist", "Guardar propuestas pending_human; ninguna regla se activa automáticamente.", lambda: self.memory.append_pending(self.run_id, self.proposals))
            self.stage("persist", "completed", "Artefactos y trazas persistidos")
            self.status = "partial" if self.errors or self.limitations else "completed"
        except Exception as exc:
            self.status = "failed"
            self.errors.append({"actor": "runner", "step": "run", "message": str(exc)[:1600]})
            for stage in self.stages:
                if stage["status"] == "running":
                    stage.update(status="failed", detail=str(exc)[:200])
        finally:
            if hasattr(self, "tools"):
                self.tools.close()
            summary = self.persist_summary()
        return summary


def report(summary: dict):
    print(f"run_id={summary['run_id']} status={summary['status']} provider={summary['provider']} calls={summary['llm_calls']}/{summary['max_llm_calls']}")
    print(f"{'Actor':<24} {'Calls':>6} {'Tokens in':>12} {'Tokens out':>12} {'Time ms':>12}")
    for actor, row in sorted(summary.get("by_actor", {}).items()):
        print(f"{actor:<24} {row['calls']:>6} {row['tokens_in']:>12} {row['tokens_out']:>12} {row['duration_ms']:>12}")
    print("Cost: unavailable (subscription); no dollar cost inferred. Sector research usage is separate.")


def main(argv=None) -> int:
    from .provider import install_shutdown_handlers
    install_shutdown_handlers()
    parser = argparse.ArgumentParser(prog="labs.runner")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--engine-output", required=True)
    run.add_argument("--giro", default="")
    run.add_argument("--focus", default="")
    run.add_argument("--focus-from", default="")
    run.add_argument("--focus-to", default="")
    run.add_argument("--out", default="data/labs/runs")
    run.add_argument("--run-id")
    run.add_argument("--estate")
    run.add_argument("--memory-dir")
    run.add_argument("--provider", choices=["mock", "codex"], default="mock")
    run.add_argument("--max-calls", type=int, default=6)
    run.add_argument("--max-groups", type=int, default=2)
    get = commands.add_parser("report")
    get.add_argument("--run-id", required=True)
    get.add_argument("--out", default="data/labs/runs")
    args = parser.parse_args(argv)
    try:
        if args.command == "report":
            run_id = str(uuid.UUID(args.run_id))
            summary = json.loads((Path(args.out) / run_id / "summary.json").read_text())
        else:
            provider = MockProvider()
            if args.provider == "codex":
                from .provider import CodexProvider
                provider = CodexProvider()
            summary = Runner(args.engine_output, args.giro, args.out, provider=provider, estate=args.estate,
                             run_id=args.run_id, max_calls=args.max_calls, max_groups=args.max_groups, memory_dir=args.memory_dir,
                             focus=args.focus, focus_from=args.focus_from, focus_to=args.focus_to).run()
        report(summary)
        return 1 if summary["status"] == "failed" else 0
    except (ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
