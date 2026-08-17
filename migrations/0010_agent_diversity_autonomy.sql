-- Post-v1: bounded cross-job Agent opportunity lookup and selection telemetry.
-- The existing agent_turns rows remain the canonical opportunity record.
CREATE INDEX IF NOT EXISTS idx_agent_turns_thread_agent_created
  ON agent_turns (thread_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_actor_agent_time
  ON events (actor_agent_id, occurred_at DESC);
