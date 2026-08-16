-- Phase 06: private Admin Observatory sessions, safe settings, and audit linkage.
-- Authentication secrets are runtime-only. This migration stores only hashes,
-- fingerprints, bounded attempt state, and operator audit metadata.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  secret_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
);

CREATE TABLE IF NOT EXISTS admin_login_buckets (
  identity_hash TEXT PRIMARY KEY NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  first_failed_at TEXT NOT NULL,
  cooldown_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_by_session_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by_session_id) REFERENCES admin_sessions(id)
);

ALTER TABLE audit_log ADD COLUMN admin_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_sessions_active
  ON admin_sessions (token_hash, expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
  ON admin_sessions (expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_admin_login_buckets_cooldown
  ON admin_login_buckets (cooldown_until, updated_at);
CREATE INDEX IF NOT EXISTS idx_admin_settings_updated
  ON admin_settings (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_admin_session
  ON audit_log (admin_session_id, created_at DESC);
