-- Post-v1 Iteration 4: bounded derived cache for the authoritative LUMA Knowledge v2 API.
-- The API remains canonical. These tables are a replaceable local retrieval cache.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS knowledge_v2_items (
  cache_key TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT,
  item_type TEXT,
  visibility TEXT NOT NULL DEFAULT 'UNKNOWN',
  language TEXT,
  status TEXT,
  authority TEXT,
  owner TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  content_text TEXT,
  structured_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(structured_json)),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  source_api_url TEXT,
  source_url TEXT,
  updated_at TEXT,
  created_at TEXT,
  review_after TEXT,
  content_hash TEXT,
  version_marker TEXT,
  last_synced_at TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
  deleted_at TEXT,
  UNIQUE (kind, item_id)
);

CREATE TABLE IF NOT EXISTS knowledge_v2_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  item_cache_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  heading TEXT,
  content_text TEXT NOT NULL,
  content_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_cache_key) REFERENCES knowledge_v2_items(cache_key) ON DELETE CASCADE,
  UNIQUE (item_cache_key, ordinal)
);

CREATE TABLE IF NOT EXISTS knowledge_v2_sync_state (
  state_key TEXT PRIMARY KEY NOT NULL,
  last_attempted_at TEXT,
  last_successful_at TEXT,
  last_full_sync_at TEXT,
  last_incremental_sync_at TEXT,
  changes_cursor TEXT,
  last_mode TEXT,
  manifest_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(manifest_json)),
  counts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts_json)),
  api_calls INTEGER NOT NULL DEFAULT 0 CHECK (api_calls >= 0),
  records_changed INTEGER NOT NULL DEFAULT 0 CHECK (records_changed >= 0),
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_v2_items_visibility_updated
  ON knowledge_v2_items (visibility, stale, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_v2_items_kind_updated
  ON knowledge_v2_items (kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_v2_items_item_id
  ON knowledge_v2_items (item_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_v2_chunks_item_ordinal
  ON knowledge_v2_chunks (item_cache_key, ordinal);
