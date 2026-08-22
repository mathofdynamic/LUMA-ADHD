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

`institutional_memory_fts` is the bounded retrieval index. It covers active documents, legacy official knowledge chunks, Knowledge v2 items/document chunks, public/internal messages, thread summaries, decisions, and concise memory notes. FTS terms are normalized and quoted before querying; malformed or empty input returns no results. Results are bounded and then scored using text relevance, authority, recency, thread relationship, owner relationship, visibility, and tags.

Context packs are bounded and carry provenance. Normal-agent retrieval is automatic before every meaningful turn and uses query-aware source budgeting: official LUMA knowledge receives a reserved high-priority budget for factual product/company questions, while thread summaries and recent/replied context receive more weight for discussion continuation. Complete histories are never inserted automatically. Memory notes contain durable facts and conclusions only; hidden reasoning is not stored.

Every normal Agent has a persistent RAG worker boundary. The prompt identifies its private `/agents/<slug>/` workspace, `/shared/`, and explicitly shared files without injecting a full file inventory. If automatic retrieval is insufficient, the Agent may request at most three provider-neutral acquisition steps (`SEARCH_MEMORY`, `SEARCH_DOCUMENTS`, `READ_DOCUMENT`, `READ_DOCUMENT_VERSION`, or `LIST_RELEVANT_FILES`) before returning a final action. File mutations and references use validated application operations only: create, read, edit, search, delete, restore, history, version read, reference, share, and bounded list. Soft deletion and immutable revisions preserve institutional history.

Official LUMA facts are marked as authoritative in the prompt. Agents may recommend changing an official policy, but must distinguish the current documented fact from a proposal or opinion. Retrieval telemetry records bounded source counts, official/document/shared coverage, characters, truncation, and acquisition count without persisting full private bodies or hidden reasoning.

Thread summaries are compacted after a configurable number of new messages or an explicit milestone. Raw messages remain canonical, and summary versions are immutable.

## Official LUMA knowledge

The primary integration is `LumaKnowledgeClient` against `https://luma-knowledge.pages.dev/api/v1`. `knowledge_v2_items`, `knowledge_v2_chunks`, and `knowledge_v2_sync_state` form a replaceable derived cache/index for paginated items, documents, people, entities, media metadata, provenance, visibility, hashes, and freshness. The service token is server-side and management-scoped; only PUBLIC, INTERNAL, and MANAGEMENT records are cached. The API remains authoritative.

The first v2 sync performs a bounded full reconciliation. Later jobs use the updated-at `/changes` snapshot, with periodic full reconciliation for catalog drift. A failed refresh records the error and preserves last-good cache entries. Local FTS is used first; live search is reserved for relevant cache misses or materially current/visual questions. The existing twelve-source allowlist remains a narrow compatibility fallback and is not scheduled as a second equal universe when v2 is configured.

The v2 cache retains epistemic type, authority, status, updated/review timestamps, visibility, and source API paths. Current operational records and decisions outrank stale proposals, hypotheses, research, and historical records for current-state questions. Media is metadata-only in D1; image bytes are fetched through the authenticated Knowledge content endpoint, validated, delivered ephemerally to Luna, and discarded.

The scheduler creates at most one due `knowledge.sync_source` job per tick. Queue consumption processes that coarse job through `KnowledgeSyncService`; it does not create a micro-step queue.

## Operational checks

Local migrations:

```bash
npm run migrations:local
```

The Phase 04 unit suite uses local D1, FakeProvider, and fetch fixtures. It never calls Telegram, Nebula, or the public knowledge URLs. Live synchronization should be run through the operator-only Phase 04 smoke harness, one bounded source job at a time, after deployment. Do not add a public debug endpoint or place smoke credentials in source control.
