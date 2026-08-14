import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside per-test-file storage isolation. The helper records
// applied migration names, so repeated setup execution is safe.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
