# LUMA ADHD

LUMA ADHD is a persistent multi-agent workspace for thinking about LUMA as a company, product, platform, and business. The project is designed around a Cloudflare Free-compatible core: Workers, D1, Cron Triggers, one coarse Queue, and Worker Static Assets.

Phase 00 establishes the runtime scaffold, configuration contract, module boundaries, local tests, and the observatory-style admin shell. It does not connect Telegram, call an LLM provider, run autonomous agents, or deploy production infrastructure.

## Local setup

```bash
npm install
copy .dev.vars.example .dev.vars
npm run types
npm run build
npm test
npm run dev
```

`.dev.vars` is local-only and ignored by Git. Keep all values empty in Phase 00. See [docs/SETUP_AND_SECRETS.md](docs/SETUP_AND_SECRETS.md) for the configuration contract and later-phase setup.

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

## Phase workflow

Implementation prompts in `IMPLEMENTATION_PROMPTS/` are executed in numerical order. Each phase is isolated, tested, and committed before the next phase begins. Do not add production credentials or infrastructure until the phase that requires them.
