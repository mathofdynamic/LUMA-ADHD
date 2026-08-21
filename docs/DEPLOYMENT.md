# LUMA ADHD v1 deployment

This runbook deploys the tracked Worker from a clean checkout. It does not contain secret values.

## Prerequisites

Required:

- Node/npm compatible with the committed lockfile;
- a Cloudflare account authenticated with Wrangler;
- the D1 database and Queue resources configured by `wrangler.jsonc`;
- the private Telegram group, gateway bot, and eight outbound persona bots;
- OpenAI access for normal Agents and GOD;
- Nebula access only when deliberately selecting the retained fallback;
- an operator-owned `ADMIN_AUTH_SECRET`.

Optional:

- Cloudflare Browser Rendering/Browser Run for diagram images. Phase 08 does not require it; source-only diagrams are the supported fallback.

Verify the repository commands before deployment:

```powershell
npm ci
npm run verify
npx wrangler whoami
```

## Cloudflare resources

The current tracked configuration is the source of truth:

- Worker: `luma-adhd`
- D1: `luma-adhd`
- Queue: `luma-adhd-agent-jobs`
- Static Admin assets: `admin/dist`
- Cron: one `* * * * *` metronome; a tick is not an AI call by itself.

Do not replace safe identifiers in `wrangler.jsonc` with stale examples.

## Migrations

Apply migrations in order from a clean checkout. Never edit a migration that has already been applied remotely.

```powershell
npx wrangler d1 migrations apply luma-adhd --remote
npx wrangler d1 migrations list luma-adhd --remote
```

Phase 08 adds migration `0009_hardening_deployment.sql`. It creates only the indexed job-type/creation-time lookup used by the bounded internal daily safety budgets. Do not edit migrations 0000–0009 after they are applied. The Luna migration adds no database migration.

## Production secrets

Install each value through secure Wrangler input or the platform secret workflow. Do not put values in `wrangler.jsonc`, Git, command arguments, or logs.

```text
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_GATEWAY_BOT_TOKEN
TELEGRAM_PRODUCT_BOT_TOKEN
TELEGRAM_GROWTH_BOT_TOKEN
TELEGRAM_CREATIVE_BOT_TOKEN
TELEGRAM_TECH_BOT_TOKEN
TELEGRAM_FINANCE_BOT_TOKEN
TELEGRAM_CUSTOMER_BOT_TOKEN
TELEGRAM_OPERATIONS_BOT_TOKEN
TELEGRAM_HERETIC_BOT_TOKEN
NEBULA_API_KEY
OPENAI_API_KEY
GOD_API_KEY
ADMIN_AUTH_SECRET
```

There is deliberately no `TELEGRAM_GOD_BOT_TOKEN`. GOD is `agent-god` internally and uses the gateway transport for public summaries.

Example safe interactive installation:

```powershell
npx wrangler secret put ADMIN_AUTH_SECRET
```

Repeat for the remaining required names. Verify only secret names/configured status through the authenticated Admin Observatory; never print values.

## Non-secret configuration

The deployment contract includes:

```text
TELEGRAM_GROUP_ID
TELEGRAM_ADMIN_USER_IDS
TELEGRAM_BOT_IDENTITIES_JSON
NEBULA_BASE_URL
NEBULA_MODEL
NORMAL_AGENT_PROVIDER=openai
NORMAL_AGENT_BASE_URL=https://api.openai.com/v1
NORMAL_AGENT_MODEL=gpt-5.6-luna
NORMAL_AGENT_REASONING_EFFORT=medium
GOD_PROVIDER=openai
GOD_BASE_URL=https://api.openai.com/v1
GOD_MODEL=gpt-5.6-luna
GOD_REASONING_EFFORT=xhigh
LUMA_ENVIRONMENT
LUMA_PHASE
```

Telegram identity metadata contains bot IDs/usernames only. The gateway is the only webhook; persona webhook count must remain zero.

## Telegram activation

1. Create the gateway and eight persona bots.
2. Add them to the private group with the permissions required by the current application.
3. Verify each bot with `getMe` and verify the group/admin IDs using the local operator bootstrap helper.
4. Configure only `/telegram/webhook/gateway` with the webhook secret.
5. Do not install persona webhooks and do not depend on bot-to-bot delivery.

The gateway-only topology is preserved across normal Worker deploys. Do not reinstall webhooks unless a deliberate topology check proves it is necessary.

## Initial knowledge

The application owns the 12-source official LUMA allowlist and bounded sync jobs. Use the authenticated Admin Knowledge action or the existing operator sync tooling. Do not inject source/chunk rows manually with SQL. Verify 12 configured sources, cached normalized content/chunks, and that an unchanged resync does not rewrite chunks.

## Admin access

Install `ADMIN_AUTH_SECRET`, then open `/admin/login`. The operator access key creates a 12-hour default server-side D1 session. Logout revokes it. Rotating the secret invalidates older sessions through the stored secret fingerprint.

Keep the operator copy outside the repository, such as `$HOME/.luma-adhd/admin.env`, with restrictive permissions where supported. Never put it in `.dev.vars` for production.

## Deploy and verify

```powershell
npm run types
npm run build
npx wrangler deploy --keep-vars
```

Install `OPENAI_API_KEY` through secure Wrangler secret input before deploying the Luna configuration. Keep the existing `GOD_API_KEY` until the shared-key production smoke succeeds; the Worker prefers `OPENAI_API_KEY` and falls back to `GOD_API_KEY` for compatibility. The operator-only `GPT_API_KEY` environment name is never installed in the Worker.

Post-deploy smoke, in order:

1. `GET /api/health` and `GET /api/version`.
2. Confirm remote migration list has no pending migrations.
3. Log in to `/admin/login` and load Strategy Room.
4. Verify gateway webhook health, persona webhook count 0, and no GOD webhook.
5. Confirm Admin Providers shows normal Agents as OpenAI `gpt-5.6-luna` / `medium`, GOD as OpenAI `gpt-5.6-luna` / `xhigh`, and Nebula as configured fallback/inactive where applicable.
6. Inspect one existing normal Agent result and official-LUMA RAG provenance.
7. Inspect existing Human Tasks, files, reputation, GOD, knowledge, Jobs, and System state.
8. Confirm source-only diagram artifacts remain inspectable.

Live provider/GOD/Telegram calls are expensive and are not part of `npm run verify`. Use `npm run openai:luna:smoke` for a non-persistent normal/GOD Responses contract smoke. When remote-D1 runtime telemetry must be verified without Telegram projection, run `powershell -File .\scripts\openai-luna-runtime-smoke.ps1`; it creates and deletes a temporary operator-only Worker. Do not run a full GOD review solely to verify configuration.

## Backup caution

Before risky changes, use the current Wrangler D1 export command after confirming the installed Wrangler version and authenticated account:

```powershell
npx wrangler d1 export luma-adhd --remote --output .\operator-backups\luma-adhd-<timestamp>.sql
```

Keep exports outside Git and protect them as sensitive organizational data. Never casually overwrite production with an old export; first establish which canonical messages, jobs, documents, reviews, and settings would be lost.

## Platform references verified 2026-08-17

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Browser Rendering pricing](https://developers.cloudflare.com/changelog/post/2025-07-28-br-pricing/)
