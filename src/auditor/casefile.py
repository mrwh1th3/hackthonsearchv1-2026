"""Expediente HTML autocontenido (sin red): secciones en el orden de
spec/forensic-auditor/case_file_structure.md y diagrama del rastro del dinero en SVG."""
from __future__ import annotations

from html import escape
from hashlib import sha256

from .trails import split_connected_trails

SCHEME_LABEL = {"phantom_vendor": "Phantom vendor", "kickback": "Kickback", "round_tripping": "Round-tripping",
                "threshold_splitting": "Threshold splitting", "revenue_inflation": "Revenue inflation"}
CLOSED_LABEL = {"investigator": "Investigator", "challenger": "Adversarial reviewer", "validator": "Validator"}

CSS = """
:root{color-scheme:light;--ink:#263b34;--muted:#61716a;--line:#d5dcd2;--bg:#f1f2e9;--card:#fffef8;--accent:#365e4c;--warn:#865430;--ok:#365e4c;--soft:#e8eddf}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:20px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif}
main{max-width:1120px;margin:0 auto;padding:52px 36px 80px}a{color:var(--accent);text-underline-offset:3px}
a:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:3px solid #925c2f;outline-offset:4px}
.skip-link{position:absolute;left:20px;top:-80px;padding:12px;background:var(--card);z-index:2}.skip-link:focus{top:12px}
h1,h2,h3,p{overflow-wrap:anywhere}h1{font:normal clamp(36px,6vw,64px)/1.08 Georgia,serif;letter-spacing:-.035em;margin:12px 0 20px}
h2{font:normal 30px/1.25 Georgia,serif;margin:54px 0 22px;padding-top:25px;border-top:1px solid var(--line)}
h3{font:normal 24px/1.3 Georgia,serif;margin:24px 0 12px}h4{font-size:11px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
p{margin:10px 0 16px}.eyebrow{font-size:10px;letter-spacing:.2em;text-transform:uppercase;font-weight:700}.meta{color:var(--muted);font-size:12px}
.report-nav{display:flex;flex-wrap:wrap;gap:8px 24px;padding:17px 0;border-block:1px solid var(--line);margin-bottom:30px;font-size:12px}
.report-nav a{text-decoration:none}.report-nav a:hover{text-decoration:underline}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:16px 0}
.section-label{display:inline-block;border:1px solid var(--line);border-radius:100px;padding:4px 11px;font-size:10px;letter-spacing:.1em;text-transform:uppercase}
.identity{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;padding:22px 0}.identity span{display:block}.identity b{font-weight:550}
.identity .meta{font-size:10px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metric{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.metric-value{display:block;font:normal clamp(24px,3vw,36px)/1.2 Georgia,serif;margin:8px 0}.metric small{color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:13px}caption{text-align:left;color:var(--muted);font-size:12px;padding:0 0 12px}
th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--soft);font-size:10px;text-transform:uppercase;letter-spacing:.07em;font-weight:650}
tbody tr:last-child td{border-bottom:0}.scroll{overflow:auto;max-width:100%;border-radius:8px}.scroll table{min-width:480px}
.pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:100px;font-size:11px;font-weight:600;white-space:nowrap}
.proven{background:#dce7d6;color:#2b4a38}.probable{background:#f2e6cf;color:#75532b}.flag-true{background:#e7e9de;color:#364d40}.flag-false{background:#e8ecdf;color:#405646}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}code{font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
.held{color:var(--ok)}.broke{color:var(--warn)}.notice{border-left:3px solid #91a585;padding:12px 18px;background:var(--soft);font-size:13px;border-radius:0 8px 8px 0}
.workflow{display:grid;grid-template-columns:repeat(4,1fr);gap:0;list-style:none;padding:0;margin:24px 0}
.workflow li{position:relative;border-top:1px solid #9eaf95;padding:14px 16px 0 0;font-size:12px}.workflow li:before{content:"";position:absolute;top:-4px;left:0;width:7px;height:7px;border-radius:50%;background:var(--accent)}
.workflow b,.workflow small{display:block}.workflow small{color:var(--muted)}.summary-visuals{display:grid;grid-template-columns:1fr 1.4fr;gap:20px}
.confidence-key{display:flex;gap:16px;font-size:12px;flex-wrap:wrap}.confidence-key span:before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:#537356;margin-right:6px}.confidence-key span+span:before{background:#c0a372}
.exposure-row{display:grid;grid-template-columns:1fr auto;gap:2px 15px;font-size:12px;margin:15px 0}.exposure-row .bar{grid-column:1/-1;height:5px;background:var(--soft);border-radius:8px;overflow:hidden}.exposure-row .bar span{display:block;height:100%;background:#73936a;border-radius:8px}
.finding{border-top:1px solid var(--line);margin-top:34px;padding-top:20px}.finding-head{display:flex;align-items:flex-start;gap:18px}.finding-number{font:normal 42px/1 Georgia,serif;color:#889879;min-width:50px}.finding-head h3{margin:0 0 7px}.finding-head .meta{margin:0}
.rule{padding:14px 18px;border-left:2px solid #9daf90;background:#ecefe5}.amount-line{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.amount-line strong{font:normal 32px/1.3 Georgia,serif}.narrative{max-width:850px;font-size:16px}
figure{margin:16px 0}figcaption{font-size:12px;color:var(--muted);margin-top:10px}.diagram{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}.scroll-hint{display:none;margin:8px 0;color:var(--muted);font-size:11px}
details{border:1px solid var(--line);border-radius:10px;background:var(--card);margin:12px 0}summary{cursor:pointer;padding:13px 16px;font-size:12px;font-weight:650}details>.detail-body{padding:0 16px 16px}
.path{border-top:1px solid var(--line);padding:14px 0}.path:first-child{border:0}.path-name{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:9px}
.path-chain{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.path-node{background:var(--soft);border-radius:6px;padding:7px 9px;font:11px ui-monospace,monospace}.path-edge{text-align:center;min-width:120px;font-size:11px}.path-edge span{display:block}.path-edge .arrow{color:var(--accent);font-size:22px;line-height:1}
.reconcile-total{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;background:var(--soft);border-radius:10px;padding:16px 20px}.reconcile-total strong{font:normal 26px Georgia,serif}.reconcile-total small{color:var(--muted)}
.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.review-item{padding:17px 19px;border:1px solid var(--line);border-radius:10px;background:var(--card)}.review-item h5{margin:0 0 8px;font-size:10px;letter-spacing:.08em;text-transform:uppercase}.review-item p{font-size:13px;margin:0}
.lead{border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:14px 0;background:var(--card)}.lead h3{font-size:16px;font-weight:600;line-height:1.4;font-family:inherit;margin:0 0 5px}.lead dl{display:grid;grid-template-columns:120px 1fr;gap:7px 14px;font-size:13px;margin:16px 0 0}.lead dt{color:var(--muted);font-size:11px}.lead dd{margin:0}
.method-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.method-grid li{font-size:13px;margin:8px 0}.footer{border-top:1px solid var(--line);margin-top:48px;padding-top:18px;font-size:11px;color:var(--muted)}
@media(max-width:720px){main{padding:28px 18px 48px}.identity,.metrics,.summary-visuals,.method-grid,.review-grid{grid-template-columns:1fr}.workflow{grid-template-columns:1fr 1fr;row-gap:24px}.card{padding:18px}.lead dl{grid-template-columns:1fr;gap:3px}.lead dd{margin-bottom:9px}.finding-number{font-size:34px;min-width:36px}h2{font-size:26px}.num{white-space:normal}.scroll-hint{display:block}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@media print{body{background:white;font-size:11px}main{max-width:none;padding:0}h1{font-size:36px}h2{break-after:avoid}h3,h4{break-after:avoid}.card,.lead,.review-item{break-inside:avoid}.report-nav,.skip-link{display:none}.scroll{overflow:visible}.scroll table{min-width:0}details>.detail-body{display:block!important}details::details-content{content-visibility:visible;display:block}details{display:block}summary{list-style:none}svg{max-width:100%;height:auto}.metrics{grid-template-columns:repeat(3,1fr)}a{color:inherit}.path{break-inside:avoid}tr{break-inside:avoid}}
"""




