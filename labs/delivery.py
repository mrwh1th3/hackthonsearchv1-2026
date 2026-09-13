"""Offline, reproducible delivery of a completed motor → A/B investigation.

python3 -m labs.delivery --run-dir data/labs/runs/UUID
python3 -m labs.delivery --run-dir data/labs/runs/UUID --check

Reads only persisted run artifacts. No provider, estate database or network access.
"""
from __future__ import annotations

import argparse
from datetime import datetime
from decimal import Decimal, InvalidOperation
import hashlib
from html import escape
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit

VERSION = 3
INPUTS = ("launch.json", "summary.json", "brief.json", "agent_a.json", "agent_b.json", "compiler.json",
          "proposals.json", "notes.json", "traces.jsonl", "engine_trace.json", "engine/run_log.json",
          "engine/submission.json", "engine/case_file.html")
LABELS = {"rule_id": "Source rule", "verdict": "Challenge", "reasoning_steps": "Checks",
          "claim": "Result", "evidence_ids": "Evidence", "open_question": "Open question",
          "licit_explanation_considered": "Legitimate explanation considered", "missing_datum_to_close": "Missing evidence",
          "new_lead": "Additional lead", "confidence": "Hypothesis confidence", "exemplar_ids": "Entities reviewed",
          "mechanism_one_liner": "Proposed mechanism", "why_engine_missed": "What the rules missed",
          "bridge_to_tags": "Connection to known signals", "evidencia_ids": "Evidence", "tipo": "Proposal type",
          "predicados": "Proposed conditions", "status": "Status", "giro": "Industry", "sources": "Sources", "mechanisms": "Mechanisms",
          "normal_operations": "Legitimate operations", "title": "Title", "reason": "Reason", "url": "Source",
          "limitations": "Limitations", "hypothesis": "Hypothesis", "normal_operation": "Legitimate operation",
          "why_it_worked": "Why it worked", "detection_test": "How to test it", "disconfirming_test": "Disconfirming test"}
VALUES = {"sostiene": "Supported in the sample", "parte": "Needs refinement", "tumba": "Challenged by A",
          "dato_insuficiente": "Insufficient evidence", "pending_human": "Awaiting human review",
          "completed": "Completed", "partial": "Finished with review notes", "failed": "Interrupted", "none": "None"}
CONTEXT_STATUS = {"ready": "Context available", "partial": "Limited context",
                  "pending": "Context research pending", "unavailable": "Context unavailable"}


def industry_display(value) -> str:
    text = str(value or "").strip()
    return "General business operations" if text.casefold() == "operaciones empresariales generales" else text


def recorded_duration(launch: dict) -> float | None:
    """Never silently substitute engine timing or zero for missing run timing."""
    value = launch.get("total_duration_ms")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0:
        return value
    try:
        start = datetime.fromisoformat(launch["started_at"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(launch["completed_at"].replace("Z", "+00:00"))
        elapsed = (end - start).total_seconds() * 1000
        return elapsed if elapsed >= 0 else None
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def duration_label(milliseconds: float | None) -> str:
    if milliseconds is None:
        return "Not recorded"
    seconds = milliseconds / 1000
    if seconds < 60:
        return f"{seconds:,.3f} s"
    minutes, remainder = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes:02d}m {remainder:02d}s" if hours else f"{minutes}m {remainder:02d}s"


def finding_exposure(findings: list) -> Decimal | None:
    total = Decimal(0)
    for finding in findings:
        try:
            amount = Decimal(str(finding["peso_amount"]))
            if not amount.is_finite() or amount < 0:
                return None
            total += amount
        except (InvalidOperation, KeyError, TypeError):
            return None
    return total


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_inputs(directory: Path) -> dict[str, bytes]:
    root = directory.resolve()
    result = {}
    for name in INPUTS:
        file = directory / name
        if not file.exists():
            continue
        if not file.resolve().is_relative_to(root) or file.stat().st_size > 16 * 1024 * 1024:
            raise ValueError("Unsafe or oversized delivery input")
        result[name] = file.read_bytes()
    for name in ("launch.json", "summary.json", "engine/run_log.json", "engine/submission.json", "engine/case_file.html"):
        if name not in result:
            raise ValueError(f"Missing persisted input: {name}")
    return result


def shown(value) -> str:
    text = str(value)
    try:
        url = urlsplit(text) if text.startswith(("https://", "http://")) else None
    except ValueError:
        url = None
    if url and url.netloc and not any(c.isspace() for c in text):
        return f'<a href="{escape(text, quote=True)}" rel="noreferrer noopener">{escape(text)}</a>'
    return escape(VALUES.get(text, text))


def value_html(value, depth=0) -> str:
    if value is None:
        return "<span class='meta'>Not supplied</span>"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, dict):
        if depth >= 6:
            return "<pre>" + escape(json.dumps(value, ensure_ascii=False, indent=2)) + "</pre>"
        parts = []
        for key, item in value.items():
            if key in {"tool_requests", "n", "group_size", "compiler_proposal", "action"} or item in (None, "", [], {}):
                continue
            parts.append(f"<dt>{escape(LABELS.get(key, key.replace('_', ' ')))}</dt><dd>{value_html(item, depth + 1)}</dd>")
        return "<dl>" + "".join(parts) + "</dl>"
    if isinstance(value, list):
        return "<ol>" + "".join(f"<li>{value_html(item, depth + 1)}</li>" for item in value) + "</ol>"
    return shown(value)


