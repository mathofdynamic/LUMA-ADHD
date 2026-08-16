# LUMA ADHD Admin Observatory

The Admin Observatory is the private operator interface at `/admin`. It reads real D1-backed organization state and does not fabricate activity for empty views.

## Routes

- `/admin/login` — operator access-key login.
- `/admin` — Strategy Room, the default landing page.
- `/admin/agents` — normal Agent roster and the separate GOD identity.
- `/admin/threads` — bounded thread list, lifecycle, canonical messages, and operator actions.
- `/admin/files` — logical Markdown workspaces and official LUMA knowledge sources.
- `/admin/human-tasks` — pending and resolved requests for human input.
- `/admin/reputation` — domain-specific dimensions, evidence, and Rank history.
- `/admin/god` — supervisory reviews, directives, and bounded manual-review enqueueing.
- `/admin/system` — jobs, scheduler state, providers, Telegram telemetry, knowledge sync, errors, and audit.
- `/admin/settings` — safe typed runtime overrides within hard-coded guardrails.

## Authentication and sessions

`ADMIN_AUTH_SECRET` is a high-entropy operator access key stored as a Worker secret. It is never returned to the browser or stored in the repository.

Successful login creates a random 12-hour session. D1 stores only the SHA-256 hash of the session token and a hash of the session-bound CSRF token. The raw session token is sent only in an HttpOnly, Secure (production), SameSite=Strict cookie. The cookie is scoped to `/` so it can authenticate both the `/admin` application and `/api/admin/*`.

Every authenticated mutation requires the session-bound `X-CSRF-Token` header. Logout revokes the session. Rotating `ADMIN_AUTH_SECRET` invalidates all sessions because each session stores only a fingerprint of the secret version.

Failed login attempts are tracked by a hash of the request identity. Five failures in the bounded window create a temporary per-identity cooldown; this does not create a global lockout.

## Operator actions

Agent configuration edits, pause/resume, thread transitions, bounded continuation, document mutations, knowledge refresh enqueueing, human-task resolution, GOD directive changes, GOD review enqueueing, and settings changes go through application services and are recorded in `audit_log`. Document deletion is soft deletion and preserves revisions.

The manual GOD action only enqueues one coarse `god.review` job. It does not execute a model call inside the HTTP request.

## Settings

Settings are typed D1 overrides. They include burst/deep-work bounds, scheduler budget, knowledge/GOD cadence, RAG acquisition steps, context budget, and recent-message count. Server-side validation enforces the minimum and maximum for every setting; code-level safety ceilings remain authoritative.

The page displays provider and credential status only. It never displays API keys, Telegram tokens, webhook secrets, session tokens, or CSRF tokens.

## Deployment and recovery

Apply migration `0007_admin_observatory.sql`, install `ADMIN_AUTH_SECRET` with Wrangler secret storage, and deploy the Worker. Telegram group, administrator, and bot-identity values are intentionally not committed to `wrangler.jsonc`; preserve the live values with the existing operator bootstrap/deployment tooling rather than deploying empty placeholders. If the admin secret is rotated, all existing sessions expire on their next authenticated request. The operator can log in again with the new key; no D1 session cleanup is required for correctness.

The Admin Observatory uses Workers, D1, Queue, Cron, and Worker Static Assets only. It does not require KV, R2, Durable Objects, Workflows, Redis, PostgreSQL, or an external authentication service.