def mxn(x: float) -> str:
    return f"MXN {x:,.2f}"


def trail_svg(trail: list[dict], labels: dict[str, str], prefix: str = "trail") -> str:
    """Una flecha por tramo (pagador → receptor), en el orden en que aparece por primera vez. Los movimientos
    repetidos de un mismo tramo (p. ej. 242 pagos al mismo proveedor) van en una sola flecha con cuántos son, el
    total, las fechas y el primer y último exhibit; todos sus exhibit ids quedan en el <title> de la flecha, y cada
    movimiento sigue en la tabla de exhibits y en money_trail de submission.json."""
    legs: dict[tuple[str, str], list[dict]] = {}
    for s in trail:
        legs.setdefault((s["from"], s["to"]), []).append(s)
    nodes: list[str] = []
    for leg in legs:
        for n in leg:
            if n not in nodes:
                nodes.append(n)
    colw, left, top, rowh = 230, 20, 70, 58
    width = left * 2 + colw * max(len(nodes), 2)
    height = top + rowh * len(legs) + 30
    x = {n: left + colw * i + colw // 2 for i, n in enumerate(nodes)}
    marker = "arrow-" + sha256(prefix.encode()).hexdigest()[:12]
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
           f'role="img" aria-label="Money trail diagram: {len(trail)} movements across {len(legs)} transfer legs" style="font-family:inherit">',
           '<desc>Each arrow groups only movements with the same payer and recipient. Parallel arrows are not a single continuous path. Every original movement is listed below.</desc>',
           f'<defs><marker id="{marker}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">'
           '<path d="M0,0 L10,4 L0,8 z" fill="#537356"/></marker></defs>']
    for n in nodes:
        lab = labels.get(n, n)
        out.append(f'<line x1="{x[n]}" y1="{top - 14}" x2="{x[n]}" y2="{height - 10}" stroke="#c9d3c2" stroke-dasharray="3 5"/>')
        out.append(f'<rect x="{x[n] - 105}" y="8" width="210" height="44" rx="10" fill="#e8eddf" stroke="#b7c6aa"/>')
        out.append(f'<text x="{x[n]}" y="27" text-anchor="middle" font-size="12" font-weight="600">{escape(n)}</text>')
        out.append(f'<text x="{x[n]}" y="43" text-anchor="middle" font-size="11" fill="#61716a">{escape(lab[:30])}</text>')
    for i, ((src, dst), steps) in enumerate(legs.items()):
        y = top + rowh * i + 20
        x1, x2 = x[src], x[dst]
        if x1 == x2:
            x2 = x1 + 60
        pad = 6 if x2 > x1 else -6
        mid = (x1 + x2) / 2
        ids = [s["exhibit_id"] for s in steps]
        dates = sorted(str(s["date"]) for s in steps)
        total = sum(s["amount"] for s in steps)
        if len(steps) == 1:
            above, below = f"{mxn(total)} · {dates[0]}", ids[0]
        else:
            span = dates[0] if dates[0] == dates[-1] else f"{dates[0]} to {dates[-1]}"
            above, below = f"{len(steps)} movements · {mxn(total)}", f"{span} · {ids[0]} … {ids[-1]}"
        out.append(f'<g><title>{escape(", ".join(ids))}</title>'
                   f'<line x1="{x1}" y1="{y}" x2="{x2 - pad}" y2="{y}" stroke="#537356" stroke-width="2" marker-end="url(#{marker})"/>'
                   f'<text x="{mid}" y="{y - 7}" text-anchor="middle" font-size="12">{escape(above)}</text>'
                   f'<text x="{mid}" y="{y + 17}" text-anchor="middle" font-size="11" fill="#61716a">{escape(below)}</text></g>')
    out.append("</svg>")
    return "".join(out)


