import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireLimit, requireNonEmpty } from "../validation";
import type {
  ClaimedJob,
  CreateJobInput,
  JobRecord,
  JobStatus,
} from "../types";

interface JobRow {
  id: string;
  job_type: string;
  status: JobStatus;
  payload_json: string;
  idempotency_key: string;
  due_at: string;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  chain_depth: number;
  last_enqueued_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    payload: toJsonObject(row.payload_json, "jobs.payload_json"),
    idempotencyKey: row.idempotency_key,
    dueAt: row.due_at,
    priority: toNumber(row.priority, "jobs.priority"),
    attemptCount: toNumber(row.attempt_count, "jobs.attempt_count"),
    maxAttempts: toNumber(row.max_attempts, "jobs.max_attempts"),
    chainDepth: toNumber(row.chain_depth, "jobs.chain_depth"),
    lastEnqueuedAt: toNullableString(row.last_enqueued_at),
    leaseOwner: toNullableString(row.lease_owner),
    leaseExpiresAt: toNullableString(row.lease_expires_at),
    lastError: toNullableString(row.last_error),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: toNullableString(row.completed_at),
    cancelledAt: toNullableString(row.cancelled_at),
  };
}

function addSeconds(timestamp: string, seconds: number): string {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) {
    throw new ValidationError("job lease timestamp must be a valid ISO timestamp");
  }

  return new Date(milliseconds + seconds * 1000).toISOString();
}

