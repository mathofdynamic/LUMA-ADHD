-- Phase 05: inspectable multidimensional reputation and provider-neutral GOD supervision.
-- Existing migrations remain immutable. GOD has no Telegram identity; public GOD
-- messages use the existing gateway transport while retaining agent-god authorship.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reputation_domains (
  domain TEXT PRIMARY KEY NOT NULL,
  description TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO reputation_domains (domain, description) VALUES
  ('product_strategy', 'Product direction, prioritization, and user value'),
  ('growth', 'Distribution, acquisition, retention, and experimentation'),
  ('ux_creative', 'User experience, creative direction, and visual quality'),
  ('engineering_architecture', 'Architecture, reliability, security, and performance'),
  ('finance_pricing', 'Pricing, unit economics, budgets, and cost discipline'),
  ('customer_experience', 'Customer needs, trust, support, and adoption friction'),
  ('operations', 'Repeatable execution, workflows, and operational quality'),
  ('critical_analysis', 'Assumption testing, dissent, and failure-mode analysis'),
  ('general', 'Cross-domain organizational contribution');

ALTER TABLE evaluations ADD COLUMN domain TEXT;
ALTER TABLE evaluations ADD COLUMN dimension TEXT;
ALTER TABLE evaluations ADD COLUMN signal REAL;
ALTER TABLE evaluations ADD COLUMN evidence_summary TEXT;
ALTER TABLE evaluations ADD COLUMN idempotency_key TEXT;
ALTER TABLE evaluations ADD COLUMN scoring_version TEXT;

ALTER TABLE peer_feedback ADD COLUMN domain TEXT DEFAULT 'general';
ALTER TABLE peer_feedback ADD COLUMN dimension TEXT DEFAULT 'collaboration';
ALTER TABLE peer_feedback ADD COLUMN idempotency_key TEXT;
ALTER TABLE peer_feedback ADD COLUMN reviewer_weight REAL NOT NULL DEFAULT 1 CHECK (reviewer_weight >= 0 AND reviewer_weight <= 1);

ALTER TABLE reputation_events ADD COLUMN dimension TEXT DEFAULT 'contribution';
ALTER TABLE reputation_events ADD COLUMN source_type TEXT DEFAULT 'system';
ALTER TABLE reputation_events ADD COLUMN evaluation_id TEXT;
ALTER TABLE reputation_events ADD COLUMN evidence_summary TEXT;
ALTER TABLE reputation_events ADD COLUMN probability REAL;
ALTER TABLE reputation_events ADD COLUMN observed_result INTEGER;
ALTER TABLE reputation_events ADD COLUMN confidence REAL;
ALTER TABLE reputation_events ADD COLUMN processed_at TEXT;
ALTER TABLE reputation_events ADD COLUMN scoring_run_id TEXT;
ALTER TABLE reputation_events ADD COLUMN scoring_version TEXT;

ALTER TABLE reputation_snapshots ADD COLUMN scoring_run_id TEXT;
ALTER TABLE reputation_snapshots ADD COLUMN scoring_day TEXT;
ALTER TABLE reputation_snapshots ADD COLUMN epistemic_before REAL DEFAULT 0;
ALTER TABLE reputation_snapshots ADD COLUMN contribution_before REAL DEFAULT 0;
ALTER TABLE reputation_snapshots ADD COLUMN outcome_before REAL DEFAULT 0;
ALTER TABLE reputation_snapshots ADD COLUMN collaboration_before REAL DEFAULT 0;
ALTER TABLE reputation_snapshots ADD COLUMN combined_score REAL DEFAULT 0;
ALTER TABLE reputation_snapshots ADD COLUMN rank_before REAL DEFAULT 10;
ALTER TABLE reputation_snapshots ADD COLUMN rank_after REAL DEFAULT 10;
ALTER TABLE reputation_snapshots ADD COLUMN rank_delta REAL DEFAULT 0;
ALTER TABLE reputation_snapshots ADD COLUMN target_rank REAL DEFAULT 10;
ALTER TABLE reputation_snapshots ADD COLUMN influence_weight REAL DEFAULT 1;
ALTER TABLE reputation_snapshots ADD COLUMN evidence_count INTEGER DEFAULT 0;
ALTER TABLE reputation_snapshots ADD COLUMN scoring_version TEXT DEFAULT 'phase-05-v1';

ALTER TABLE god_reviews ADD COLUMN idempotency_key TEXT;
ALTER TABLE god_reviews ADD COLUMN briefing_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(briefing_json));
ALTER TABLE god_reviews ADD COLUMN repair_attempts INTEGER NOT NULL DEFAULT 0 CHECK (repair_attempts >= 0);
ALTER TABLE god_reviews ADD COLUMN failure_summary TEXT;
ALTER TABLE god_reviews ADD COLUMN public_message_id TEXT;
ALTER TABLE god_reviews ADD COLUMN scoring_version TEXT DEFAULT 'phase-05-v1';