def exhibit_anchor(finding: int, exhibit_id: str) -> str:
    return f"finding-{finding}-ex-" + sha256(str(exhibit_id).encode()).hexdigest()[:14]


def names_from_record(r: dict) -> dict[str, str]:
    """Use saved names only; do not assign the first vendor's name to an intermediary."""
    metadata = r.get("metadata") if isinstance(r.get("metadata"), dict) else {}
    names = {}
    for source in (metadata.get("entity_names", {}), r.get("entity_names", {})):
        if isinstance(source, dict):
            names.update({str(k): v for k, v in source.items() if isinstance(v, str) and v.strip()})
    for f in r.get("findings", []):
        entities = f.get("entities", [])
        if entities and f.get("subject_name"):
            names.setdefault(entities[0], f["subject_name"].split(" / ")[0])
        employees = [ent for ent in entities if ent.startswith("EMP:")]
        if len(employees) == 1 and f.get("employee_label"):
            names.setdefault(employees[0], f["employee_label"])
    return names


def connected_paths_html(trail: list[dict], finding: int) -> str:
    paths = split_connected_trails(trail)
    out = [f'<details><summary>Explore {len(paths)} connected path(s) · all {len(trail)} original movements</summary><div class="detail-body">']
    for p, path in enumerate(paths, 1):
        out.append(f'<div class="path" data-connected-path="{p}"><div class="path-name">Path {p} · {len(path)} step(s)</div><div class="path-chain">')
        out.append(f'<span class="path-node">{escape(str(path[0]["from"]))}</span>')
        for step in path:
            ref = escape(str(step["exhibit_id"]))
            target = exhibit_anchor(finding, step["exhibit_id"])
            out.append(f'<span class="path-edge"><span class="num">{mxn(step["amount"])}</span>'
                       f'<span class="arrow" aria-hidden="true">⟶</span><span>{escape(str(step["date"]))} · '
                       f'<a href="#{target}">{ref}</a></span></span>'
                       f'<span class="path-node">{escape(str(step["to"]))}</span>')
        out.append('</div></div>')
    out.append('</div></details>')
    return "".join(out)


