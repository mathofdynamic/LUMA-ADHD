-- Phase 07: first-class human work, safe diagram artifacts, and bounded recovery.
-- Existing migrations remain immutable. Binary rendering is deliberately not
-- stored here; the DiagramSpec and trusted source remain canonical in D1.
PRAGMA foreign_keys = ON;

ALTER TABLE human_tasks ADD COLUMN reason TEXT NOT NULL DEFAULT '';
ALTER TABLE human_tasks ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0, 1));
ALTER TABLE human_tasks ADD COLUMN target_human_user_id TEXT;
ALTER TABLE human_tasks ADD COLUMN request_key TEXT;
ALTER TABLE human_tasks ADD COLUMN request_message_id TEXT;
ALTER TABLE human_tasks ADD COLUMN response_message_id TEXT;
ALTER TABLE human_tasks ADD COLUMN responded_by_user_id TEXT;
ALTER TABLE human_tasks ADD COLUMN response_source TEXT NOT NULL DEFAULT 'none' CHECK (response_source IN ('none', 'telegram', 'admin'));
ALTER TABLE human_tasks ADD COLUMN resolved_at TEXT;
ALTER TABLE human_tasks ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE human_tasks ADD COLUMN telegram_message_id TEXT;
ALTER TABLE human_tasks ADD COLUMN telegram_bot_alias TEXT;
ALTER TABLE human_tasks ADD COLUMN telegram_outbound_id TEXT;
ALTER TABLE human_tasks ADD COLUMN projection_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (projection_status IN ('not_requested', 'pending', 'sent', 'failed'));
ALTER TABLE human_tasks ADD COLUMN projection_error TEXT;
ALTER TABLE human_tasks ADD COLUMN wake_job_id TEXT;
ALTER TABLE human_tasks ADD COLUMN response_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(response_metadata_json));

ALTER TABLE artifacts ADD COLUMN spec_json TEXT;
ALTER TABLE artifacts ADD COLUMN source_hash TEXT;
ALTER TABLE artifacts ADD COLUMN render_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (render_status IN ('not_requested', 'rendered', 'unavailable', 'quota_exhausted', 'failed'));
ALTER TABLE artifacts ADD COLUMN render_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (render_attempt_count >= 0);
ALTER TABLE artifacts ADD COLUMN render_error TEXT;
ALTER TABLE artifacts ADD COLUMN rendered_at TEXT;
ALTER TABLE artifacts ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (delivery_status IN ('not_requested', 'sent', 'failed', 'not_available'));
ALTER TABLE artifacts ADD COLUMN delivery_error TEXT;
ALTER TABLE artifacts ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE artifacts ADD COLUMN telegram_message_id TEXT;
ALTER TABLE artifacts ADD COLUMN telegram_bot_alias TEXT;
ALTER TABLE artifacts ADD COLUMN telegram_file_id TEXT;
ALTER TABLE artifacts ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_human_tasks_open_request_key
  ON human_tasks (thread_id, requested_by_agent_id, request_key)
  WHERE deleted_at IS NULL
    AND request_key IS NOT NULL
    AND status IN ('open', 'claimed', 'in_progress', 'blocked');
CREATE INDEX IF NOT EXISTS idx_human_tasks_blocking
  ON human_tasks (blocking, status, priority DESC, created_at ASC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_human_tasks_telegram
  ON human_tasks (telegram_chat_id, telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_human_tasks_wake
  ON human_tasks (wake_job_id, response_source, resolved_at)
  WHERE wake_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_type_status
  ON artifacts (artifact_type, status, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_render
  ON artifacts (render_status, delivery_status, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_idempotency
  ON artifacts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_recovery
  ON jobs (status, lease_expires_at, attempt_count, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_recovery
  ON job_runs (status, finished_at, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_usage_failure
  ON provider_usage (status, created_at DESC);
