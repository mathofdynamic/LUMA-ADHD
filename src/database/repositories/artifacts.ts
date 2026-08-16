import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireLimit, requireNonEmpty, type JsonObject } from "../validation";
import type {
  ArtifactDeliveryStatus,
  ArtifactRecord,
  ArtifactRenderStatus,
  ArtifactRevisionRecord,
  ArtifactStatus,
} from "../types";

interface ArtifactRow {
  id: string;
  artifact_type: ArtifactRecord["artifactType"];
  title: string;
  source_text: string | null;
  format: string | null;
  thread_id: string | null;
  document_id: string | null;
  message_id: string | null;
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  status: ArtifactStatus;
  spec_json: string | null;
  source_hash: string | null;
  render_status: ArtifactRenderStatus;
  render_attempt_count: number;
  render_error: string | null;
  rendered_at: string | null;
  delivery_status: ArtifactDeliveryStatus;
  delivery_error: string | null;
  telegram_chat_id: string | null;
  telegram_message_id: string | null;
  telegram_bot_alias: string | null;
  telegram_file_id: string | null;
  idempotency_key: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ArtifactRevisionRow {
  id: string;
  artifact_id: string;
  revision_number: number;
  source_text: string;
  metadata_json: string;
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
}

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    artifactType: row.artifact_type,
    title: row.title,
    sourceText: toNullableString(row.source_text),
    format: toNullableString(row.format),
    threadId: toNullableString(row.thread_id),
    documentId: toNullableString(row.document_id),
    messageId: toNullableString(row.message_id),
    createdByAgentId: toNullableString(row.created_by_agent_id),
    createdByUserId: toNullableString(row.created_by_user_id),
    status: row.status,
    spec: row.spec_json ? toJsonObject(row.spec_json, "artifacts.spec_json") : null,
    sourceHash: toNullableString(row.source_hash),
    renderStatus: row.render_status,
    renderAttemptCount: toNumber(row.render_attempt_count, "artifacts.render_attempt_count"),
    renderError: toNullableString(row.render_error),
    renderedAt: toNullableString(row.rendered_at),
    deliveryStatus: row.delivery_status,
    deliveryError: toNullableString(row.delivery_error),
    telegramChatId: toNullableString(row.telegram_chat_id),
    telegramMessageId: toNullableString(row.telegram_message_id),
    telegramBotAlias: toNullableString(row.telegram_bot_alias),
    telegramFileId: toNullableString(row.telegram_file_id),
    metadata: toJsonObject(row.metadata_json, "artifacts.metadata_json"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: toNullableString(row.deleted_at),
  };
}

function mapRevision(row: ArtifactRevisionRow): ArtifactRevisionRecord {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    revisionNumber: toNumber(row.revision_number, "artifact_revisions.revision_number"),
    sourceText: row.source_text,
    metadata: toJsonObject(row.metadata_json, "artifact_revisions.metadata_json"),
    createdByAgentId: toNullableString(row.created_by_agent_id),
    createdByUserId: toNullableString(row.created_by_user_id),
    createdAt: row.created_at,
  };
}

export interface CreateArtifactInput {
  readonly id?: string;
  readonly title: string;
  readonly sourceText: string;
  readonly spec: JsonObject;
  readonly sourceHash?: string;
  readonly format?: string;
  readonly threadId?: string;
  readonly messageId?: string;
  readonly createdByAgentId?: string;
  readonly createdByUserId?: string;
  readonly metadata?: JsonObject;
  readonly idempotencyKey?: string;
}

