import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toBoolean, toJsonObject, toNullableString } from "../rows";
import { encodeObject, requireLimit, requireNonEmpty } from "../validation";
import type { JsonObject } from "../validation";
import type { ScheduledJobRecord } from "../types";

interface ScheduledJobRow {
  id: string;
  schedule_key: string;
  job_type: string;
  schedule_expression: string;
  payload_json: string;
  next_run_at: string;
  last_enqueued_at: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function mapScheduledJob(row: ScheduledJobRow): ScheduledJobRecord {
  return {
    id: row.id,
    scheduleKey: row.schedule_key,
    jobType: row.job_type,
    scheduleExpression: row.schedule_expression,
    payload: toJsonObject(row.payload_json, "scheduled_jobs.payload_json"),
    nextRunAt: row.next_run_at,
    lastEnqueuedAt: toNullableString(row.last_enqueued_at),
    enabled: toBoolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateScheduledJobInput {
  readonly id?: string;
  readonly scheduleKey: string;
  readonly jobType: string;
  readonly scheduleExpression: string;
  readonly payload?: JsonObject;
  readonly nextRunAt: string;
  readonly enabled?: boolean;
}

export class ScheduledJobRepository {
  constructor(private readonly database: DatabaseClient) {}

  async upsert(input: CreateScheduledJobInput): Promise<ScheduledJobRecord> {
    const id = input.id ?? createId("scheduled-job");
    const scheduleKey = requireNonEmpty(input.scheduleKey, "scheduledJob.scheduleKey");
    const jobType = requireNonEmpty(input.jobType, "scheduledJob.jobType");
    const expression = requireNonEmpty(input.scheduleExpression, "scheduledJob.scheduleExpression");
    const timestamp = nowIso();

    await this.database
      .prepare(
        `INSERT INTO scheduled_jobs (
          id, schedule_key, job_type, schedule_expression, payload_json,
          next_run_at, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (schedule_key) DO UPDATE SET
          job_type = excluded.job_type,
          schedule_expression = excluded.schedule_expression,
          payload_json = excluded.payload_json,
          next_run_at = excluded.next_run_at,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        scheduleKey,
        jobType,
        expression,
        encodeObject(input.payload, "scheduledJob.payload"),
        input.nextRunAt,
        input.enabled === false ? 0 : 1,
        timestamp,
        timestamp,
      )
      .run();

    return this.getByKey(scheduleKey);
  }

  async getByKey(scheduleKey: string): Promise<ScheduledJobRecord> {
    const row = await this.database
      .prepare("SELECT * FROM scheduled_jobs WHERE schedule_key = ?")
      .bind(scheduleKey)
      .first<ScheduledJobRow>();

    if (!row) {
      throw new NotFoundError("scheduled job", scheduleKey);
    }

    return mapScheduledJob(row);
  }

  async listDue(asOf: string, limit = 25): Promise<readonly ScheduledJobRecord[]> {
    const safeLimit = requireLimit(limit, "scheduled job list limit", 100);
    const result = await this.database
      .prepare(
        `SELECT * FROM scheduled_jobs
         WHERE enabled = 1 AND next_run_at <= ?
         ORDER BY next_run_at ASC
         LIMIT ?`,
      )
      .bind(asOf, safeLimit)
      .all<ScheduledJobRow>();

    return result.results.map(mapScheduledJob);
  }

  async markEnqueued(scheduleKey: string, nextRunAt: string, asOf = nowIso()): Promise<ScheduledJobRecord> {
    const result = await this.database
      .prepare(
        `UPDATE scheduled_jobs SET
          last_enqueued_at = ?, next_run_at = ?, updated_at = ?
         WHERE schedule_key = ? AND enabled = 1`,
      )
      .bind(asOf, nextRunAt, asOf, scheduleKey)
      .run();

    if (result.meta.changes !== 1) {
      throw new NotFoundError("scheduled job", scheduleKey);
    }

    return this.getByKey(scheduleKey);
  }
}
