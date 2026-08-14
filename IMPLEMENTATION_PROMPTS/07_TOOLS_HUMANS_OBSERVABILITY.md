# Phase 07 — Human Tasks, Diagrams, and Observability

Implement the remaining system tools without adding paid storage.

## Human tasks

`REQUEST_HUMAN` must create a first-class durable task, not only a chat mention. Store request, reason, requesting agent, related thread, priority, blocking/non-blocking state, target human when configured, status, response, and timestamps.

Project the request into the private Telegram workspace. When a human resolves a blocking task, persist the response and create a bounded wake-up job for the related thread so agents can continue with the new information.

The system may ask humans for research, private company information, approval, external action, analytics, or experiments, but should explain exactly why the information/action is needed.

## Diagram tool without R2

Store diagram source as sanitized HTML/CSS text in D1. Keep generated diagrams simple and explanatory: architectures, flows, comparisons, decision trees, and process diagrams.

If Cloudflare Browser Rendering is configured and quota is available, render the source to an image and send it to the configured private Telegram workspace. Store the Telegram media identifiers plus the canonical source/metadata in D1. Do not add R2.

If rendering is unavailable or quota is exhausted, preserve the source and degrade gracefully rather than failing the entire agent turn.

Treat generated HTML as untrusted content: keep the diagram template constrained and prevent arbitrary external resource loading or script execution.

## Observability

Make the System admin area useful for operations. Record and expose:

- scheduled/running/completed/failed jobs;
- agent-turn outcomes including WAIT;
- provider latency/usage when available;
- Telegram delivery results;
- scheduler/GOD execution history;
- file mutations;
- human-task lifecycle;
- reputation changes;
- important thread transitions;
- admin changes;
- approximate Worker/D1/Queue budget pressure.

Never expose model/provider credentials in logs or UI.

Add clear retry/recovery operations for failed coarse jobs and stale work, with idempotency preserved.

## Tests and acceptance

Test human-task creation/resolution/thread wake-up, diagram source validation and graceful fallback, artifact metadata, event/audit records, retry behavior, and quota-warning calculations.

The phase is complete when the system can cleanly ask humans for missing work, produce optional diagrams without R2, recover from ordinary failures, and expose enough state for an operator to diagnose problems from the admin panel.