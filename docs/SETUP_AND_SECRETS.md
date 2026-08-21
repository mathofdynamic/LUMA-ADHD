# LUMA ADHD setup and secrets

Phase 08 is the final v1 hardening layer over the provider-neutral runtime, memory/RAG, Human Tasks, diagrams, reputation, GOD, and Admin Observatory. The current post-v1 provider contract uses OpenAI Luna for normal Agents and GOD. The application and automated tests run locally with empty values, fake providers/transports, and local Wrangler bindings. Live activation is never performed by ordinary tests or deployments.

## Configuration categories

### Safe identifiers and ordinary configuration

These values identify a resource or select behavior. They are not authentication credentials, although Telegram IDs and account IDs should still be handled as operational data:

- `LUMA_ENVIRONMENT` and `LUMA_PHASE` - runtime labels.
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account identifier used by manual tooling when needed.
- `TELEGRAM_GROUP_ID` - the configured private workspace chat identifier.
- `TELEGRAM_ADMIN_USER_IDS` - comma-separated Telegram user identifiers allowed to perform privileged actions.
- `TELEGRAM_BOT_IDENTITIES_JSON` - safe JSON metadata for deterministic bot-to-agent mapping. Store Telegram bot IDs and usernames here, never tokens. Empty `{}` is valid.
- `NORMAL_AGENT_PROVIDER`, `NORMAL_AGENT_BASE_URL`, `NORMAL_AGENT_MODEL`, and `NORMAL_AGENT_REASONING_EFFORT` - the normal-Agent provider contract. Production uses OpenAI `gpt-5.6-luna` with `medium` effort.
- `NEBULA_BASE_URL` and `NEBULA_MODEL` - the retained Nebula fallback endpoint and model identifier. Nebula remains implemented and selectable, but is inactive in the current production configuration.
- `GOD_PROVIDER`, `GOD_BASE_URL`, `GOD_MODEL`, and `GOD_REASONING_EFFORT` - the supervisory provider contract and reasoning policy. Production uses OpenAI `gpt-5.6-luna` with `xhigh` effort.
- `database_name`, `queue`, and Worker `name` in `wrangler.jsonc` - safe Cloudflare resource names.
- `database_id` in `wrangler.jsonc` - a safe D1 resource identifier populated after the real database is created.

The Telegram identity map contains only `gateway`, `product`, `growth`, `creative`, `technical`, `finance`, `customer`, `operations`, and `heretic`. `agent-god` is an internal supervisory identity and has no Telegram bot. GOD announcements use the existing `gateway` transport while canonical authorship remains `agent-god`.

### Secrets

These values authenticate the application and must never be committed, placed in `wrangler.jsonc`, or printed in logs:

- `TELEGRAM_WEBHOOK_SECRET`.
- `TELEGRAM_*_BOT_TOKEN` for the gateway and normal persona bots only. There is no `TELEGRAM_GOD_BOT_TOKEN`.
- `NEBULA_API_KEY`.
- `OPENAI_API_KEY` - the canonical shared OpenAI credential for normal Agents and GOD.
- `GOD_API_KEY` - retained as a backward-compatible GOD credential during the migration; do not remove it until the shared key path is verified.
- `ADMIN_AUTH_SECRET`.
- A future restricted Cloudflare API token used only by CI/CD.

The tracked `.dev.vars.example` contains names and empty values only. Copy it to `.dev.vars`; the latter is protected by `.gitignore`. If a local Nebula key is needed for an operator smoke test, `.nebula-env` is also ignored and must never be committed.

## Local development

1. Install dependencies with `npm install`.
2. Copy the example file:

   ```powershell
   Copy-Item .dev.vars.example .dev.vars
   ```

3. Leave all Telegram token, webhook-secret, and Nebula key values empty for ordinary local work. Phase 02 and Phase 03 tests use fake transports/providers and do not contact external services.
4. Generate Worker binding types and run the local checks:

   ```powershell
   npm run types
   npm run typecheck
   npm test
   npm run eval
   npm run verify
   ```

5. Start the local Worker with `npm run dev`. Wrangler uses local D1 and Queue simulation by default. No Telegram, Nebula, GOD, admin, or Cloudflare API credential is needed for local Phase 08 code or tests. A webhook request without the local secret is rejected safely.

Manual development can authenticate Wrangler with the browser-based login flow:

```powershell
npx wrangler login
npx wrangler whoami
```

Wrangler login is an operator session for manual development. It is not a secret committed to this repository.

## Production configuration later

Production secrets should be added interactively or through a secure secret-management workflow. Never put a value after the command in shell history or source code:

```powershell
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_GATEWAY_BOT_TOKEN
npx wrangler secret put TELEGRAM_PRODUCT_BOT_TOKEN
npx wrangler secret put TELEGRAM_GROWTH_BOT_TOKEN
npx wrangler secret put TELEGRAM_CREATIVE_BOT_TOKEN
npx wrangler secret put TELEGRAM_TECH_BOT_TOKEN
npx wrangler secret put TELEGRAM_FINANCE_BOT_TOKEN
npx wrangler secret put TELEGRAM_CUSTOMER_BOT_TOKEN
npx wrangler secret put TELEGRAM_OPERATIONS_BOT_TOKEN
npx wrangler secret put TELEGRAM_HERETIC_BOT_TOKEN
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put NEBULA_API_KEY
npx wrangler secret put GOD_API_KEY
npx wrangler secret put ADMIN_AUTH_SECRET
```