export class JobRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateJobInput): Promise<JobRecord> {
    const id = input.id ?? createId("job");
    const jobType = requireNonEmpty(input.jobType, "job.jobType");
    const idempotencyKey = requireNonEmpty(input.idempotencyKey, "job.idempotencyKey");
    const priority = input.priority ?? 50;
    const maxAttempts = input.maxAttempts ?? 3;
    const chainDepth = input.chainDepth ?? 0;

    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      throw new ValidationError("job.priority must be an integer between 0 and 100");
    }

    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new ValidationError("job.maxAttempts must be a positive integer");
    }

    if (!Number.isInteger(chainDepth) || chainDepth < 0) {
      throw new ValidationError("job.chainDepth must be a non-negative integer");
    }

    await this.database
      .prepare(
        `INSERT INTO jobs (
          id, job_type, status, payload_json, idempotency_key, due_at,
          priority, max_attempts, chain_depth, created_at, updated_at
        ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(
        id,
        jobType,
        encodeObject(input.payload, "job.payload"),
        idempotencyKey,
        input.dueAt,
        priority,
        maxAttempts,
        chainDepth,
        nowIso(),
        nowIso(),
      )
      .run();

    return this.getByIdempotencyKey(idempotencyKey);
  }

  async getById(id: string): Promise<JobRecord> {
    const row = await this.database
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .bind(id)
      .first<JobRow>();

    if (!row) {
      throw new NotFoundError("job", id);
    }

    return mapJob(row);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<JobRecord> {
    const row = await this.database
      .prepare("SELECT * FROM jobs WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<JobRow>();

    if (!row) {
      throw new NotFoundError("job idempotency key", idempotencyKey);
    }

    return mapJob(row);
  }

  async listDue(asOf: string, limit = 25): Promise<readonly JobRecord[]> {
    const safeLimit = requireLimit(limit, "job list limit", 100);
    const result = await this.database
      .prepare(
        `SELECT * FROM jobs
         WHERE status IN ('pending', 'retry_scheduled')
           AND due_at <= ?
         ORDER BY priority DESC, due_at ASC, created_at ASC
         LIMIT ?`,
      )
      .bind(asOf, safeLimit)
      .all<JobRow>();

    return result.results.map(mapJob);
  }

  async listDueToEnqueue(
    asOf: string,
    limit = 25,
    minimumIntervalSeconds = 60,
  ): Promise<readonly JobRecord[]> {
    const safeLimit = requireLimit(limit, "job enqueue list limit", 100);
    if (!Number.isInteger(minimumIntervalSeconds) || minimumIntervalSeconds < 0) {
      throw new ValidationError("job enqueue interval must be a non-negative integer");
    }
    const timestamp = Date.parse(asOf);
    if (!Number.isFinite(timestamp)) {
      throw new ValidationError("job enqueue timestamp must be a valid ISO timestamp");
    }
    const lastAllowed = new Date(timestamp - minimumIntervalSeconds * 1000).toISOString();
    const result = await this.database
      .prepare(
        `SELECT * FROM jobs
         WHERE status IN ('pending', 'retry_scheduled')
           AND due_at <= ?
           AND (last_enqueued_at IS NULL OR last_enqueued_at <= ?)
         ORDER BY priority DESC, due_at ASC, created_at ASC
         LIMIT ?`,
      )
      .bind(asOf, lastAllowed, safeLimit)
      .all<JobRow>();

    return result.results.map(mapJob);
  }

  async markEnqueued(id: string, asOf = nowIso()): Promise<JobRecord> {
    const result = await this.database
      .prepare(
        `UPDATE jobs SET last_enqueued_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'retry_scheduled')`,
      )
      .bind(asOf, asOf, id)
      .run();

    if (result.meta.changes !== 1) {
      throw new NotFoundError("enqueuable job", id);
    }

    return this.getById(id);
  }

  async claim(
    id: string,
    leaseOwner: string,
    leaseSeconds = 60,
    asOf = nowIso(),
  ): Promise<ClaimedJob | null> {
    const owner = requireNonEmpty(leaseOwner, "job.leaseOwner");
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
      throw new ValidationError("job leaseSeconds must be between 1 and 3600");
    }

    const leaseExpiresAt = addSeconds(asOf, leaseSeconds);
    const runId = createId("job-run");
    const results = await this.database.batch<JobRow>([
      this.database
        .prepare(
          `UPDATE jobs SET
            status = 'claimed',
            attempt_count = attempt_count + 1,
            lease_owner = ?,
            lease_expires_at = ?,
            updated_at = ?
           WHERE id = ?
             AND status IN ('pending', 'retry_scheduled')
             AND due_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
             AND attempt_count < max_attempts`,
        )
        .bind(owner, leaseExpiresAt, asOf, id, asOf, asOf),
      this.database
        .prepare(
          `INSERT INTO job_runs (
            id, job_id, attempt_number, status, lease_owner, started_at
          )
          SELECT ?, id, attempt_count, 'claimed', ?, ?
          FROM jobs
          WHERE id = ? AND status = 'claimed' AND lease_owner = ? AND lease_expires_at = ?`,
        )
        .bind(runId, owner, asOf, id, owner, leaseExpiresAt),
      this.database.prepare("SELECT * FROM jobs WHERE id = ? AND lease_owner = ? AND status = 'claimed'").bind(id, owner),
    ]);

    const row = results[2]?.results[0];
    return row ? { ...mapJob(row), runId } : null;
  }

  async complete(id: string, leaseOwner: string, asOf = nowIso()): Promise<JobRecord> {
    const updated = await this.database.batch<JobRow>([
      this.database
        .prepare(
          `UPDATE jobs SET
            status = 'completed',
            lease_owner = NULL,
            lease_expires_at = NULL,
            completed_at = ?,
            updated_at = ?
           WHERE id = ? AND status = 'claimed' AND lease_owner = ?`,
        )
        .bind(asOf, asOf, id, leaseOwner),
      this.database
        .prepare(
          `UPDATE job_runs SET status = 'completed', finished_at = ?
           WHERE job_id = ? AND attempt_number = (
             SELECT attempt_count FROM jobs WHERE id = ? AND status = 'completed' AND completed_at = ?
           )`,
        )
        .bind(asOf, id, id, asOf),
      this.database.prepare("SELECT * FROM jobs WHERE id = ?").bind(id),
    ]);

    if (updated[0]?.meta.changes !== 1) {
      throw new ValidationError(`job '${id}' is not owned by lease '${leaseOwner}'`);
    }

    const row = updated[2]?.results[0];
    if (!row) {
      throw new NotFoundError("job", id);
    }

    return mapJob(row);
  }

  async fail(
    id: string,
    leaseOwner: string,
    errorSummary: string,
    retryable: boolean,
    nextDueAt: string,
    asOf = nowIso(),
  ): Promise<JobRecord> {
    const error = requireNonEmpty(errorSummary, "job.errorSummary");
    const updated = await this.database.batch<JobRow>([
      this.database
        .prepare(
          `UPDATE jobs SET
            status = CASE WHEN ? = 1 AND attempt_count < max_attempts THEN 'retry_scheduled' ELSE 'failed' END,
            due_at = CASE WHEN ? = 1 AND attempt_count < max_attempts THEN ? ELSE due_at END,
            last_error = ?,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = ?
           WHERE id = ? AND status = 'claimed' AND lease_owner = ?`,
        )
        .bind(retryable ? 1 : 0, retryable ? 1 : 0, nextDueAt, error, asOf, id, leaseOwner),
      this.database
        .prepare(
          `UPDATE job_runs SET
            status = 'failed', finished_at = ?, error_summary = ?
           WHERE job_id = ? AND attempt_number = (
             SELECT attempt_count FROM jobs WHERE id = ? AND status IN ('retry_scheduled', 'failed')
           )`,
        )
        .bind(asOf, error, id, id),
      this.database.prepare("SELECT * FROM jobs WHERE id = ?").bind(id),
    ]);

    if (updated[0]?.meta.changes !== 1) {
      throw new ValidationError(`job '${id}' is not owned by lease '${leaseOwner}'`);
    }

    const row = updated[2]?.results[0];
    if (!row) {
      throw new NotFoundError("job", id);
    }

    return mapJob(row);
  }

  async reschedule(
    id: string,
    leaseOwner: string,
    nextDueAt: string,
    reason: string,
    asOf = nowIso(),
  ): Promise<JobRecord> {
    return this.fail(id, leaseOwner, reason, true, nextDueAt, asOf);
  }

  async recoverStale(asOf = nowIso(), nextDueAt = asOf): Promise<number> {
    const results = await this.database.batch([
      this.database
        .prepare(
          `UPDATE jobs SET
            status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'retry_scheduled' END,
            due_at = CASE WHEN attempt_count >= max_attempts THEN due_at ELSE ? END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error = 'stale lease recovered',
            updated_at = ?
           WHERE status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
        )
        .bind(nextDueAt, asOf, asOf),
      this.database
        .prepare(
          `UPDATE job_runs SET
            status = 'abandoned',
            finished_at = ?,
            error_summary = 'stale lease recovered'
           WHERE status = 'claimed'
             AND attempt_number = (
               SELECT attempt_count FROM jobs
               WHERE jobs.id = job_runs.job_id
                 AND jobs.status IN ('retry_scheduled', 'failed')
                 AND jobs.last_error = 'stale lease recovered'
                 AND jobs.updated_at = ?
             )`,
        )
        .bind(asOf, asOf),
    ]);

    return results[0]?.meta.changes ?? 0;
  }

  async retryFailed(id: string, asOf = nowIso()): Promise<JobRecord> {
    const result = await this.database.prepare(
      `UPDATE jobs SET status = 'retry_scheduled', due_at = ?, last_error = NULL,
         lease_owner = NULL, lease_expires_at = NULL, completed_at = NULL,
         cancelled_at = NULL, updated_at = ?
       WHERE id = ? AND status IN ('failed', 'retry_scheduled') AND attempt_count < max_attempts`,
    ).bind(asOf, asOf, id).run();
    if (result.meta.changes !== 1) {
      const existing = await this.getById(id);
      if (existing.status === "completed") return existing;
      throw new ValidationError(`job '${id}' is not eligible for retry`);
    }
    return this.getById(id);
  }

  async recoverStaleById(id: string, asOf = nowIso(), nextDueAt = asOf): Promise<JobRecord> {
    const result = await this.database.prepare(
      `UPDATE jobs SET
         status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'retry_scheduled' END,
         due_at = CASE WHEN attempt_count >= max_attempts THEN due_at ELSE ? END,
         lease_owner = NULL, lease_expires_at = NULL,
         last_error = 'stale lease recovered', updated_at = ?
       WHERE id = ? AND status = 'claimed'
         AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
    ).bind(nextDueAt, asOf, id, asOf).run();
    if (result.meta.changes !== 1) {
      const existing = await this.getById(id);
      if (existing.status === "claimed") throw new ValidationError(`job '${id}' still has an active lease`);
      return existing;
    }
    await this.database.prepare(
      `UPDATE job_runs SET status = 'abandoned', finished_at = ?, error_summary = 'stale lease recovered'
       WHERE job_id = ? AND status = 'claimed' AND attempt_number = (
         SELECT attempt_count FROM jobs WHERE id = ?
       )`,
    ).bind(asOf, id, id).run();
    return this.getById(id);
  }
}
