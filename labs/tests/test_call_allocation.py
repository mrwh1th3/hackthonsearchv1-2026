from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from labs.mock_provider import MockProvider
from labs.runner import Runner
from labs.tests.test_laboratory import FIXTURE, ReadyContext


class RequestingProvider(MockProvider):
    def __init__(self):
        self.received = []

    def call(self, actor, prompt, schema):
        payload = json.loads(prompt.split("RECORTE_JSON_NO_CONFIABLE:\n", 1)[1])
        self.received.append((actor, payload))
        result = super().call(actor, prompt, schema)
        if actor in {"agent_a", "agent_b"} and "tool_results" not in payload:
            if actor == "agent_a":
                sid = payload["groups"][0]["exemplars"][0]["subject_id"]
            else:
                sid = payload["residual"][0]["subject_id"]
            result["output"]["tool_requests"] = [{"name": "subject_slice", "ids": [sid], "giro": "", "max_hops": 1,
                                                  "purpose": "Inspect the supplied subject's bounded evidence before concluding."}]
        return result


class CallAllocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = json.loads(FIXTURE.read_text())
        second = dict(source["triage"]["records"][0], scheme_type="kickback", subject_id="RFC:DEMO050505EEE")
        source["triage"]["records"].append(second)
        self.input = self.root / "engine.json"
        self.input.write_text(json.dumps(source))

    def tearDown(self):
        self.temp.cleanup()

    def run_budget(self, calls, automatic=True):
        provider = RequestingProvider()
        run = Runner(str(self.input), "" if automatic else "construction", str(self.root / "runs"),
                     provider=provider, context=ReadyContext(), max_calls=calls, max_groups=2)
        summary = run.run()
        self.assertEqual(summary["errors"], [])
        self.assertEqual(summary["llm_calls"], calls)
        self.assertEqual(len(provider.received), calls)
        return run, summary, provider

    def test_six_calls_include_batched_a_and_both_tool_reviews_and_compiler(self):
        run, summary, provider = self.run_budget(6)
        self.assertEqual(summary["max_llm_calls"], 6)
        self.assertEqual(summary["counts"]["a_reviews"], 2)
        for actor in ["agent_a", "agent_b"]:
            received = [payload for name, payload in provider.received if name == actor]
            self.assertEqual(len(received), 2)
            self.assertNotIn("tool_results", received[0])
            self.assertEqual(len(received[1]["tool_results"]), 1)
            self.assertEqual(received[1]["tool_results"][0]["result"]["status"], "ready")
            self.assertEqual(summary["tool_followups"][actor], {"status": "completed", "requested_tools": 1,
                                                              "executed_tools": 1, "review_completed": True})
        initial_a = next(payload for actor, payload in provider.received if actor == "agent_a")
        self.assertEqual(len(initial_a["groups"]), 2)
        self.assertEqual(provider.received[-1][0], "compiler")
        self.assertEqual(len([e for e in run.trace.events if e["actor"] == "tool:subject_slice"]), 2)
        self.assertEqual(run.proposals, [], "A completed review is not a fabricated new detection")

    def test_five_call_budget_preserves_b_followup_and_explicitly_limits_a(self):
        run, summary, _ = self.run_budget(5)
        self.assertEqual(summary["tool_followups"]["agent_b"]["status"], "completed")
        self.assertEqual(summary["tool_followups"]["agent_a"], {"status": "skipped_budget", "requested_tools": 1,
                                                              "executed_tools": 0, "review_completed": False})
        self.assertEqual(next(s for s in summary["stages"] if s["id"] == "agent_a")["status"], "partial")
        self.assertEqual(len([e for e in run.trace.events if e["actor"] == "tool:subject_slice"]), 1)

    def test_four_call_budget_does_not_run_tools_without_a_review_slot(self):
        run, summary, _ = self.run_budget(4)
        for actor in ("agent_a", "agent_b"):
            self.assertEqual(summary["tool_followups"][actor]["status"], "skipped_budget")
            self.assertEqual(summary["tool_followups"][actor]["executed_tools"], 0)
        self.assertFalse(any(e["actor"] == "tool:subject_slice" for e in run.trace.events))
        self.assertEqual(summary["status"], "partial")

    def test_three_calls_with_explicit_sector_still_review_both_a_groups(self):
        _, summary, provider = self.run_budget(3, automatic=False)
        self.assertEqual(summary["counts"]["a_reviews"], 2)
        self.assertEqual([actor for actor, _ in provider.received].count("agent_a"), 1)
        self.assertNotIn("sector_selector", [actor for actor, _ in provider.received])


if __name__ == "__main__":
    unittest.main()
