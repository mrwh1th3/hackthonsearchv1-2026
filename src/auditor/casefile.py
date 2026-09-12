"""Expediente HTML autocontenido (sin red): secciones en el orden de
spec/forensic-auditor/case_file_structure.md y diagrama del rastro del dinero en SVG."""
from __future__ import annotations

from html import escape

SCHEME_LABEL = {"phantom_vendor": "Phantom vendor", "kickback": "Kickback", "round_tripping": "Round-tripping",
                "threshold_splitting": "Threshold splitting", "revenue_inflation": "Revenue inflation"}
CLOSED_LABEL = {"investigator": "Investigator", "challenger": "Adversarial reviewer", "validator": "Validator"}

CSS = """
:root{--ink:#1b1f24;--muted:#5b6470;--line:#d9dee4;--bg:#fafbfc;--card:#fff;--accent:#0b5cad;--warn:#a4400b;--ok:#1f7a3a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px;padding-top:12px;border-top:2px solid var(--ink)}
h3{font-size:17px;margin:28px 0 8px}h4{font-size:14px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.meta{color:var(--muted);font-size:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px 20px;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#f1f3f6;font-weight:600}.scroll{overflow-x:auto}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.proven{background:#fde3d6;color:var(--warn)}.probable{background:#fff1c7;color:#7a5a00}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}code{font-size:13px}
.held{color:var(--ok)}.broke{color:var(--warn)}
.lead{border-left:4px solid var(--line);padding:8px 14px;margin:10px 0;background:var(--card)}
"""


def mxn(x: float) -> str:
    return f"MXN {x:,.2f}"


def trail_svg(trail: list[dict], labels: dict[str, str]) -> str:
    nodes: list[str] = []
    for s in trail:
        for n in (s["from"], s["to"]):
            if n not in nodes:
                nodes.append(n)
    colw, left, top, rowh = 230, 20, 70, 46
    width = left * 2 + colw * max(len(nodes), 2)
    height = top + rowh * len(trail) + 30
    x = {n: left + colw * i + colw // 2 for i, n in enumerate(nodes)}
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
           f'role="img" aria-label="Money trail diagram" style="font-family:inherit">',
           '<defs><marker id="ar" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">'
           '<path d="M0,0 L10,4 L0,8 z" fill="#0b5cad"/></marker></defs>']
    for n in nodes:
        lab = labels.get(n, n)
        out.append(f'<line x1="{x[n]}" y1="{top - 14}" x2="{x[n]}" y2="{height - 10}" stroke="#c7cdd4" stroke-dasharray="4 4"/>')
        out.append(f'<rect x="{x[n] - 105}" y="8" width="210" height="44" rx="6" fill="#fff" stroke="#1b1f24"/>')
        out.append(f'<text x="{x[n]}" y="27" text-anchor="middle" font-size="12" font-weight="600">{escape(n)}</text>')
        out.append(f'<text x="{x[n]}" y="43" text-anchor="middle" font-size="11" fill="#5b6470">{escape(lab[:30])}</text>')
    for i, s in enumerate(trail):
        y = top + rowh * i + 20
        x1, x2 = x[s["from"]], x[s["to"]]
        if x1 == x2:
            x2 = x1 + 60
        pad = 6 if x2 > x1 else -6
        out.append(f'<line x1="{x1}" y1="{y}" x2="{x2 - pad}" y2="{y}" stroke="#0b5cad" stroke-width="2" marker-end="url(#ar)"/>')
        mid = (x1 + x2) / 2
        out.append(f'<text x="{mid}" y="{y - 7}" text-anchor="middle" font-size="12">'
                   f'{escape(mxn(s["amount"]))} · {escape(str(s["date"]))} · {escape(s["exhibit_id"])}</text>')
    out.append("</svg>")
    return "".join(out)