ALTER TABLE god_directives ADD COLUMN idempotency_key TEXT;
ALTER TABLE god_directives ADD COLUMN priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100);
ALTER TABLE god_directives ADD COLUMN source_summary TEXT;
ALTER TABLE god_directives ADD COLUMN acknowledged_at TEXT;

CREATE TABLE IF NOT EXISTS reputation_domain_state (
  agent_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  epistemic REAL NOT NULL DEFAULT 0 CHECK (epistemic BETWEEN -1 AND 1),
  contribution REAL NOT NULL DEFAULT 0 CHECK (contribution BETWEEN -1 AND 1),
  outcome REAL NOT NULL DEFAULT 0 CHECK (outcome BETWEEN -1 AND 1),
  collaboration REAL NOT NULL DEFAULT 0 CHECK (collaboration BETWEEN -1 AND 1),
  rank REAL NOT NULL DEFAULT 10 CHECK (rank >= 0),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, domain),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (domain) REFERENCES reputation_domains(domain)
);

CREATE TABLE IF NOT EXISTS reputation_scoring_runs (
  id TEXT PRIMARY KEY NOT NULL,
  scoring_day TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (snapshot_count >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  error_summary TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS reputation_outcomes (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  signal REAL NOT NULL CHECK (signal BETWEEN -1 AND 1),
  outcome_summary TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (domain) REFERENCES reputation_domains(domain),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS god_schedule_state (
  schedule_key TEXT PRIMARY KEY NOT NULL,
  next_due_at TEXT NOT NULL,
  last_enqueued_at TEXT,
  last_review_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (last_review_id) REFERENCES god_reviews(id)
);

INSERT OR IGNORE INTO reputation_domain_state (agent_id, domain)
SELECT agents.id, reputation_domains.domain
FROM agents
CROSS JOIN reputation_domains
WHERE agents.is_supervisor = 0
  AND agents.is_active = 1
  AND agents.deleted_at IS NULL
  AND reputation_domains.is_active = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluations_idempotency
  ON evaluations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_feedback_idempotency
  ON peer_feedback (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reputation_snapshots_run
  ON reputation_snapshots (agent_id, domain, scoring_run_id)
  WHERE scoring_run_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_god_reviews_idempotency
  ON god_reviews (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_god_directives_idempotency
  ON god_directives (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reputation_events_unprocessed
  ON reputation_events (processed_at, created_at, agent_id, domain)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reputation_events_source
  ON reputation_events (source_type, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reputation_state_domain_rank
  ON reputation_domain_state (domain, rank DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reputation_runs_day
  ON reputation_scoring_runs (scoring_day, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_reputation_outcomes_source
  ON reputation_outcomes (source_type, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_god_reviews_status_time
  ON god_reviews (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_god_directives_review
  ON god_directives (review_id, status, priority DESC);

UPDATE agents
SET rank = 10,
    updated_at = CURRENT_TIMESTAMP
WHERE is_supervisor = 0 AND deleted_at IS NULL;
