"""Judge presentation and offline verification; no live service or answer key."""
from __future__ import annotations

from copy import deepcopy
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _estate import Builder, ROOT  # noqa: E402
from auditor.casefile import exhibit_anchor, names_from_record, render_html  # noqa: E402
from auditor.llm import LLM  # noqa: E402
from auditor.pipeline import content_fingerprint, run, to_submission, write_outputs  # noqa: E402
from labs.delivery import build_delivery  # noqa: E402

spec = importlib.util.spec_from_file_location("judge_delivery_gate", ROOT / "scripts" / "verify-judge-delivery.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.targets, self.exhibit_disclosures = [], [], []
        self.scripts = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script":
            self.scripts += 1
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if attrs.get("href", "").startswith("#"):
            self.targets.append(attrs["href"][1:])
        if tag == "details" and "exhibits" in attrs.get("class", "").split():
            self.exhibit_disclosures.append(attrs)


class PresentationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name) / "run"
        self.engine = self.directory / "engine"
        self.engine.mkdir(parents=True)
        self.estate = Path(self.tmp.name) / "estate.db"
        b = Builder(self.estate)
        vendor = b.vendor("PHA010101AB1", registered="2025-12-01")
        for date, amount in (("2026-01-10", 120_000), ("2026-02-10", 130_000), ("2026-03-10", 140_000)):
            b.purchase(vendor, amount, date, po=False)
        b.efos("PHA010101AB1", "definitivo", "2025-12-20")
        self.result = run(b.write(), 1, LLM("off"))
        self.assertTrue(self.result["findings"])
        write_outputs(self.result, str(self.engine))

    def tearDown(self):
        self.tmp.cleanup()

    def test_every_evidence_link_and_all_five_sections_resolve(self):
        html = render_html(self.result)
        gate.check_report(html, len(self.result["findings"]))
        links = Links()
        links.feed(html)
        self.assertEqual(links.scripts, 0, "The authenticated document viewer blocks scripts")
        self.assertEqual(len(links.ids), len(set(links.ids)), "SVG markers and evidence IDs must be unique")
        self.assertLessEqual(set(links.targets), set(links.ids))
        self.assertEqual(len(links.exhibit_disclosures), len(self.result["findings"]))
        self.assertTrue(all("open" not in attrs for attrs in links.exhibit_disclosures))
        for number, finding in enumerate(self.result["findings"], 1):
            for step in finding["money_trail"]:
                self.assertIn(exhibit_anchor(number, step["exhibit_id"]), links.targets)
            for key, amount in finding["reconciliation"]["items"]:
                self.assertIn(f"+ MXN {amount:,.2f}", html)
        self.assertIn("parallel transfer legs", html)
        self.assertIn("not a probability or a legal determination", html)

    def test_historical_missing_name_placeholder_is_translated_only_for_display(self):
        result = deepcopy(self.result)
        result["company_name"] = "nombre no suministrado"
        html = render_html(result)
        self.assertIn("Name not supplied", html)
        self.assertNotIn("nombre no suministrado", html)
        self.assertEqual(result["company_name"], "nombre no suministrado")

    def test_no_findings_retains_sections_and_truthful_zero_states(self):
        result = deepcopy(self.result)
        result.update(findings=[], leads=[])
        result["run_metadata"]["deterministic"] = False
        html = render_html(result)
        gate.check_report(html, 0)
        self.assertIn("0 proven findings and 0 probable findings", html)
        self.assertIn("No amount was attributed to a validated finding", html)
        self.assertIn("does not establish an absence of fraud", html)
        self.assertIn("No investigated lead was closed", html)
        self.assertIn("Not declared deterministic", html)

    def test_presentation_names_are_bounded_and_do_not_change_verdict_or_submission(self):
        referenced = {entity for finding in self.result["findings"] for entity in finding["entities"]}
        referenced.update(lead["entity"] for lead in self.result["leads"])
        self.assertTrue(self.result["entity_names"])
        self.assertLessEqual(set(self.result["entity_names"]), referenced)
        baseline = deepcopy(self.result)
        baseline.pop("entity_names")
        self.assertEqual(to_submission(self.result), to_submission(baseline))
        self.assertEqual(content_fingerprint(self.result), content_fingerprint(baseline))
        entity = next(iter(self.result["entity_names"]))
        self.result["entity_names"][entity] = "<strong>Saved supplier name</strong>"
        self.assertEqual(content_fingerprint(self.result), content_fingerprint(baseline))
        self.result["leads"] = [{"entity": entity, "investigated_as": "phantom_vendor", "signal": "document_check",
                                "signal_detail": "Examined documents", "reason": "Supported by CTR-007",
                                "tool_calls_made": ["contracts"], "closed_by": "challenger"}]
        html = render_html(self.result)
        self.assertIn("&lt;strong&gt;Saved supplier name&lt;/strong&gt;", html)
        self.assertNotIn("<strong>Saved supplier name</strong>", html)

    def test_saved_names_do_not_mislabel_intermediaries_and_closed_reason_stays_visible(self):
        result = deepcopy(self.result)
        first = result["findings"][0]
        first["entities"].append("RFC:OTHER010101AA1")
        self.assertNotIn("RFC:OTHER010101AA1", names_from_record(result))
        result["entity_names"] = {"RFC:SAFE010101AA1": "Supplier <Safe>"}
        result["leads"] = [{"entity": "RFC:SAFE010101AA1", "investigated_as": "phantom_vendor", "signal": "missing_document",
                            "signal_detail": "Document checked", "reason": "Contract CTR-007 supports the purchase.",
                            "tool_calls_made": ["contracts"], "closed_by": "challenger"}]
        html = render_html(result)
        body = html.split('<section id="section-leads"', 1)[1].split('<section id="section-method"', 1)[0]
        self.assertIn("Supplier &lt;Safe&gt;", body)
        self.assertIn("Contract CTR-007 supports the purchase.", body)
        self.assertNotIn("<details", body, "Closed-lead reasons must be readable without disclosure clicks")

    def test_official_gate_passes_engine_and_complete_offline_replay(self):
        self.assertTrue(gate.verify(self.engine, self.estate)["offline_replay_verified"])
        (self.directory / "launch.json").write_text(json.dumps({"run_id": "saved-test", "provider": "mock",
            "status": "completed", "total_duration_ms": 20, "seed_provenance": "provided"}))
        (self.directory / "summary.json").write_text(json.dumps({"status": "completed", "llm_calls": 0}))
        build_delivery(self.directory)
        checked = gate.verify(self.directory, self.estate)
        self.assertEqual(checked["scope"], "whole_investigation")
        self.assertEqual(checked["full_run_metrics"]["mxn_cost"], 0)
        self.assertTrue(checked["offline_replay_verified"])

    def test_gate_rejects_external_resources_missing_diagrams_and_modified_replay(self):
        html = (self.engine / "case_file.html").read_text()
        with self.assertRaisesRegex(ValueError, "self-contained"):
            gate.check_report(html.replace("</head>", '<link rel="stylesheet" href="https://example.com/report.css"></head>'), len(self.result["findings"]))
        with self.assertRaisesRegex(ValueError, "diagram"):
            gate.check_report(html.replace("Money trail diagram:", "Summary graphic:"), len(self.result["findings"]))
        (self.engine / "case_file.html").write_text(html.replace("Follow the evidence.", "Changed title."))
        with self.assertRaisesRegex(ValueError, "differs from offline replay"):
            gate.verify(self.engine, self.estate)

    def test_gate_runs_official_record_validation_before_replay(self):
        path = self.engine / "submission.json"
        submission = json.loads(path.read_text())
        submission["findings"][0]["exhibits"][0]["record_id"] = "NOT-IN-ESTATE"
        path.write_text(json.dumps(submission))
        with self.assertRaisesRegex(ValueError, "Official validator failed"):
            gate.verify(self.engine, self.estate)


if __name__ == "__main__":
    unittest.main()
