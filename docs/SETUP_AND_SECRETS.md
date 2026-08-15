# LUMA ADHD setup and secrets

Phase 02 establishes the Telegram integration contract and the operator-controlled path for activating a real gateway webhook. The application and automated tests run locally with empty values, fake transports, and local Wrangler bindings. Live activation is never performed by ordinary tests or deployments.

## Configuration categories

### Safe identifiers and ordinary configuration

These values identify a resource or select behavior. They are not authentication credentials, although Telegram IDs and account IDs should still be handled as operational data:

- `LUMA_ENVIRONMENT` and `LUMA_PHASE` - runtime labels.
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account identifier used by manual tooling when needed.
- `TELEGRAM_GROUP_ID` - the configured private workspace chat identifier.
- `TELEGRAM_ADMIN_USER_IDS` - comma-separated Telegram user identifiers allowed to perform privileged actions.
- `TELEGRAM_BOT_IDENTITIES_JSON` - safe JSON metadata for deterministic bot-to-agent mapping. Store Telegram bot IDs and usernames here, never tokens. Empty `{}` is valid.
- `NEBULA_BASE_URL` and `NEBULA_MODEL` - normal-model provider endpoint and model identifier.
- `GOD_BASE_URL` and `GOD_MODEL` - frontier-provider endpoint and model identifier.
- `database_name`, `queue`, and Worker `name` in `wrangler.jsonc` - safe Cloudflare resource names.
- `database_id` in `wrangler.jsonc` - a safe D1 resource identifier, currently a zero UUID placeholder.

The identity map uses aliases such as `gateway`, `product`, `growth`, `creative`, `technical`, `finance`, `customer`, `operations`, `heretic`, and `god`. The alias-to-agent mapping is deterministic in code. Adding a bot changes configuration, not orchestration logic.

### Secrets

These values authenticate the application and must never be committed, placed in `wrangler.jsonc`, or printed in logs:

- `TELEGRAM_WEBHOOK_SECRET`.
- `TELEGRAM_*_BOT_TOKEN` for the gateway and persona bots.
- `NEBULA_API_KEY`.
- `GOD_API_KEY`.
- `ADMIN_AUTH_SECRET`.
- A future restricted Cloudflare API token used only by CI/CD.

The tracked `.dev.vars.example` contains names and empty values only. Copy it to `.dev.vars`; the latter is protected by `.gitignore`.

## Local development

1. Install dependencies with `npm install`.
2. Copy the example file:

   ```powershell
   Copy-Item .dev.vars.example .dev.vars
   ```

3. Leave all Telegram token and webhook-secret values empty until live Telegram activation is explicitly approved. Phase 02 tests use a fake transport and do not contact Telegram.
4. Generate Worker binding types and run the local checks:

   ```powershell
   npm run types
   npm run typecheck
   npm test
   npm run build
   ```

5. Start the local Worker with `npm run dev`. Wrangler uses local D1 and Queue simulation by default. No Telegram, Nebula, GOD, admin, or Cloudflare API credential is needed for the Phase 02 code or tests. A webhook request without the local secret is rejected safely.

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
npx wrangler secret put TELEGRAM_GOD_BOT_TOKEN
npx wrangler secret put NEBULA_API_KEY
npx wrangler secret put GOD_API_KEY
npx wrangler secret put ADMIN_AUTH_SECRET
```

Use the appropriate Worker environment when staging and production configuration are introduced. Do not use `.dev.vars` as a production deployment mechanism. GOD remains unconfigured until a later phase; do not create or require `TELEGRAM_GOD_BOT_TOKEN` for Phase 02.

Automatic deployment may later use a restricted Cloudflare API token stored as a GitHub Actions secret. That token is separate from application runtime secrets and should have only the account permissions required to deploy this Worker. Phase 02 does not create or use it.

## D1 identifier lifecycle

`d1_databases[0].database_id` is a safe identifier, not a credential. After a real D1 database is created, replace the placeholder with the generated ID, verify the `database_name`, and apply migrations deliberately. Never put D1 API tokens in `wrangler.jsonc`.

## Telegram activation boundary

Phase 02 provides the adapter, normalization, D1 mappings, idempotent webhook ingestion, outbound projection records, and fake-transport tests. The gateway is the only supported ingress webhook. Persona bots are outbound identities; do not install persona webhooks. Before live integration testing, configure the private group, stable human admin IDs, verified bot identities, bot tokens, and webhook secret, then perform a deliberate operator-controlled gateway setup.

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

## Credential timeline

| Phase | Required configuration | Real secrets required? |
| --- | --- | --- |
| Phase 00 | Local Worker, local D1/Queue simulation, empty config contract | No |
| Phase 02 | Telegram group ID, admin user IDs, gateway/persona bot identities, bot tokens, webhook secret for live activation | Yes only for live Telegram activation; fakes are sufficient for code/tests |
| Phase 03 | Nebula API key, base URL, and model configuration | Yes, Nebula key |
| Phase 05 | GOD/frontier-provider key, base URL, and model configuration | Yes, GOD key |
| Phase 06+ | Production admin authentication secret | Yes, admin secret |
| Phase 08 | Restricted Cloudflare API token if automatic deployment is enabled | Only if CI/CD is enabled |

No credential is required for local Phase 02 development or automated tests. Live Telegram integration requires the Phase 02 values above and a real private group where the configured bots are members. The GOD bot remains intentionally deferred.
