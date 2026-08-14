# LUMA ADHD setup and secrets

Phase 02 establishes the Telegram integration contract without activating a production webhook. The application and automated tests run locally with empty values, fake transports, and local Wrangler bindings.

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

Use the appropriate Worker environment when staging and production configuration are introduced. Do not use `.dev.vars` as a production deployment mechanism.

Automatic deployment may later use a restricted Cloudflare API token stored as a GitHub Actions secret. That token is separate from application runtime secrets and should have only the account permissions required to deploy this Worker. Phase 02 does not create or use it.

## D1 identifier lifecycle

`wrangler.jsonc` contains a zero UUID placeholder for `d1_databases[0].database_id`. This is a safe identifier placeholder, not a credential. After a real D1 database is created, replace it with the generated `database_id`, verify the `database_name`, and apply migrations deliberately. Phase 02 does not create a remote D1 database or activate a production Telegram webhook.

## Telegram activation boundary

Phase 02 provides the adapter, normalization, D1 mappings, idempotent webhook ingestion, outbound projection records, and fake-transport tests. It does not call `setWebhook`, send unsolicited messages, or enable a public Telegram workspace. Before live integration testing, configure the private group, stable human admin IDs, bot identities, bot tokens, and webhook secret, then perform a deliberate operator-controlled webhook setup.

The common `TELEGRAM_WEBHOOK_SECRET` is sent to Telegram when a webhook is configured and is checked against the `X-Telegram-Bot-Api-Secret-Token` request header before the request body is read. Bot tokens remain runtime secrets. Telegram bot IDs and usernames remain ordinary configuration identifiers in `TELEGRAM_BOT_IDENTITIES_JSON`.

## Credential timeline

| Phase | Required configuration | Real secrets required? |
| --- | --- | --- |
| Phase 00 | Local Worker, local D1/Queue simulation, empty config contract | No |
| Phase 02 | Telegram group ID, admin user IDs, gateway/persona bot identities, bot tokens, webhook secret | Yes, Telegram values |
| Phase 03 | Nebula API key, base URL, and model configuration | Yes, Nebula key |
| Phase 05 | GOD/frontier-provider key, base URL, and model configuration | Yes, GOD key |
| Phase 06+ | Production admin authentication secret | Yes, admin secret |
| Phase 08 | Restricted Cloudflare API token if automatic deployment is enabled | Only if CI/CD is enabled |

No credential is requested or required to complete Phase 02. Live Telegram integration testing later requires the Phase 02 values above and a real private group where the configured bots are members.
