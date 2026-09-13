import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from labs.context import ContextStore, check_source
from labs.provider import CodexProvider, ProviderError, child_environment, safe_events


class FakeResearch:
    name = "codex"

    def __init__(self):
        self.calls = 0

    def call(self, actor, prompt, schema):
        self.calls += 1
        return {"output": {"sources": [{"url": "https://example.org/case", "title": "Caso"}],
                           "mechanisms": [{"name": "Mecanismo", "source_urls": ["https://example.org/case"]}],
                           "normal_operations": ["Anticipos documentados"], "limitations": []},
                "tokens_in": 5, "tokens_out": 3, "model": "test", "duration_ms": 10,
                "provider_events": [{"type": "web_search"}]}


class ProviderContextTests(unittest.TestCase):
    def test_environment_cannot_leak_app_keys(self):
        with patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": "secret", "OPENAI_API_KEY": "secret", "HOME": "/test"}):
            env = child_environment()
            self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", env)
            self.assertNotIn("OPENAI_API_KEY", env)
            self.assertEqual(env["HOME"], "/test")

    def test_raw_reasoning_not_persisted_but_usage_is(self):
        events = safe_events('\n'.join(json.dumps(x) for x in [
            {"type": "item.completed", "item": {"type": "reasoning", "text": "private"}},
            {"type": "turn.completed", "usage": {"input_tokens": 12, "output_tokens": 3}},
            {"type": "error", "message": "sk-sensitive-secret"}]))
        self.assertNotIn("private", json.dumps(events))
        self.assertNotIn("sk-sensitive", json.dumps(events))
        self.assertEqual(events[0]["usage"]["input_tokens"], 12)

    def test_unknown_sector_records_pending_without_fabrication(self):
        with tempfile.TemporaryDirectory() as root:
            value = ContextStore(root, catalog_root=Path(root) / "no_catalog").get("Construcción")
            self.assertEqual(value["status"], "pending")
            self.assertEqual(value["mechanisms"], [])
            self.assertEqual(len(list(Path(root).glob("*.json"))), 1)

    def test_cached_research_is_reused_without_cost(self):
        with tempfile.TemporaryDirectory() as root:
            provider = FakeResearch()
            store = ContextStore(root, provider, source_checker=lambda url: {"reachable": True}, catalog_root=Path(root) / "no_catalog")
            first, second = store.get("Construcción"), store.get("construcción")
            self.assertEqual(provider.calls, 1)
            self.assertEqual(first["status"], "partial")
            self.assertEqual(first["current_usage"]["tokens_in"], 5)
            self.assertTrue(second["cache_hit"])
            self.assertIsNone(second["current_usage"])

    def test_unreachable_sources_cannot_support_mechanism(self):
        with tempfile.TemporaryDirectory() as root:
            value = ContextStore(root, FakeResearch(), source_checker=lambda url: {"reachable": False}).get("Giro")
            self.assertEqual(value["status"], "unavailable")
            self.assertEqual(value["mechanisms"], [])

    def test_source_verification_rejects_local_urls(self):
        for url in ("file:///etc/passwd", "http://example.org", "https://127.0.0.1", "https://[::1]", "https://user:pass@example.org"):
            self.assertFalse(check_source(url)["reachable"])

    def test_no_web_search_cannot_be_claimed_as_sourced_context(self):
        provider = FakeResearch()
        call = provider.call
        provider.call = lambda *args: {**call(*args), "provider_events": []}
        with tempfile.TemporaryDirectory() as root:
            result = ContextStore(root, provider, source_checker=lambda u: {"reachable": True}).get("giro")
            self.assertEqual(result["status"], "unavailable")

    def test_failed_research_preserves_known_consumption(self):
        provider = FakeResearch()
        def fail(*args):
            raise ProviderError("failed", events=[{"type": "turn.completed", "usage": {"input_tokens": 1200, "output_tokens": 300}}])
        provider.call = fail
        with tempfile.TemporaryDirectory() as root:
            value = ContextStore(root, provider).get("giro")
            self.assertEqual(value["current_usage"]["tokens_in"], 1200)
            self.assertFalse(value["current_usage"]["tokens_estimated"])

    def test_stale_sector_lock_recovers(self):
        with tempfile.TemporaryDirectory() as root:
            ContextStore(root).get("giro")
            lock = next(Path(root).glob("*.json")).with_suffix(".lock")
            lock.write_text("")
            os.utime(lock, (time.time() - 700, time.time() - 700))
            value = ContextStore(root, FakeResearch(), source_checker=lambda u: {"reachable": True}).get("giro")
            self.assertEqual(value["status"], "partial")
            self.assertFalse(lock.exists())

    def test_sector_research_has_separate_hard_budget(self):
        with tempfile.TemporaryDirectory() as root:
            provider = FakeResearch()
            store = ContextStore(root, provider, source_checker=lambda u: {"reachable": True}, max_research_calls=1)
            store.get("giro uno")
            second = store.get("giro dos")
            self.assertEqual(provider.calls, 1)
            self.assertEqual(second["status"], "pending")


if __name__ == "__main__":
    unittest.main()