def confidence_svg(proven: int, probable: int) -> str:
    total = proven + probable
    ratio = proven / total if total else 0
    length = 2 * 3.141592653589793 * 54
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="210" height="168" viewBox="0 0 210 168" role="img" '
            f'aria-label="{proven} proven findings and {probable} probable findings">'
            '<circle cx="105" cy="80" r="54" fill="none" stroke="#e5e9df" stroke-width="10"/>'
            + (f'<circle cx="105" cy="80" r="54" fill="none" stroke="#c0a372" stroke-width="10"/>'
               f'<circle cx="105" cy="80" r="54" fill="none" stroke="#537356" stroke-width="10" '
               f'stroke-dasharray="{length * ratio:.3f} {length:.3f}" transform="rotate(-90 105 80)"/>' if total else "")
            + f'<text x="105" y="83" text-anchor="middle" fill="#263b34" font-family="Georgia,serif" font-size="38">{total}</text>'
              '<text x="105" y="102" text-anchor="middle" fill="#61716a" font-size="10" font-family="sans-serif">FINDINGS</text></svg>')


def summary_graphics(findings: list[dict]) -> str:
    conf = {c: sum(f["confidence"] == c for f in findings) for c in ("proven", "probable")}
    amounts = {kind: sum(f["peso_amount"] for f in findings if f["scheme_type"] == kind) for kind in SCHEME_LABEL}
    maximum = max(amounts.values(), default=0)
    out = ['<div class="summary-visuals"><div class="card"><h4 style="margin-top:0">Confidence in the evidence</h4>',
           confidence_svg(conf["proven"], conf["probable"]),
           f'<div class="confidence-key"><span>{conf["proven"]} proven</span><span>{conf["probable"]} probable</span></div>',
           '<p class="meta">Rule-engine categories, not a probability or a legal determination.</p></div>',
           '<div class="card"><h4 style="margin-top:0">Exposure by scheme</h4>']
    for kind, amount in amounts.items():
        if amount:
            width = 100 * amount / maximum
            out.append(f'<div class="exposure-row"><span>{SCHEME_LABEL[kind]}</span><b class="num">{mxn(amount)}</b>'
                       f'<div class="bar" aria-hidden="true"><span style="width:{width:.3f}%"></span></div></div>')
    if not maximum:
        out.append('<p>No amount was attributed to a validated finding.</p>')
    out.append('<p class="meta">Sum within each scheme. Operations may overlap between findings.</p></div></div>')
    return "".join(out)


def structure_html(r: dict) -> str:
    """Subsección breve de cómo se leyó el estate (structure_report en run_log.json)."""
    sr = r.get("structure_report")
    if not sr:
        return ""
    inp = sr.get("input", {})
    fmt = inp.get("input_format", "sqlite")
    parts = [f"<h4>Estate structure</h4><p>Input format: <code>{escape(fmt)}</code>. {escape(sr.get('summary', ''))}"]
    if sr.get("status") != "identity":
        tables = sr.get("tables", {})
        mapped = [f"{escape(ct)} ← <code>{escape(str(t.get('source')))}</code>" for ct, t in tables.items()
                  if isinstance(t, dict) and t.get("source") and t["source"] != ct]
        if mapped:
            parts.append(" Tables read from other names: " + ", ".join(mapped) + ".")
        if sr.get("missing_tables"):
            parts.append(" Missing or unusable tables: " + escape(", ".join(sr["missing_tables"])) + ".")
        if sr.get("precision_lost"):
            parts.append(" Values discarded for numeric precision loss (not guessed): "
                         + escape(", ".join(f"{k} ×{v}" for k, v in sr["precision_lost"].items())) + ".")
        if sr.get("validator_estate"):
            parts.append(f" Cited record ids are the original input ids; <code>{escape(sr['validator_estate'])}</code> "
                         f"is a canonical copy with those ids for <code>validate_format.py --estate</code>.")
        parts.append(" Column-by-column mapping, confidence, method and every transformation are in "
                     "<code>run_log.json → structure_report</code>.")
    parts.append("</p>")
    dis = sr.get("disabled_schemes") or {}
    if dis:
        parts.append("<p><b>Not evaluated for missing data:</b></p><ul>" + "".join(
            f"<li>{escape(SCHEME_LABEL.get(s, s))}: needs {escape(', '.join(m))}, which the estate does not provide. "
            f"No lead of this type was opened, so its absence from the findings is not a clean result.</li>"
            for s, m in dis.items()) + "</ul>")
    weak = sr.get("weakened_schemes") or {}
    if weak:
        parts.append("<p><b>Evaluated with reduced evidence:</b></p><ul>" + "".join(
            f"<li>{escape(SCHEME_LABEL.get(s, s))}: the estate lacks {escape(', '.join(m))}. Signals built on those "
            f"records could not fire, so a scheme of this type may be missed here.</li>" for s, m in weak.items()) + "</ul>")
    return "".join(parts)


