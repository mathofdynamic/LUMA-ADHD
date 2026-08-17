# LUMA ADHD v1 operations runbook

## First response

Open Admin Observatory → Strategy Room → System. Check attention items, failed jobs, provider state, Telegram delivery, Human Tasks, knowledge sync, GOD, and recent audit entries. Preserve canonical D1 state; do not delete rows as a first response.

## Emergency pause

To reduce autonomous activity without losing inbound work:

1. Pause the affected Agent in Admin.
2. Lower `scheduler_work_per_tick` and ambient safety settings within their validated ranges.
3. Defer nonessential deep work and knowledge refreshes.
4. If needed, disable GOD scheduling through the existing safe configuration path.
5. Keep the gateway webhook and human-interactive work available unless the incident is Telegram-specific.

## Provider failures

Nebula and OpenAI/GOD are separate roles. A timeout/rate limit is retryable and appears in Jobs/Providers; an authentication, configuration, unsupported-model, or malformed-output failure is not silently retried indefinitely. Verify endpoint/model/secret configuration, rotate only through Wrangler, then run the relevant bounded smoke. A failed structured response is a safe failed turn/review, not permission to bypass validation.

## Telegram failures

Check Worker health, Admin System outbound state, the configured gateway webhook, pending updates, and Telegram `getWebhookInfo` through the operator tool. Confirm the private group ID and secret header. Persona bots remain outbound-only. Do not drop pending updates or reinstall the webhook as a first response. Inspect `telegram_outbound` state before retrying an ambiguous send.

## D1 and migrations

If a migration fails, stop and inspect Wrangler output and the remote migration list. Do not edit an applied migration or run destructive SQL as a first response. Query failures should be bounded and visible as an Admin/System error. D1 remains the canonical state; Telegram and provider outputs can be replayed only through idempotent application services.

## Queue and stale leases

Admin System shows pending, claimed/running, retry-scheduled, completed, and failed work. Retry only an allowlisted recoverable job. Recover only an objectively expired lease; an active lease is refused. Recovery keeps the original idempotency key and is audited. Queue units are coarse: interactive/ambient/deep-work bursts, Human Task wakes, GOD reviews, knowledge sync, reputation runs, diagram rendering, and Telegram delivery.

## Human Tasks

If a task is stuck, verify its durable Telegram outbound mapping and response source. A direct reply resolves only the mapped task. Admin response uses the same service. If a wake job fails, inspect the related thread and retry the allowlisted wake job after confirming no continuation already completed. Multiple open blocking tasks keep the thread waiting.

## Knowledge and RAG

One unavailable official source must preserve its last known good normalized content/chunks. Inspect source status, last success, hash, and bounded sync jobs. An unchanged fetch should not create new chunks. If FTS looks stale, refresh the source through the application service and inspect provenance before changing prompts.

## GOD and reputation

Scheduled GOD work is approximately every 12 hours and is subject to the internal daily safety budget. A failed review, zero evaluations, or no directives can be valid. Do not fabricate evidence to move Rank. GOD output flows through evaluations/reputation events and bounded scoring; it never writes Rank directly. Inspect the review, directives, evidence, and provider usage together.

## Diagrams

Source-only diagrams are valid production artifacts. Browser Rendering is optional and currently unconfigured; renderer unavailability is not a system emergency. Inspect the DiagramSpec, sanitized source, revision history, render state, and Telegram delivery state. Retry only when the failure is eligible and bounded. There is no R2 dependency.

## Internal pressure warnings

Admin warnings labelled **LUMA INTERNAL SAFETY BUDGETS** are application-observed safeguards, not exact Cloudflare billing or quota percentages. If pressure rises, lower ambient cadence/work per tick, delay nonessential knowledge sync, defer deep work, and keep human-interactive work prioritized. Do not delete canonical memory to reduce pressure.

## Backups and restore

Use the current authenticated Wrangler D1 export tooling before risky changes and keep the export outside Git. Treat exports as sensitive organizational data. Never restore an old export directly over live D1 without a reviewed loss/merge plan; it may erase canonical messages, documents, reviews, reputation evidence, tasks, jobs, and audit records.

## Provider replacement

Replace a normal or GOD provider behind the existing provider interface. Verify the adapter contract, exact model identifier, authentication, structured output, timeout/retry classification, usage/request IDs, and one fake-provider plus one controlled operator smoke. Orchestration, evidence, and Telegram transport must not become provider-specific.

## Disaster-recovery hierarchy

`D1 canonical state` → `application projections/recovery` → `Telegram/provider/rendering projections`.

Telegram messages, provider responses, and diagram images are not the source of truth. Rebuild projections from D1 through bounded idempotent services.
