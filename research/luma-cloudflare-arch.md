# LUMA ADHD on Cloudflare Free Plan (August 2026)

## Executive summary

LUMA ADHD can run entirely on Cloudflare’s Free plan by combining a small number of HTTP Workers, D1 as the primary data store, optional Queues for background work, and static assets served for free from Workers or Pages.[web:1][web:2][web:9][web:19][web:55] The main global constraints you must design around are: 100,000 Worker/Workflow/DO/Queue requests per day, 10 ms CPU time per invocation, 50 external subrequests per invocation, 5 cron triggers per account, D1’s 5M read / 100k write rows per day and 5 GB storage, and Queues’ 10,000 operations per day.[web:1][web:2][web:3][web:9][web:10][web:19][web:39]

---

## Core free‑plan limits (August 2026)

### Workers & Pages Functions

Cloudflare Workers and Pages Functions share the same Workers plan limits.[web:1][web:2][web:11]

- 100,000 Worker requests per day across the account (includes HTTP requests, Cron triggers, Durable Objects, Workflows, and Queue consumer invocations that count as Worker requests).[web:1][web:2][web:39]
- 10 ms CPU time per invocation (HTTP or Cron) on Workers Free.[web:1][web:2]
- Memory: 128 MB per V8 isolate, shared across concurrent requests.[web:1]
- Subrequests per invocation: 50 external fetches (e.g., AI APIs, Telegram, other HTTP endpoints) and 1,000 internal subrequests to Cloudflare services (D1, KV, R2, DO, Queues, Workflows, etc.).[web:1][web:8][web:39]
- Static assets with Workers Static Assets:
  - Up to 20,000 files per Worker version on Free; individual file size up to 25 MiB.[web:1][web:46][web:50]
  - Requests that hit static assets directly are free and unlimited; only requests that execute Worker code count against the 100k/day quota.[web:2][web:55]
- Request body size limit on the Free Cloudflare plan: 100 MB per request; response body effectively unbounded (subject to CDN object size limits of 512 MB for cached responses).[web:1][web:15]

### Cron Triggers

Cron Triggers are available on the Free plan but are tightly constrained.[web:1][web:20][web:22]

- Up to 5 Cron Triggers per account on Free (not per Worker).[web:1][web:20][web:22]
- Each scheduled run counts as a normal Worker request against the 100k/day quota and is subject to the 10 ms CPU limit.[web:1][web:2][web:22]
- Minimum schedule granularity: 1 minute.
- No automatic retries or built‑in alerting; failures just count as a request and are lost until the next scheduled run.[web:22][web:23]

### D1 (primary SQL database)

D1 provides a generous free tier but is now strictly enforced for Free accounts.[web:3][web:9][web:12]

- Databases per account: 10 on Free.[web:3][web:14]
- Max database size: 500 MB per database on Free; total D1 storage across databases: 5 GB.[web:3][web:9][web:14]
- Per‑account daily limits for Workers Free:[web:9][web:12]
  - Rows read: 5,000,000 per day.
  - Rows written: 100,000 per day.
- Per‑invocation query limits:
  - Up to 50 D1 queries (reads/writes) per Worker invocation on Free (these count as internal subrequests).[web:3][web:14]
- Query characteristics:
  - Max query duration: 30 s; up to 100 bound parameters per query; row or BLOB size up to 2 MB.[web:3][web:14]

When daily limits are exceeded, all further D1 queries fail until the next UTC day.[web:9][web:12]

### Durable Objects

Durable Objects (DOs) are available on the Workers Free plan with their own free allocation, but they still share the 100k requests/day cap.[web:16][web:17][web:32]

- DO requests on Free:
  - 100,000 DO requests per day (HTTP, RPC, WebSocket messages, alarm invocations), effectively bound by the global 100k Workers request limit.[web:17][web:32]
