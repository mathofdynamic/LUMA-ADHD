# Cloudflare Free-plan notes

Phase 00 deliberately uses the smallest Cloudflare surface that supports the product foundation:

- One Worker for HTTP, scheduled, and Queue entry points.
- D1 as the canonical relational store.
- One Queue for coarse background work and future retries.
- One Cron trigger as a scheduler metronome.
- Worker Static Assets for the React/Vite admin shell.

The project does not require R2, Durable Objects, Workflows, KV, Redis, PostgreSQL, a VPS, or a paid Cloudflare plan. Those exclusions are architectural constraints, not temporary omissions.

## Limits that shape the design

Cloudflare limits change. Verify the official documentation before production configuration or capacity decisions.

### Worker execution

Worker requests, scheduled invocations, and Queue consumers share account-level request and CPU budgets. Foundation handlers therefore remain thin: route a small API response, record a bounded scheduling signal, or acknowledge a validated Queue message. They do not run model reasoning or unbounded loops.

Official references:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

### D1

D1 is the canonical store for future conversations, files, jobs, and organizational state. Direct prepared statements and explicit migrations keep query behavior visible and avoid ORM overhead. Queries must remain bounded, indexed, and batched as later phases add data.

Official references:

- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

### Queue

The single Queue is reserved for coarse agent jobs, retries, and reliability buffering. It must not become a message for every internal reasoning step. Queue retention and operation limits make bounded batching essential on the Free plan.

Official references:

- [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Queues configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/)

### Cron

Cron is a metronome, not the agent runtime. The scheduled handler should select or mark a small amount of due work and return. Later phases must keep each tick bounded and use durable D1 state for progress.

Official reference: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

### Static assets

The admin application is built by Vite into `admin/dist`. Workers Static Assets serves that directory, while `/api/*` is routed to the Worker first. SPA navigation uses `not_found_handling: "single-page-application"`.

Official references:

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Static Assets configuration and bindings](https://developers.cloudflare.com/workers/static-assets/binding/)
- [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)

## Operational rules

- Keep model calls outside the foundation HTTP and Cron paths.
- Do not add a Cloudflare product just to avoid designing a bounded D1 workflow.
- Measure Worker requests, D1 reads/writes, Queue operations, and scheduled work before increasing autonomy.
- Treat quota pressure as a product signal visible in the future admin observatory.
- Re-check current official limits when implementing each later phase.
