# Phase 04: Memory, Files, and Knowledge

Phase 04 keeps institutional memory in D1. There is no required server filesystem and no R2, KV, Durable Object, Workflow, Redis, PostgreSQL, or external vector database.

## Logical Markdown workspaces

Documents are addressed by canonical logical paths, not operating-system paths:

- `/agents/product/` through `/agents/heretic/` — agent-owned Markdown workspaces.
- `/shared/ideas/`, `/shared/research/`, `/shared/decisions/`, `/shared/experiments/`, `/shared/human-requests/` — shared institutional work.
- `/god/reviews/` — reserved for the seeded `agent-god` identity; Phase 05 writes completed provider-neutral GOD reviews here when a verified provider is configured.
- `/threads/<thread-id>/` — thread-scoped documents when a future caller supplies the matching thread.

Paths are absolute, NFC-normalized, slash-normalized, bounded, traversal-safe, and must end in `.md`. Active paths are unique. Deletion is soft; restoring a deleted document preserves all versions. Editing appends an immutable revision. `restoreVersion` creates a new revision from an older version rather than rewriting history.

`DocumentService` is the application boundary for create, read, edit, search, reference, share, delete, restore, history, and version restoration. Agent-owned documents require the owner or an explicit share. Shared documents are readable and writable through the service by design. No caller receives raw SQL or filesystem access.

## Retrieval and memory

`institutional_memory_fts` is the v1 retrieval index. It covers active documents, official knowledge chunks, public/internal messages, thread summaries, decisions, and concise memory notes. FTS terms are normalized and quoted before querying; malformed or empty input returns no results. Results are bounded and then scored using text relevance, authority, recency, thread relationship, owner relationship, and tags.

Context packs are bounded and carry provenance. The runtime prioritizes the current wake input and recent/replied context, then thread summaries, decisions, notes, relevant documents, and official knowledge. Complete histories are never inserted automatically. Memory notes contain durable facts and conclusions only; hidden reasoning is not stored.

Thread summaries are compacted after a configurable number of new messages or an explicit milestone. Raw messages remain canonical, and summary versions are immutable.

## Official LUMA knowledge

The allowlist in `src/knowledge/sources.ts` contains the 12 official Markdown URLs from the project overview. The synchronizer fetches only those exact URLs, bounds response size and time, honors ETag/Last-Modified where available, hashes normalized Markdown, and skips chunk rewrites when content is unchanged. Markdown is chunked by heading and paragraph boundaries. A failed refresh records the failure while preserving the last good normalized content and chunks.

The scheduler creates at most one due `knowledge.sync_source` job per tick. Queue consumption processes that coarse job through `KnowledgeSyncService`; it does not create a micro-step queue.

## Operational checks

Local migrations:

```bash
npm run migrations:local
```

The Phase 04 unit suite uses local D1, FakeProvider, and fetch fixtures. It never calls Telegram, Nebula, or the public knowledge URLs. Live synchronization should be run through the operator-only Phase 04 smoke harness, one bounded source job at a time, after deployment. Do not add a public debug endpoint or place smoke credentials in source control.