- DO storage (SQLite backend) on Free:
  - Total SQL stored data: 5 GB per account; per‑object limit 10 GB (but Free account hits the 5 GB total first).[web:16][web:17][web:27]
- CPU & wall‑time:
  - Per‑invocation CPU time behaves like Workers; free‑plan DOs are effectively bound by 10 ms CPU per invocation, but can wait on I/O and stay active while connections are open.[web:1][web:16][web:27]
  - Wall‑time for DO requests is effectively unlimited while the client connection is open; alarms have up to 15 minutes wall time.[web:16][web:27]

In practice, DOs are constrained more by the global 100k requests/day and the DO SQL storage cap than by their own throughput (500–1,000 requests/s per object for simple operations).[web:16][web:18][web:27]

### Queues

Queues is now part of the Workers Free plan with a small daily operations pool.[web:10][web:19][web:30]

- Queues per account: up to 10,000.[web:19][web:30]
- Operations on Free: 10,000 operations per day across send, receive, acknowledge, and delete.[web:2][web:10][web:30]
- Per‑queue throughput limits (technical, not economic):
  - Up to 5,000 messages per second per queue, 100 per batch, 128 KB per message, 25 GB backlog per queue.[web:19][web:26]
- Retention:
  - Free plan: max 24 hours retention.[web:10][web:30]
  - Paid plans: configurable up to 14 days.[web:19][web:26]
- Queue consumers are Worker invocations with up to 15 minutes wall‑time and configurable CPU up to 5 minutes on paid; on Free you are practically bound by 10 ms CPU per invocation even though the wall‑time limit is 15 minutes.[web:1][web:19]

With only 10,000 queue operations per day, Queues is useful as a low‑volume reliability buffer, not a high‑throughput job system on Free.

### Workers KV (if used at all)

KV has a small free allocation and strong eventual consistency.[web:2][web:5]

- Reads: 100,000 per day per account.[web:2][web:5]
- Writes: 1,000 per day; deletes: 1,000 per day.[web:2][web:5]
- Storage: 1 GB per account; values up to 25 MiB.[web:2][web:5]

Given the low write limit and eventual consistency, KV is best reserved for infrequently‑changing configuration or feature flags, not core conversational data.

### Browser Rendering

Browser Rendering provides headless Chromium instances with a small free allowance.[web:31][web:32][web:34][web:35]

- Free tier: 10 minutes of browser time per day, 3 concurrent browsers per account, 60 s timeout per browser run, and strict per‑second rate limits.[web:32][web:34][web:35]

Because LUMA ADHD does not need headless browsing for normal operation, Browser Rendering should be avoided in the core architecture.

### Workflows (durable execution)

Cloudflare Workflows is GA and available on the Workers Free plan.[web:31][web:39][web:40][web:42]

- Shares the Workers Free limits: 100,000 invocations per day and 10 ms CPU per Workflow invocation (per step) on Free.[web:31][web:39][web:42]
- Additional free metrics for Workflows on Free:
  - Steps: 3,000 steps per day.[web:31][web:39]
  - Storage: 1 GB of Workflow instance state (with default retention around 3 days).[web:31][web:39][web:42]
  - Max steps per Workflow: 1,024 on Free.[web:39][web:41]
- Subrequests per Workflow instance on Free: limited to 50 external subrequests and 1,000 internal subrequests, same as Workers.[web:39]

Given the 3,000‑steps‑per‑day free limit and the fact that steps, not just CPU, are billed/limited, Workflows is better suited for a few long‑running orchestrations (e.g., an occasional experiment) than for every agent turn.

---

## Which Cloudflare services to use / avoid on Free

### Strongly recommended services

- **Workers (core)**: Required for Telegram webhooks, AI proxying, orchestration, and admin APIs.
- **D1**: Primary store for conversations, agent state, and Markdown documents; free tier gives 5M row reads and 100k writes per day.[web:3][web:9][web:14]
- **Queues (light use)**: For low‑volume background/retry work where eventual processing matters more than latency, within 10k operations/day.[web:10][web:19][web:30]
- **Workers Static Assets or Pages (admin dashboard)**:
  - Serve admin UI as static HTML/JS/CSS; static requests do not consume Worker quota if they bypass the Worker.[web:2][web:51][web:55]

