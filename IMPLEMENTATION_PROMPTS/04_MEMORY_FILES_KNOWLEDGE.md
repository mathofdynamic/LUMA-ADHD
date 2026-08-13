# Phase 04 — Memory, Files, and Knowledge

Implement LUMA ADHD’s text-first institutional memory using D1 only.

Create database-backed Markdown workspaces for agents and shared material. Support create, read, edit, search, reference/share, version history, and reversible deletion. Store logical path, owner, tags, related thread, revision lineage, and timestamps. The folder structure is logical; do not create a server filesystem dependency.

Use D1 FTS5 for v1 search across documents, knowledge chunks, and useful thread content. Retrieval should combine text relevance with tags/domain, recency, thread relationship, and ownership. Put search behind an interface so semantic retrieval can be added later without redesigning the agent runtime.

Maintain bounded memory layers:

- recent thread messages;
- thread/phase summaries;
- decision records;
- concise agent-specific memory notes;
- shared institutional memory;
- relevant files and LUMA knowledge chunks.

Preserve raw history, but use summaries/retrieval instead of loading full transcripts into every model call. Do not store hidden chain-of-thought.

Cache the official LUMA Markdown sources listed in `PROJECT_OVERVIEW_EN.md` into D1. Store source URL, title, update/hash metadata, normalized content, headings, and chunks. Refresh incrementally and avoid rewriting unchanged sources. Split synchronization into bounded jobs rather than processing the entire knowledge base in one Worker invocation.

When company documentation conflicts with model memory, retrieval/prompt construction should treat the documented LUMA source as authoritative and preserve source provenance for inspection.

Use local tests for document revisions, restore behavior, FTS search, retrieval filters, source-change detection, chunking, and summary compaction.

## Acceptance

Agents can persist and find Markdown work, old revisions remain recoverable, FTS search works, LUMA knowledge can be incrementally cached, and the runtime can build a small relevant context pack without R2 or another database.