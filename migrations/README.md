# D1 migrations

Phase 00 creates only the foundation metadata table. Phase 01 adds the durable domain schema for agents, messages, threads, files, jobs, evaluations, and governance records. Phase 02 adds the normalized child records needed when one canonical message is projected into multiple Telegram messages. Phase 04 adds D1-backed logical Markdown workspaces, immutable document history, bounded thread summaries, official knowledge-source caching, and FTS5 retrieval. Later migrations add reputation/GOD, the private Admin Observatory, human-task/diagram observability, hardening state, bounded cross-job Agent opportunity indexes, and the replaceable LUMA Knowledge v2 cache/FTS tables. Knowledge v2 does not make D1 authoritative for LUMA records.

Apply locally with:

```bash
npm run migrations:local
```

The production `database_id` in `wrangler.jsonc` is a safe identifier placeholder. Replace it only after the real D1 database is created; it is not a secret.