### Use cautiously or avoid for this project

- **Durable Objects:**
  - Technically available on Free with DO‑specific free tier, but Free accounts are capped at 5 GB SQL storage and 100k DO requests/day, competing directly with Worker quota.[web:17][web:27][web:32]
  - DOs shine for strongly‑consistent coordination and WebSocket fan‑in; LUMA ADHD can instead centralize coordination in D1 with careful indexing and modest locking patterns, avoiding DO complexity and limits.
- **Workflows:**
  - While free and powerful, the 3,000‑step/day limit makes them fragile for continuous multi‑agent orchestration with many small steps.[web:31][web:39][web:41]
  - They also add a second orchestration DSL; for this system, plain Workers + Queues + Cron is simpler and safer.
- **KV:**
  - Very limited writes/day and eventual consistency; good for static config, but not needed if D1 is already used.[web:2][web:5]
- **Browser Rendering:**
  - Only 10 minutes/day and 3 concurrent browsers; best avoided unless you have a compelling browser automation use case.[web:32][web:34][web:35]
- **Workers AI:**
  - Has its own free quota (10k neurons/day), but LUMA ADHD already depends on external AI APIs; mixing providers risks hidden quota coupling.[web:13]

Result: the **recommended stack** for a fully‑free LUMA ADHD is: Workers + D1 + optional Queues + static assets (Workers or Pages), with Cron Triggers as the only scheduler.

---

## Durable Objects vs D1 for agent coordination

### D1 characteristics

- Global transactional SQL database with read replicas and up to 5M rows read / 100k rows written per day on Free.[web:3][web:9][web:14]
- Strong consistency within a single region, eventual replication globally; read‑your‑write consistency is not guaranteed on immediately subsequent reads from different regions, but is generally sufficient for chat‑like workloads when you design access carefully.[web:14]
- Per‑invocation cap of 50 D1 queries on Free, and 6 concurrent D1 connections per Worker invocation.[web:3][web:14]

### Durable Objects characteristics

- Per‑object, single‑threaded state machine with persistent storage, intended for strongly consistent coordination or WebSockets.[web:16][web:18]
- On Free, SQLite‑backed DOs share the 5 GB SQL storage cap and 100k requests/day DO free tier.[web:16][web:17][web:27][web:32]
- A single DO can handle roughly 500–1,000 requests/s for simple operations, but overall usage is bounded by the free daily request quota, not peak RPS.[web:18]

### Suitability for LUMA ADHD

For LUMA ADHD’s 8–15 agents and mostly asynchronous, Telegram‑driven interactions:

- **Coordination via D1** is enough:
  - Use D1 tables for conversations, agent states, and scheduled jobs.
  - Serialize critical operations with primary keys and constraint‑based upserts instead of per‑user Durable Objects.
- **Durable Objects** mainly help with:
  - High‑frequency concurrent updates to a small shared state (e.g., multiplayer docs, WebSocket rooms).
  - Long‑lived WebSocket or TCP sessions (LLM streaming, etc.).[web:16][web:18][web:27]

Given your free‑tier goal and agent count, DOs **do not provide a decisive benefit** over D1 and add another resource pool to monitor.
Unless you need strong per‑user mutual exclusion or intensive real‑time collaboration, you can skip DOs entirely in v1.

---

## Queues on Free: are they worth it?

### Pros

- Decouple Telegram webhook ingestion from AI API calls so webhook Workers stay within 10 ms CPU time.[web:1][web:19]
- Provide at‑least‑once delivery with retries (up to 100 retries per message).[web:19]
- Allow up to 5,000 messages/s per queue from a throughput standpoint.[web:19][web:26]

### Cons on Free

