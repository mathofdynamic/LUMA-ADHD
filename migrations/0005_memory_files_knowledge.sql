-- Phase 04: D1-backed Markdown workspaces, bounded memory, and FTS5 retrieval.
-- Persistent files are logical database paths. No server filesystem is required.
PRAGMA foreign_keys = ON;

ALTER TABLE documents ADD COLUMN logical_path TEXT;
ALTER TABLE documents ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json));
ALTER TABLE document_versions ADD COLUMN parent_version_id TEXT;

ALTER TABLE knowledge_sources ADD COLUMN normalized_content TEXT;
ALTER TABLE knowledge_sources ADD COLUMN content_hash TEXT;
ALTER TABLE knowledge_sources ADD COLUMN etag TEXT;
ALTER TABLE knowledge_sources ADD COLUMN last_modified TEXT;
ALTER TABLE knowledge_sources ADD COLUMN last_attempted_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN last_successful_fetch_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN next_refresh_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN error_summary TEXT;
ALTER TABLE knowledge_sources ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0 CHECK (content_version >= 0);

ALTER TABLE knowledge_chunks ADD COLUMN heading TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN heading_path TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN content_hash TEXT;
ALTER TABLE memory_notes ADD COLUMN idempotency_key TEXT;

-- Phase 01 documents predate logical paths. Preserve them under a deterministic
-- legacy namespace before enforcing uniqueness for all new active documents.
UPDATE documents
SET logical_path = '/legacy/' || id || '.md'
WHERE logical_path IS NULL;

CREATE TABLE IF NOT EXISTS document_shares (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  granted_by_agent_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (granted_by_agent_id) REFERENCES agents(id),
  UNIQUE (document_id, agent_id)
);

CREATE TABLE IF NOT EXISTS document_references (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  thread_id TEXT,
  message_id TEXT,
  referenced_by_agent_id TEXT,
  relation TEXT NOT NULL DEFAULT 'reference',
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (referenced_by_agent_id) REFERENCES agents(id),
  CHECK (thread_id IS NOT NULL OR message_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS thread_summaries (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  phase_key TEXT NOT NULL DEFAULT 'overall',
  summary_markdown TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_message_id TEXT,
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (last_message_id) REFERENCES messages(id),
  UNIQUE (thread_id, phase_key)
);

CREATE TABLE IF NOT EXISTS thread_summary_versions (
  id TEXT PRIMARY KEY NOT NULL,
  summary_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  summary_markdown TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_message_id TEXT,
  provider_name TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (summary_id) REFERENCES thread_summaries(id),
  FOREIGN KEY (last_message_id) REFERENCES messages(id),
  UNIQUE (summary_id, version_number)
);

ALTER TABLE thread_summary_versions ADD COLUMN idempotency_key TEXT;

CREATE VIRTUAL TABLE IF NOT EXISTS institutional_memory_fts USING fts5(
  source_kind UNINDEXED,
  source_id UNINDEXED,
  title,
  path_or_url UNINDEXED,
  content_text,
  tags_text,
  authority UNINDEXED,
  updated_at UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 0'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_active_logical_path
  ON documents (logical_path)
  WHERE deleted_at IS NULL AND logical_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_path_lookup
  ON documents (logical_path, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_tags
  ON documents (scope, owner_agent_id, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_versions_parent
  ON document_versions (document_id, parent_version_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_document_shares_agent
  ON document_shares (agent_id, revoked_at, document_id);
CREATE INDEX IF NOT EXISTS idx_document_shares_document
  ON document_shares (document_id, revoked_at, agent_id);
CREATE INDEX IF NOT EXISTS idx_document_references_thread
  ON document_references (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_references_document
  ON document_references (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_summaries_thread
  ON thread_summaries (thread_id, phase_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_summary_versions_summary
  ON thread_summary_versions (summary_id, version_number DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_summary_versions_idempotency
  ON thread_summary_versions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_refresh
  ON knowledge_sources (status, next_refresh_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source_hash
  ON knowledge_chunks (source_id, content_hash, ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_notes_idempotency
  ON memory_notes (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Backfill useful historical messages into the unified retrieval index. Private
-- messages are deliberately excluded from institutional search.
INSERT INTO institutional_memory_fts (
  source_kind, source_id, title, path_or_url, content_text, tags_text, authority, updated_at
)
SELECT
  'message',
  id,
  CASE author_type
    WHEN 'agent' THEN COALESCE(telegram_bot_alias, author_agent_id, 'agent')
    WHEN 'human' THEN 'human message'
    ELSE 'system message'
  END,
  NULL,
  content_text,
  '',
  CASE author_type WHEN 'system' THEN 20 ELSE 40 END,
  created_at
FROM messages
WHERE deleted_at IS NULL AND visibility <> 'private';

INSERT INTO institutional_memory_fts (
  source_kind, source_id, title, path_or_url, content_text, tags_text, authority, updated_at
)
SELECT
  'memory_note', id, title, NULL, content_text, scope,
  CASE scope WHEN 'organization' THEN 75 ELSE 55 END, updated_at
FROM memory_notes
WHERE deleted_at IS NULL;

INSERT INTO institutional_memory_fts (
  source_kind, source_id, title, path_or_url, content_text, tags_text, authority, updated_at
)
SELECT
  'decision', id, title, NULL, decision_text || char(10) || COALESCE(rationale, ''), status, 85, updated_at
FROM decision_records;

CREATE TRIGGER IF NOT EXISTS messages_memory_fts_ai
AFTER INSERT ON messages
WHEN new.deleted_at IS NULL AND new.visibility <> 'private'
BEGIN
  INSERT INTO institutional_memory_fts (
    source_kind, source_id, title, path_or_url, content_text, tags_text, authority, updated_at
  ) VALUES (
    'message',
    new.id,
    CASE new.author_type
      WHEN 'agent' THEN COALESCE(new.telegram_bot_alias, new.author_agent_id, 'agent')
      WHEN 'human' THEN 'human message'
      ELSE 'system message'
    END,
    NULL,
    new.content_text,
    '',
    CASE new.author_type WHEN 'system' THEN 20 ELSE 40 END,
    new.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS messages_memory_fts_au
AFTER UPDATE OF content_text, visibility, deleted_at ON messages
BEGIN
  DELETE FROM institutional_memory_fts
  WHERE source_kind = 'message' AND source_id = old.id;
  INSERT INTO institutional_memory_fts (
    source_kind, source_id, title, path_or_url, content_text, tags_text, authority, updated_at
  )
  SELECT
    'message',
    new.id,
    CASE new.author_type
      WHEN 'agent' THEN COALESCE(new.telegram_bot_alias, new.author_agent_id, 'agent')
      WHEN 'human' THEN 'human message'
      ELSE 'system message'
    END,
    NULL,
    new.content_text,
    '',
    CASE new.author_type WHEN 'system' THEN 20 ELSE 40 END,
    new.created_at
  WHERE new.deleted_at IS NULL AND new.visibility <> 'private';
END;

CREATE TRIGGER IF NOT EXISTS messages_memory_fts_ad
AFTER DELETE ON messages
BEGIN
  DELETE FROM institutional_memory_fts
  WHERE source_kind = 'message' AND source_id = old.id;
END;
