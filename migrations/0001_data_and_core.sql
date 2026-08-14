-- Phase 01: durable application data and core runtime state.
-- D1 remains the canonical store. Provider, Telegram, and agent-runtime
-- integrations consume these records in later phases.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  specialty_description TEXT NOT NULL DEFAULT '',
  soul TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  rank REAL NOT NULL DEFAULT 10 CHECK (rank >= 0),
  is_supervisor INTEGER NOT NULL DEFAULT 0 CHECK (is_supervisor IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_specialties (
  agent_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, domain),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS agent_interests (
  agent_id TEXT NOT NULL,
  interest TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, interest),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS agent_configurations (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  provider_role TEXT NOT NULL DEFAULT 'normal_agent',
  model_key TEXT,
  prompt_version TEXT,
  config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  UNIQUE (agent_id, version)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  external_key TEXT UNIQUE,
  display_name TEXT NOT NULL,
  username TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY NOT NULL,
  telegram_chat_id TEXT UNIQUE,
  chat_type TEXT NOT NULL CHECK (chat_type IN ('private', 'group', 'supergroup', 'channel', 'internal')),
  title TEXT,
  is_workspace INTEGER NOT NULL DEFAULT 0 CHECK (is_workspace IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS telegram_identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  agent_id TEXT,
  telegram_user_id TEXT NOT NULL,
  bot_alias TEXT NOT NULL DEFAULT '',
  username TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1)),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  CHECK (
    (user_id IS NOT NULL AND agent_id IS NULL)
    OR (user_id IS NULL AND agent_id IS NOT NULL)
  ),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  UNIQUE (telegram_user_id, bot_alias)
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY NOT NULL,
  chat_id TEXT,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN (
    'open', 'exploring', 'debating', 'evidence_gathering',
    'developing', 'synthesizing', 'human_required', 'blocked',
    'decided', 'rejected', 'parked', 'reopened'
  )),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  summary TEXT,
  turn_budget INTEGER NOT NULL DEFAULT 12 CHECK (turn_budget >= 0),
  turns_used INTEGER NOT NULL DEFAULT 0 CHECK (turns_used >= 0),
  phase_budget INTEGER NOT NULL DEFAULT 6 CHECK (phase_budget >= 0),
  phase_turns_used INTEGER NOT NULL DEFAULT 0 CHECK (phase_turns_used >= 0),
  cycle_budget INTEGER NOT NULL DEFAULT 3 CHECK (cycle_budget >= 0),
  cycle_depth INTEGER NOT NULL DEFAULT 0 CHECK (cycle_depth >= 0),
  created_by_user_id TEXT,
  created_by_agent_id TEXT,
  telegram_topic_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (chat_id) REFERENCES chats(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by_agent_id) REFERENCES agents(id),
  CHECK (NOT (created_by_user_id IS NOT NULL AND created_by_agent_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS thread_participants (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  user_id TEXT,
  agent_id TEXT,
  role TEXT NOT NULL DEFAULT 'contributor' CHECK (role IN ('owner', 'contributor', 'observer')),
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  CHECK (
    (user_id IS NOT NULL AND agent_id IS NULL)
    OR (user_id IS NULL AND agent_id IS NOT NULL)
  ),
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  chat_id TEXT,
  author_type TEXT NOT NULL CHECK (author_type IN ('human', 'agent', 'system')),
  author_user_id TEXT,
  author_agent_id TEXT,
  content_text TEXT NOT NULL CHECK (length(content_text) > 0),
  reply_to_message_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal', 'private')),
  origin TEXT NOT NULL DEFAULT 'internal' CHECK (origin IN ('internal', 'telegram', 'system', 'external')),
  telegram_chat_id TEXT,
  telegram_message_id TEXT,
  telegram_bot_alias TEXT,
  telegram_update_id TEXT,
  idempotency_key TEXT UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (chat_id) REFERENCES chats(id),
  FOREIGN KEY (author_user_id) REFERENCES users(id),
  FOREIGN KEY (author_agent_id) REFERENCES agents(id),
  FOREIGN KEY (reply_to_message_id) REFERENCES messages(id),
  CHECK (
    (author_type = 'human' AND author_user_id IS NOT NULL AND author_agent_id IS NULL)
    OR (author_type = 'agent' AND author_user_id IS NULL AND author_agent_id IS NOT NULL)
    OR (author_type = 'system' AND author_user_id IS NULL AND author_agent_id IS NULL)
  ),
  CHECK (
    (telegram_message_id IS NULL AND telegram_chat_id IS NULL)
    OR (telegram_message_id IS NOT NULL AND telegram_chat_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'claimed', 'retry_scheduled', 'completed', 'failed', 'cancelled'
  )),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  idempotency_key TEXT NOT NULL UNIQUE,
  due_at TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  chain_depth INTEGER NOT NULL DEFAULT 0 CHECK (chain_depth >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  schedule_key TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL,
  schedule_expression TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  next_run_at TEXT NOT NULL,
  last_enqueued_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'completed', 'failed', 'abandoned')),
  lease_owner TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_summary TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  UNIQUE (job_id, attempt_number),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  thread_id TEXT,
  job_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_user_id TEXT,
  actor_agent_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id),
  FOREIGN KEY (actor_agent_id) REFERENCES agents(id),
  CHECK (
    (actor_type = 'human' AND actor_user_id IS NOT NULL AND actor_agent_id IS NULL)
    OR (actor_type = 'agent' AND actor_user_id IS NULL AND actor_agent_id IS NOT NULL)
    OR (actor_type = 'system' AND actor_user_id IS NULL AND actor_agent_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS agent_turns (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT,
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'completed', 'failed', 'skipped')),
  input_message_id TEXT,
  output_message_id TEXT,
  wake_reason TEXT,
  budget_units INTEGER NOT NULL DEFAULT 1 CHECK (budget_units > 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (input_message_id) REFERENCES messages(id),
  FOREIGN KEY (output_message_id) REFERENCES messages(id),
  UNIQUE (thread_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS human_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT,
  requested_by_agent_id TEXT,
  requested_by_user_id TEXT,
  assignee_user_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'claimed', 'in_progress', 'blocked', 'completed', 'rejected', 'cancelled'
  )),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  due_at TEXT,
  resolution TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (requested_by_agent_id) REFERENCES agents(id),
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  FOREIGN KEY (assignee_user_id) REFERENCES users(id),
  CHECK (NOT (requested_by_agent_id IS NOT NULL AND requested_by_user_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('shared', 'agent', 'thread')),
  owner_agent_id TEXT,
  thread_id TEXT,
  title TEXT NOT NULL,
  slug TEXT,
  document_type TEXT NOT NULL DEFAULT 'markdown',
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (owner_agent_id) REFERENCES agents(id),
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  CHECK (
    (scope = 'shared' AND owner_agent_id IS NULL AND thread_id IS NULL)
    OR (scope = 'agent' AND owner_agent_id IS NOT NULL AND thread_id IS NULL)
    OR (scope = 'thread' AND thread_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  content_markdown TEXT NOT NULL,
  change_summary TEXT,
  checksum TEXT,
  created_by_agent_id TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, version_number),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (created_by_agent_id) REFERENCES agents(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CHECK (NOT (created_by_agent_id IS NOT NULL AND created_by_user_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('url', 'document', 'telegram', 'manual', 'system')),
  canonical_key TEXT NOT NULL UNIQUE,
  title TEXT,
  uri TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'archived', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  document_version_id TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  content_text TEXT NOT NULL,
  token_estimate INTEGER CHECK (token_estimate IS NULL OR token_estimate >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, ordinal),
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id),
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id)
);

CREATE TABLE IF NOT EXISTS memory_notes (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('agent', 'organization', 'thread')),
  agent_id TEXT,
  thread_id TEXT,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
  source_message_id TEXT,
  source_document_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (source_message_id) REFERENCES messages(id),
  FOREIGN KEY (source_document_id) REFERENCES documents(id),
  CHECK (
    (scope = 'organization' AND agent_id IS NULL AND thread_id IS NULL)
    OR (scope = 'agent' AND agent_id IS NOT NULL)
    OR (scope = 'thread' AND thread_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS decision_records (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
  decision_text TEXT NOT NULL,
  rationale TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json)),
  decided_by_agent_id TEXT,
  decided_by_user_id TEXT,
  supersedes_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (decided_by_agent_id) REFERENCES agents(id),
  FOREIGN KEY (decided_by_user_id) REFERENCES users(id),
  FOREIGN KEY (supersedes_id) REFERENCES decision_records(id),
  CHECK (NOT (decided_by_agent_id IS NOT NULL AND decided_by_user_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT,
  message_id TEXT,
  document_id TEXT,
  target_agent_id TEXT,
  evaluator_agent_id TEXT,
  evaluator_user_id TEXT,
  evaluation_type TEXT NOT NULL CHECK (evaluation_type IN ('god', 'human', 'peer', 'outcome', 'system')),
  outcome TEXT,
  scores_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scores_json)),
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (target_agent_id) REFERENCES agents(id),
  FOREIGN KEY (evaluator_agent_id) REFERENCES agents(id),
  FOREIGN KEY (evaluator_user_id) REFERENCES users(id),
  CHECK (NOT (evaluator_agent_id IS NOT NULL AND evaluator_user_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS peer_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  evaluation_id TEXT,
  target_message_id TEXT,
  target_agent_id TEXT NOT NULL,
  reviewer_agent_id TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  score REAL CHECK (score IS NULL OR score BETWEEN -1 AND 1),
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (evaluation_id) REFERENCES evaluations(id),
  FOREIGN KEY (target_message_id) REFERENCES messages(id),
  FOREIGN KEY (target_agent_id) REFERENCES agents(id),
  FOREIGN KEY (reviewer_agent_id) REFERENCES agents(id),
  UNIQUE (target_message_id, reviewer_agent_id)
);

CREATE TABLE IF NOT EXISTS reputation_events (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('proposal', 'prediction', 'critique', 'outcome', 'human', 'god', 'system')),
  source_id TEXT,
  signal REAL NOT NULL CHECK (signal BETWEEN -1 AND 1),
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS reputation_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  epistemic REAL NOT NULL DEFAULT 0 CHECK (epistemic BETWEEN -1 AND 1),
  contribution REAL NOT NULL DEFAULT 0 CHECK (contribution BETWEEN -1 AND 1),
  collaboration REAL NOT NULL DEFAULT 0 CHECK (collaboration BETWEEN -1 AND 1),
  outcome REAL NOT NULL DEFAULT 0 CHECK (outcome BETWEEN -1 AND 1),
  rank REAL NOT NULL DEFAULT 10 CHECK (rank >= 0),
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  basis_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(basis_json)),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  UNIQUE (agent_id, domain, captured_at)
);

CREATE TABLE IF NOT EXISTS god_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT,
  review_period_start TEXT,
  review_period_end TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'superseded')),
  summary TEXT,
  findings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(findings_json)),
  provider_name TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE TABLE IF NOT EXISTS god_directives (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL,
  target_agent_id TEXT,
  target_thread_id TEXT,
  directive TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'completed', 'dismissed')),
  due_at TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (review_id) REFERENCES god_reviews(id),
  FOREIGN KEY (target_agent_id) REFERENCES agents(id),
  FOREIGN KEY (target_thread_id) REFERENCES threads(id)
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id TEXT PRIMARY KEY NOT NULL,
  provider_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  job_id TEXT,
  agent_turn_id TEXT,
  request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'timed_out')),
  prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_summary TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (agent_turn_id) REFERENCES agent_turns(id)
);