- Only 10,000 operations/day, across all queues and all `send`, `receive`, `ack`, and `delete` calls.[web:2][web:10][web:30]
- Retention is limited to 24 hours, not configurable longer on Free.[web:10][web:30]
- Each consumer invocation is also a Worker request that counts against the 100k/day limit.[web:1][web:19]

### Conclusion

Queues are worth using **for low‑volume reliability**: buffering Telegram updates when external AI APIs are slow, or retrying failed agent turns.
They are **not** suitable as the core scheduling backbone for all agent work on Free; instead, they complement Cron and on‑demand Workers.

---

## Designing around the 10 ms CPU limit

### Key patterns

To survive the 10 ms CPU limit, make Workers mostly I/O orchestrators:

- **Keep logic thin:**
  - Parse Telegram updates, validate, and push minimal job records to D1 or Queues.
  - Offload heavy reasoning to external AI APIs.
- **Avoid big JSON manipulation in Workers:**
  - Store prompts and responses largely as opaque text blobs in D1.
  - Let the AI do summarization and analysis rather than Worker code.
- **Leverage async I/O:**
  - Use `await fetch()` for AI calls and `env.DB.prepare()` for D1; time spent waiting on network or database I/O does not count as CPU time, only JavaScript execution does.[web:1][web:16][web:19]
- **Limit per‑request fan‑out:**
  - Never call more than a few external APIs per invocation; Free plan caps you at 50 external subrequests anyway.[web:1][web:8]

### Concrete design tricks

- **Two‑stage agent turns:**
  1. Webhook / trigger Worker records intent and enqueues work (D1 row + Queue message) in under 10 ms of CPU.
  2. A separate Worker (Queue consumer or HTTP endpoint) performs the AI call and writes the result back to D1.
- **Minimize JSON schema transformations:**
  - Represent messages as `{id, chat_id, role, content, metadata_json, created_at}`; avoid heavy in‑Worker restructuring.
- **Use `waitUntil` sparingly:**
  - On Free, `waitUntil` still shares the 10 ms CPU budget; use it to perform a small D1 write after responding to Telegram, not for full AI calls.[web:1]

If your handlers consistently exceed 10 ms of CPU, Cloudflare will terminate them and you will see intermittent failures; monitoring logs and CPU usage charts is essential.[web:1][web:14][web:27]

---

## Scheduling autonomous agents with limited Cron

### Raw constraints

- 5 Cron Triggers per account on Free.[web:1][web:20][web:22]
- 10 ms CPU per scheduled invocation, counting against 100k Worker requests/day.[web:1][web:22]

### Practical scheduling strategy

Use Cron only to drive a **small number of scheduler Workers**, which then store work in D1:

- Trigger 1: `* * * * *` — **minute‑tick scheduler.**
  - Inserts or updates “due jobs” rows in `agent_jobs` based on `next_run_at` in D1.
  - Work per run: 1–3 queries (select subset, mark some jobs as queued), easily under 10 ms CPU.
- Trigger 2: `0 */1 * * *` — **hourly maintenance.**
  - Compacts logs, prunes old agent files, recalculates summaries, etc., with tight query limits.
- Trigger 3: `0 */12 * * *` — **GOD supervisor scheduler.**
  - Writes a row to `agent_jobs` for the supervisory AI run and returns.

Agent execution itself does **not** happen inside Cron handlers; rather, it is run by:

- Queue consumers that pull tasks from a Queue; or
- On‑demand Workers triggered by user interaction; or
- Optionally, a Workflow for long‑running “GOD” jobs if you can afford the limited daily steps.

Within the 5‑Cron limit you still have room for 2 spare triggers (e.g., for ad‑hoc experiments) if needed.

---

## Avoiding architectures that force upgrade to Paid

To stay on Free indefinitely, avoid architectural choices that scale linearly into free‑tier ceilings.

### Anti‑patterns to avoid

