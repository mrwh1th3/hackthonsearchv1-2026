from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from labs.context import ContextStore
from labs.context_catalog import CATALOG_ROOT, ContextCatalog, normalize_alias
from labs.runner import compact_context
from labs.tests.test_provider_context import FakeResearch


def catalog_fixture(researched=None):
    stamp = researched or datetime.now(timezone.utc).isoformat()
    sources = [{"title": f"Test-only case {n}", "url": f"https://example.org/case-{n}", "published_at": "2026-01-01",
                "event_date": "", "jurisdiction": "Test", "legal_status": "Allegation, not a conviction",
                "verification": "opened_primary_source", "checked_at": stamp} for n in range(5)]
    mechanisms = [{"name": f"Test mechanism {n}", "vulnerability": "A test control gap", "distinctive_detail": "A test distinction",
                   "actions": ["Test action"], "concealment": ["Test concealment"], "observable_signals": ["Test signal"],
                   "licit_alternatives": ["Test lawful explanation"], "disconfirming_evidence": ["Test supporting record"],
                   "source_urls": [source["url"]]} for n, source in enumerate(sources)]
    return {"schema_version": 1, "researched_at": stamp, "sectors": [{"id": "construction", "giro": "Construction",
            "aliases": ["Construcción", "construccion civil"], "normal_operations": ["Test milestone billing"],
            "mechanisms": mechanisms, "sources": sources, "limitations": ["Synthetic test fixture, not case research."]}]}


class ContextCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog = self.root / "catalog"
        self.catalog.mkdir()
        self.data = catalog_fixture()
        self.write_catalog()

    def tearDown(self):
        self.temp.cleanup()

    def write_catalog(self):
        (self.catalog / "test.json").write_text(json.dumps(self.data))

    def store(self, provider=None, **kwargs):
        return ContextStore(self.root / "cache", provider, catalog_root=self.catalog, **kwargs)

    def test_aliases_load_offline_without_model_source_check_or_cache_write(self):
        provider = FakeResearch()
        def forbidden(_):
            raise AssertionError("Curated lookup must not perform network checks")
        for alias in ["Construction", "  CONSTRUCCIÓN  ", "construccion", "construcción civil"]:
            value = self.store(provider, source_checker=forbidden).get(alias)
            self.assertEqual(value["sector_id"], "construction")
            self.assertEqual(value["origin"], "bundled_catalog")
            self.assertEqual(value["status"], "partial")
            self.assertEqual(value["freshness"], "fresh")
            self.assertTrue(value["cache_hit"])
            self.assertIsNone(value["current_usage"])
            self.assertEqual(len(value["sources"]), 5)
            self.assertIn("Allegation", value["sources"][0]["legal_status"])
        self.assertEqual(provider.calls, 0)
        self.assertFalse((self.root / "cache").exists())

    def test_fresh_runtime_cache_wins_across_a_known_alias(self):
        cache = self.root / "cache"
        cache.mkdir()
        key = hashlib.sha256("construcción".encode()).hexdigest()[:24]
        prior = {"status": "ready", "giro": "Construcción", "researched_at": datetime.now(timezone.utc).isoformat(),
                 "mechanisms": [{"name": "Saved live result"}], "current_usage": {"tokens_in": 100}, "research_usage": {"tokens_in": 100}}
        path = cache / f"{key}.json"
        path.write_text(json.dumps(prior))
        before = path.read_bytes()
        provider = FakeResearch()
        result = self.store(provider).get("construction")
        self.assertEqual(result["mechanisms"][0]["name"], "Saved live result")
        self.assertIsNone(result["current_usage"])
        self.assertEqual(result["origin"], "runtime_cache")
        self.assertEqual(provider.calls, 0)
        self.assertEqual(path.read_bytes(), before)

    def test_unknown_sector_does_not_match_a_substring(self):
        result = self.store().get("Construction unrelated speculative products")
        self.assertEqual(result["status"], "pending")
        self.assertEqual(result["mechanisms"], [])

    def test_stale_catalog_is_explicit_without_refresh_provider(self):
        old = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
        self.data = catalog_fixture(old)
        self.write_catalog()
        before = (self.catalog / "test.json").read_bytes()
        result = self.store().get("construction")
        self.assertEqual(result["freshness"], "stale")
        self.assertEqual(result["as_of"], old)
        self.assertIsNone(result["current_usage"])
        self.assertTrue(any("stale" in text for text in result["limitations"]))
        self.assertEqual((self.catalog / "test.json").read_bytes(), before)
        self.assertFalse((self.root / "cache").exists())

    def test_stale_catalog_uses_live_research_when_available(self):
        self.data = catalog_fixture((datetime.now(timezone.utc) - timedelta(days=40)).isoformat())
        self.write_catalog()
        provider = FakeResearch()
        result = self.store(provider, source_checker=lambda _: {"reachable": True}).get("construction")
        self.assertEqual(provider.calls, 1)
        self.assertEqual(result["origin"], "live_research")
        self.assertEqual(result["freshness"], "fresh")
        self.assertEqual(result["current_usage"]["tokens_in"], 5)

    def test_ambiguous_alias_and_duplicate_sources_are_not_silently_accepted(self):
        duplicate = copy.deepcopy(self.data["sectors"][0])
        duplicate["id"] = "another-sector"
        self.data["sectors"].append(duplicate)
        self.write_catalog()
        self.assertIsNone(ContextCatalog(self.catalog).find("construction"))
        self.data["sectors"].pop()
        self.data["sectors"][0]["sources"][1]["url"] = self.data["sectors"][0]["sources"][0]["url"]
        self.write_catalog()
        self.assertIsNone(ContextCatalog(self.catalog).find("construction"))

    def test_inaccessible_or_uncited_reference_cannot_be_a_catalog_match(self):
        self.data["sectors"][0]["sources"][0]["url"] = "https://127.0.0.1/private"
        self.write_catalog()
        self.assertIsNone(ContextCatalog(self.catalog).find("construction"))
        self.data = catalog_fixture()
        self.data["sectors"][0]["mechanisms"][0]["source_urls"] = ["https://example.org/unopened"]
        self.write_catalog()
        self.assertIsNone(ContextCatalog(self.catalog).find("construction"))

    def test_compact_payload_caps_lists_and_preserves_case_status_and_provenance(self):
        source = ContextCatalog(self.catalog).find("construction")
        source["mechanisms"] *= 10
        source["normal_operations"] = ["x" * 1000] * 30
        source["mechanisms"][0]["actions"] = ["x" * 1000] * 30
        brief = compact_context(source)
        self.assertEqual(len(brief["mechanisms"]), 5)
        self.assertEqual(len(brief["mechanisms"][0]["actions"]), 3)
        self.assertEqual(len(brief["normal_operations"]), 6)
        self.assertLessEqual(len(brief["normal_operations"][0]), 180)
        self.assertEqual(brief["origin"], "bundled_catalog")
        self.assertEqual(brief["sources"][0]["legal_status"], "Allegation, not a conviction")
        self.assertEqual(brief["sources"][0]["url"], source["sources"][0]["url"])

    def test_bundled_profiles_have_five_cited_cases_and_unambiguous_aliases(self):
        bundled = ContextCatalog()
        sectors, aliases = [], {}
        for path in sorted(CATALOG_ROOT.glob("*.json")):
            document = json.loads(path.read_text())
            sectors.extend(document["sectors"])
        self.assertGreaterEqual(len(sectors), 12)
        for sector in sectors:
            found = bundled.find(sector["id"])
            self.assertIsNotNone(found, sector["id"])
            self.assertEqual(found["sector_id"], sector["id"])
            self.assertEqual(len(found["sources"]), 5)
            self.assertEqual(len({source["url"] for source in found["sources"]}), 5)
            self.assertEqual(len(found["mechanisms"]), 5)
            self.assertLess(len(json.dumps(compact_context(found), ensure_ascii=False)), 12_000)
            for alias in [sector["id"], sector["giro"], *sector["aliases"]]:
                normalized = normalize_alias(alias)
                self.assertIn(aliases.get(normalized, sector["id"]), [sector["id"]], alias)
                aliases[normalized] = sector["id"]
                self.assertEqual(bundled.find(alias)["sector_id"], sector["id"], alias)
        self.assertEqual(bundled.find("construcción")["sector_id"], bundled.find("construction")["sector_id"])


if __name__ == "__main__":
    unittest.main()