CREATE TABLE IF NOT EXISTS telegram_outbound (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT,
  thread_id TEXT,
  chat_id TEXT,
  agent_id TEXT,
  bot_alias TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'cancelled')),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  telegram_message_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (chat_id) REFERENCES chats(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('diagram', 'attachment', 'export', 'other')),
  title TEXT NOT NULL,
  source_text TEXT,
  format TEXT,
  thread_id TEXT,
  document_id TEXT,
  message_id TEXT,
  created_by_agent_id TEXT,
  created_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'rendered', 'failed', 'archived')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (created_by_agent_id) REFERENCES agents(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CHECK (NOT (created_by_agent_id IS NOT NULL AND created_by_user_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS artifact_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  artifact_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  source_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_by_agent_id TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (artifact_id, revision_number),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id),
  FOREIGN KEY (created_by_agent_id) REFERENCES agents(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CHECK (NOT (created_by_agent_id IS NOT NULL AND created_by_user_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_user_id TEXT,
  actor_agent_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id),
  FOREIGN KEY (actor_agent_id) REFERENCES agents(id),
  CHECK (
    (actor_type = 'human' AND actor_user_id IS NOT NULL AND actor_agent_id IS NULL)
    OR (actor_type = 'agent' AND actor_user_id IS NULL AND actor_agent_id IS NOT NULL)
    OR (actor_type = 'system' AND actor_user_id IS NULL AND actor_agent_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agents_active_rank ON agents (is_active, rank DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_specialties_domain ON agent_specialties (domain, priority DESC);
CREATE INDEX IF NOT EXISTS idx_agent_configurations_active ON agent_configurations (agent_id, is_active, version DESC);
CREATE INDEX IF NOT EXISTS idx_users_admin_active ON users (is_admin, deleted_at);
CREATE INDEX IF NOT EXISTS idx_telegram_identities_user ON telegram_identities (user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_telegram_identities_agent ON telegram_identities (agent_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_telegram_identities_telegram ON telegram_identities (telegram_user_id, bot_alias);
CREATE INDEX IF NOT EXISTS idx_chats_workspace ON chats (is_workspace, deleted_at);
CREATE INDEX IF NOT EXISTS idx_threads_active ON threads (state, priority DESC, last_activity_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_chat_activity ON threads (chat_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_participants_thread ON thread_participants (thread_id, left_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_participants_user ON thread_participants (thread_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_participants_agent ON thread_participants (thread_id, agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_thread_time ON messages (thread_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_author_user ON messages (author_user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_author_agent ON messages (author_agent_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_telegram ON messages (telegram_chat_id, telegram_message_id, telegram_bot_alias);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs (status, due_at, priority DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs (lease_expires_at, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_job_time ON job_runs (job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events (aggregate_type, aggregate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_thread_time ON events (thread_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON events (processed_at, occurred_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_turns_thread ON agent_turns (thread_id, sequence_number DESC);
CREATE INDEX IF NOT EXISTS idx_agent_turns_agent ON agent_turns (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_human_tasks_status ON human_tasks (status, priority DESC, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_human_tasks_thread ON human_tasks (thread_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents (owner_agent_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents (scope, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions (document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks (source_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_memory_notes_scope ON memory_notes (scope, agent_id, thread_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_decision_records_thread ON decision_records (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluations_target ON evaluations (target_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_peer_feedback_reviewer ON peer_feedback (reviewer_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reputation_events_agent_domain ON reputation_events (agent_id, domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reputation_snapshots_agent_domain ON reputation_snapshots (agent_id, domain, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_god_reviews_time ON god_reviews (created_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_god_directives_status ON god_directives (status, due_at);
CREATE INDEX IF NOT EXISTS idx_provider_usage_time ON provider_usage (provider_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_outbound_due ON telegram_outbound (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_thread ON artifacts (thread_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artifact_revisions_artifact ON artifact_revisions (artifact_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id, created_at DESC);

INSERT OR IGNORE INTO agents (
  id, slug, display_name, specialty, specialty_description, soul, personality, rank, is_supervisor, config_json
) VALUES
  ('agent-product', 'product', 'Product Strategist', 'Product strategy', 'Clarifies user value, product direction, and strategic trade-offs.', 'Prefer a small clear product that earns its complexity through user value.', 'Curious, structured, pragmatic, and willing to turn ambiguity into a testable choice.', 10, 0, '{"seed":"phase-01","final_prompt":false}'),
  ('agent-growth', 'growth', 'Growth Strategist', 'Growth', 'Explores distribution, positioning, experiments, and sustainable acquisition.', 'Prefer compounding learning and durable trust over vanity growth.', 'Energetic, experimental, analytical, and attentive to causal evidence.', 10, 0, '{"seed":"phase-01","final_prompt":false}'),
  ('agent-creative', 'creative', 'Creative Director / UX Critic', 'UX and creative direction', 'Protects clarity, accessibility, emotional resonance, and interaction quality.', 'Make the important thing obvious, useful, and worth returning to.', 'Observant, precise, humane, and constructively demanding.', 10, 0, '{"seed":"phase-01","final_prompt":false}'),
  ('agent-technical', 'technical', 'Technical Architect', 'Engineering and architecture', 'Designs maintainable systems within reliability, security, and free-tier constraints.', 'Prefer the simplest durable architecture and make failure modes explicit.', 'Calm, skeptical, systems-oriented, and precise about operational cost.', 10, 0, '{"seed":"phase-01","final_prompt":false}'),
  ('agent-finance', 'finance', 'Finance & Pricing Analyst', 'Finance and pricing', 'Tests unit economics, pricing logic, budgets, and downside risk.', 'A sustainable business is part of product quality, not a separate concern.', 'Numerate, direct, conservative with assumptions, and open to asymmetric upside.', 10, 0, '{"seed":"phase-01","final_prompt":false}'),
  ('agent-customer', 'customer', 'Customer Advocate', 'Customer experience', 'Represents user needs, friction, trust, and real-world adoption barriers.', 'Start with the lived problem and protect the user from organizational convenience.', 'Empathetic, concrete, patient, and alert to unspoken pain.', 10, 0, '{"seed":"phase-01","final_prompt":false}'),
  ('agent-operations', 'operations', 'Operations Strategist', 'Operations', 'Turns ideas into repeatable workflows, ownership, and measurable execution.', 'A good idea becomes valuable when people can reliably operate it.', 'Practical, organized, risk-aware, and focused on handoffs.', 10, 0, '{"seed":"phase-01","final_prompt":false}'),
  ('agent-heretic', 'heretic', 'Contrarian / Heretic', 'Critical analysis', 'Challenges consensus, hidden assumptions, and fashionable but weak reasoning.', 'Consensus is a hypothesis; protect the organization by looking for disconfirming evidence.', 'Sharp, independent, provocative without being careless, and evidence-seeking.', 10, 0, '{"seed":"phase-01","final_prompt":false}'),
  ('agent-god', 'god', 'GOD', 'Supervisory intelligence', 'Periodically reviews organizational reasoning, quality, and unresolved strategic risk.', 'Intervene sparingly, preserve accountability, and make weak assumptions visible.', 'Detached, rigorous, fair, and focused on long-term institutional quality.', 10, 1, '{"seed":"phase-01","final_prompt":false}');

INSERT OR IGNORE INTO agent_specialties (agent_id, domain, description, priority, is_primary) VALUES
  ('agent-product', 'product_strategy', 'Product direction and prioritization', 100, 1),
  ('agent-growth', 'growth', 'Distribution and experimentation', 100, 1),
  ('agent-creative', 'ux_creative', 'User experience and creative direction', 100, 1),
  ('agent-technical', 'engineering_architecture', 'Technical architecture and reliability', 100, 1),
  ('agent-finance', 'finance_pricing', 'Economics and pricing', 100, 1),
  ('agent-customer', 'customer_experience', 'Customer needs and trust', 100, 1),
  ('agent-operations', 'operations', 'Execution systems and workflows', 100, 1),
  ('agent-heretic', 'critical_analysis', 'Dissent and assumption testing', 100, 1),
  ('agent-god', 'governance', 'Supervision and institutional quality', 100, 1);

INSERT OR IGNORE INTO agent_interests (agent_id, interest, priority) VALUES
  ('agent-product', 'user value', 90),
  ('agent-product', 'product discovery', 85),
  ('agent-growth', 'sustainable acquisition', 90),
  ('agent-growth', 'experimentation', 85),
  ('agent-creative', 'interaction clarity', 90),
  ('agent-creative', 'accessible design', 85),
  ('agent-technical', 'reliability', 90),
  ('agent-technical', 'cost-aware infrastructure', 85),
  ('agent-finance', 'unit economics', 90),
  ('agent-finance', 'pricing strategy', 85),
  ('agent-customer', 'user trust', 90),
  ('agent-customer', 'support friction', 85),
  ('agent-operations', 'repeatable execution', 90),
  ('agent-operations', 'process quality', 85),
  ('agent-heretic', 'disconfirming evidence', 95),
  ('agent-heretic', 'failure modes', 90),
  ('agent-god', 'organizational reasoning', 95),
  ('agent-god', 'governance quality', 90);

INSERT OR IGNORE INTO agent_configurations (
  id, agent_id, version, provider_role, model_key, prompt_version, config_json
) VALUES
  ('agent-config-product-v1', 'agent-product', 1, 'normal_agent', NULL, 'phase-01-identity', '{"seed":"phase-01","prompt_status":"not_implemented"}'),
  ('agent-config-growth-v1', 'agent-growth', 1, 'normal_agent', NULL, 'phase-01-identity', '{"seed":"phase-01","prompt_status":"not_implemented"}'),
  ('agent-config-creative-v1', 'agent-creative', 1, 'normal_agent', NULL, 'phase-01-identity', '{"seed":"phase-01","prompt_status":"not_implemented"}'),
  ('agent-config-technical-v1', 'agent-technical', 1, 'normal_agent', NULL, 'phase-01-identity', '{"seed":"phase-01","prompt_status":"not_implemented"}'),
  ('agent-config-finance-v1', 'agent-finance', 1, 'normal_agent', NULL, 'phase-01-identity', '{"seed":"phase-01","prompt_status":"not_implemented"}'),
  ('agent-config-customer-v1', 'agent-customer', 1, 'normal_agent', NULL, 'phase-01-identity', '{"seed":"phase-01","prompt_status":"not_implemented"}'),
  ('agent-config-operations-v1', 'agent-operations', 1, 'normal_agent', NULL, 'phase-01-identity', '{"seed":"phase-01","prompt_status":"not_implemented"}'),
  ('agent-config-heretic-v1', 'agent-heretic', 1, 'normal_agent', NULL, 'phase-01-identity', '{"seed":"phase-01","prompt_status":"not_implemented"}'),
  ('agent-config-god-v1', 'agent-god', 1, 'supervisor', NULL, 'phase-01-identity', '{"seed":"phase-01","prompt_status":"not_implemented"}');
