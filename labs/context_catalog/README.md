# Curated industry context

The context tool can reuse **12 industry profiles, 60 sector-specific case references and
58 distinct primary-source URLs**, researched on September 13, 2026. Two cases apply to
more than one industry. These are selected documented cases, not a claim to contain the
five latest fraud cases worldwide.

`operations.json` covers construction, real estate, manufacturing, transportation/logistics,
energy and professional services. `services.json` covers healthcare, pharmaceuticals/life
sciences, financial services/investment, technology/SaaS, retail/e-commerce and charities.
The catalog resolves 141 normalized English/Spanish names. Unknown or ambiguous names
are not assigned to a similar-sounding industry.

Each profile contains normal operations and five mechanisms. A mechanism records the
control gap, actions, concealment, observable signals, a legitimate alternative and a
check that could disprove the suspicion. Signals and investigative checks are analyst
inferences. The linked source documents the external case; it is never evidence against
an entity in an uploaded estate.

Every source records its publication date, event date when available, jurisdiction,
legal status as announced, inspection time and verification method. Settlements and
indictments are distinguished from guilty pleas and convictions. US enforcement sources
predominate; UK and Australian sources add other jurisdictions. Local legal applicability
must be assessed separately.

Fresh runtime research takes precedence, followed by this bundled reference. A fresh
catalog lookup makes **zero provider calls and zero network checks**. After 30 days, the
tool attempts a live refresh when available; a stale fallback stays explicitly dated.
Only the requested profile enters the prompt, with capped fields and lists. Current
compact profiles are approximately 6.3–7.1 thousand characters; this is a character
measurement, not a tokenizer count or an empirical savings estimate.

To refresh a profile, open primary announcements, preserve procedural status and dates,
replace all five linked mechanisms and sources coherently, and advance `researched_at`
only after completing that review. Do not advance the date simply to bypass expiry.

Run `python3 -m unittest labs.tests.test_context_catalog` to check production profile
shape, source membership, alias uniqueness and bounded prompt payloads. The fixture
tests also verify offline reuse, expiry, unknown sectors and fresh runtime precedence.
