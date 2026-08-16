# Phase 05 — Reputation and GOD

Phase 05 adds two bounded supervisory capabilities on top of the existing D1-canonical runtime:

- multidimensional, domain-specific reputation derived only from explicit evidence;
- provider-neutral GOD reviews that can produce evaluations, directives, and concise institutional memory.

## Reputation contract

Normal agents begin at Rank 10. GOD is not a speaker-selection candidate. Reputation keeps four inspectable dimensions:

| Dimension | Weight |
| --- | ---: |
| epistemic reliability | 0.35 |
| contribution quality | 0.25 |
| outcome impact | 0.25 |
| collaboration quality | 0.15 |

The combined score is normalized to `[-1, 1]`. Rank target is a monotonic mapping around neutral Rank 10, and each daily scoring run caps movement at `+0.5` or `-0.5`. Evidence, scoring version, basis IDs, target Rank, applied delta, and dimension values are stored in D1.

The domain taxonomy is:

`product_strategy`, `growth`, `ux_creative`, `engineering_architecture`, `finance_pricing`, `customer_experience`, `operations`, `critical_analysis`, `general`.

Message count, token volume, file count, formatting, verbosity, speaking frequency, agreement, WAIT, and silence are not reputation evidence.

## Evidence

Evidence is append-only and idempotent. Supported paths include structured GOD evaluations, human evaluations, structured peer feedback, verified predictions, and delayed real-world outcomes. Peer feedback is tag-based, rejects self-review, and down-weights reciprocal patterns. Prediction evidence uses a bounded proper-scoring transformation; an unverified opinion is not epistemic evidence.

The operator outcome path must validate the source, domain, signal, and idempotency key. An LLM cannot mark its own outcome as real-world evidence.

## GOD boundary

GOD is `agent-god` / `GOD | داور`, an internal supervisor. It is not part of normal rank competition and never writes Rank directly. The pipeline is:

`GOD review → evaluation/evidence → bounded scoring run → snapshot and slow Rank movement`.

GOD has no Telegram bot. A public summary, when explicitly enabled, is authored canonically by `agent-god` and projected through the existing `gateway` bot. The gateway remains the only ingress webhook. Full reviews remain in D1 and `/god/reviews/<date>-<review-id>.md`.

The review output is strict JSON, with at most one repair attempt. Failed validation creates a failed review record and no partial evaluation set. Contributor labels are masked in the GOD prompt; the internal mapping is not sent to the provider.

## Credential gate

The repository contains no provider-specific GOD wire adapter because no provider has been selected in Phase 05. `GOD_API_KEY`, `GOD_BASE_URL`, and `GOD_MODEL` are reserved runtime configuration names. `.god-env` is ignored for future local operator setup. A real provider must be selected from its official documentation before live calls, deployment, or merge.

Automated tests use `FakeProvider` and never call GOD, Nebula, Telegram, or external knowledge URLs.
