# LUMA ADHD — Research Synthesis

This file records the implementation conclusions drawn from the five reports in `/research`. The reports remain the detailed evidence layer; this is the v1 decision layer.

## Decisions

1. **Cloudflare Free is a hard constraint.** Build around Workers + D1 + Cron + Worker Static Assets. Use one Queue only for coarse jobs/agent turns. Do not require R2, Durable Objects, Workflows, KV, a VPS, Redis, or PostgreSQL.

2. **D1 is canonical.** Telegram is the visible workspace. Agent conversations, thread state, files, jobs, evaluations, and memory live in D1.

3. **Telegram personas are presentation identities.** A controller integration receives human workspace input; internal orchestration chooses agents and projects output through configured personas. Do not make the reasoning engine depend on bot-to-bot Telegram delivery.

4. **Continuous does not mean constant chatter.** Use bounded interactive bursts after human input, ambient scheduled work, and small deep-work bursts for promising threads. `WAIT` is valid, but prolonged inactivity should cause deliberate exploration/review opportunities.

5. **Use an explicit thread state machine.** Exploration, debate, evidence gathering, development, synthesis, human-required/blocked, decision/rejection, parking, and reopening are durable states with bounded turn budgets.

6. **Search first, vectors later.** D1 FTS5 + tags/domain/recency is sufficient for v1 memory and Markdown retrieval. Keep retrieval abstract enough to add semantic search later.

7. **Normal models return structured intentions.** Do not require provider-native tool calling. Validate model output and let application code execute allowlisted internal intentions.

8. **Nebula details require live verification.** The Nebula research report could not retrieve the supplied API guide and therefore inferred parts of the interface. Implementation must verify the live guide before hard-coding transport details.

9. **Reputation is multidimensional and domain-aware.** Track factual reliability, contribution quality, outcome impact, and collaboration quality. Rank affects influence slowly, not absolute authority.

10. **GOD is periodic supervision, not the normal router.** Use a separately configured stronger model approximately every 12 hours to review compressed organizational state, challenge weak consensus, and evaluate important work.

11. **No R2 for diagrams.** Store diagram source in D1; optional Browser Rendering can create an image that is sent to the private Telegram workspace. Preserve source/Telegram metadata and degrade gracefully if rendering is unavailable.

12. **The admin panel is a core product surface.** It must explain current work, threads, files, human tasks, Rank changes, GOD reviews, failures, and free-tier pressure—not just expose database CRUD.

## Known moving targets

Cloudflare limits, Telegram behavior, and the Nebula API may change. When implementation-time official documentation conflicts with a research report, prefer the official current behavior and record the deviation in the relevant implementation PR.