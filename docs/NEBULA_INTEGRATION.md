# Verified Nebula integration

This contract was retrieved from the live Nebula guide on 2026-08-15:
`https://nebula-free-llm.nebula-ai-company.workers.dev/nebula-api-guide.md`.

## Connection contract

- Base URL: `https://nebula-free-llm.nebula-ai-company.workers.dev/v1`
- Chat endpoint: `POST /chat/completions`
- Model catalog: `GET /models`
- Authentication: `Authorization: Bearer <NEBULA_API_KEY>`
- Transport: HTTPS only
- API key: Worker secret `NEBULA_API_KEY`; never expose it to a browser or log it.

The resulting chat URL is:
`https://nebula-free-llm.nebula-ai-company.workers.dev/v1/chat/completions`.

## Request and response

The Phase 03 adapter sends a non-streaming OpenAI-compatible chat request:

```json
{
  "model": "<exact-model-id-or-auto>",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "temperature": 0.2,
  "max_tokens": 512,
  "stream": false
}
```

The guide documents a response containing `model`, `choices[0].message.content`,
`choices[0].finish_reason`, and optional `usage` fields
(`prompt_tokens`, `completion_tokens`, `total_tokens`). The adapter also records
the routed provider header when present, without persisting raw response headers.

The model must be `auto` or an exact ID returned by `/v1/models`. The current
catalog was queried during Phase 03 setup. Normal agents use
`@cf/meta/llama-3.1-8b-instruct-fast` because it is an explicitly catalogued
small, fast model with a large documented context window. Provider-native tools
are intentionally not required by LUMA; structured action JSON is validated by
the application.

## Structured output

The guide documents standard chat completions and does not guarantee strict JSON
mode for every routed model. LUMA therefore sends a strict text instruction and
validates the returned JSON locally. There is at most one repair request. No
hidden chain-of-thought is requested or stored; only the short `reason_summary`
field from the validated action is retained.

## Limits and retry decisions

The gateway documents these statuses: `400` malformed request, `401` invalid
authentication, `413` body over 2 MB, `422` no eligible model, `429` rate limit,
and `502` provider timeout/upstream failure. It may try up to six upstream
candidates with a 30-second per-attempt timeout and a 90-second overall retry
budget.

LUMA uses a shorter per-call timeout suitable for a bounded Worker turn and
bounded application retries. It retries only normalized transient, rate-limit,
or timeout failures; authentication, validation, unsupported-model, and other
terminal 4xx failures are not retried. The retry-after value is retained when
Nebula supplies one. Queue jobs remain coarse and capped by the runtime
guardrails.

## Deliberate non-assumptions

- Provider-native tool calling is not required for normal agents.
- Streaming is not used by Phase 03.
- The adapter does not assume a fixed model catalog beyond the exact configured
  ID or `auto`.
- Raw provider responses, request headers, and credentials are not persisted.
- Multimodal input, embeddings, Responses API behavior, and GOD execution are
  deferred to later phases.