def triage_html(r: dict) -> str:
    t = r.get("triage") or {}
    c = t.get("counts")
    if not c:
        return ""
    return (f"<h4>Fraud flag split</h4><p>Every evaluated subject carries an explicit <code>fraud_flag</code>: "
            f"{c['fraud_flag_true']} record(s) flagged true (findings) and {c['fraud_flag_false']} flagged false "
            f"({c['by_status']['closed_lead']} closed leads, {c['by_status']['no_signal']} subjects no detector raised), "
            f"covering {c['subjects']} subjects, {c['subjects_flagged']} of them in at least one finding.</p>")


def render_finding(f: dict, number: int, names: dict[str, str]) -> str:
    trail = f["money_trail"]
    labels = {"COMPANY": "Audited company", **names}
    out = [f'<article class="finding" id="finding-{number}" aria-labelledby="finding-{number}-title">',
           '<div class="finding-head">',
           f'<span class="finding-number" aria-hidden="true">{number:02d}</span><div>',
           f'<h3 id="finding-{number}-title">{escape(f["subject_name"])} · {SCHEME_LABEL[f["scheme_type"]]}</h3>',
           f'<p class="meta">{escape(", ".join(f["entities"]))} · <span class="pill flag-true">fraud_flag: true</span></p></div></div>',
           '<h4>Rule broken</h4>', f'<p class="rule">{escape(f["rule_broken"])}</p>',
           '<h4>Amount and confidence</h4>',
           f'<p class="amount-line"><strong class="num">{mxn(f["peso_amount"])}</strong><span class="pill {f["confidence"]}">{f["confidence"]}</span></p>',
           f'<h4>What happened</h4><p class="narrative">{escape(f["narrative"])}</p>',
           '<h4>Money trail</h4><figure>',
           '<div class="diagram scroll" tabindex="0" role="region" aria-label="Scrollable money trail diagram">',
           trail_svg(trail, labels, f"finding-{number}"), '</div><p class="scroll-hint">Swipe to follow the money →</p>',
           '<figcaption>Transfer overview: repeated movements between the same parties are grouped. '
           'These are parallel transfer legs, not a claim that every arrow forms one continuous path. '
           'Invoice or purchase-order arrows document the obligation; only bank exhibits document a transfer.</figcaption></figure>',
           connected_paths_html(trail, number),
           '<h4>Exhibits</h4>',
           f'<details class="exhibits"><summary>{len(f["exhibits"])} cited records · evidence for this finding</summary><div class="detail-body">',
           '<div class="scroll" tabindex="0" role="region" aria-label="Cited evidence table"><table>',
           '<caption>Every exhibit resolves to a record in the estate. Exhibit identifiers are local to this finding.</caption>',
           '<thead><tr><th scope="col">Exhibit</th><th scope="col">Source table</th><th scope="col">Record id</th><th scope="col">What it supports</th></tr></thead><tbody>']
    for ex in f["exhibits"]:
        target = exhibit_anchor(number, ex["exhibit_id"])
        out.append(f'<tr id="{target}"><td><b>{escape(str(ex["exhibit_id"]))}</b></td>'
                   f'<td><code>{escape(str(ex["source_table"]))}</code></td><td><code>{escape(str(ex["record_id"]))}</code></td>'
                   f'<td>{escape(ex["note"])}</td></tr>')
    out.append('</tbody></table></div></div></details><h4>Reconciliation</h4>')
    rec, amount = f["reconciliation"], f["peso_amount"]
    items = rec["items"]
    total = sum(value for _, value in items)
    out.append(f'<div class="reconcile-total"><div><small>{len(items)} cited {escape(rec["table"])} record(s)</small>'
               f'<br><strong class="num">{mxn(total)}</strong></div><div><small>Claimed amount</small>'
               f'<br><strong class="num">{mxn(amount)}</strong></div></div>')
    out.append(f'<details{" open" if len(items) <= 8 else ""}><summary>Verify the arithmetic · {len(items)} terms and their running total</summary>'
               '<div class="detail-body"><div class="scroll" tabindex="0" role="region" aria-label="Arithmetic reconciliation">'
               '<table><caption>Each line adds one cited amount. The final running total is the sum shown above.</caption>'
               '<thead><tr><th scope="col">Record id</th><th scope="col">Add amount</th><th scope="col">Running total</th></tr></thead><tbody>')
    running = 0.0
    for key, value in items:
        running += value
        out.append(f'<tr><td><code>{escape(str(key))}</code></td><td class="num">+ {mxn(value)}</td>'
                   f'<td class="num">= {mxn(running)}</td></tr>')
    out.append(f'</tbody><tfoot><tr><th scope="row">Sum of cited amounts</th><td></td><td class="num">{mxn(total)}</td></tr></tfoot></table></div></div></details>')
    reconciled = f.get("reconciled_against")
    if reconciled:
        out.append('<p class="meta">Validated per table, within 2%. An invoice and its settlement are the same pesos viewed in two tables; they are not added together.</p>'
                   '<div class="scroll" tabindex="0" role="region" aria-label="Per-table reconciliation"><table><thead>'
                   '<tr><th scope="col">Cited table</th><th scope="col">Sum</th><th scope="col">Reconciliation basis</th></tr></thead><tbody>')
        for table, value in reconciled["per_table"].items():
            out.append(f'<tr><td><code>{escape(table)}</code></td><td class="num">{mxn(value)}</td>'
                       f'<td>{"Selected · within 2%" if table == reconciled["table"] else "Corroboration · not added to the claim"}</td></tr>')
        out.append('</tbody></table></div>')
    out.append('<h4>Evidence and adversarial review</h4><ul>')
    out.extend(f'<li>{escape(text)}</li>' for text in f["evidence"])
    out.append('</ul><div class="review-grid">')
    for defense in f["defense"]:
        actor = "Recorded LLM defence" if defense.get("by") == "llm" else "Adversarial reviewer"
        out.append(f'<div class="review-item"><h5>{actor} argued</h5><p>{escape(defense["argument"])}</p></div>'
                   f'<div class="review-item"><h5>Why the finding survived</h5><p>{escape(defense["why"])}</p></div>')
    out.append('</div></article>')
    return "".join(out)


