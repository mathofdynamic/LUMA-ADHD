# OpenAI GOD integration

This document records the OpenAI Responses provider contract. It contains no credentials.

## Runtime configuration

- `GOD_PROVIDER=openai`
- `GOD_BASE_URL=https://api.openai.com/v1`
- `GOD_MODEL=gpt-5.6-luna`
- `GOD_REASONING_EFFORT=xhigh`
- `OPENAI_API_KEY` is the preferred shared Worker secret. `GOD_API_KEY` remains a compatibility fallback during migration.

The exact model was verified against the authenticated OpenAI `GET /v1/models` catalog during operator setup. Model availability is account-scoped; the application keeps the configured identifier and does not silently substitute another model.

## Wire contract

The adapter sends `POST /responses` to the configured base URL with a Bearer authorization header. It uses:

- top-level `instructions` for the supervisory system prompt;
- `input` message items for the bounded briefing;
  - `reasoning: { effort: "xhigh" }`;
- `max_output_tokens` bounded by the GOD guardrail;
- `store: false` so OpenAI state is not used as LUMA persistence;
- `text.format` with strict `json_schema` output for the GOD review contract.

The raw REST response is parsed from `output` message items and `output_text` content parts. The adapter records the provider response ID or `x-request-id`, input/output/total usage when present, status, latency, and a bounded finish reason. It never stores raw provider payloads or authorization headers.

Authentication failures, unsupported requests/models, rate limits, timeouts, and transient 5xx failures are normalized. Only bounded retries are used. `Retry-After` is retained when supplied; permanent 4xx failures are not retried.

OpenAI Structured Outputs supports the JSON Schema subset used by `GOD_REVIEW_JSON_SCHEMA`. The application still validates the parsed output and allows only the existing single repair attempt; no hidden reasoning is persisted.

Normal Agents use the same transport with `NORMAL_AGENT_PROVIDER=openai`, `NORMAL_AGENT_MODEL=gpt-5.6-luna`, and `NORMAL_AGENT_REASONING_EFFORT=medium`. Their application `AgentStep` contract remains separate from the GOD review schema. Nebula remains a selectable provider fallback and is not deleted.
