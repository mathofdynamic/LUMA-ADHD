# Phase 08 — Hardening, Evals, and Deployment Readiness

Finish v1 by proving that the system is safe from its own failure modes and can remain inside the Cloudflare Free architecture.

## Reliability

Add failure-injection tests for model timeouts/errors, malformed agent output, Telegram failures, duplicate inbound events, Queue redelivery, D1 errors, stale jobs, and partial multi-step work. Confirm idempotency and that retries cannot create duplicate visible messages or duplicate durable actions.

Add hard guards for interactive/deep-work length, queue-chain depth, phase turn budgets, repeated-agent dominance, repeated-content behavior, and daily/scheduler work limits.

## Multi-agent eval suite

Create deterministic/fake-model scenarios that measure behavior rather than prose quality:

- human question receives multiple relevant perspectives;
- agents can disagree and later synthesize;
- repetitive turns terminate or WAIT;
- a quiet organization eventually creates a new exploration opportunity;
- low-ranked specialists still participate when relevant;
- blocked work becomes a human task;
- resolved human input wakes the correct thread;
- old decisions/files can be rediscovered;
- a promising thread cannot loop forever;
- GOD can challenge a weak consensus without deleting prior reasoning.

Keep these fixtures stable so later prompt/model changes can be regression-tested.

## Security and privacy review

Review all externally reachable routes, admin access, Telegram workspace scoping, input validation, model-output validation, HTML diagram constraints, error responses, and logs. Ensure repository/config examples contain no live credentials or private company data.

## Free-tier review

Instrument and document approximate consumption for Worker invocations, D1 reads/writes, Queue operations, scheduled jobs, and optional Browser Rendering. Add warning thresholds below hard limits. Confirm Queues are used only for coarse jobs and Cron count remains within the v1 design.

## CI and deployment docs

Add GitHub Actions for install, typecheck, tests, and production builds. Do not require deployment credentials for pull-request CI.

Add `docs/DEPLOYMENT.md` with the exact operator checklist for creating D1/Queue resources, applying migrations, configuring the Worker/admin assets, setting required runtime values, Telegram workspace setup, Cron schedules, initial agent seed, and post-deploy smoke tests.

Add `docs/OPERATIONS.md` covering ordinary failures, retry/recovery, pausing autonomous activity, database backup/export guidance, model-provider replacement, and quota-pressure response.

## Final acceptance

A clean checkout passes CI; local integration/eval suites pass without live external services; production build succeeds; deployment has no paid Cloudflare dependency; failure/retry paths are idempotent; autonomous loops are bounded; operator documentation is sufficient to deploy and recover the system.