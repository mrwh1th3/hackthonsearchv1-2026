"""Append-only spans, exact prompts and atomic UI summaries."""
from __future__ import annotations

import json
import time
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path


LLM_ACTORS = frozenset({"sector_selector", "agent_a", "agent_b", "compiler"})


def usage_metadata(result: dict | None = None, events: list | None = None) -> dict:
    """Keep aggregate input/output and the cached-input subset separate.

    Missing usage is unknown, including errors whose event stream contains
    progress but no usage. Explicit response counters take precedence over
    their duplicate provider-event counters.
    """
    result = result or {}
    events = events if events is not None else result.get("provider_events", [])
    usages = [item["usage"] for item in (events or [])
              if isinstance(item, dict) and isinstance(item.get("usage"), dict)]

    def count(value):
        return value if type(value) is int and value >= 0 else None

    def counter(key, provider_key):
        direct = count(result.get(key))
        if direct is not None:
            return direct
        values = [count(usage.get(provider_key)) for usage in usages]
        return sum(values) if values and all(value is not None for value in values) else None

    tokens_in = counter("tokens_in", "input_tokens")
    tokens_out = counter("tokens_out", "output_tokens")
    cached = counter("cached_tokens_in", "cached_input_tokens")
    unknown = tokens_in is None or tokens_out is None or bool(result.get("tokens_unknown") or result.get("usage_unknown"))
    return {"tokens_in": tokens_in or 0, "tokens_out": tokens_out or 0,
            "cached_tokens_in": cached, "cached_usage_incomplete": cached is None,
            "tokens_estimated": bool(result.get("tokens_estimated")) or unknown,
            "tokens_unknown": unknown, "usage_incomplete": bool(result.get("usage_incomplete")) or unknown}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str) + "\n")
    temporary.replace(path)


class Tracer:
    def __init__(self, run_id: str, directory: Path):
        self.run_id, self.directory = run_id, directory
        self.events = []
        self.lock = threading.RLock()

    def run(self, actor: str, step: str, rationale: str, call, input_ref="", output_ref="", ids=None):
        start, clock = now(), time.monotonic()
        usage_recorded = False
        event = {"run_id": self.run_id, "span_id": str(uuid.uuid4()), "parent_span_id": None,
                 "ts_start": start, "actor": actor, "step": step,
                 "thought": rationale, "rationale": rationale, "input_ref": input_ref, "output_ref": output_ref,
                 "evidence_ids": ids or [], "tokens_in": 0, "tokens_out": 0, "tokens_estimated": False,
                 "cached_tokens_in": 0, "cached_usage_incomplete": False,
                 "model": "", "cost_usd_est": None, "error": None}
        try:
            result = call()
            if actor in LLM_ACTORS:
                metadata = result if isinstance(result, dict) else {}
                event.update(usage_metadata(metadata))
                event["model"] = metadata.get("model", "")
                if metadata.get("provider_events"):
                    event["provider_events"] = metadata["provider_events"]
                usage_recorded = True
            if output_ref:
                write_json(self.directory / output_ref, result)
            return result
        except Exception as exc:
            event["error"] = str(exc)[:1600]
            if actor in LLM_ACTORS and not usage_recorded:
                provider_events = getattr(exc, "events", [])
                event.update(usage_metadata(events=provider_events))
                if provider_events:
                    event["provider_events"] = provider_events
            raise
        finally:
            event["ts_end"] = now()
            event["duration_ms"] = round((time.monotonic() - clock) * 1000)
            with self.lock:
                self.events.append(event)
                with (self.directory / "traces.jsonl").open("a") as output:
                    output.write(json.dumps(event, ensure_ascii=False) + "\n")

    def totals(self) -> dict:
        actors = {}
        with self.lock:
            events = list(self.events)
        for event in events:
            actor = event["actor"]
            item = actors.setdefault(actor, {"calls": 0, "tokens_in": 0, "tokens_out": 0, "duration_ms": 0,
                                             "cached_tokens_in": 0, "cached_usage_incomplete": False})
            item["calls"] += 1
            for key in ("tokens_in", "tokens_out", "duration_ms"):
                item[key] += event.get(key) or 0
            if event.get("cached_tokens_in") is None or item["cached_tokens_in"] is None:
                item["cached_tokens_in"] = None
                item["cached_usage_incomplete"] = True
            else:
                item["cached_tokens_in"] += event["cached_tokens_in"]
        llms = [event for event in events if event["actor"] in LLM_ACTORS]
        cache_unknown = any(e.get("cached_tokens_in") is None for e in llms)
        return {"by_actor": actors, "total_tokens_in": sum(e.get("tokens_in") or 0 for e in llms),
                "total_tokens_out": sum(e.get("tokens_out") or 0 for e in llms),
                "total_cached_tokens_in": None if cache_unknown else sum(e.get("cached_tokens_in") or 0 for e in llms),
                "cached_usage_incomplete": cache_unknown,
                "tokens_estimated": any(e.get("tokens_estimated") for e in llms),
                "usage_incomplete": any(e.get("usage_incomplete") for e in llms), "cost_usd_est": None}
