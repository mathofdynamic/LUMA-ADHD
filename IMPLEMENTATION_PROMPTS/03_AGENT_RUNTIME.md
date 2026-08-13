# Phase 03 — Agent Runtime

Implement the multi-agent reasoning engine using the project overview and the multi-agent/Nebula research.

Create a provider-neutral LLM interface first. Normal agents and GOD use separate model configurations. The Nebula research could not retrieve the supplied API guide, so Codex must attempt to read the live guide at `https://nebula-free-llm.nebula-ai-company.workers.dev/nebula-api-guide.md` before finalizing that adapter. Do not treat inferred research details as confirmed.

Use a validated structured agent response rather than requiring provider-native tools. Supported intentions should include speaking, waiting, file work, requesting another agent, requesting human input, proposing/reopening a thread, drawing, and voting. Allow at most one response-format repair attempt. Persist concise summaries/rationales rather than hidden chain-of-thought.

Build prompts from the agent’s identity, Soul, specialty, interests, thread state, recent messages, relevant memory/files, wake reason, and allowed intentions. Keep context bounded.

Implement three bounded activity modes:

- **Interactive burst:** after human input, several relevant agents may work the issue; default cap about 6 turns.
- **Ambient work:** scheduled opportunities to continue threads, revisit old work, create ideas, improve artifacts, or wait.
- **Deep-work burst:** a promising thread may receive a small extra bounded turn budget.

Speaker selection should combine specialty relevance, phase fit, recent participation, current usefulness, domain reputation, explicit agent interest/request, and a small exploration component. Never use pure round-robin or highest-rank-wins.

Waiting is valid but must not make the organization permanently quiet. Detect prolonged inactivity and schedule exploration/review opportunities.

Use fake model providers in tests. Cover structured-response validation, provider failure, candidate selection, dominance limits, turn caps, WAIT behavior, inactivity recovery, and idempotent execution.

## Acceptance

A test human thread produces a bounded multi-agent exchange; scheduled ambient work can progress independently; inactive agents do not create noise; no execution path can loop indefinitely; the LLM provider can be replaced without rewriting orchestration.