def review_cards(items: list, actor: str) -> str:
    parts = []
    for number, item in enumerate(items, 1):
        if not isinstance(item, dict):
            parts.append(value_html(item))
            continue
        heading = item.get("rule_id") or item.get("mechanism_one_liner") or item.get("title") or f"{actor} record {number}"
        status = item.get("verdict") or item.get("status") or "Recorded hypothesis"
        claim = item.get("claim") or item.get("hypothesis") or ""
        parts.append(f'<article class="review-record"><div class="review-record-head"><span class="eyebrow">{actor} · {number:02d}</span>'
                     f'<span class="pill">{shown(status)}</span></div><h5>{escape(str(heading))}</h5>')
        if claim:
            parts.append(f'<p>{escape(str(claim))}</p>')
        details = {key: value for key, value in item.items() if key not in {"rule_id", "mechanism_one_liner", "title", "claim", "verdict"}}
        parts.append('<details><summary>Evidence, checks and remaining questions</summary><div class="detail-body">'
                     + value_html(details) + '</div></details></article>')
    return "".join(parts)


DELIVERY_CSS = """
:root{--ink:#293128;--muted:#687062;--line:#dce0d5;--bg:#f5f5f0;--card:#fff;--accent:#566c47;--soft:#edf1e7}
::selection{background:#d7e6ca;color:#26351e}a:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid #718365;outline-offset:4px}
main{max-width:1120px;padding-top:38px}main>h1{font-size:48px;margin:12px 0 22px}#section-header>h2{font-family:inherit;font-size:10px;font-weight:600;line-height:1.4;text-transform:uppercase;letter-spacing:.16em;border:0;margin:24px 0 12px;padding:0}
.whole-run{margin:0 0 20px}.whole-run h3{font:normal 32px/1.2 Georgia,serif;letter-spacing:-.02em;margin:8px 0}.whole-run .run-heading{display:flex;justify-content:space-between;gap:20px;align-items:start}.whole-run .pill{background:var(--soft);color:var(--accent)}
.run-identity{display:grid;grid-template-columns:2fr 1.4fr .6fr;gap:24px;margin:20px 0 24px}.run-identity span,.run-identity b{display:block}.run-identity span{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.run-identity b{font-size:13px;font-weight:500;margin-top:4px;overflow-wrap:anywhere}
.whole-run .metrics{display:grid;grid-template-columns:1.25fr .8fr 1fr 1fr;gap:0;border-block:1px solid var(--line);padding:20px 0}.whole-run .metric{background:none;border:0;border-right:1px solid var(--line);border-radius:0;padding:0 20px}.whole-run .metric:first-child{padding-left:0}.whole-run .metric:last-child{border:0;padding-right:0}.whole-run .metric strong{display:block;font:normal 30px/1.2 Georgia,serif;margin:8px 0}.whole-run .metric .cost-unavailable{font-size:24px}.whole-run .metric small{display:block;font-size:10px;line-height:1.5;color:var(--muted)}
.run-outcome{display:grid;grid-template-columns:1fr 1.4fr 1fr;gap:22px;padding:20px 24px;margin:22px 0;background:var(--soft);border-radius:14px}.run-outcome a{color:inherit;text-decoration:none}.run-outcome a:hover{text-decoration:underline}.run-outcome strong{display:block;font:normal 28px/1.2 Georgia,serif;margin:6px 0}.run-outcome span,.run-outcome small{display:block;font-size:11px}.run-outcome small{color:var(--muted)}
.whole-run-flow{display:grid;grid-template-columns:repeat(5,1fr);list-style:none;padding:0;gap:0;margin:28px 0 22px}.whole-run-flow>li{position:relative;border-top:1px solid #b3c2a5;padding:16px 14px 0 0;font-size:11px}.whole-run-flow>li:before{content:"";position:absolute;top:-5px;left:0;width:9px;height:9px;border-radius:50%;background:#758766;box-shadow:0 0 0 4px var(--bg)}.whole-run-flow b,.whole-run-flow small{display:block}.whole-run-flow small{color:var(--muted);margin-top:5px}.whole-run-flow .review-branches{display:grid;gap:7px;margin-top:5px}.review-branches span{display:block;font-size:10px;color:var(--muted)}
.replay-line{display:flex;gap:14px 24px;flex-wrap:wrap;font-size:11px;padding:12px 0;border-top:1px solid var(--line)}.replay-line b{font-weight:600;color:var(--ink)}.replay-line span{color:var(--muted)}.run-details{border:0;background:none;border-block:1px solid var(--line);border-radius:0}.run-details>summary{padding:13px 0}.run-details>.detail-body{padding:0 0 14px}.run-details p{font-size:12px;line-height:1.6}.engine-provenance{margin-top:10px}.engine-provenance>.detail-body{padding:0 18px 18px}
.ai-review{border-top:1px solid #d5dcd2;margin:36px 0 10px;padding-top:22px}.ai-review h3{font:normal 28px/1.3 Georgia,serif}
.review-record{border:1px solid #d5dcd2;border-radius:12px;padding:18px 20px;margin:14px 0;background:#fffef8}.review-record-head{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.review-record h5{font-size:16px;margin:12px 0}.review-record p{font-size:13px}.review-record .pill{background:#e8eddf;color:#365e4c}.ai-review details{margin-bottom:0}
.whole-run dl,.ai-review dl,.delivery-appendix dl{display:grid;grid-template-columns:minmax(120px,1fr) 3fr;gap:7px 18px;font-size:12px}.ai-review dt,.delivery-appendix dt{font-weight:600}.ai-review dd,.delivery-appendix dd{margin:0;overflow-wrap:anywhere}
.ai-review li,.delivery-appendix li{margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}.delivery-appendix{border-top:1px solid #d5dcd2;margin-top:30px;padding-top:14px}
.review-counts{display:flex;gap:9px;flex-wrap:wrap;margin:15px 0}.review-counts span{border:1px solid #d5dcd2;background:#fffef8;padding:5px 11px;border-radius:100px;font-size:11px}
@media(max-width:720px){main>h1{font-size:36px}.run-identity{grid-template-columns:1fr 1fr;gap:16px}.run-identity>div:first-child{grid-column:1/-1}.whole-run .metrics{grid-template-columns:1fr 1fr;gap:22px 0}.whole-run .metric{padding:0 16px}.whole-run .metric:nth-child(odd){padding-left:0}.whole-run .metric:nth-child(even){border:0}.whole-run-flow{grid-template-columns:1fr 1fr;row-gap:24px}.run-outcome{grid-template-columns:1fr;padding:20px;gap:18px}.run-outcome strong{font-size:28px}.whole-run dl,.ai-review dl,.delivery-appendix dl{display:block}.ai-review dd,.delivery-appendix dd{margin-bottom:12px}}
@media print{main>h1{font-size:30px}.whole-run{break-inside:avoid}.whole-run h3{font-size:25px}.whole-run .metrics{padding:14px 0}.whole-run .metric strong{font-size:24px}.run-outcome{margin:16px 0;padding:16px}.whole-run-flow{margin:22px 0 14px}.run-identity{margin:14px 0}.review-record{break-inside:avoid}.ai-review details>.detail-body,.delivery-appendix details>.detail-body,.engine-provenance>.detail-body,.run-details>.detail-body{display:block!important}}
"""