Use the appropriate Worker environment when staging and production configuration are introduced. Do not use `.dev.vars` as a production deployment mechanism. `NORMAL_AGENT_*` and `GOD_*` provider/model/reasoning settings are ordinary Worker configuration. `OPENAI_API_KEY` is the preferred shared credential; `GOD_API_KEY` remains a compatibility fallback until migration cleanup is explicitly approved. The operator-only `GPT_API_KEY` name is never read by the Worker. GOD never requires a Telegram GOD bot or `TELEGRAM_GOD_BOT_TOKEN`.

Automatic deployment is not required by Phase 08. If a future manual workflow is added, use a restricted Cloudflare API token stored as a protected GitHub Actions secret. That token is separate from application runtime secrets and should have only the account permissions required to deploy this Worker.

## D1 identifier lifecycle

`d1_databases[0].database_id` is a safe identifier, not a credential. After a real D1 database is created, replace the placeholder with the generated ID, verify the `database_name`, and apply migrations deliberately. Never put D1 API tokens in `wrangler.jsonc`.

## Telegram activation boundary

Phase 02 provides the adapter, normalization, D1 mappings, idempotent webhook ingestion, outbound projection records, and fake-transport tests. Phase 03 adds bounded runtime orchestration and the verified Nebula provider. The current post-v1 contract selects OpenAI Luna for normal Agents while retaining Nebula as a fallback. Phase 05 adds GOD as an internal reviewer only. The gateway is the only supported ingress webhook. Persona bots are outbound identities; do not install persona webhooks. GOD summaries use the gateway bot and preserve `agent-god` as canonical author. Before live integration testing, configure the private group, stable human admin IDs, verified bot identities, bot tokens, webhook secret, and the selected provider secret, then perform deliberate operator-controlled validation.

The common `TELEGRAM_WEBHOOK_SECRET` is sent to Telegram when a webhook is configured and is checked against the `X-Telegram-Bot-Api-Secret-Token` request header before the request body is read. Bot tokens remain runtime secrets. Telegram bot IDs and usernames remain ordinary configuration identifiers in `TELEGRAM_BOT_IDENTITIES_JSON`.

The checked-in operator helpers are intentionally separate from the production Worker:

```powershell
powershell -File .\scripts\telegram-bootstrap.ps1 -GroupId '<telegram group id>'
powershell -File .\scripts\telegram-bootstrap.ps1 -GroupId '<telegram group id>' -Deploy
powershell -File .\scripts\telegram-bootstrap.ps1 -GroupId '<telegram group id>' -WorkerBaseUrl '<worker base url>' -InstallGatewayWebhook
```

`telegram-bootstrap.ps1` reads only the ignored `.telegram-env`, verifies every configured bot with `getMe`, resolves the group creator, and never prints token values. Its deployment-time operational variables are injected at runtime and are not written to tracked configuration.

`telegram-smoke.ps1` starts a localhost-only `wrangler dev --remote` harness, uses the existing outbound application and Telegram adapter against remote D1, sends one bounded operator-controlled message, and terminates the local process. It is not a public endpoint:

```powershell
powershell -File .\scripts\telegram-smoke.ps1 -Persona product -Message '<controlled message>' -IdempotencyKey phase02-live-radin-001 -GroupId '<telegram group id>'
```

`telegram-replay.ps1` is an operator-only idempotency check. It loads the already-received test update from remote D1, rotates the webhook secret in runtime configuration, posts that same update twice through the gateway, and expects two `duplicate` responses. `-SimulateFailure` on `telegram-smoke.ps1` swaps in a bounded fake rate-limit transport and never calls Telegram.

`agent-ambient-smoke.ps1` starts a localhost-only remote-D1 harness, creates exactly one due ambient opportunity through `AgentScheduler.createImmediateAmbientJob`, claims it once, and runs the bounded runtime. It is an operator-only harness; it is not deployed and has no public route.

```powershell
powershell -File .\scripts\agent-ambient-smoke.ps1 -GroupId '<telegram group id>'
```

`god-review-smoke.ps1` is the operator-only GOD review harness. It uses the application service against remote D1, requires the configured OpenAI credential only in the local child Worker process, and never exposes a public smoke endpoint. It supports a fake-provider test locally and a single real review after the verified provider is configured. For a provider-only check without persistence, use `npm run openai:luna:smoke` with the operator environment's `GPT_API_KEY`.

## Credential timeline

| Phase | Required configuration | Real secrets required? |
| --- | --- | --- |
| Phase 00 | Local Worker, local D1/Queue simulation, empty config contract | No |
| Phase 02 | Telegram group ID, admin user IDs, gateway/persona bot identities, bot tokens, webhook secret for live activation | Yes only for live Telegram activation; fakes are sufficient for code/tests |
| Phase 03 | Nebula API key, base URL, and model configuration | Yes, Nebula key |
| Phase 05 | OpenAI provider protocol and GOD as an internal reviewer; no GOD Telegram bot | Yes, for the single live GOD review |
| Phase 06+ | Production admin authentication secret | Yes, admin secret |
| Phase 08 | Hardening and deployment readiness | No for local/CI verification |
| Post-v1 Luna migration | `OPENAI_API_KEY` for normal Agents and GOD; `GOD_API_KEY` retained during compatibility transition; Luna medium/xhigh configuration | Yes for production provider activation; never for deterministic CI |

No credential is required for local Phase 08 development, `npm run verify`, or automated tests. Live Telegram validation requires the Phase 02 values above. Live normal-Agent/GOD validation additionally requires the selected OpenAI provider secret; Nebula remains available for an explicit fallback smoke. `GPT_API_KEY` is an operator-only local environment name, not a production Worker secret. `TELEGRAM_GOD_BOT_TOKEN` is never required.
