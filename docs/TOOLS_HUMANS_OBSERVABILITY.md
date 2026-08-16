# Phase 07: human work, diagrams, and observability

Phase 07 extends the existing D1, Queue, Telegram, Agent runtime, and Admin Observatory services. It does not add a second task system, persistent filesystem, binary store, or rendering endpoint.

## Human Tasks

`REQUEST_HUMAN` creates a durable `human_tasks` record with the requesting Agent, thread, concrete request, reason, priority, blocking flag, request key, response provenance, and wake-job linkage. The runtime should search official knowledge, memory, and accessible files before escalating. A request must explain what is needed, why it is needed, and whether the work is blocked.

Blocking tasks may move their thread to `human_required`. Non-blocking tasks do not. When the owner responds from Telegram, the gateway resolves the task through the same `HumanTaskService` used by the Admin Observatory. The reply is mapped through the canonical outbound/request message metadata; visible text matching is not used. A resolved blocking task creates one idempotent `human_task.wake` job. The thread is reopened only when no other blocking task remains.

The requesting Agent's persona projects the task to Telegram. Gateway is the fallback transport when that persona is unavailable. Persona bots remain outbound-only and the gateway remains the only ingress. Admin responses use the same resolution service and wake semantics.

## Diagrams

`DRAW` accepts a bounded typed `DiagramSpec` with one of `architecture`, `flow`, `process`, `comparison`, or `decision_tree`. D1 stores the validated spec, self-contained trusted HTML/CSS source, artifact metadata, and immutable revisions. Labels are escaped into a controlled template. The renderer emits no scripts, event handlers, external resources, remote fonts, arbitrary URLs, iframes, or executable SVG.

The source is canonical. Rendered images and Telegram media are projections only. The default Phase 07 renderer is source-only and records `unavailable` without failing the Agent turn. An optional `DiagramRenderer` can later produce media without changing the artifact model; it must be bounded and must not persist image bytes in D1. Admin previews use a sandboxed iframe with the trusted source.

## Observability and recovery

The Admin System page exposes bounded jobs, leases, Agent WAIT/SPEAK outcomes, provider usage, Telegram delivery, knowledge sync, artifacts, human-task state, errors, and audit data. WAIT is internal activity, not a Telegram failure. Application-observed activity is distinct from Cloudflare platform quota; exact platform usage is not fabricated.

Recoverable job types are explicitly allowlisted. Retry preserves the original idempotency key and is refused for unsupported work. A claimed job may be manually recovered only after its lease expires. Active leases are refused. Every manual retry or stale-lease recovery is authenticated, CSRF-protected, and audited.

Operational categories include provider failures, Telegram delivery/rate limits, knowledge fetches, runtime validation, human-task mapping, diagram renderer availability/quota/failure, and expired leases. Source-only diagrams and empty queues are normal states, not incidents.

## Operator smoke paths

The authenticated `POST /api/admin/human-tasks/phase07-smoke` route creates at most one dedicated live human-task smoke request, projects it through the customer persona, and relies on the direct Telegram reply to test resolution and wake-up. It is not public and does not accept arbitrary task content.

The authenticated `POST /api/admin/artifacts/phase07-smoke` route creates at most one architecture smoke artifact through `DiagramService`, stores its validated spec and first immutable revision, and performs one bounded render attempt. Without an optional Browser Rendering binding, the expected result is a durable source-only artifact. Replay returns the existing artifact.

The Admin Observatory provides artifact inspection and bounded source-only render retry. It does not expose arbitrary job payload editing or arbitrary HTML/JavaScript execution.
