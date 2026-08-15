# D1 migrations

Phase 00 creates only the foundation metadata table. Phase 01 adds the durable domain schema for agents, messages, threads, files, jobs, evaluations, and governance records. Phase 02 adds the normalized child records needed when one canonical message is projected into multiple Telegram messages.

Apply locally with:

```bash
npm run migrations:local
```

The production `database_id` in `wrangler.jsonc` is a safe identifier placeholder. Replace it only after the real D1 database is created; it is not a secret.