- **One Durable Object per user or per conversation:**
  - Quickly pushes DO request and storage counts up and complicates migrations; also DOs are more tightly tied to Workers Paid in some docs.[web:17][web:27][web:54]
- **Per‑message Workflows:**
  - 8–15 agents with multiple steps per turn will exhaust 3,000 steps/day fast.[web:31][web:39][web:41]
- **Fine‑grained Queues:**
  - Using Queues for every micro‑step of agent reasoning quickly eats 10k operations/day.[web:10][web:19][web:30]
- **KV for every message or token:**
  - KV’s 1,000 writes/day free quota will be exceeded quickly if you write per‑message.[web:2][web:5]
- **Browser Rendering as part of core loop:**
  - 10 min/day is far too small for any recurring task.[web:32][web:34][web:35]

### Safe patterns

- Centralize state in a small number of D1 databases (e.g., prod + staging), with tight schemas and efficient indexes.[web:3][web:9]
- Keep all static assets separated from dynamic Worker routes so that most admin/dashboard traffic is “free” static serving.[web:2][web:51][web:55]
- Use a single Queue (or a small handful) and keep a bounded number of operations per agent turn.
- Use Cron only as a metronome feeding job rows into D1, not as the agent execution engine.

---

## Recommended architecture components

### Telegram webhook ingestion

- **Worker `telegram-webhook`** (HTTP handler):
  - Exposed behind a custom HTTPS domain compatible with Telegram’s webhook constraints (or `workers.dev` if acceptable in your region).[web:38][web:43][web:44]
  - Responsibilities per request:
    - Verify method and, optionally, Telegram secret token.
    - Parse update JSON minimally.
    - Insert/update into D1 tables: `conversations`, `messages`, and `pending_jobs` (1–3 writes, batched if possible).
    - Optionally enqueue a message to a single `agent_jobs` Queue for async handling (1 Queue `send` operation).[web:19][web:38]
    - Return `200 OK` quickly.
  - CPU: Simple parsing + 1 D1 write + 1 Queue send is well under 10 ms CPU.
  - External subrequests per invocation: 0 (only internal D1 + Queues).

If you wish to avoid Queues entirely, the webhook can write directly to D1 and a separate Cron‑driven Worker can poll for due jobs.

### Agent scheduler

- **Worker `agent-scheduler`** (Cron‑triggered):
  - Triggered every minute.
  - Reads at most N pending jobs from `pending_jobs` where `run_at <= now()` and `status = 'pending'`.
  - Sets them to `status = 'queued'` and either:
    - Inserts a row into `agent_executions` to be picked up by `agent-runner` via HTTP; or
    - Sends one message per job to the `agent_jobs` Queue.
  - Keeps per‑tick work to a handful of D1 reads/writes to respect 50‑query and 10 ms CPU limits.

### AI API calls and agent turn execution

- **Worker `agent-runner`** (Queue consumer or HTTP endpoint):
  - If using Queues:
    - Bound as a consumer to `agent_jobs`.
    - Each batch (up to 100 messages) pulls job ids, loads job + context from D1, calls external AI APIs, and writes results back.
  - If not using Queues:
    - Exposed as an HTTP endpoint invoked by the scheduler or by user‑initiated flows.
  - Responsibilities:
    - Fetch conversation context window from D1 (read rows for last K messages or pre‑summarised context).
    - Compose prompts for each agent; call external AI APIs via `fetch` (counted against 50 external subrequests per invocation).[web:1][web:8]
    - Insert resulting messages and updated agent state into D1.
    - Optionally schedule follow‑up jobs by writing new rows.
  - To stay within 50 external subrequests, limit each invocation to a small batch of agent turns (e.g., 3–5 agents), or process them sequentially within a single AI call when possible.

### Conversation orchestration & multi‑agent logic

