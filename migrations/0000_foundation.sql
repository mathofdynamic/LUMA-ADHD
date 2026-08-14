-- Phase 00: deployment/schema marker only.
-- Domain tables belong to Phase 01.
CREATE TABLE IF NOT EXISTS foundation_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO foundation_meta (key, value)
VALUES ('phase', '00-foundation');