def render_html(r: dict) -> str:
    md = r["run_metadata"]
    fs, leads = r["findings"], r["leads"]
    total = sum(f["peso_amount"] for f in fs)
    conf = {c: sum(1 for f in fs if f["confidence"] == c) for c in ("proven", "probable")}
    p0, p1 = r["period"] if r.get("period") else ("", "")
    h = [f"<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Case File — seed {r['seed']}</title><style>{CSS}</style><main>"]

    # 1. Header
    h.append(f"<h1>Forensic Audit Case File</h1><h2 style='border:0;margin-top:8px;padding:0'>1. Header</h2>"
             f"<p class='meta'>Company RFC <b>{escape(r['company_rfc'])}</b> · audit period {escape(str(p0))} to "
             f"{escape(str(p1))} · estate seed <b>{r['seed']}</b> · estate sha256 <code>{r['estate_sha256'][:16]}…</code></p>"
             f"<div class='card'><table><tr><th>LLM calls</th><th>MXN cost</th><th>Wall-clock seconds</th>"
             f"<th>Deterministic</th><th>LLM mode</th></tr><tr><td class='num'>{md['llm_calls']}</td>"
             f"<td class='num'>{md['mxn_cost']:,.2f}</td><td class='num'>{md['wall_clock_seconds']:,.2f}</td>"
             f"<td>{'Yes' if md['deterministic'] else 'No'} — same seed and estate give the same findings "
             f"(fingerprint <code>{escape(r.get('fingerprint', '')[:16])}</code>)</td>"
             f"<td>{escape(md.get('llm_mode', 'off'))}</td></tr></table></div>")

    # 2. Executive summary
    kinds = sorted({SCHEME_LABEL[f["scheme_type"]].lower() for f in fs})
    if fs:
        top = fs[0]
        summary = (f"The audit found <b>{len(fs)}</b> fraud scheme{'s' if len(fs) != 1 else ''} "
                   f"({escape(', '.join(kinds))}) with a combined exposure of <b>{mxn(total)}</b>. "
                   f"The largest is {escape(SCHEME_LABEL[top['scheme_type']].lower())} involving "
                   f"{escape(top['subject_name'])} for {mxn(top['peso_amount'])}. "
                   f"{len(leads)} other leads raised by the detectors were investigated and closed without "
                   f"an accusation; each is explained in section 4.")
    else:
        summary = (f"The audit found no scheme that survived investigation and validation. "
                   f"{len(leads)} leads were investigated and closed; see section 4.")
    h.append(f"<h2>2. Executive summary</h2><p>{summary}</p><div class='card'><table>"
             f"<tr><th>Findings</th><td>{len(fs)} ({conf['proven']} proven, {conf['probable']} probable)</td></tr>"
             f"<tr><th>Total exposure</th><td class='num'>{mxn(total)}</td></tr>"
             f"<tr><th>Leads investigated and closed</th><td>{len(leads)}</td></tr></table></div>")
    if fs:
        h.append("<div class='scroll'><table><tr><th>#</th><th>Scheme</th><th>Entities</th><th>Amount</th>"
                 "<th>Confidence</th></tr>")
        for i, f in enumerate(fs, 1):
            h.append(f"<tr><td>{i}</td><td>{SCHEME_LABEL[f['scheme_type']]}</td><td>{escape(', '.join(f['entities']))}</td>"
                     f"<td class='num'>{mxn(f['peso_amount'])}</td><td><span class='pill {f['confidence']}'>"
                     f"{f['confidence']}</span></td></tr>")
        h.append("</table></div>")

    # 3. Findings
    h.append("<h2>3. Findings</h2>" if fs else "<h2>3. Findings</h2><p>None.</p>")
    for i, f in enumerate(fs, 1):
        labels = {"COMPANY": "Audited company"}
        for ent in f["entities"]:
            labels[ent] = f["subject_name"].split(" / ")[0] if ent.startswith("RFC:") else f.get("employee_label", "Employee")
        h.append(f"<h3>Finding {i} — {escape(f['subject_name'])} ({escape(', '.join(f['entities']))}): "
                 f"{SCHEME_LABEL[f['scheme_type']]}</h3>")
        h.append(f"<h4>Rule broken</h4><p>{escape(f['rule_broken'])}</p>")
        h.append(f"<h4>Amount and confidence</h4><p><b class='num'>{mxn(f['peso_amount'])}</b> · "
                 f"<span class='pill {f['confidence']}'>{f['confidence']}</span></p>")
        h.append(f"<h4>What happened</h4><p>{escape(f['narrative'])}</p>")
        h.append("<h4>Money trail</h4><div class='card scroll'>" + trail_svg(f["money_trail"], labels) + "</div>")
        h.append("<h4>Exhibits</h4><div class='scroll'><table><tr><th>Exhibit</th><th>Source table</th>"
                 "<th>Record id</th><th>What it proves</th></tr>")
        for x in f["exhibits"]:
            h.append(f"<tr><td>{x['exhibit_id']}</td><td><code>{x['source_table']}</code></td>"
                     f"<td><code>{escape(x['record_id'])}</code></td><td>{escape(x['note'])}</td></tr>")
        h.append("</table></div>")
        rec = f["reconciliation"]
        items = rec["items"]
        h.append(f"<h4>Reconciliation</h4><p>Claimed amount reconciles against cited "
                 f"<code>{rec['table']}</code> records:</p><p class='num'>"
                 + " + ".join(f"{mxn(a)} ({escape(str(k))})" for k, a in items)
                 + f" = <b>{mxn(sum(a for _, a in items))}</b> — claimed {mxn(f['peso_amount'])}.</p>")
        ra = f.get("reconciled_against")
        if ra:
            h.append(f"<p class='meta'>Validator: per-table sums {escape(str(ra['per_table']))}; closest "
                     f"<code>{ra['table']}</code> = {mxn(ra['sum'])}, within 2%. Every cited record id exists in the estate.</p>")
        h.append("<h4>Evidence and adversarial review</h4><ul>"
                 + "".join(f"<li>{escape(ev)}</li>" for ev in f["evidence"]) + "</ul><ul>")
        for dfn in f["defense"]:
            who = "LLM defence counsel" if dfn.get("by") == "llm" else "Challenger"
            h.append(f"<li><b>{who} argued:</b> {escape(dfn['argument'])} "
                     f"<span class='held'>Finding held:</span> {escape(dfn['why'])}</li>")
        h.append("</ul>")

    # 4. Leads not pursued
    h.append(f"<h2>4. Leads not pursued</h2><p>{len(leads)} leads were investigated and closed without an accusation.</p>")
    h.append("<div class='scroll'><table><tr><th>Entity</th><th>Signal</th><th>Why it was closed</th>"
             "<th>Tools called</th><th>Closed by</th></tr>")
    for l in leads:
        h.append(f"<tr><td><code>{escape(l['entity'])}</code><br><span class='meta'>checked for "
                 f"{escape(SCHEME_LABEL[l['investigated_as']].lower())}</span></td>"
                 f"<td>{escape(l['signal'])}<br><span class='meta'>{escape(l['signal_detail'])}</span></td>"
                 f"<td>{escape(l['reason'])}</td><td class='meta'>{escape(', '.join(l['tool_calls_made']))}</td>"
                 f"<td>{CLOSED_LABEL[l['closed_by']]}</td></tr>")
    h.append("</table></div>")

    # 5. Method and limits
    h.append("""<h2>5. Method and limits</h2>
<h4>Architecture</h4><p>Deterministic SQL detectors read the estate and open leads; they never accuse. One investigator
per scheme type gathers evidence through logged, read-only tools and applies explicit rules
(<code>src/auditor/config.py</code>). A challenger tests the innocent explanation (contracts, purchase orders, receipts,
refunds, shared-bank coincidence) and can close the lead. A validator checks every cited record exists and that the
amount reconciles within 2% per table before anything is printed. An optional LLM writes a defence argument; it
never changes amounts, evidence or confidence.</p>
<h4>Out of scope for this run</h4><p>Physical delivery evidence, e-mail and document review, CFDI XML signature
verification against SAT, related-party ownership data, payroll, and any period outside the estate.</p>
<h4>What this system cannot detect</h4><ul>
<li>Kickbacks paid in cash or through accounts not present in <code>bank_txns</code>.</li>
<li>Phantom vendors whose invoices are fully backed by forged purchase orders and contracts.</li>
<li>Splitting across different vendors, or across windows longer than 21 days.</li>
<li>Round-trips routed through intermediaries, or returning less than 80% of the amount.</li>
<li>Revenue inflation that is later settled with circular cash; approval limits other than the candidate list.</li></ul>
<h4>Reproducibility</h4><p><code>PYTHONPATH=src python3 -m auditor run --estate &lt;estate.db&gt; --seed N --out &lt;dir&gt;</code>.
No network is used with <code>--llm off</code> (default) or <code>--llm replay --cassette &lt;file&gt;</code>. The same estate
and seed produce the same findings, leads and fingerprint; only the wall-clock figure varies.
<code>python3 -m auditor render --run-log &lt;run_log.json&gt;</code> rebuilds this file byte-for-byte offline.</p>
</main>""")
    return "".join(h)