- Represent orchestration mostly in **data** inside D1:
  - `agents` table: agent identity, configuration, system prompts, capabilities.
  - `agent_state` table: pointer to last message per agent per conversation, status, “mood,” etc.
  - `workflows` or `tasks` table: dependences between agents, e.g., GOD supervising subordinate agents.
- Keep Workers responsible for:
  - Loading relevant rows.
  - Feeding them to external AI APIs in a small number of calls.
  - Persisting outputs and scheduling next steps.

This minimizes Worker CPU and subrequest usage while still enabling rich multi‑agent interactions.

### Persistence and agent “files”

- Use D1 as the single source of truth:
  - `messages` table for chat history and thoughts.
  - `agent_files` table for Markdown documents, with columns: `id`, `owner_agent_id`, `conversation_id (optional)`, `title`, `slug`, `content_markdown`, `created_at`, `updated_at`.
- For large Markdown documents, store them in D1 as compressed text blobs (still under 2 MB per row limit), or split into sections.[web:3]
- Avoid R2 or KV to keep architecture simple and fully within known D1 limits.

### Admin dashboard

- Deploy the admin UI as static HTML/JS/CSS:
  - Either via **Cloudflare Pages** (static site) or via Workers static assets on a dedicated Worker.
  - All admin read views should call backend APIs (Workers) for dynamic data; static asset requests remain free and unlimited.[web:2][web:51][web:55]
- Admin API Worker:
  - Protect with authentication (e.g., simple token or IP allowlist) and rate limiting.
  - Read‑only dashboards (metrics, logs, job queues) are mostly D1 reads, which are cheap up to 5M/day.

### GOD supervisory AI (every ~12 hours)

- Implement as a data‑driven job triggered by Cron:
  - Cron Trigger 3: `0 */12 * * *` to schedule a GOD job row in `agent_jobs`.
- Execution path:
  - `agent-runner` recognizes jobs with type `GOD_SUPERVISION`.
  - GOD’s Worker code queries D1 for summarised state of all agents and key conversations (using pre‑computed summaries to minimize reads).
  - Performs several external AI calls in sequence (but keep under 50 subrequests), writes updated global directives and possibly new jobs.

As GOD runs at most 2 times per day, it is unlikely to threaten daily Workers or D1 limits unless each run fans out excessively.

### Background / retry work

- Use Queues sparingly for retries:
  - On temporary AI API failure or transient D1 error, push a retry job to `retry_jobs` Queue with exponential backoff encoded in message metadata.
  - Consumer Worker reattempts within the allowed 24‑hour retention window.
- If you prefer not to depend on Queues at all:
  - Implement a `retries` table in D1 and a Cron‑driven Worker that periodically scans for jobs with `status='retry'` and `next_attempt_at <= now()`.

Both patterns keep CPU usage low and avoid hitting 10k Queue operations/day prematurely.

---

## Free‑tier bottlenecks for 8–15 agents

Assume the following baseline usage model for estimates:

- 8–15 agents, each with 50–200 turns/day depending on user activity and scheduled thinking.
- Each user message triggers:
  - 1 Telegram webhook Worker invocation.
  - 1–3 D1 writes (message + job + state update).
  - 1 agent‑runner invocation with 1 external AI call and 5–20 D1 reads.

### Likely first bottlenecks

1. **Worker requests/day (100k)**
   - Every webhook, agent‑runner execution, Cron tick, and Queue consumer counts toward the 100k/day limit.[web:1][web:2][web:39]
   - With 8–15 agents and modest traffic, this is usually the first hard ceiling.
2. **D1 writes/day (100k)**
   - Conversation logs and agent state updates consume writes quickly; each agent turn can easily cost 3–5 writes.
3. **Queues operations/day (10k)**
   - If you use Queues for every agent turn, the 10k ops/day limit will be consumed quickly.[web:10][web:19][web:30]
4. **Workflows steps/day (3k)** if you choose to use Workflows for orchestration.

### Approximate safe operating envelope

Let’s derive a conservative envelope assuming:

