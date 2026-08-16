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
  reason: string;
  blocking: number;
  target_human_user_id: string | null;
  request_key: string | null;
  request_message_id: string | null;
  response_message_id: string | null;
  responded_by_user_id: string | null;
  response_source: HumanTaskRecord["responseSource"];
  resolved_at: string | null;
  telegram_chat_id: string | null;
  telegram_message_id: string | null;
  telegram_bot_alias: string | null;
  telegram_outbound_id: string | null;
  projection_status: HumanTaskRecord["projectionStatus"];
  projection_error: string | null;
  wake_job_id: string | null;
  response_metadata_json: string;
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
    reason: row.reason ?? "",
    blocking: row.blocking === 1,
    targetHumanUserId: toNullableString(row.target_human_user_id),
    requestKey: toNullableString(row.request_key),
    requestMessageId: toNullableString(row.request_message_id),
    responseMessageId: toNullableString(row.response_message_id),
    respondedByUserId: toNullableString(row.responded_by_user_id),
    responseSource: row.response_source,
    resolvedAt: toNullableString(row.resolved_at),
    telegramChatId: toNullableString(row.telegram_chat_id),
    telegramMessageId: toNullableString(row.telegram_message_id),
    telegramBotAlias: toNullableString(row.telegram_bot_alias),
    telegramOutboundId: toNullableString(row.telegram_outbound_id),
    projectionStatus: row.projection_status,
    projectionError: toNullableString(row.projection_error),
    wakeJobId: toNullableString(row.wake_job_id),
    responseMetadata: toJsonObject(row.response_metadata_json, "human_tasks.response_metadata_json"),
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
          reason, blocking, target_human_user_id, request_key,
          metadata_json, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        input.reason?.trim() || "",
        input.blocking === true ? 1 : 0,
        input.targetHumanUserId ?? null,
        input.requestKey?.trim() || null,
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

  async list(input: { readonly status?: string | null; readonly threadId?: string; readonly limit?: number } = {}): Promise<readonly HumanTaskRecord[]> {
    const safeLimit = requireLimit(input.limit ?? 50, "human task list limit", 200);
    const statuses = ["open", "claimed", "in_progress", "blocked", "completed", "rejected", "cancelled"];
    const status = input.status && statuses.includes(input.status) ? input.status : null;
    const result = await this.database.prepare(
      `SELECT * FROM human_tasks
       WHERE deleted_at IS NULL
         AND (? IS NULL OR status = ?)
         AND (? IS NULL OR thread_id = ?)
       ORDER BY priority DESC, created_at ASC LIMIT ?`,
    ).bind(status, status, input.threadId ?? null, input.threadId ?? null, safeLimit).all<HumanTaskRow>();
    return result.results.map(mapTask);
  }

  async findOpenEquivalent(input: { readonly threadId?: string; readonly requestedByAgentId?: string; readonly requestKey: string }): Promise<HumanTaskRecord | null> {
    const row = await this.database.prepare(
      `SELECT * FROM human_tasks
       WHERE deleted_at IS NULL
         AND request_key = ?
         AND (? IS NULL OR thread_id = ?)
         AND (? IS NULL OR requested_by_agent_id = ?)
         AND status IN ('open', 'claimed', 'in_progress', 'blocked')
       ORDER BY created_at ASC LIMIT 1`,
    ).bind(input.requestKey, input.threadId ?? null, input.threadId ?? null, input.requestedByAgentId ?? null, input.requestedByAgentId ?? null).first<HumanTaskRow>();
    return row ? mapTask(row) : null;
  }

  async findByRequestKey(requestKey: string): Promise<HumanTaskRecord | null> {
    const row = await this.database.prepare(
      "SELECT * FROM human_tasks WHERE request_key = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1",
    ).bind(requestKey).first<HumanTaskRow>();
    return row ? mapTask(row) : null;
  }

  async findByTelegramMessage(telegramChatId: string, telegramMessageId: string): Promise<HumanTaskRecord | null> {
    const row = await this.database.prepare(
      "SELECT * FROM human_tasks WHERE telegram_chat_id = ? AND telegram_message_id = ? AND deleted_at IS NULL LIMIT 1",
    ).bind(telegramChatId, telegramMessageId).first<HumanTaskRow>();
    return row ? mapTask(row) : null;
  }

  async updateProjection(input: {
    readonly id: string;
    readonly status: HumanTaskRecord["projectionStatus"];
    readonly telegramChatId?: string;
    readonly telegramMessageId?: string;
    readonly telegramBotAlias?: string;
    readonly telegramOutboundId?: string;
    readonly requestMessageId?: string;
    readonly error?: string;
  }): Promise<HumanTaskRecord> {
    const result = await this.database.prepare(
      `UPDATE human_tasks SET projection_status = ?,
         telegram_chat_id = COALESCE(?, telegram_chat_id),
         telegram_message_id = COALESCE(?, telegram_message_id),
         telegram_bot_alias = COALESCE(?, telegram_bot_alias),
         telegram_outbound_id = COALESCE(?, telegram_outbound_id),
         request_message_id = COALESCE(?, request_message_id),
         projection_error = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).bind(input.status, input.telegramChatId ?? null, input.telegramMessageId ?? null, input.telegramBotAlias ?? null, input.telegramOutboundId ?? null, input.requestMessageId ?? null, input.error ?? null, nowIso(), input.id).run();
    if (result.meta.changes !== 1) throw new NotFoundError("human task", input.id);
    return this.getById(input.id);
  }

  async resolve(input: {
    readonly id: string;
    readonly resolution: string;
    readonly responseMessageId?: string;
    readonly respondedByUserId?: string;
    readonly responseSource: "telegram" | "admin";
    readonly responseMetadata?: import("../../database/validation").JsonObject;
    readonly wakeJobId?: string;
  }): Promise<HumanTaskRecord> {
    const timestamp = nowIso();
    const result = await this.database.prepare(
      `UPDATE human_tasks SET status = 'completed', resolution = ?,
         response_message_id = COALESCE(?, response_message_id),
         responded_by_user_id = COALESCE(?, responded_by_user_id),
         response_source = ?, response_metadata_json = ?,
         resolved_at = COALESCE(resolved_at, ?), completed_at = COALESCE(completed_at, ?),
         wake_job_id = COALESCE(?, wake_job_id), updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND status IN ('open', 'claimed', 'in_progress', 'blocked')`,
    ).bind(input.resolution.trim(), input.responseMessageId ?? null, input.respondedByUserId ?? null, input.responseSource, encodeObject(input.responseMetadata, "humanTask.responseMetadata"), timestamp, timestamp, input.wakeJobId ?? null, timestamp, input.id).run();
    if (result.meta.changes !== 1) {
      const existing = await this.getById(input.id);
      if (existing.status === "completed" && existing.responseSource === input.responseSource) return existing;
      throw new ValidationError(`human task '${input.id}' is not open`);
    }
    return this.getById(input.id);
  }

  async countOpenBlocking(threadId: string): Promise<number> {
    const row = await this.database.prepare(
      `SELECT COUNT(*) AS count FROM human_tasks
       WHERE thread_id = ? AND deleted_at IS NULL AND blocking = 1
         AND status IN ('open', 'claimed', 'in_progress', 'blocked')`,
    ).bind(threadId).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async updateStatus(
    id: string,
    status: HumanTaskStatus,
    resolution?: string,
    options: { readonly responseSource?: "admin" | "telegram"; readonly respondedByUserId?: string } = {},
  ): Promise<HumanTaskRecord> {
    const timestamp = nowIso();
    const completedAt = ["completed", "rejected", "cancelled"].includes(status) ? timestamp : null;
    const result = await this.database
      .prepare(
        `UPDATE human_tasks SET
          status = ?,
          resolution = COALESCE(?, resolution),
          response_source = COALESCE(?, response_source),
          responded_by_user_id = COALESCE(?, responded_by_user_id),
          completed_at = COALESCE(?, completed_at),
          resolved_at = COALESCE(?, resolved_at),
          updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(status, resolution ?? null, options.responseSource ?? null, options.respondedByUserId ?? null, completedAt, completedAt, timestamp, id)
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
