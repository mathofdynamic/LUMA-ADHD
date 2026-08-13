# Phase 01 — D1 Data Model and Core Runtime

Read all prior phase files and research first. Build the persistent core before adding Telegram or real models.

## Data model

Create explicit D1 migrations and typed repositories for the minimum durable entities:

- `agents` and agent/domain configuration
- `users` and `chats`
- `threads` with lifecycle state, priority, budgets, summary, timestamps
- `messages` with human/agent/system author type, reply relationship, visibility, Telegram mapping fields
- `thread_participants`
- `scheduled_jobs` and `job_runs`
- `agent_turns`
- `events` / audit history
- `human_tasks`
- `documents` and `document_versions`
- `knowledge_sources` and `knowledge_chunks`
- `memory_notes` and `decision_records`
- `evaluations`, `peer_feedback`, `reputation_events`, `reputation_snapshots`
- `god_reviews` and `god_directives`
- `provider_usage`
- `telegram_outbound`
- diagram/artifact metadata

Keep the schema normalized enough to query efficiently but do not create speculative complexity. Use indexes for due jobs, active threads, chronological messages, author/agent lookups, Telegram IDs, human-task status, and document ownership.

All destructive user-facing deletes for institutional content should be soft deletes or versioned unless there is a strong operational reason otherwise.

## Thread model

Support these explicit states:

`open`, `exploring`, `debating`, `evidence_gathering`, `developing`, `synthesizing`, `human_required`, `blocked`, `decided`, `rejected`, `parked`, `reopened`.

Implement a small transition service that validates allowed transitions and records every transition as an event. Store per-thread turn/phase budgets so loops can be bounded later.

## Jobs

Implement a durable job repository with job type, payload, status, due time, attempt count, chain depth, lease/claim metadata, error summary, and idempotency key. A job is a coarse unit of work, never a reasoning micro-step.

Provide safe claim/complete/fail/reschedule operations and stale-job recovery. Queue payloads should normally contain a job ID plus minimal routing metadata; D1 remains canonical.

## Core services

Implement repositories/services with dependency injection so tests can use local D1 and fake external adapters. Add stable error types and schema validation for JSON metadata.

Seed the initial ordinary agent roster from project overview as editable records, all beginning at display Rank 10. Do not yet implement their final prompts.

## Tests

Cover migrations, repository CRUD, thread transitions, message ordering/replies, job idempotency and stale recovery, soft deletion/versioning, and seed behavior.

## Acceptance

A fresh local D1 database can migrate and seed deterministically; core repositories and state transitions are tested; jobs are recoverable/idempotent; no external Telegram or LLM call is required.