- Worker request budget: 80,000/day reserved for LUMA ADHD (leave 20k headroom for spikes, Cron, admin, etc.).
- D1 budgets: 4M reads/day and 80k writes/day reserved (leave headroom below 5M/100k limits).[web:9]
- Queues: 5,000 operations/day reserved for core tasks.

Assume per **agent turn** (one incoming message + one agent response):

- Workers:
  - 1 webhook invocation.
  - 1 agent‑runner invocation.
  - 0.1 share of scheduler or other background invocations (averaged across day).
  - ≈ 2.1 Worker invocations per turn.
- D1:
  - Writes: message in, agent log, state update = 3 writes.
  - Reads: conversation slice, agent config, etc. ≈ 20 reads.
- Queues (if used): 1 send + 1 receive+ack ≈ 2 operations.

From these we get rough ceilings:

- Worker‑limited turns/day ≈ 80,000 / 2.1 ≈ **38,000 agent turns/day**.
- D1 write‑limited turns/day ≈ 80,000 / 3 ≈ **26,000 turns/day**.
- D1 read‑limited turns/day ≈ 4,000,000 / 20 ≈ **200,000 turns/day**, so writes constrain long before reads.
- Queues‑limited turns/day ≈ 5,000 / 2 ≈ **2,500 turns/day** if every turn uses Queue send + receive.

Thus, if you rely heavily on Queues for every agent turn, Queues becomes the first bottleneck (around 2.5k turns/day).
If you only use Queues for a subset of turns (e.g., scheduled tasks and retries) and let user‑initiated turns flow directly via Workers + D1, you can scale closer to 20–25k turns/day before hitting D1 writes.

For 8–15 agents, that translates roughly to:

- **Per‑agent turns/day** safely supported:
  - With Queues for all turns: ≈ 150–300 turns/day across the entire system.
  - With Queues only for some tasks and direct Worker + D1 for most turns: ≈ 1,000–3,000 turns/day system‑wide.

These are conservative; real numbers depend heavily on how many writes you batch per turn and how often agents think autonomously versus user‑driven.

---

## Recommended Cloudflare architecture for LUMA ADHD (Free plan)

### Summary of services to use

- **Workers / Pages Functions**: Core HTTP entrypoints (Telegram webhook, admin API, agent runner, scheduler).[web:1][web:2][web:11]
- **D1**: Primary database for all structured data (users, conversations, messages, jobs, agent configs, agent files).[web:3][web:9]
- **Queues**: Single or very small number of queues for async job execution and retries.
- **Cron Triggers**: 3–5 Cron entries for minute tick, hourly maintenance, and GOD scheduling.[web:1][web:20][web:22]
- **Workers Static Assets / Pages**: Static admin dashboard assets.

### Services to avoid or keep as optional

- **Durable Objects**: Not required; only introduce if you later need strong per‑user locking or WebSockets.
- **Workflows**: Optional for long‑running GOD experiments but not for routine agent turns.
- **KV**: Optional for config only.
- **Browser Rendering, Workers AI, R2**: Not needed for MVP and risk coupling you to additional quotas.[web:13][web:32][web:34][web:54]

### Free‑tier risk matrix

| Resource / Limit | Risk level for LUMA ADHD | Why |
| --- | --- | --- |
| Workers 100k req/day | High | Every webhook, agent run, Cron, and admin call consumes this; easy to hit with growth.[web:1][web:2] |
| 10 ms CPU / invocation | Medium‑high | Requires disciplined handler design; heavy orchestration will timeout.[web:1][web:14] |
| 50 external subrequests/invocation | Medium | Limits multi‑agent fan‑out; must batch AI calls.[web:1][web:8] |
| D1 100k writes/day | High | Chat logs + state + jobs quickly accumulate writes.[web:3][web:9][web:14] |
| D1 5M reads/day | Medium | More generous; reads mostly fine if queries are efficient.[web:3][web:9] |
| D1 5 GB storage | Medium | Sufficient for many text conversations; watch agent files and logs.[web:3][web:9][web:14] |
| Queues 10k ops/day | High (if used heavily) | Core queue‑based architecture would quickly hit this; use sparingly.[web:10][web:19][web:30] |
| Cron 5 triggers/account | Low‑medium | Enough for few schedulers but no more.
| Workflows 3k steps/day | Medium | Fine for occasional GOD experiments; not for per‑turn orchestration.[web:31][web:39][web:41] |
| KV 1k writes/day | Low (if avoided) | Do not use KV for chat data; use D1 instead.[web:2][web:5] |
| Browser Rendering 10 min/day | Low (if avoided) | Not part of the design.[web:32][web:34][web:35] |