export class ArtifactRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    if (input.createdByAgentId !== undefined && input.createdByUserId !== undefined) {
      throw new ValidationError("artifact creator must be an agent or user, not both");
    }
    const id = input.id ?? createId("artifact");
    const title = requireNonEmpty(input.title, "artifact.title");
    const timestamp = nowIso();
    if (input.idempotencyKey) {
      const existing = await this.database.prepare(
        "SELECT id FROM artifacts WHERE idempotency_key = ?",
      ).bind(input.idempotencyKey).first<{ id: string }>();
      if (existing) return this.getById(existing.id);
    }
    await this.database.prepare(
      `INSERT INTO artifacts (
        id, artifact_type, title, source_text, format, thread_id, message_id,
        created_by_agent_id, created_by_user_id, status, metadata_json,
        spec_json, source_hash, render_status, delivery_status, idempotency_key, created_at, updated_at
      ) VALUES (?, 'diagram', ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, 'not_requested', 'not_requested', ?, ?, ?)
      ON CONFLICT DO NOTHING`,
    ).bind(
      id, title, input.sourceText, input.format ?? "luma-diagram-v1", input.threadId ?? null,
      input.messageId ?? null, input.createdByAgentId ?? null, input.createdByUserId ?? null,
      encodeObject(input.metadata, "artifact.metadata"), encodeObject(input.spec, "artifact.spec"),
      input.sourceHash ?? null, input.idempotencyKey ?? null, timestamp, timestamp,
    ).run();

    if (input.idempotencyKey) {
      const existing = await this.database.prepare(
        "SELECT id FROM artifacts WHERE idempotency_key = ?",
      ).bind(input.idempotencyKey).first<{ id: string }>();
      if (!existing) throw new NotFoundError("artifact idempotency key", input.idempotencyKey);
      if (existing.id !== id) return this.getById(existing.id);
    }
    const artifact = await this.getById(id);
    await this.createRevision({
      artifactId: artifact.id,
      revisionNumber: 1,
      sourceText: input.sourceText,
      metadata: { specHash: input.sourceHash ?? null, changeSummary: "initial diagram" },
      createdByAgentId: input.createdByAgentId,
      createdByUserId: input.createdByUserId,
    });
    return artifact;
  }

  async getById(id: string): Promise<ArtifactRecord> {
    const row = await this.database.prepare("SELECT * FROM artifacts WHERE id = ?").bind(id).first<ArtifactRow>();
    if (!row) throw new NotFoundError("artifact", id);
    return mapArtifact(row);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ArtifactRecord | null> {
    const row = await this.database.prepare(
      "SELECT * FROM artifacts WHERE idempotency_key = ? LIMIT 1",
    ).bind(idempotencyKey).first<ArtifactRow>();
    return row ? mapArtifact(row) : null;
  }

  async list(input: { readonly limit?: number; readonly includeDeleted?: boolean } = {}): Promise<readonly ArtifactRecord[]> {
    const limit = requireLimit(input.limit ?? 50, "artifact list limit", 200);
    const result = await this.database.prepare(
      `SELECT * FROM artifacts WHERE (? = 1 OR deleted_at IS NULL)
       ORDER BY updated_at DESC LIMIT ?`,
    ).bind(input.includeDeleted === true ? 1 : 0, limit).all<ArtifactRow>();
    return result.results.map(mapArtifact);
  }

  async listRevisions(artifactId: string, limit = 100): Promise<readonly ArtifactRevisionRecord[]> {
    const safeLimit = requireLimit(limit, "artifact revision limit", 200);
    const result = await this.database.prepare(
      "SELECT * FROM artifact_revisions WHERE artifact_id = ? ORDER BY revision_number DESC LIMIT ?",
    ).bind(artifactId, safeLimit).all<ArtifactRevisionRow>();
    return result.results.map(mapRevision);
  }

  async createRevision(input: {
    readonly id?: string;
    readonly artifactId: string;
    readonly revisionNumber?: number;
    readonly sourceText: string;
    readonly metadata?: JsonObject;
    readonly createdByAgentId?: string;
    readonly createdByUserId?: string;
  }): Promise<ArtifactRevisionRecord> {
    if (input.createdByAgentId !== undefined && input.createdByUserId !== undefined) {
      throw new ValidationError("artifact revision creator must be an agent or user, not both");
    }
    const revisionNumber = input.revisionNumber ?? ((await this.database.prepare(
      "SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision FROM artifact_revisions WHERE artifact_id = ?",
    ).bind(input.artifactId).first<{ next_revision: number }>())?.next_revision ?? 1);
    const id = input.id ?? createId("artifact-revision");
    await this.database.prepare(
      `INSERT INTO artifact_revisions (
        id, artifact_id, revision_number, source_text, metadata_json,
        created_by_agent_id, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (artifact_id, revision_number) DO NOTHING`,
    ).bind(id, input.artifactId, revisionNumber, input.sourceText, encodeObject(input.metadata, "artifactRevision.metadata"), input.createdByAgentId ?? null, input.createdByUserId ?? null, nowIso()).run();
    const row = await this.database.prepare(
      "SELECT * FROM artifact_revisions WHERE artifact_id = ? AND revision_number = ?",
    ).bind(input.artifactId, revisionNumber).first<ArtifactRevisionRow>();
    if (!row) throw new NotFoundError("artifact revision", `${input.artifactId}:${revisionNumber}`);
    return mapRevision(row);
  }

  async updateRender(input: {
    readonly id: string;
    readonly status: ArtifactRenderStatus;
    readonly error?: string;
    readonly incrementAttempt?: boolean;
  }): Promise<ArtifactRecord> {
    const result = await this.database.prepare(
      `UPDATE artifacts SET render_status = ?, render_error = ?,
         render_attempt_count = render_attempt_count + ?,
         rendered_at = CASE WHEN ? = 'rendered' THEN COALESCE(rendered_at, ?) ELSE rendered_at END,
         status = CASE WHEN ? = 'rendered' THEN 'rendered' WHEN ? IN ('failed','unavailable','quota_exhausted') THEN 'ready' ELSE status END,
         updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    ).bind(input.status, input.error ?? null, input.incrementAttempt === false ? 0 : 1, input.status, nowIso(), input.status, input.status, nowIso(), input.id).run();
    if (result.meta.changes !== 1) throw new NotFoundError("artifact", input.id);
    return this.getById(input.id);
  }

  async updateDelivery(input: {
    readonly id: string;
    readonly status: ArtifactDeliveryStatus;
    readonly telegramChatId?: string;
    readonly telegramMessageId?: string;
    readonly telegramBotAlias?: string;
    readonly telegramFileId?: string;
    readonly error?: string;
  }): Promise<ArtifactRecord> {
    const result = await this.database.prepare(
      `UPDATE artifacts SET delivery_status = ?, delivery_error = ?,
         telegram_chat_id = COALESCE(?, telegram_chat_id), telegram_message_id = COALESCE(?, telegram_message_id),
         telegram_bot_alias = COALESCE(?, telegram_bot_alias), telegram_file_id = COALESCE(?, telegram_file_id),
         updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    ).bind(input.status, input.error ?? null, input.telegramChatId ?? null, input.telegramMessageId ?? null, input.telegramBotAlias ?? null, input.telegramFileId ?? null, nowIso(), input.id).run();
    if (result.meta.changes !== 1) throw new NotFoundError("artifact", input.id);
    return this.getById(input.id);
  }

  async archive(id: string): Promise<ArtifactRecord> {
    const result = await this.database.prepare(
      "UPDATE artifacts SET status = 'archived', deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    ).bind(nowIso(), nowIso(), id).run();
    if (result.meta.changes !== 1) throw new NotFoundError("artifact", id);
    return this.getById(id);
  }

  async restore(id: string): Promise<ArtifactRecord> {
    const result = await this.database.prepare(
      "UPDATE artifacts SET status = CASE WHEN status = 'archived' THEN 'ready' ELSE status END, deleted_at = NULL, updated_at = ? WHERE id = ?",
    ).bind(nowIso(), id).run();
    if (result.meta.changes !== 1) throw new NotFoundError("artifact", id);
    return this.getById(id);
  }
}
