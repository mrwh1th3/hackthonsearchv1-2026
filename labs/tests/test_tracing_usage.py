from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from labs.tracing import Tracer, usage_metadata


class ProviderFailure(RuntimeError):
    def __init__(self, events):
        super().__init__("Provider failed after starting the request")
        self.events = events


class TracingUsageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.trace = Tracer("usage-test", self.directory)

    def fail(self, actor, events):
        def call():
            raise ProviderFailure(events)

        with self.assertRaises(ProviderFailure):
            self.trace.run(actor, "request", "Record the failed request", call)
        return self.trace.events[-1]

    def test_sector_selector_success_preserves_usage_and_cached_subset(self):
        response = {"output": {"sector": "construction"}, "tokens_in": 123, "tokens_out": 17,
                    "cached_tokens_in": 91, "tokens_estimated": False, "model": "test-model"}
        result = self.trace.run("sector_selector", "select", "Choose the sector", lambda: response)

        self.assertIs(result, response)
        event = self.trace.events[-1]
        self.assertEqual(event["tokens_in"], 123)
        self.assertEqual(event["tokens_out"], 17)
        self.assertEqual(event["cached_tokens_in"], 91)
        self.assertEqual(event["model"], "test-model")
        totals = self.trace.totals()
        self.assertEqual(totals["total_tokens_in"], 123)
        self.assertEqual(totals["total_tokens_out"], 17)
        self.assertEqual(totals["total_cached_tokens_in"], 91)
        self.assertEqual(totals["by_actor"]["sector_selector"]["cached_tokens_in"], 91)
        self.assertFalse(totals["tokens_estimated"])
        self.assertFalse(totals["usage_incomplete"])
        self.assertFalse(totals["cached_usage_incomplete"])
        self.assertIsNone(totals["cost_usd_est"])
        persisted = json.loads((self.directory / "traces.jsonl").read_text().splitlines()[-1])
        self.assertEqual(persisted["cached_tokens_in"], 91)

    def test_all_llm_actors_count_cache_separately_without_double_counting_inputs(self):
        rows = [("sector_selector", 11, 3, 7), ("agent_a", 100, 10, 0),
                ("agent_b", 30, 5, 15), ("compiler", 5, 2, 2)]
        for actor, inputs, outputs, cached in rows:
            response = {"tokens_in": inputs, "tokens_out": outputs, "cached_tokens_in": cached,
                        "tokens_estimated": False}
            self.trace.run(actor, "request", "Account for this request", lambda: response)

        totals = self.trace.totals()
        self.assertEqual(totals["total_tokens_in"], 146)
        self.assertEqual(totals["total_tokens_out"], 20)
        self.assertEqual(totals["total_cached_tokens_in"], 24)
        for actor, inputs, outputs, cached in rows:
            with self.subTest(actor=actor):
                row = totals["by_actor"][actor]
                self.assertEqual(row["calls"], 1)
                self.assertEqual(row["tokens_in"], inputs)
                self.assertEqual(row["tokens_out"], outputs)
                self.assertEqual(row["cached_tokens_in"], cached)
                self.assertGreaterEqual(row["duration_ms"], 0)

    def test_failed_selector_preserves_each_reported_usage_event(self):
        events = [
            {"type": "turn.started"},
            {"type": "turn.completed", "usage": {"input_tokens": 40, "output_tokens": 6, "cached_input_tokens": 12}},
            {"type": "turn.completed", "usage": {"input_tokens": 25, "output_tokens": 4, "cached_input_tokens": 8}},
        ]
        event = self.fail("sector_selector", events)

        self.assertEqual(event["provider_events"], events)
        self.assertEqual(event["tokens_in"], 65)
        self.assertEqual(event["tokens_out"], 10)
        self.assertEqual(event["cached_tokens_in"], 20)
        self.assertIsNotNone(event["error"])
        self.assertFalse(event["tokens_estimated"])
        self.assertFalse(event.get("tokens_unknown", False))
        self.assertFalse(event.get("usage_incomplete", False))
        self.assertFalse(event.get("cached_usage_incomplete", False))
        totals = self.trace.totals()
        self.assertEqual(totals["total_tokens_in"], 65)
        self.assertEqual(totals["total_tokens_out"], 10)
        self.assertEqual(totals["total_cached_tokens_in"], 20)

    def test_llm_failures_without_usage_remain_unknown_even_when_events_exist(self):
        for actor in ("sector_selector", "agent_a", "agent_b", "compiler"):
            for events in ([], [{"type": "turn.started"}, {"type": "error", "message": "connection lost"}]):
                with self.subTest(actor=actor, events=events):
                    event = self.fail(actor, events)
                    self.assertTrue(event["usage_incomplete"])
                    self.assertTrue(event["tokens_unknown"])
                    self.assertTrue(event["tokens_estimated"])
                    self.assertIsNone(event["cached_tokens_in"])
                    self.assertTrue(event["cached_usage_incomplete"])
        totals = self.trace.totals()
        self.assertEqual(totals["total_tokens_in"], 0)
        self.assertEqual(totals["total_tokens_out"], 0)
        self.assertTrue(totals["tokens_estimated"])
        self.assertTrue(totals["usage_incomplete"])
        self.assertIsNone(totals["total_cached_tokens_in"])
        self.assertTrue(totals["cached_usage_incomplete"])

    def test_legacy_success_without_cache_does_not_invent_zero_cached_tokens(self):
        response = {"tokens_in": 100, "tokens_out": 5, "tokens_estimated": False}
        self.trace.run("agent_a", "request", "Legacy response without cache data", lambda: response)

        event = self.trace.events[-1]
        self.assertIsNone(event["cached_tokens_in"])
        self.assertTrue(event["cached_usage_incomplete"])
        self.assertFalse(event["tokens_estimated"])
        totals = self.trace.totals()
        self.assertEqual(totals["total_tokens_in"], 100)
        self.assertEqual(totals["total_tokens_out"], 5)
        self.assertIsNone(totals["by_actor"]["agent_a"]["cached_tokens_in"])
        self.assertIsNone(totals["total_cached_tokens_in"])
        self.assertTrue(totals["cached_usage_incomplete"])
        self.assertFalse(totals["usage_incomplete"])

    def test_unknown_cache_makes_the_actor_and_run_aggregate_unknown(self):
        for actor, response in [
            ("agent_a", {"tokens_in": 100, "tokens_out": 5, "cached_tokens_in": 30}),
            ("agent_a", {"tokens_in": 40, "tokens_out": 3}),
            ("sector_selector", {"tokens_in": 10, "tokens_out": 2, "cached_tokens_in": 0}),
        ]:
            self.trace.run(actor, "request", "Preserve incomplete cache accounting", lambda: response)

        totals = self.trace.totals()
        self.assertEqual(totals["total_tokens_in"], 150)
        self.assertEqual(totals["total_tokens_out"], 10)
        self.assertIsNone(totals["by_actor"]["agent_a"]["cached_tokens_in"])
        self.assertEqual(totals["by_actor"]["sector_selector"]["cached_tokens_in"], 0)
        self.assertIsNone(totals["total_cached_tokens_in"])
        self.assertTrue(totals["cached_usage_incomplete"])

    def test_context_snapshot_events_supply_cache_without_recounting_direct_totals(self):
        snapshot = {"tokens_in": 50, "tokens_out": 7, "search_events": [
            {"type": "web_search", "query": "Example context query"},
            {"type": "turn.completed", "usage": {"input_tokens": 50, "output_tokens": 7, "cached_input_tokens": 31}},
        ]}
        metadata = usage_metadata(snapshot, events=snapshot["search_events"])

        self.assertEqual(metadata["tokens_in"], 50)
        self.assertEqual(metadata["tokens_out"], 7)
        self.assertEqual(metadata["cached_tokens_in"], 31)
        self.assertFalse(metadata["usage_incomplete"])
        self.assertFalse(metadata["cached_usage_incomplete"])
        self.assertFalse(metadata["tokens_estimated"])

    def test_failure_with_input_output_usage_but_no_cache_only_marks_cache_unknown(self):
        event = self.fail("compiler", [{"type": "turn.completed", "usage": {"input_tokens": 30, "output_tokens": 8}}])

        self.assertEqual(event["tokens_in"], 30)
        self.assertEqual(event["tokens_out"], 8)
        self.assertFalse(event["tokens_estimated"])
        self.assertFalse(event.get("usage_incomplete", False))
        self.assertIsNone(event["cached_tokens_in"])
        self.assertTrue(event["cached_usage_incomplete"])

    def test_data_tool_payloads_and_failures_cannot_add_llm_usage(self):
        response = {"tokens_in": 999, "tokens_out": 888, "cached_tokens_in": 777,
                    "tokens_estimated": True, "provider_events": [
                        {"usage": {"input_tokens": 999, "output_tokens": 888, "cached_input_tokens": 777}}]}
        self.trace.run("tool:evidence_rows", "query", "Read evidence, not an LLM call", lambda: response)
        self.fail("tool:evidence_rows", response["provider_events"])

        for event in self.trace.events:
            self.assertEqual(event["tokens_in"], 0)
            self.assertEqual(event["tokens_out"], 0)
            self.assertFalse(event["tokens_estimated"])
        totals = self.trace.totals()
        self.assertEqual(totals["by_actor"]["tool:evidence_rows"]["calls"], 2)
        self.assertEqual(totals["by_actor"]["tool:evidence_rows"]["tokens_in"], 0)
        self.assertEqual(totals["by_actor"]["tool:evidence_rows"]["tokens_out"], 0)
        self.assertEqual(totals["total_tokens_in"], 0)
        self.assertEqual(totals["total_tokens_out"], 0)
        self.assertEqual(totals["total_cached_tokens_in"], 0)
        self.assertFalse(totals["tokens_estimated"])
        self.assertFalse(totals["usage_incomplete"])
        self.assertFalse(totals["cached_usage_incomplete"])

    def test_local_artifact_write_failure_keeps_already_reported_provider_usage(self):
        (self.directory / "blocked").write_text("A file prevents creating the output directory")
        response = {"tokens_in": 15, "tokens_out": 4, "cached_tokens_in": 8, "tokens_estimated": False}
        with self.assertRaises(OSError):
            self.trace.run("sector_selector", "select", "Save the selector output", lambda: response,
                           output_ref="blocked/response.json")

        event = self.trace.events[-1]
        self.assertIsNotNone(event["error"])
        self.assertEqual(event["tokens_in"], 15)
        self.assertEqual(event["tokens_out"], 4)
        self.assertEqual(event["cached_tokens_in"], 8)
        self.assertFalse(event["tokens_estimated"])
        self.assertFalse(event.get("tokens_unknown", False))
        self.assertFalse(event.get("usage_incomplete", False))
        self.assertFalse(event.get("cached_usage_incomplete", False))


if __name__ == "__main__":
    unittest.main()