### Suggested operating limits for LUMA ADHD (Free plan)

To stay comfortably within free‑tier quotas:

- **Worker invocations:** Target ≤ 60,000/day average, leave 40,000/day headroom.
- **D1 writes:** Target ≤ 60,000/day; design schemas to minimize writes per turn (e.g., summarise old history, batch state updates).
- **D1 reads:** Target ≤ 3,000,000/day.
- **Queues operations:** Target ≤ 5,000/day if Queues are used, keeping them for retries and scheduled tasks.
- **Agent turns/day:**
  - Design for **1,000–3,000 turns/day** across all agents as the “safe” free‑tier envelope.
  - Beyond ~5,000 turns/day, plan for either tighter batching and summarisation or upgrading to Workers Paid.
- **Agent count:**
  - 8–15 agents is fine so long as you cap autonomous thinking; avoid letting every agent think every minute.
- **GOD supervisor:**
  - Run at most twice per day, with a hard cap of a few dozen external AI calls per run.

If you approach any of these usage envelopes for sustained periods, you should expect to hit free‑tier ceilings and should plan migration paths (e.g., Workers Paid, sharding across multiple free accounts where permissible by Cloudflare’s ToS).

---

## Key source URLs

- Workers limits: https://developers.cloudflare.com/workers/platform/limits/[web:1]
- Workers pricing & KV free tier: https://developers.cloudflare.com/workers/platform/pricing/[web:2]
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/[web:3]
- D1 pricing & free tier: https://developers.cloudflare.com/d1/platform/pricing/[web:9]
- D1 enforcement announcement: https://developers.cloudflare.com/d1/platform/release-notes/[web:12]
- Workers KV limits: https://developers.cloudflare.com/kv/platform/limits/[web:5]
- Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/[web:16]
- Durable Objects pricing & free tier: https://developers.cloudflare.com/durable-objects/platform/pricing/[web:17]
- Durable Objects best practices: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/[web:18]
- Durable Objects changelog: https://developers.cloudflare.com/changelog/product/durable-objects/[web:27]
- Queues limits: https://developers.cloudflare.com/queues/platform/limits/[web:19]
- Queues free‑tier announcement: https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/[web:10]
- Workflows pricing and limits: https://developers.cloudflare.com/workflows/reference/pricing/[web:31] and https://developers.cloudflare.com/workflows/reference/limits/[web:39]
- Browser Rendering limits: https://developers.cloudflare.com/browser-rendering/llms-full.txt and pricing announcement https://developers.cloudflare.com/changelog/post/2025-07-28-br-pricing/[web:34][web:35]
- Workers static assets limits & billing: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/[web:55]
- Pages limits (static assets): https://developers.cloudflare.com/pages/platform/limits/[web:51]
- Cron Triggers guide & limits: https://cronuru.com/guides/cloudflare-workers-cron-triggers and official docs links therein.[web:20][web:21][web:22]
- Telegram bots on Workers (reference implementations): https://dev.to/kevinc/create-and-deploy-your-telegram-bot-here-entirely-free-4cgc and https://github.com/EAimTY/telegram-bot-on-worker and https://seanbehan.ca/posts/cf-workers-telegram-bot[web:38][web:43][web:44]
