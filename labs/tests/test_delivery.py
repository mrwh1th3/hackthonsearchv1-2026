"""The judge delivery replays recorded evidence without any live services."""
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from labs.delivery import VERSION, build_delivery, shown


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name) / "run"
        (self.directory / "engine").mkdir(parents=True)
        self.write("launch.json", {"run_id": "recorded-run", "status": "partial", "provider": "codex",
                                  "giro": "<script>alert(1)</script>", "total_duration_ms": 12000})
        self.write("engine/run_log.json", {"estate_sha256": "estate-hash", "run_metadata": {"llm_calls": 0}})
        self.write("engine/submission.json", {"findings": []})
        digest = hashlib.sha256((self.directory / "engine/run_log.json").read_bytes()).hexdigest()
        self.write("brief.json", {"engine_sha256": digest})
        self.write("summary.json", {"llm_calls": 6, "total_tokens_in": 100, "total_tokens_out": 20,
                                    "sector_research": {"calls": 1, "tokens_in": 30, "tokens_out": 10}})
        self.write("agent_a.json", {"reviews": [{"claim": "<img src=x onerror=alert(1)>", "evidence_ids": ["invoices:1"]}]})
        (self.directory / "engine/case_file.html").write_text("<html><style></style><body><main><h1>1. Header</h1>"
            "<table><tr><th>LLM calls</th></tr></table><h2>2. Executive summary</h2>"
            "<h2>3. Findings</h2><svg aria-label='Money trail'></svg><h2>4. Leads not pursued</h2>"
            "<p>Vendor ABC: closed with bank record1.</p><h2>5. Method and limits</h2></main></body></html>")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, data):
        (self.directory / name).write_text(json.dumps(data))

    def test_replay_is_byte_identical_with_network_and_processes_unavailable(self):
        with patch.object(socket, "socket", side_effect=AssertionError("No network")), \
             patch.object(subprocess, "Popen", side_effect=AssertionError("No subprocess")):
            original = build_delivery(self.directory)
            body = (self.directory / "delivery/case_file.html").read_bytes()
            rebuilt = build_delivery(self.directory)
            checked = build_delivery(self.directory, check=True)
        self.assertEqual(original, rebuilt)
        self.assertEqual(rebuilt, checked)
        self.assertEqual(body, (self.directory / "delivery/case_file.html").read_bytes())
        self.assertEqual(original["metrics"]["llm_invocations"], 7)
        self.assertEqual(original["metrics"]["tokens_in"], 130)
        self.assertEqual(original["metrics"]["tokens_out"], 30)
        self.assertEqual(original["metrics"]["wall_clock_seconds"], 12)
        self.assertIsNone(original["metrics"]["mxn_cost"])
        self.assertFalse(original["metrics"]["fresh_execution_deterministic"])
        self.assertTrue(original["metrics"]["saved_artifact_replay_deterministic"])

    def test_keeps_rendered_diagrams_declined_leads_and_escapes_agent_content(self):
        build_delivery(self.directory)
        html = (self.directory / "delivery/case_file.html").read_text()
        self.assertIn("<svg aria-label='Money trail'>", html)
        self.assertIn("Vendor ABC: closed with bank record1.", html)
        self.assertIn("LLM calls · rule engine", html)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt;", html)
        self.assertNotIn("<script>", html)
        self.assertNotIn("<img src=x", html)
        self.assertIn("No pending proposals", html)
        self.assertIn("Not supplied", html)

    def test_engine_mismatch_and_modified_delivery_are_rejected(self):
        build_delivery(self.directory)
        report = self.directory / "delivery/case_file.html"
        report.write_text(report.read_text() + "tampered")
        with self.assertRaisesRegex(ValueError, "differs"):
            build_delivery(self.directory, check=True)
        self.write("engine/run_log.json", {"findings": ["different investigation"]})
        with self.assertRaisesRegex(ValueError, "do not match"):
            build_delivery(self.directory)

    def test_mock_invocations_are_not_paid_llm_calls(self):
        self.write("launch.json", {"run_id": "recorded-run", "provider": "mock", "status": "completed", "total_duration_ms": 50})
        result = build_delivery(self.directory)["metrics"]
        self.assertEqual(result["llm_invocations"], 0)
        self.assertEqual(result["provider_invocations_including_mock"], 7)
        self.assertEqual(result["mxn_cost"], 0)
        self.assertTrue(result["decision_pipeline_deterministic"])
        self.assertFalse(result["fresh_execution_deterministic"])

    def test_nonterminal_and_path_escapes_are_rejected(self):
        self.write("launch.json", {"status": "running"})
        with self.assertRaisesRegex(ValueError, "terminal"):
            build_delivery(self.directory)
        outside = Path(self.tmp.name) / "outside.json"
        outside.write_text("{}")
        (self.directory / "notes.json").symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            build_delivery(self.directory)

    def test_mock_review_preserves_nonzero_recorded_engine_usage(self):
        self.write("launch.json", {"run_id": "recorded-run", "provider": "mock", "status": "completed", "total_duration_ms": 50})
        self.write("engine/run_log.json", {"estate_sha256": "estate-hash", "run_metadata": {"llm_calls": 2, "mxn_cost": 12.5}})
        digest = hashlib.sha256((self.directory / "engine/run_log.json").read_bytes()).hexdigest()
        self.write("brief.json", {"engine_sha256": digest})
        metrics = build_delivery(self.directory)["metrics"]
        html = (self.directory / "delivery/case_file.html").read_text()
        self.assertEqual(metrics["llm_invocations"], 2)
        self.assertEqual(metrics["mxn_cost"], 12.5)
        self.assertTrue(metrics["usage_incomplete"])
        self.assertNotIn("Demo without AI.", html)
        self.assertIn("A/B simulation.", html)

    def test_unknown_usage_is_a_subtotal_and_required_section_order_is_preserved(self):
        self.write("summary.json", {"llm_calls": 1, "total_tokens_in": 20, "total_tokens_out": 0, "usage_incomplete": True})
        build_delivery(self.directory)
        html = (self.directory / "delivery/case_file.html").read_text()
        self.assertIn("Recorded token subtotal", html)
        self.assertIn("these totals are incomplete", html)
        labels = ("1. Header", "2. Executive summary", "3. Findings", "4. Leads not pursued", "5. Method and limits")
        self.assertEqual([html.index(label) for label in labels], sorted(html.index(label) for label in labels))
        self.assertLess(html.index("1. Header"), html.index("Complete workflow"))
        self.assertIn('href="https://example.com/case"', shown("https://example.com/case"))
        self.assertEqual(shown("https://[broken"), "https://[broken")

    def test_empty_industry_separator_and_context_labels_are_display_only(self):
        self.write("launch.json", {"run_id": "recorded-run", "provider": "codex", "status": "partial",
                                  "corrida_nombre": "Estate · estate_seed_105.zip", "giro": "", "total_duration_ms": 50})
        digest = hashlib.sha256((self.directory / "engine/run_log.json").read_bytes()).hexdigest()
        self.write("brief.json", {"engine_sha256": digest, "playbook_excerpt": {
            "status": "partial", "giro": "operaciones empresariales generales", "mechanisms": []}})
        original = {name: (self.directory / name).read_bytes() for name in ("launch.json", "brief.json")}
        build_delivery(self.directory)
        html = (self.directory / "delivery/case_file.html").read_text()
        self.assertNotIn(" ·  · ", html)
        self.assertIn('Estate · estate_seed_105.zip</p>', html)
        self.assertIn('<span class="pill">Finished with review notes</span>', html)
        context = html.split("Scope, context and recorded decisions", 1)[1]
        self.assertIn("Limited context", context)
        self.assertNotIn("Finished with review notes", context)
        self.assertIn("<dt>Industry</dt>", context)
        self.assertIn("General business operations", context)
        self.assertNotIn("operaciones empresariales generales", context)
        self.assertEqual(original, {name: (self.directory / name).read_bytes() for name in original})

    def test_header_reports_whole_run_timing_and_keeps_ai_out_of_validated_totals(self):
        self.write("launch.json", {"run_id": "recorded-run", "provider": "codex", "status": "completed",
                                  "total_duration_ms": 125500, "timing_scope": "through_report", "seed_provenance": "provided"})
        self.write("engine/run_log.json", {"company_name": "Example & Co", "company_rfc": "ABC123",
            "period": ["2024-01-01", "2024-12-31"], "seed": 105,
            "run_metadata": {"llm_calls": 0, "wall_clock_seconds": 1.2},
            "findings": [{"peso_amount": 100.10, "confidence": "proven"}, {"peso_amount": 20.20, "confidence": "probable"}],
            "leads": [{"entity": "ABC"}]})
        self.write("brief.json", {})
        self.write("agent_b.json", {"findings": [{"peso_amount": 999999, "claim": "Unvalidated hypothesis"}]})
        result = build_delivery(self.directory)
        html = (self.directory / "delivery/case_file.html").read_text()
        header = html.split("2. Executive summary", 1)[0]
        self.assertEqual(result["metrics"]["wall_clock_seconds"], 125.5)
        self.assertTrue(result["metrics"]["timing_includes_report"])
        for text in ("Total investigation time", "2m 05s", "125.500 wall-clock seconds", "through report validation",
                     "Example &amp; Co", "ABC123", "2024-01-01 — 2024-12-31", "<b>105</b>",
                     "MXN 120.30", "1 proven · 1 probable", "B · 1 new hypotheses", "Fresh conclusions", "May vary"):
            self.assertIn(text, header)
        self.assertNotIn("999,999", header)
        self.assertNotIn("1.200 wall-clock seconds", header)

    def test_legacy_and_missing_timing_do_not_claim_report_completion_or_zero(self):
        result = build_delivery(self.directory)
        html = (self.directory / "delivery/case_file.html").read_text()
        self.assertFalse(result["metrics"]["timing_includes_report"])
        self.assertIn("Recorded execution time", html)
        self.assertIn("report completion was not measured", html)
        self.assertNotIn("Total investigation time", html)
        for timing in ({}, {"total_duration_ms": -1}, {"total_duration_ms": float("nan")}):
            self.write("launch.json", {"run_id": "recorded-run", "provider": "codex", "status": "completed", **timing})
            result = build_delivery(self.directory)
            self.assertIsNone(result["metrics"]["wall_clock_seconds"])
            html = (self.directory / "delivery/case_file.html").read_text()
            self.assertIn("Duration was not captured", html)
            self.assertNotIn("0.000 wall-clock seconds", html)

    def test_timestamp_fallback_and_reversed_timestamps(self):
        self.write("launch.json", {"run_id": "recorded-run", "provider": "codex", "status": "completed",
            "started_at": "2026-09-13T10:00:00Z", "completed_at": "2026-09-13T10:02:00+00:00"})
        self.assertEqual(build_delivery(self.directory)["metrics"]["wall_clock_seconds"], 120)
        self.write("launch.json", {"run_id": "recorded-run", "provider": "codex", "status": "completed",
            "started_at": "2026-09-13T10:02:00Z", "completed_at": "2026-09-13T10:00:00Z"})
        self.assertIsNone(build_delivery(self.directory)["metrics"]["wall_clock_seconds"])

    def test_new_header_folds_engine_provenance_without_losing_original_evidence(self):
        source = ('<html><style></style><main><section id="section-header"><h2>1. Header</h2>'
            '<!-- whole-run-header --><table><tr><th>LLM calls</th><td>0</td></tr></table>'
            '<p>Estate fingerprint <code>original-sha</code></p></section>'
            '<section id="section-summary"><h2>2. Executive summary</h2></section>'
            '<section id="section-findings"><h2>3. Findings</h2><svg aria-label="Money trail"></svg>'
            '<a href="#original-evidence">Read evidence</a><p id="original-evidence">Original evidence</p><!-- ai-review --></section>'
            '<section id="section-leads"><h2>4. Leads not pursued</h2><p>Closed lead evidence</p></section>'
            '<section id="section-method"><h2>5. Method and limits</h2><!-- whole-run-appendix --></section></main></html>')
        (self.directory / "engine/case_file.html").write_text(source)
        build_delivery(self.directory)
        html = (self.directory / "delivery/case_file.html").read_text()
        self.assertIn('class="engine-provenance"', html)
        self.assertIn("original-sha", html)
        self.assertIn('href="#original-evidence"', html)
        self.assertIn('<svg aria-label="Money trail">', html)
        self.assertLess(html.index("engine-provenance" + '\"><summary>'), html.index("2. Executive summary"))
        self.assertIn("Closed lead evidence", html)
        self.assertEqual(source, (self.directory / "engine/case_file.html").read_text())

    def test_old_renderer_check_explains_version_without_overwriting_saved_report(self):
        build_delivery(self.directory)
        manifest = self.directory / "delivery/manifest.json"
        stored = json.loads(manifest.read_text())
        stored["version"] = VERSION - 1
        manifest.write_text(json.dumps(stored))
        original = (self.directory / "delivery/case_file.html").read_bytes()
        with self.assertRaisesRegex(ValueError, "matching renderer"):
            build_delivery(self.directory, check=True)
        self.assertEqual(original, (self.directory / "delivery/case_file.html").read_bytes())
        self.assertEqual(stored, json.loads(manifest.read_text()))


if __name__ == "__main__":
    unittest.main()