def render_delivery(inputs: dict[str, bytes]) -> tuple[bytes, dict]:
    def load(name, default=None):
        return json.loads(inputs[name]) if name in inputs else default

    launch, summary = load("launch.json"), load("summary.json")
    if launch.get("status") in {"queued", "running"} or summary.get("status") in {"queued", "running"}:
        raise ValueError("Only terminal runs can be delivered")
    engine, brief = load("engine/run_log.json"), load("brief.json", {})
    if brief.get("engine_sha256") and brief["engine_sha256"] != sha(inputs["engine/run_log.json"]):
        raise ValueError("Agent inputs do not match this engine artifact")
    sector, engine_metrics = summary.get("sector_research", {}), engine.get("run_metadata", {})
    engine_calls = engine_metrics.get("llm_calls", 0) or 0
    agent_calls = (summary.get("llm_calls", 0) or 0) + (sector.get("calls", 0) or 0)
    calls = agent_calls + engine_calls
    token_in = (summary.get("total_tokens_in", 0) or 0) + (sector.get("tokens_in", 0) or 0)
    token_out = (summary.get("total_tokens_out", 0) or 0) + (sector.get("tokens_out", 0) or 0)
    mock = launch.get("provider") == "mock"
    measured_model_calls = engine_calls + (0 if mock else agent_calls)
    milliseconds = recorded_duration(launch)
    whole_timing = launch.get("timing_scope") == "through_report"
    attributable_cost = (engine_metrics.get("mxn_cost") if engine_calls else 0) if mock else None
    incomplete = bool(summary.get("usage_incomplete") or summary.get("usage_unknown") or sector.get("usage_unknown") or engine_calls)
    metrics = {"provider": launch["provider"], "llm_invocations": measured_model_calls,
               "provider_invocations_including_mock": calls, "tokens_in": token_in, "tokens_out": token_out,
               "wall_clock_seconds": milliseconds / 1000 if milliseconds is not None else None, "mxn_cost": attributable_cost,
               "timing_scope": "through_report" if whole_timing else "recorded_execution",
               "timing_includes_report": whole_timing,
               "cost_basis": ("offline_no_model_calls" if not engine_calls else "recorded_engine_cost") if mock else "subscription_allocation_unavailable",
               "fresh_execution_deterministic": False, "decision_pipeline_deterministic": bool(mock and not engine_calls),
               "saved_artifact_replay_deterministic": True, "usage_incomplete": incomplete,
               "tokens_estimated": bool(summary.get("tokens_estimated") or sector.get("tokens_estimated")),
               "call_count_basis": "Recorded provider invocations; Codex internal model requests are not exposed by the provider",
               "scopes": {"rule_engine_calls": engine_calls, "ab_compiler_invocations": summary.get("llm_calls", 0),
                          "sector_research_invocations": sector.get("calls", 0),
                          "engine_submission": "validated_rule_findings_only"}}
    cost_text = f"MXN {attributable_cost:,.2f}" if attributable_cost is not None else "Unavailable"
    cost_note = ("No model calls" if not measured_model_calls else "Recorded engine cost; A/B simulated") if mock else "Subscription allocation is not available per run"
    seed_known = launch.get("seed_provenance") in {"filename", "provided", "explicit"}
    seed_value = engine.get("seed", engine.get("estate_seed"))
    seed_text = str(seed_value) if seed_known and seed_value is not None else "Not supplied"
    reviews = load("agent_a.json", {}).get("reviews", [])
    hypotheses = load("agent_b.json", {}).get("findings", [])
    proposals = load("proposals.json", [])
    stages = {stage.get("id"): stage.get("status") for stage in summary.get("stages", []) if isinstance(stage, dict)}
    token_label = "Recorded token subtotal" if incomplete else ("Estimated tokens" if metrics["tokens_estimated"] else "Recorded tokens")
    metadata = engine.get("metadata") if isinstance(engine.get("metadata"), dict) else {}
    company = str(engine.get("company_name") or metadata.get("company_name") or "").strip()
    if company.casefold() == "nombre no suministrado":
        company = ""
    period = engine.get("period")
    period_text = " — ".join(str(value or "Not supplied") for value in period) if isinstance(period, list) and len(period) == 2 else "Not supplied"
    findings = engine.get("findings", [])
    findings = findings if isinstance(findings, list) else []
    closed = engine.get("leads")
    if not isinstance(closed, list):
        closed = load("engine/submission.json", {}).get("leads_not_pursued", [])
    closed = closed if isinstance(closed, list) else []
    proven = sum(isinstance(item, dict) and item.get("confidence") == "proven" for item in findings)
    probable = sum(isinstance(item, dict) and item.get("confidence") == "probable" for item in findings)
    exposure = finding_exposure(findings)
    exposure_text = f"MXN {exposure:,.2f}" if exposure is not None else "Not recorded"
    timing_label = "Total investigation time" if whole_timing else "Recorded execution time"
    timing_note = ("Dispatch through report validation; final metric sealing excluded."
                   if whole_timing else "Legacy timing; report completion was not measured.")
    seconds_note = f"{milliseconds / 1000:,.3f} wall-clock seconds" if milliseconds is not None else "Duration was not captured"
    determinism_text = "Deterministic · simulated A/B" if metrics["decision_pipeline_deterministic"] else "May vary"
    header_parts = []
    if str(launch.get("corrida_nombre") or "").strip():
        header_parts.append(escape(str(launch["corrida_nombre"]).strip()))
    if industry_display(launch.get("giro")):
        header_parts.append("Industry: " + escape(industry_display(launch["giro"])))
    header_line = " · ".join(header_parts)
    review_mode = ("<b>Demo without AI.</b> A/B responses are simulated." if not engine_calls
                   else "<b>A/B simulation.</b> The engine includes recorded model usage.") if mock else (
                       "A new Codex review may differ. Recorded provider invocations do not expose internal model-request counts.")
    prefix = (
        '<aside class="whole-run" aria-label="Complete investigation metrics">'
        '<div class="run-heading"><div><span class="eyebrow">Complete workflow · recorded execution</span>'
        f'<h3>{escape(company or "Company name not supplied")}</h3>'
        f'<p class="meta">{header_line}</p></div><span class="pill">{shown(launch.get("status", "Recorded"))}</span></div>'
        '<div class="run-identity">'
        f'<div><span>Audited company ID</span><b>{escape(str(engine.get("company_rfc") or "Not supplied"))}</b></div>'
        f'<div><span>Audit period</span><b>{escape(period_text)}</b></div>'
        f'<div><span>Estate seed</span><b>{escape(seed_text)}</b></div></div>'
        '<div class="metrics">'
        f'<div class="metric"><small>{timing_label}</small><strong>{duration_label(milliseconds)}</strong><small>{seconds_note}</small></div>'
        f'<div class="metric"><small>LLM call count</small><strong>{measured_model_calls}</strong><small>Recorded provider invocations</small></div>'
        f'<div class="metric"><small>MXN cost</small><strong class="cost-unavailable">{cost_text}</strong><small>{cost_note}</small></div>'
        f'<div class="metric"><small>{token_label}</small><strong>{token_in + token_out:,}</strong><small>{token_in:,} input · {token_out:,} output</small></div></div>'
        f'<p class="meta">{timing_note}</p>'
        '<div class="run-outcome" aria-label="Investigation result">'
        f'<a href="#section-findings"><span>Rule-engine findings</span><strong>{len(findings)}</strong><small>{proven} proven · {probable} probable</small></a>'
        f'<a href="#section-summary"><span>Exposure · sum of findings</span><strong>{exposure_text}</strong><small>May overlap; not a deduplicated loss</small></a>'
        f'<a href="#section-leads"><span>Leads examined and closed</span><strong>{len(closed)}</strong><small>Reasons and evidence in section 4</small></a></div>'
        '<ol class="whole-run-flow" aria-label="Complete investigation workflow">'
        f'<li><b>01 · Rules</b><small>{len(findings)} retained findings<br>{len(closed)} closed leads</small></li>'
        '<li><b>02 · Context</b><small>Shared industry reference<br>Guide questions, not verdicts</small></li>'
        f'<li><b>03 · A + B review</b><div class="review-branches"><span>A · {len(reviews)} known-signal reviews</span><span>B · {len(hypotheses)} new hypotheses</span></div></li>'
        f'<li><b>04 · Compile</b><small>{len(proposals)} proposed changes<br>{shown(stages.get("compiler", "Not recorded"))}</small></li>'
        '<li><b>05 · Human decision</b><small>Approval required to change rules</small></li></ol>'
        '<div class="replay-line" aria-label="Reproducibility">'
        f'<span><b>Fresh conclusions</b> · {determinism_text}</span>'
        f'<span><b>Saved replay</b> · Identical with renderer v{VERSION}</span></div>'
        '<details class="run-details"><summary>Measurement, scope and replay details</summary><div class="detail-body">'
        f'<p>{review_mode} The findings remain the validated rule-engine output; A/B reviews and proposals do not automatically change them.</p>'
        f'<p>{token_label}: {token_in:,} input / {token_out:,} output. '
        f'Includes {sector.get("calls", 0)} industry-research invocation(s) during this run. '
        + ("Some usage is unavailable; these totals are incomplete. " if incomplete else "")
        + 'Internal Codex requests are not itemized.</p>'
        f'<p>Started: {escape(str(launch.get("started_at") or "Not recorded"))}<br>'
        f'Completed: {escape(str(launch.get("completed_at") or "Not recorded"))}<br>'
        f'Run <code>{escape(launch["run_id"])}</code>.</p>'
        '<p>This recorded report can be rebuilt offline byte for byte with the same renderer version and saved inputs. '
        'A new run has its own identifier and measured duration. Evidence labels describe this audit, not a judicial ruling.</p>'
        '</div></details></aside>')
    supplement = ['<section class="ai-review" aria-label="A and B evidence review"><span class="eyebrow">Independent review · preserved as recorded</span>',
                  '<h3>A/B · Evidence review</h3><p>Hypotheses and proposed rules are not validated accusations. '
                  'A finding is not removed or promoted merely because an agent agrees or disagrees.</p>',
                  f'<div class="review-counts"><span>A · {len(reviews)} reviews</span><span>B · {len(hypotheses)} hypotheses</span>'
                  f'<span>{len(proposals)} proposals awaiting a decision</span></div>',
                  '<h4>A · Challenge known signals</h4>',
                  review_cards(reviews, "A") if reviews else '<p>No valid challenges recorded.</p>',
                  '<h4>B · Explore the remaining sample</h4>',
                  review_cards(hypotheses, "B") if hypotheses else '<p>No additional hypotheses recorded. This does not prove an absence of fraud.</p>',
                  '<h4>Proposals for human review</h4>',
                  review_cards(proposals, "Proposal") if proposals else '<p>No pending proposals.</p>', '</section>']
    context = brief.get("playbook_excerpt", {})
    if isinstance(context, dict):
        # Display vocabulary is separate from the persisted research and run states.
        context = dict(context)
        if context.get("status") in CONTEXT_STATUS:
            context["status"] = CONTEXT_STATUS[context["status"]]
        if context.get("giro") is not None:
            context["giro"] = industry_display(context["giro"])
    appendix = ('<section class="delivery-appendix" aria-label="Recorded scope and replay"><h3>Scope, context and recorded decisions</h3>'
                '<p>The review covers the recorded samples below. Unreviewed subjects and missing data remain outside its conclusions.</p>'
                + value_html({"coverage": summary.get("coverage", {}), "context": context,
                              "notes": load("notes.json", []), "errors": summary.get("errors", []),
                              "compiler_notes": load("compiler.json", {}).get("notes", [])})
                + '<h4>Local replay</h4><p>Keep the complete investigation folder. '
                '<code>python3 -m labs.delivery --run-dir RUN_DIRECTORY --check</code> verifies the saved bytes; '
                'the same command without <code>--check</code> rebuilds this report without model calls or dataset queries. '
                'Keep the renderer version with the inputs for identical bytes.</p></section>')
    html = inputs["engine/case_file.html"].decode("utf-8")
    if "<main>" not in html or "</main>" not in html:
        raise ValueError("Invalid persisted engine case file")
    if "<!-- whole-run-header -->" in html:
        html, folded = re.subn(r"<!-- whole-run-header -->(.*?)(</section>)",
            lambda match: prefix + '<details class="engine-provenance"><summary>Original engine metrics and evidence fingerprints</summary>'
            '<div class="detail-body">' + match.group(1) + '</div></details>' + match.group(2), html, count=1, flags=re.S)
        if not folded:
            html = html.replace("<!-- whole-run-header -->", prefix, 1)
    else:
        html, replacements = re.subn(r"(<h[12][^>]*>\s*1\. Header\s*</h[12]>)", lambda match: match.group(1) + prefix, html, count=1)
        if not replacements:
            raise ValueError("Engine case file has no required header section")
    for term in ("LLM calls", "MXN cost", "Wall-clock seconds", "Deterministic"):
        html = re.sub(r"(<th\b[^>]*>)" + re.escape(term) + r"(</th>)",
                      lambda match: match.group(1) + term + " · rule engine" + match.group(2), html, count=1)
    if "<!-- ai-review -->" in html:
        html = html.replace("<!-- ai-review -->", "".join(supplement), 1)
    else:
        html = html.replace("<h2>4. Leads not pursued</h2>", "".join(supplement) + "<h2>4. Leads not pursued</h2>", 1)
    if "<!-- whole-run-appendix -->" in html:
        html = html.replace("<!-- whole-run-appendix -->", appendix, 1)
    else:
        html = html.replace("</main>", appendix + "</main>", 1)
    html = html.replace("</style>", DELIVERY_CSS + "</style>", 1)
    html = html.replace('<p class="eyebrow">Forensic audit / Evidence-led case file</p><h1>Follow the evidence.</h1>',
                        '<p class="eyebrow">Inspector / Evidence-led case file</p><h1>Investigation report.</h1>', 1)
    body = html.encode("utf-8")
    manifest = {"version": VERSION, "run_id": launch["run_id"], "status": launch["status"], "scope": "whole_investigation",
                "metrics": metrics, "submission_scope": "deterministic_engine_only", "submission": "engine/submission.json",
                "engine_estate_sha256": engine.get("estate_sha256"),
                "inputs_sha256": {name: sha(data) for name, data in sorted(inputs.items())},
                "case_file_sha256": sha(body), "no_network_required": True,
                "limitations": ["Fresh mock reports have new run identifiers and measured timing; replay the saved artifacts for identical bytes."] if mock else [
                    "The complete run has no attributable numeric MXN subscription cost.",
                    "Fresh Codex executions are not guaranteed identical; saved-artifact replay is deterministic.",
                    "Internal model-request count is not exposed; provider invocations are reported."]}
    return body, manifest


