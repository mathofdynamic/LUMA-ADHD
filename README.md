# LUMA ADHD

LUMA ADHD is a persistent multi-agent workspace for thinking about LUMA as a company, product, platform, and business. v1 is built around a Cloudflare Free-compatible core: Workers, D1, Cron Triggers, one coarse Queue, and Worker Static Assets.

v1 is complete through Phase 08. It includes eight normal Agents, GOD as a distinct supervisory model, gateway-only Telegram ingress with persona outbound identities, D1-backed memory/files/RAG, domain reputation, Human Tasks, source-first diagrams, and a private Admin Observatory. Phase 08 hardens failure handling, idempotency, loop limits, deterministic evaluations, security review, CI, deployment, and operations. The current post-v1 provider contract runs all normal Agents on OpenAI `gpt-5.6-luna` with `medium` reasoning and GOD on the same model with `xhigh` reasoning; Nebula remains a supported fallback but is inactive in production.

## Local setup

```bash
npm install
copy .dev.vars.example .dev.vars
npm run types
npm run build
npm test
npm run dev
```

`.dev.vars` is local-only and ignored by Git. Keep credentials out of tracked files. See [docs/SETUP_AND_SECRETS.md](docs/SETUP_AND_SECRETS.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/OPERATIONS.md](docs/OPERATIONS.md), and [docs/SECURITY.md](docs/SECURITY.md).

## Architecture

- `src/index.ts` — Worker entry points for HTTP, Cron, and Queue events.
- `src/api/` — lightweight API routing and foundation endpoints.
- `src/agents/` — agent identity and orchestration boundary.
- `src/database/` — direct prepared D1 query boundary.
- `src/jobs/` — coarse Queue message contract and consumer boundary.
- `src/llm/` — provider-neutral LLM contract; adapters begin later.
- `src/memory/`, `src/reputation/`, `src/telegram/`, `src/tools/` — stable future module boundaries.
- `admin/` — React + Vite static admin observatory shell.
- `migrations/` — D1 migrations; domain schema begins in Phase 01.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict Worker and admin TypeScript checks |
| `npm test` | Credential-free unit tests |
| `npm run build` | Build the admin assets and Worker dry run |
| `npm run dev` | Build admin assets and start local Wrangler development |
| `npm run dev:admin` | Run the Vite admin development server |
| `npm run migrations:local` | Apply local D1 migrations |
| `npm run eval` | Run the deterministic, credential-free v1 behavioral eval suite |
| `npm run verify` | Run local migrations, generated-type checks, tests, evals, builds, and startup validation |
| `npm run openai:luna:smoke` | Operator-only non-persistent OpenAI Luna structured-output smoke; requires `GPT_API_KEY` and never prints it |

## Phase workflow

Implementation prompts in `IMPLEMENTATION_PROMPTS/` were executed in numerical order. Each phase is isolated, tested, and committed. Core v1 does not require R2, KV, Durable Objects, Workflows, Redis, PostgreSQL, a vector database, or a VPS. Browser Rendering is optional; source-only diagrams remain fully operational.
