#!/usr/bin/env python3
"""Read-only judge gate: official format + estate checks, report structure and offline replay.

python3 scripts/verify-judge-delivery.py --run-dir RUN_DIRECTORY --estate CANONICAL_ESTATE.db

RUN_DIRECTORY may contain the engine outputs directly or a complete run with engine/ and
delivery/. This does not run detectors, models, evaluation keys or external services.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import sqlite3
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))
SECTIONS = ("1. Header", "2. Executive summary", "3. Findings", "4. Leads not pursued", "5. Method and limits")


class ReportStructure(HTMLParser):
    def __init__(self):
        super().__init__()
        self.headings, self.current, self.in_heading = [], [], False
        self.money_diagrams = 0
        self.external_resources = []
        self.styles, self.in_style = [], False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("style"):
            self.styles.append(attrs["style"])
        if tag == "h2":
            self.in_heading, self.current = True, []
        if tag == "style":
            self.in_style = True
        if tag == "svg" and "money trail" in attrs.get("aria-label", "").lower():
            self.money_diagrams += 1
        # External citations are links, not dependencies. Everything required to render
        # the document must be inline (including SVG references and stylesheet assets).
        for key in ("src", "srcset", "poster", "data"):
            value = attrs.get(key)
            if value and not value.startswith(("data:", "#")):
                self.external_resources.append(f"{tag}.{key}")
        if tag in {"link", "use", "image", "script"}:
            for key in ("href", "xlink:href"):
                value = attrs.get(key)
                if value and not value.startswith(("data:", "#")):
                    self.external_resources.append(f"{tag}.{key}")

    def handle_endtag(self, tag):
        if tag == "h2" and self.in_heading:
            self.headings.append(" ".join("".join(self.current).split()))
            self.in_heading = False
        if tag == "style":
            self.in_style = False

    def handle_data(self, data):
        if self.in_heading:
            self.current.append(data)
        if self.in_style:
            self.styles.append(data)


def check_report(html: str, finding_count: int) -> None:
    report = ReportStructure()
    report.feed(html)
    headings = [text for text in report.headings if re.match(r"^[1-5]\. ", text)]
    if headings != list(SECTIONS):
        raise ValueError("Required five case-file sections are missing, duplicated or out of order")
    if report.money_diagrams < finding_count:
        raise ValueError("Each finding requires a rendered money-trail diagram")
    styles = "".join(report.styles)
    urls = re.findall(r"url\(([^)]+)\)", styles, re.IGNORECASE)
    external_css = any(not url.strip().strip("'\"").startswith(("data:", "#")) for url in urls)
    if report.external_resources or re.search(r"@import", styles, re.IGNORECASE) or external_css:
        raise ValueError("Report depends on resources outside its self-contained HTML")


def verify(run_dir: Path, estate: Path | None = None, validator: Path | None = None) -> dict:
    from auditor.casefile import render_html
    from labs.delivery import build_delivery

    directory = Path(run_dir).resolve()
    full = (directory / "engine" / "run_log.json").is_file()
    engine_dir = directory / "engine" if full else directory
    log = json.loads((engine_dir / "run_log.json").read_text())
    submission = json.loads((engine_dir / "submission.json").read_text())
    if estate is None:
        canonical = log.get("structure_report", {}).get("validator_estate")
        estate = engine_dir / canonical if canonical else Path(log["estate_path"])
    estate = Path(estate).resolve()
    if not estate.is_file():
        raise ValueError("An existing canonical estate is required; no database will be created")
    validator = Path(validator or ROOT / "spec" / "forensic-auditor" / "validate_format.py").resolve()
    spec = importlib.util.spec_from_file_location("official_judge_format_validator", validator)
    if spec is None or spec.loader is None:
        raise ValueError("Official validator could not be loaded")
    official = importlib.util.module_from_spec(spec)
    with ExitStack() as stack:
        stack.enter_context(patch("socket.socket", side_effect=RuntimeError("Network disabled by the offline gate")))
        stack.enter_context(patch("subprocess.Popen", side_effect=RuntimeError("External processes disabled by the offline gate")))
        spec.loader.exec_module(official)
        errors = official.validate_structure(submission)
        if errors:
            raise ValueError("Official validator failed: " + "; ".join(errors))
        errors += official.validate_against_estate(submission, str(estate))
        if errors:
            raise ValueError("Official validator failed: " + "; ".join(errors))
        html = (engine_dir / "case_file.html").read_text()
        check_report(html, len(submission["findings"]))
        if html != render_html(log):
            raise ValueError("Saved engine case file differs from offline replay with this renderer version")
        metrics = None
        if full:
            manifest = build_delivery(directory, check=True)
            check_report((directory / "delivery" / "case_file.html").read_text(), len(submission["findings"]))
            metrics = manifest["metrics"]
    return {"status": "passed", "scope": "whole_investigation" if full else "rule_engine",
            "official_validator": str(validator), "estate_checked": True,
            "findings": len(submission["findings"]), "closed_leads": len(submission["leads_not_pursued"]),
            "required_sections": list(SECTIONS), "self_contained": True, "offline_replay_verified": True,
            "full_run_metrics": metrics,
            "accuracy_scope": "Format, evidence resolution, arithmetic and replay only; not fraud correctness or recall."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--estate", type=Path)
    parser.add_argument("--validator", type=Path, help="Path to the supplied official validate_format.py")
    args = parser.parse_args()
    try:
        result = verify(args.run_dir, args.estate, args.validator)
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error, RuntimeError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