def render_html(r: dict) -> str:
    md = r["run_metadata"]
    fs, leads = r["findings"], r["leads"]
    total = sum(f["peso_amount"] for f in fs)
    conf = {c: sum(f["confidence"] == c for f in fs) for c in ("proven", "probable")}
    p0, p1 = r["period"] if r.get("period") else (None, None)
    metadata = r.get("metadata") if isinstance(r.get("metadata"), dict) else {}
    company_name = r.get("company_name") or metadata.get("company_name")
    company_name = company_name.strip() if isinstance(company_name, str) else ""
    if company_name.casefold() == "nombre no suministrado":
        company_name = ""
    names = names_from_record(r)
    mode = md.get("llm_mode", "off")
    cost = mxn(md["mxn_cost"]) if isinstance(md.get("mxn_cost"), (int, float)) else "Unavailable"
    duration = f'{md["wall_clock_seconds"]:,.3f} s' if isinstance(md.get("wall_clock_seconds"), (int, float)) else "Unavailable"
    engine_determinism = "Deterministic rules; recorded review replays" if mode == "replay" else (
        "Deterministic rules and recorded inputs" if mode == "off" else "Fresh assisted review may differ")
    if md.get("deterministic") is not True:
        engine_determinism = "Not declared deterministic"
    h = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
         f"<title>Forensic case file — seed {r['seed']}</title><style>{CSS}</style></head><body>",
         '<a class="skip-link" href="#section-summary">Skip to executive summary</a><main>',
         '<p class="eyebrow">Forensic audit / Evidence-led case file</p><h1>Follow the evidence.</h1>',
         '<nav class="report-nav" aria-label="Report sections"><a href="#section-header">01 · Header</a>'
         '<a href="#section-summary">02 · Summary</a><a href="#section-findings">03 · Findings</a>'
         '<a href="#section-leads">04 · Closed leads</a><a href="#section-method">05 · Method & limits</a></nav>',
         '<section id="section-header" aria-label="Header"><h2>1. Header</h2><!-- whole-run-header -->',
         '<div class="identity">',
         f'<div><span class="meta">Audited company</span><b>{escape(company_name or "Name not supplied")}</b><span><code>{escape(r["company_rfc"])}</code></span></div>',
         f'<div><span class="meta">Audit period</span><b>{escape(str(p0 or "Not supplied"))}</b><span>to {escape(str(p1 or "Not supplied"))}</span></div>',
         f'<div><span class="meta">Estate seed</span><b>{r["seed"]}</b><span class="meta">As supplied to the engine</span></div></div>',
         '<div class="card engine-metrics"><p class="eyebrow">Rule engine · recorded execution</p>',
         '<div class="scroll" tabindex="0" role="region" aria-label="Rule-engine metrics"><table><thead><tr>'
         '<th scope="col">LLM calls</th><th scope="col">MXN cost</th><th scope="col">Wall-clock seconds</th><th scope="col">Deterministic</th><th scope="col">LLM mode</th></tr></thead><tbody>',
         f'<tr><td class="num">{md.get("llm_calls", "Unavailable")}</td><td>{cost}</td><td class="num">{duration}</td>'
         f'<td>{engine_determinism}</td><td>{escape(mode)}</td></tr></tbody></table></div>',
         '<p class="meta">These figures cover the rule engine only. They do not include a separate A/B or Codex investigation. '
         'A new execution measures a new duration; replaying saved inputs preserves the recorded duration.</p></div>',
         f'<p class="meta">Estate SHA-256 <code>{escape(r["estate_sha256"])}</code><br>Conclusion fingerprint <code>{escape(r.get("fingerprint", "Not recorded"))}</code></p></section>',
         '<section id="section-summary" aria-label="Executive summary"><h2>2. Executive summary</h2>']
    if fs:
        top = max(fs, key=lambda f: f["peso_amount"])
        h.append(f'<p class="narrative">The investigation retained <b>{len(fs)} finding(s)</b>: {conf["proven"]} proven and '
                 f'{conf["probable"]} probable under the engine rules. The sum of finding amounts is <b>{mxn(total)}</b>. '
                 f'The largest concerns {escape(top["subject_name"])}: {escape(SCHEME_LABEL[top["scheme_type"]].lower())}, '
                 f'{mxn(top["peso_amount"])}. Another {len(leads)} lead(s) were investigated and closed; each reason appears in section 4.</p>')
    else:
        h.append(f'<p class="narrative">No finding survived investigation and validation. {len(leads)} lead(s) were '
                 'investigated and closed. This result does not establish an absence of fraud; the scope and limitations appear in section 5.</p>')
    h.extend(['<div class="card"><table><caption>Result at a glance</caption><tbody>',
              f'<tr><th scope="row">Findings</th><td>{len(fs)} ({conf["proven"]} proven, {conf["probable"]} probable)</td></tr>',
              f'<tr><th scope="row">Total exposure — sum by finding</th><td class="num">{mxn(total)}</td></tr>',
              f'<tr><th scope="row">Leads investigated and closed</th><td>{len(leads)}</td></tr></tbody></table></div>',
              '<p class="notice">Amounts may overlap across findings involving the same operation; this sum is not a deduplicated loss estimate.</p>',
              summary_graphics(fs),
              '<ol class="workflow" aria-label="Rule-engine workflow"><li><b>Read the estate</b><small>Recorded, read-only data</small></li>',
              f'<li><b>Open signals</b><small>{r.get("detector_hits", "Recorded")} detector hits</small></li>',
              f'<li><b>Investigate & challenge</b><small>{r.get("leads_investigated", "Recorded")} checks</small></li>',
              f'<li><b>Validate the evidence</b><small>{len(fs)} findings · {len(leads)} closed leads</small></li></ol>'])
    if fs:
        h.append('<div class="scroll" tabindex="0" role="region" aria-label="Finding index"><table><thead><tr>'
                 '<th scope="col">Finding</th><th scope="col">Entity / scheme</th><th scope="col">Amount</th><th scope="col">Confidence</th></tr></thead><tbody>')
        for i, finding in enumerate(fs, 1):
            h.append(f'<tr><td><a href="#finding-{i}">{i:02d} · Read finding</a></td><td>{escape(finding["subject_name"])}'
                     f'<br><span class="meta">{SCHEME_LABEL[finding["scheme_type"]]} · {escape(", ".join(finding["entities"]))}</span></td>'
                     f'<td class="num">{mxn(finding["peso_amount"])}</td><td><span class="pill {finding["confidence"]}">{finding["confidence"]}</span></td></tr>')
        h.append('</tbody></table></div>')
    h.append('</section><section id="section-findings" aria-label="Findings"><h2>3. Findings</h2>')
    h.extend(render_finding(finding, number, names) for number, finding in enumerate(fs, 1))
    if not fs:
        h.append('<p>No validated finding is recorded.</p>')
    h.append('<!-- ai-review --></section><section id="section-leads" aria-label="Leads not pursued"><h2>4. Leads not pursued</h2>')
    h.append(f'<p>{len(leads)} lead(s) were investigated and closed without an accusation. A closed lead has been examined; '
             'a subject with no signal has not necessarily been investigated. Neither status is a certification of no fraud.</p>')
    for number, lead in enumerate(leads, 1):
        entity = lead["entity"]
        name = next((lead.get(key) for key in ("entity_name", "subject_name", "legal_name", "name")
                     if isinstance(lead.get(key), str) and lead[key].strip()), names.get(entity))
        h.append(f'<article class="lead" id="closed-lead-{number}"><span class="pill flag-false">Closed · fraud_flag: false</span>'
                 f'<h3>{escape(name or entity)}</h3><p class="meta">{escape(entity)}'
                 + ('' if name else ' · Name not supplied in the saved record')
                 + f' · Checked for {escape(SCHEME_LABEL[lead["investigated_as"]].lower())}</p>'
                 f'<dl><dt>Signal examined</dt><dd>{escape(lead["signal"])}<br>{escape(lead["signal_detail"])}</dd>'
                 f'<dt>Reason closed</dt><dd><b>{escape(lead["reason"])}</b></dd>'
                 f'<dt>Tools called</dt><dd>{escape(", ".join(lead["tool_calls_made"]))}</dd>'
                 f'<dt>Closed by</dt><dd>{CLOSED_LABEL[lead["closed_by"]]}</dd></dl></article>')
    if not leads:
        h.append('<p>No investigated lead was closed in this run.</p>')
    h.append('</section><section id="section-method" aria-label="Method and limits"><h2>5. Method and limits</h2>'
             '<h4>Architecture</h4><p>Deterministic SQL detectors open leads. Investigators gather evidence using logged, read-only '
             'tools, then test legitimate explanations such as contracts, purchase orders, receipts, refunds and shared-bank '
             'coincidences. Before publication, validation checks cited records, structured support for each entity and '
             'per-table amount reconciliation within 2%. Optional recorded LLM defence does not set the engine amounts or confidence.</p>')
    h.extend([structure_html(r), triage_html(r),
              '<div class="method-grid"><div><h4>Out of scope for this run</h4><ul>'
              '<li>Physical delivery, email and external documents.</li><li>CFDI XML signature verification against SAT.</li>'
              '<li>Beneficial ownership, payroll and periods outside this estate.</li></ul></div>'
              '<div><h4>What the rules may miss</h4><ul><li>Cash kickbacks or accounts absent from the bank records.</li>'
              '<li>Phantom suppliers supported by convincing forged documents.</li>'
              '<li>Splitting across vendors or outside the configured 21-day window.</li>'
              '<li>Longer or weaker money cycles beyond the configured hop, date and retention thresholds; ambiguous overlapping cycles.</li>'
              '<li>Unknown business policies or conventions that cannot be established from the recorded data.</li></ul></div></div>',
              '<p class="meta">Time windows, inferred approval limits, account ownership and amount matching are explicit implementation assumptions, '
              'not universal proof of fraud. Confidence labels describe the engine evidence standard.</p>',
              '<h4>Reproducibility</h4><p><code>PYTHONPATH=src python3 -m auditor run --estate &lt;estate.db&gt; --seed N --out &lt;dir&gt;</code> '
              'starts a new execution. With <code>--llm off</code>, no model or network call is needed. Replaying a recorded LLM cassette '
              'also requires no network. New executions record their own elapsed time.</p>'
              '<p><code>python3 -m auditor render --run-log &lt;run_log.json&gt;</code> rebuilds the saved case file offline using the same renderer version. '
              'The same estate, configuration and recorded inputs preserve conclusions. Repeating into the same output folder preserves the original '
              'reported duration and appends actual timing to <code>executions.jsonl</code>; fresh output folders may have different duration bytes.</p>',
              '<p class="meta">The full subject split remains in triage.json, branch_fraud.json and branch_no_fraud.json. '
              'The submission contains a representative connected path plus all original paths; exhibits retain the complete reconciliation basis.</p>',
              '<!-- whole-run-appendix --></section><footer class="footer">Prepared from recorded evidence. '
              'This report is self-contained and needs no network connection to read. <a href="#section-header">Back to header ↑</a></footer></main>',
              '</body></html>'])
    return "".join(h)
