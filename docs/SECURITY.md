# LUMA ADHD security model

This document describes the v1 trust boundaries and the controls exercised by the Worker. It contains no credentials.

## Trust boundaries

- D1 is the canonical application state. Telegram messages, provider responses, and diagram media are projections or transient inputs.
- The gateway Telegram bot is the only inbound Telegram webhook. Persona bots are outbound-only. GOD has no Telegram bot.
- Normal Agents can use bounded application services for RAG and logical documents. They cannot issue SQL, access the Worker filesystem, or supply arbitrary fetch URLs.
- Admin APIs require a valid D1-backed session and mutations additionally require the session-bound `X-CSRF-Token`.
- Provider credentials exist only as Worker secrets and are never returned by health, version, or Admin configuration endpoints.

## External route policy

| Route | Policy |
| --- | --- |
| `/api/health` | Public liveness/readiness response; no data access. |
| `/api/version` | Public non-secret build/phase metadata. |
| `/telegram/webhook/gateway` | POST only, exact configured alias, secret header checked before body processing, configured private group enforced by the Telegram application. |
| `/telegram/webhook/<other-alias>` | Not configured in production; persona bots have no webhook. |
| `/api/admin/auth/login` | Public login endpoint with bounded body size and privacy-preserving D1 failed-login buckets. |
| `/api/admin/*` | Admin session required; state-changing methods also require CSRF. |
| `/admin/*` and static assets | First-party static Admin Observatory assets with CSP, `X-Frame-Options`, no-store, and no external scripts/fonts. |
| operator smoke scripts | Local-only tooling; no deployed smoke/debug route. |

Unknown API and webhook paths return bounded errors. No public arbitrary SQL, filesystem, rendering, or provider proxy route exists.

## Telegram controls

- `X-Telegram-Bot-Api-Secret-Token` is compared in constant time.
- The body is not read until the secret and request size checks pass.
- Updates are normalized and idempotent in D1.
- The configured workspace chat and authorized human IDs are checked before privileged actions.
- Reply routing uses durable outbound/canonical mappings, not visible-text matching.
- `agent-god` remains the canonical author of GOD messages while `gateway` is the transport identity.
- Telegram retry state is bounded and canonical messages are created before projection.

## Admin authentication

`ADMIN_AUTH_SECRET` is an operator access key. Login creates a cryptographically random session token and CSRF token; only SHA-256 hashes are stored in D1. The session token is an HttpOnly, Secure, SameSite=Strict cookie in production, expires by configuration within a hard 1–24 hour range, and is invalidated when the secret fingerprint changes. Failed logins use a short, hashed identity bucket with a bounded cooldown.

The access key, session token, and CSRF token are never logged, returned as configuration, stored in frontend storage, or placed in a URL.

## RAG, files, and knowledge

- Logical paths are canonical absolute database paths; traversal and malformed paths are rejected.
- Retrieval applies Agent scope, shared-file scope, explicit shares, thread context, and official-source authority.
- Deleted/private documents are excluded from ordinary retrieval.
- Official knowledge synchronization accepts only the exact allowlisted LUMA URLs. Agents and model output cannot choose a sync URL.
- Search queries are sanitized before FTS execution.
- Memory notes contain concise durable facts, not hidden reasoning or chain-of-thought.

## Diagrams

DiagramSpec is validated before rendering. The renderer emits a controlled HTML/CSS template with escaped text. Scripts, event handlers, SVG execution, iframes, external CSS/fonts/images, network URLs, and arbitrary HTML are not accepted. Source remains canonical in D1; image bytes are never stored in D1 and R2 is not used.

Browser Rendering is optional and currently unconfigured. Core diagrams remain valid source-only artifacts.

## Human Tasks and recovery

Human-task replies resolve only the task identified through the Telegram reply-to outbound mapping and the related canonical message. Wake jobs use task-scoped idempotency keys. Admin responses use the same resolution service as Telegram responses.

Job retries are allowlisted by type, do not permit payload editing, and preserve idempotency keys. Stale leases can be recovered only after expiry. Every privileged recovery or mutation is written to the audit log.

## Outbound HTTP allowlist

Application fetches are limited to:

- Telegram Bot API for configured bot aliases;
- the configured Nebula endpoint;
- the configured OpenAI endpoint;
- the exact 12 official LUMA knowledge URLs.

No user/model-provided URL is followed by knowledge sync or diagram rendering. Redirects for official knowledge are handled conservatively and unexpected response URLs fail closed.

## Logging and known limitations

Persisted errors are normalized and bounded. They do not contain authorization headers, API keys, bot tokens, webhook secrets, session/CSRF tokens, or hidden reasoning. Full private document bodies are not written to operational telemetry.

There is an unavoidable external-send ambiguity if a Worker terminates after Telegram accepts a request but before the returned message ID is persisted. The D1 outbound state remains the recovery authority; automatic retries are bounded, and operators must inspect outbound state before forcing recovery. Telegram itself provides no application idempotency key for `sendMessage`.

Rotate production secrets through Wrangler, then verify health and a controlled authenticated smoke. Rotating `ADMIN_AUTH_SECRET` invalidates all existing Admin sessions.