def build_delivery(directory: Path, *, check=False) -> dict:
    directory = Path(directory)
    if check:
        recorded = json.loads((directory / "delivery/manifest.json").read_text())
        if recorded.get("version") != VERSION:
            raise ValueError(f"Saved delivery uses renderer version {recorded.get('version')}; this renderer is version {VERSION}. "
                             "Use the matching renderer for byte-identical replay. Original artifacts were not changed.")
    body, manifest = render_delivery(read_inputs(directory))
    destination = directory / "delivery"
    manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    if check:
        if (destination / "case_file.html").read_bytes() != body or (destination / "manifest.json").read_bytes() != manifest_bytes:
            raise ValueError("Persisted delivery differs from its recorded inputs")
        return manifest
    destination.mkdir(exist_ok=True, mode=0o700)
    if destination.is_symlink():
        raise ValueError("Delivery directory must not be a symlink")
    for name, data in (("case_file.html", body), ("manifest.json", manifest_bytes)):
        temporary = destination / (name + ".tmp")
        temporary.write_bytes(data)
        temporary.chmod(0o600)
        temporary.replace(destination / name)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = build_delivery(Path(args.run_dir), check=args.check)
    print(json.dumps({"run_id": manifest["run_id"], "replay_verified": args.check, "case_file_sha256": manifest["case_file_sha256"]}))


if __name__ == "__main__":
    main()
