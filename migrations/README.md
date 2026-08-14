# D1 migrations

Phase 00 creates only the foundation metadata table. Phase 01 owns the domain schema for agents, messages, threads, files, and jobs.

Apply locally with:

```bash
npm run migrations:local
```

The production `database_id` in `wrangler.jsonc` is a safe identifier placeholder. Replace it only after the real D1 database is created; it is not a secret.
