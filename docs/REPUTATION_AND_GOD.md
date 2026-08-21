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

## OpenAI provider

The provider-neutral GOD service uses the verified OpenAI Responses adapter. Runtime configuration is `GOD_PROVIDER=openai`, `GOD_BASE_URL=https://api.openai.com/v1`, `GOD_MODEL=gpt-5.6-luna`, and `GOD_REASONING_EFFORT=xhigh`; the preferred shared credential is `OPENAI_API_KEY`, with `GOD_API_KEY` retained as a compatibility fallback during migration. Responses use `store=false`, strict JSON Schema output, bounded retries, and status/usage/request-ID normalization. The application never reads the operator-only `GPT_API_KEY` name. Normal Agents use OpenAI Luna with `medium` effort; Nebula remains a supported fallback but is inactive in production.

Automated tests use `FakeProvider` and never call GOD, Nebula, Telegram, or external knowledge URLs.
