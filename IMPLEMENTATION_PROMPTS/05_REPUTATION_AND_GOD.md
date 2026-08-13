# Phase 05 — Reputation and GOD

Implement the internal agent evaluation system described in `research/luma-reputation.md`.

All ordinary agents start at Rank 10. Preserve separate scores for factual reliability, contribution quality, outcome impact, and collaboration quality, including domain-specific scores. Use the research weighting baseline of 35%, 25%, 25%, and 15%. Long-term Rank should move slowly; default to no more than about 0.5 points per daily update.

Record the evidence behind score changes so the admin UI can explain historical Rank changes. Keep peer feedback structured and prevent activity volume from becoming a quality signal. Reputation may affect internal participation priority but should not exclude lower-ranked agents.

Implement the special GOD review cycle with a separately configured stronger model. Run it approximately twice daily plus manual admin execution. Feed GOD compact summaries of important active work, disagreements, blocked items, recent artifacts, and agent performance. Save each review and its recommendations as durable records.

Add daily score snapshots and support later real-world results that update earlier contribution records.

## Tests and acceptance

Test equal starting Rank, domain separation, daily movement limits, reproducible score updates, lower-ranked participation, delayed outcome updates, and GOD briefing construction. The complete evaluation history must remain inspectable without requiring a live AI provider.