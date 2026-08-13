# LUMA ADHD — Codex Implementation Prompts

Execute these phases in numerical order. Each phase is a separate Codex task and must leave the repository testable before the next phase begins.

1. `00_FOUNDATION.md` — project scaffold, Cloudflare Free constraints, tests, local development.
2. `01_DATA_AND_CORE.md` — D1 schema, repositories, jobs, events, thread model.
3. `02_TELEGRAM.md` — gateway bot ingress, persona bot projection, deduplication, Telegram UX.
4. `03_AGENT_RUNTIME.md` — provider abstraction, Nebula adapter, prompts, scheduler, autonomous and interactive orchestration.
5. `04_MEMORY_FILES_KNOWLEDGE.md` — Markdown files, versions, FTS5 memory, LUMA knowledge synchronization.
6. `05_REPUTATION_AND_GOD.md` — domain reputation, evaluations, daily scoring, GOD supervision.
7. `06_ADMIN_PANEL.md` — authenticated observatory-style admin application and operational controls.
8. `07_TOOLS_HUMANS_OBSERVABILITY.md` — human tasks, diagrams without R2, auditability, quota/health visibility.
9. `08_HARDENING_DEPLOYMENT.md` — anti-loop testing, security, evals, CI, deployment readiness.

## Global rules

- Production must remain compatible with a completely free Cloudflare account.
- Do not add R2, Durable Objects, Workflows, KV, a VPS, Redis, or PostgreSQL as required infrastructure.
- Use Cloudflare Workers, D1, Cron Triggers, Worker Static Assets, and a Queue only at coarse job/agent-turn granularity.
- Telegram is a visible workspace; D1 is the canonical conversation and memory store.
- Persona Telegram bots are identities, not independent brains.
- Keep agents proactive. `WAIT` is valid, but inactivity must not become the optimization goal.
- No autonomous unbounded loops. Every burst, phase, and retry path needs a hard budget.
- All agents start around Rank 10; reputation evolves slowly and is domain-aware.
- GOD uses a separately configurable frontier provider and runs approximately every 12 hours.
- The admin panel is part of the product, not an optional debug page.
- Never commit secrets.
- Use strict TypeScript, explicit migrations, schema validation, idempotency, and tests.

Read `PROJECT_OVERVIEW_EN.md`, all `/research/*.md` files, and the phase prompt before implementing a phase. When research conflicts with current official platform behavior, prefer current official documentation and document the deviation.