# Phase 00 — Foundation

Build the repository scaffold only. Read the project overview, all `/research` files, and `IMPLEMENTATION_PROMPTS/README.md` first.

## Requirements

- TypeScript strict mode.
- Cloudflare Worker as the backend runtime.
- D1 as the database.
- One Cloudflare Queue reserved for coarse agent jobs.
- Cron entry point for later scheduling.
- React + Vite admin application served as static assets.
- Lightweight routing and direct prepared D1 queries; avoid a heavy ORM.
- No R2, Durable Objects, Workflows, KV, Redis, PostgreSQL, VPS, or paid Cloudflare requirement.

Create clear modules for API, agents, database, jobs, LLM providers, memory, reputation, Telegram, and tools. Add `migrations/`, `tests/`, and the admin app.

Implement `GET /api/health`, `GET /api/version`, a typed Queue consumer entry point, a `scheduled()` entry point, and SPA static-asset fallback. Health output must contain only readiness/status information.

Create Wrangler configuration with D1 and Queue bindings plus placeholders for later Telegram, normal-model, GOD-model, admin, and optional Browser Rendering configuration. Commit examples only, never live credentials.

Create the admin shell with navigation for Strategy Room, Agents, Threads, Files, Human Tasks, Reputation, GOD, System, and Settings. Establish the final visual quality now: dark LUMA workspace, restrained violet/magenta accents, strong typography/spacing, responsive behavior, accessibility, reduced-motion support, and designed loading/error/empty states. Do not add fake charts.

Add centralized guardrail defaults for interactive-burst length, deep-work length, Queue chain depth, scheduler work per tick, retry count, and Telegram message splitting.

Add `docs/FREE_TIER_NOTES.md` using current official Cloudflare documentation and explain the limits that shape this architecture.

Add scripts for typecheck, tests, admin build, Worker development, migrations, and production build. Tests must run without external service credentials.

Create a concise root README covering purpose, architecture, local setup, tests, and phase workflow.

## Do not implement yet

Real agent behavior, Telegram orchestration, reputation calculations, knowledge sync, GOD logic, or final admin pages.

## Acceptance

Install, typecheck, tests, admin build, and local Worker startup all succeed. D1/Queue bindings are valid, no paid service is required, and the repository is ready for Phase 01.