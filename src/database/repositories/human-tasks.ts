import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireLimit, requireNonEmpty } from "../validation";
import type {
  CreateHumanTaskInput,
  HumanTaskRecord,
  HumanTaskStatus,
} from "../types";

interface HumanTaskRow {
  id: string;
  thread_id: string | null;
  requested_by_agent_id: string | null;
  requested_by_user_id: string | null;
  assignee_user_id: string | null;
  title: string;
  description: string;
  status: HumanTaskStatus;
  priority: number;
  due_at: string | null;
  resolution: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
}

function mapTask(row: HumanTaskRow): HumanTaskRecord {
  return {
    id: row.id,
    threadId: toNullableString(row.thread_id),
    requestedByAgentId: toNullableString(row.requested_by_agent_id),
    requestedByUserId: toNullableString(row.requested_by_user_id),
    assigneeUserId: toNullableString(row.assignee_user_id),
    title: row.title,
    description: row.description,
    status: row.status,
    priority: toNumber(row.priority, "human_tasks.priority"),
    dueAt: toNullableString(row.due_at),
    resolution: toNullableString(row.resolution),
    metadata: toJsonObject(row.metadata_json, "human_tasks.metadata_json"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: toNullableString(row.completed_at),
    deletedAt: toNullableString(row.deleted_at),
  };
}

export class HumanTaskRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateHumanTaskInput): Promise<HumanTaskRecord> {
    if (input.requestedByAgentId !== undefined && input.requestedByUserId !== undefined) {
      throw new ValidationError("human task requester must be an agent or a user, not both");
    }

    const priority = input.priority ?? 50;
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      throw new ValidationError("human task priority must be an integer between 0 and 100");
    }

    const id = input.id ?? createId("human-task");
    const title = requireNonEmpty(input.title, "humanTask.title");
    const description = requireNonEmpty(input.description, "humanTask.description");
    const timestamp = nowIso();

    await this.database
      .prepare(
        `INSERT INTO human_tasks (
          id, thread_id, requested_by_agent_id, requested_by_user_id,
          assignee_user_id, title, description, priority, due_at,
          metadata_json, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING`,
      )
      .bind(
        id,
        input.threadId ?? null,
        input.requestedByAgentId ?? null,
        input.requestedByUserId ?? null,
        input.assigneeUserId ?? null,
        title,
        description,
        priority,
        input.dueAt ?? null,
        encodeObject(input.metadata, "humanTask.metadata"),
        input.idempotencyKey ?? null,
        timestamp,
        timestamp,
      )
      .run();

    if (input.idempotencyKey !== undefined) {
      const existing = await this.database
        .prepare("SELECT id FROM human_tasks WHERE idempotency_key = ?")
        .bind(input.idempotencyKey)
        .first<{ id: string }>();
      if (!existing) {
        throw new NotFoundError("human task idempotency key", input.idempotencyKey);
      }
      return this.getById(existing.id);
    }

    return this.getById(id);
  }

  async getById(id: string): Promise<HumanTaskRecord> {
    const row = await this.database
      .prepare("SELECT * FROM human_tasks WHERE id = ?")
      .bind(id)
      .first<HumanTaskRow>();

    if (!row) {
      throw new NotFoundError("human task", id);
    }

    return mapTask(row);
  }

  async listOpen(limit = 50): Promise<readonly HumanTaskRecord[]> {
    const safeLimit = requireLimit(limit, "human task list limit", 200);
    const result = await this.database
      .prepare(
        `SELECT * FROM human_tasks
         WHERE deleted_at IS NULL AND status IN ('open', 'claimed', 'in_progress', 'blocked')
         ORDER BY priority DESC, created_at ASC
         LIMIT ?`,
      )
      .bind(safeLimit)
      .all<HumanTaskRow>();

    return result.results.map(mapTask);
  }

  async updateStatus(id: string, status: HumanTaskStatus, resolution?: string): Promise<HumanTaskRecord> {
    const timestamp = nowIso();
    const completedAt = ["completed", "rejected", "cancelled"].includes(status) ? timestamp : null;
    const result = await this.database
      .prepare(
        `UPDATE human_tasks SET
          status = ?,
          resolution = COALESCE(?, resolution),
          completed_at = COALESCE(?, completed_at),
          updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(status, resolution ?? null, completedAt, timestamp, id)
      .run();

    if (result.meta.changes !== 1) {
      throw new NotFoundError("human task", id);
    }

    return this.getById(id);
  }

  async softDelete(id: string): Promise<void> {
    const timestamp = nowIso();
    const result = await this.database
      .prepare("UPDATE human_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(timestamp, timestamp, id)
      .run();

    if (result.meta.changes !== 1) {
      throw new NotFoundError("human task", id);
    }
  }
}
