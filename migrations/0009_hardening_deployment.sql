-- Phase 08: support bounded daily autonomy-budget counts without scanning all jobs.
CREATE INDEX IF NOT EXISTS idx_jobs_type_created_at
  ON jobs (job_type, created_at);
