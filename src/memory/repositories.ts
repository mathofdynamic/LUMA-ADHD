import type { DatabaseClient } from "../database/client";
import { createId, nowIso } from "../database/ids";
import { NotFoundError, ValidationError } from "../database/errors";
import { toJsonObject, toNullableString, toNumber } from "../database/rows";
import { encodeJson, encodeObject, requireLimit, requireNonEmpty, type JsonObject } from "../database/validation";
import { replaceMemorySearchRecord, removeMemorySearchRecord } from "./fts";
import type { KnowledgeSourceDefinition, MemoryNoteInput, ThreadSummaryInput } from "./types";

export interface MemoryNoteRecord {
  readonly id: string;
  readonly scope: "agent" | "organization" | "thread";
  readonly agentId: string | null;
  readonly threadId: string | null;
  readonly title: string;
  readonly contentText: string;
  readonly importance: number;
  readonly sourceMessageId: string | null;
  readonly sourceDocumentId: string | null;
  readonly metadata: JsonObject;
  readonly idempotencyKey: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface DecisionRecord {
  readonly id: string;
  readonly threadId: string;
  readonly title: string;
  readonly status: "proposed" | "accepted" | "rejected" | "superseded";
  readonly decisionText: string;
  readonly rationale: string | null;
  readonly evidence: readonly JsonObject[];
  readonly decidedByAgentId: string | null;
  readonly decidedByUserId: string | null;
  readonly supersedesId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ThreadSummaryRecord {
  readonly id: string;
  readonly threadId: string;
  readonly phaseKey: string;
  readonly summaryMarkdown: string;
  readonly messageCount: number;
  readonly lastMessageId: string | null;
  readonly currentVersion: number;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ThreadSummaryVersionRecord {
  readonly id: string;
  readonly summaryId: string;
  readonly versionNumber: number;
  readonly summaryMarkdown: string;
  readonly messageCount: number;
  readonly lastMessageId: string | null;
  readonly providerName: string | null;
  readonly modelName: string | null;
  readonly idempotencyKey: string | null;
  readonly createdAt: string;
}

export interface KnowledgeSourceRecord {
  readonly id: string;
  readonly documentId: string | null;
  readonly sourceType: string;
  readonly canonicalKey: string;
  readonly title: string | null;
  readonly uri: string | null;
  readonly status: "active" | "stale" | "archived" | "failed";
  readonly metadata: JsonObject;
  readonly normalizedContent: string | null;
  readonly contentHash: string | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly lastAttemptedAt: string | null;
  readonly lastSuccessfulFetchAt: string | null;
  readonly nextRefreshAt: string | null;
  readonly errorSummary: string | null;
  readonly contentVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeChunkRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly documentVersionId: string | null;
  readonly ordinal: number;
  readonly heading: string | null;
  readonly headingPath: string | null;
  readonly contentText: string;
  readonly contentHash: string | null;
  readonly tokenEstimate: number | null;
  readonly metadata: JsonObject;
  readonly createdAt: string;
}

interface MemoryNoteRow {
  id: string; scope: MemoryNoteRecord["scope"]; agent_id: string | null; thread_id: string | null;
  title: string; content_text: string; importance: number; source_message_id: string | null;
  source_document_id: string | null; metadata_json: string; idempotency_key: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}

interface DecisionRow {
  id: string; thread_id: string; title: string; status: DecisionRecord["status"];
  decision_text: string; rationale: string | null; evidence_json: string;
  decided_by_agent_id: string | null; decided_by_user_id: string | null; supersedes_id: string | null;
  created_at: string; updated_at: string;
}

interface SummaryRow {
  id: string; thread_id: string; phase_key: string; summary_markdown: string;
  message_count: number; last_message_id: string | null; current_version: number;
  metadata_json: string; created_at: string; updated_at: string;
}

interface SummaryVersionRow {
  id: string; summary_id: string; version_number: number; summary_markdown: string;
  message_count: number; last_message_id: string | null; provider_name: string | null;
  model_name: string | null; idempotency_key: string | null; created_at: string;
}

interface KnowledgeSourceRow {
  id: string; document_id: string | null; source_type: string; canonical_key: string;
  title: string | null; uri: string | null; status: KnowledgeSourceRecord["status"];
  metadata_json: string; normalized_content: string | null; content_hash: string | null;
  etag: string | null; last_modified: string | null; last_attempted_at: string | null;
  last_successful_fetch_at: string | null; next_refresh_at: string | null;
  error_summary: string | null; content_version: number; created_at: string; updated_at: string;
}

interface KnowledgeChunkRow {
  id: string; source_id: string; document_version_id: string | null; ordinal: number;
  heading: string | null; heading_path: string | null; content_text: string;
  content_hash: string | null; token_estimate: number | null; metadata_json: string; created_at: string;
}

function mapMemoryNote(row: MemoryNoteRow): MemoryNoteRecord {
  return {
    id: row.id, scope: row.scope, agentId: toNullableString(row.agent_id), threadId: toNullableString(row.thread_id),
    title: row.title, contentText: row.content_text, importance: toNumber(row.importance, "memory_notes.importance"),
    sourceMessageId: toNullableString(row.source_message_id), sourceDocumentId: toNullableString(row.source_document_id),
    metadata: toJsonObject(row.metadata_json, "memory_notes.metadata_json"), idempotencyKey: toNullableString(row.idempotency_key),
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: toNullableString(row.deleted_at),
  };
}

function parseEvidence(value: string): readonly JsonObject[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
      throw new Error("evidence must be an array of objects");
    }
    return parsed as JsonObject[];
  } catch (error: unknown) {
    throw new ValidationError(`decision_records.evidence_json is invalid: ${String(error)}`);
  }
}

function mapDecision(row: DecisionRow): DecisionRecord {
  return {
    id: row.id, threadId: row.thread_id, title: row.title, status: row.status,
    decisionText: row.decision_text, rationale: toNullableString(row.rationale), evidence: parseEvidence(row.evidence_json),
    decidedByAgentId: toNullableString(row.decided_by_agent_id), decidedByUserId: toNullableString(row.decided_by_user_id),
    supersedesId: toNullableString(row.supersedes_id), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapSummary(row: SummaryRow): ThreadSummaryRecord {
  return {
    id: row.id, threadId: row.thread_id, phaseKey: row.phase_key, summaryMarkdown: row.summary_markdown,
    messageCount: toNumber(row.message_count, "thread_summaries.message_count"), lastMessageId: toNullableString(row.last_message_id),
    currentVersion: toNumber(row.current_version, "thread_summaries.current_version"), metadata: toJsonObject(row.metadata_json, "thread_summaries.metadata_json"),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapSummaryVersion(row: SummaryVersionRow): ThreadSummaryVersionRecord {
  return {
    id: row.id, summaryId: row.summary_id, versionNumber: row.version_number, summaryMarkdown: row.summary_markdown,
    messageCount: row.message_count, lastMessageId: toNullableString(row.last_message_id), providerName: toNullableString(row.provider_name),
    modelName: toNullableString(row.model_name), idempotencyKey: toNullableString(row.idempotency_key), createdAt: row.created_at,
  };
}

function mapSource(row: KnowledgeSourceRow): KnowledgeSourceRecord {
  return {
    id: row.id, documentId: toNullableString(row.document_id), sourceType: row.source_type, canonicalKey: row.canonical_key,
    title: toNullableString(row.title), uri: toNullableString(row.uri), status: row.status,
    metadata: toJsonObject(row.metadata_json, "knowledge_sources.metadata_json"), normalizedContent: toNullableString(row.normalized_content),
    contentHash: toNullableString(row.content_hash), etag: toNullableString(row.etag), lastModified: toNullableString(row.last_modified),
    lastAttemptedAt: toNullableString(row.last_attempted_at), lastSuccessfulFetchAt: toNullableString(row.last_successful_fetch_at),
    nextRefreshAt: toNullableString(row.next_refresh_at), errorSummary: toNullableString(row.error_summary),
    contentVersion: toNumber(row.content_version, "knowledge_sources.content_version"), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapChunk(row: KnowledgeChunkRow): KnowledgeChunkRecord {
  return {
    id: row.id, sourceId: row.source_id, documentVersionId: toNullableString(row.document_version_id), ordinal: row.ordinal,
    heading: toNullableString(row.heading), headingPath: toNullableString(row.heading_path), contentText: row.content_text,
    contentHash: toNullableString(row.content_hash), tokenEstimate: row.token_estimate === null ? null : toNumber(row.token_estimate, "knowledge_chunks.token_estimate"),
    metadata: toJsonObject(row.metadata_json, "knowledge_chunks.metadata_json"), createdAt: row.created_at,
  };
}

export class MemoryNoteRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: MemoryNoteInput): Promise<MemoryNoteRecord> {
    if (input.scope === "agent" && !input.agentId) throw new ValidationError("agent memory notes require an agent");
    if (input.scope === "thread" && !input.threadId) throw new ValidationError("thread memory notes require a thread");
    const id = createId("memory-note");
    const now = nowIso();
    const metadata: JsonObject = { source: "phase-04", ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) };
    const statement = input.idempotencyKey
      ? `INSERT INTO memory_notes (
          id, scope, agent_id, thread_id, title, content_text, importance,
          source_message_id, source_document_id, metadata_json, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING`
      : `INSERT INTO memory_notes (
          id, scope, agent_id, thread_id, title, content_text, importance,
          source_message_id, source_document_id, metadata_json, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await this.database.prepare(statement).bind(
      id, input.scope, input.agentId ?? null, input.threadId ?? null, requireNonEmpty(input.title, "memory note.title"),
      requireNonEmpty(input.contentText, "memory note.content"), Math.max(0, Math.min(100, Math.round(input.importance ?? 50))),
      input.sourceMessageId ?? null, input.sourceDocumentId ?? null, encodeObject(metadata, "memory note metadata"),
      input.idempotencyKey ?? null, now, now,
    ).run();
    const row = await this.database.prepare(
      "SELECT * FROM memory_notes WHERE idempotency_key = ? OR id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(input.idempotencyKey ?? "", id).first<MemoryNoteRow>();
    if (!row) throw new NotFoundError("memory note", input.idempotencyKey ?? id);
    const record = mapMemoryNote(row);
    if (record.deletedAt === null) {
      await replaceMemorySearchRecord(this.database, {
        sourceKind: "memory_note", sourceId: record.id, title: record.title, contentText: record.contentText,
        tagsText: record.scope, authority: record.scope === "organization" ? 75 : 55, updatedAt: record.updatedAt,
      });
    }
    return record;
  }

  async listForContext(input: { readonly agentId?: string; readonly threadId?: string; readonly limit?: number }): Promise<readonly MemoryNoteRecord[]> {
    const limit = requireLimit(input.limit ?? 10, "memory note limit", 50);
    const rows = await this.database.prepare(
      `SELECT * FROM memory_notes
       WHERE deleted_at IS NULL AND (
         scope = 'organization' OR (scope = 'agent' AND agent_id = ?)
         OR (scope = 'thread' AND thread_id = ?)
       ) ORDER BY importance DESC, updated_at DESC LIMIT ?`,
    ).bind(input.agentId ?? null, input.threadId ?? null, limit).all<MemoryNoteRow>();
    return rows.results.map(mapMemoryNote);
  }
}

export class DecisionRecordRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: {
    readonly id?: string; readonly threadId: string; readonly title: string; readonly decisionText: string;
    readonly status?: DecisionRecord["status"]; readonly rationale?: string; readonly evidence?: readonly JsonObject[];
    readonly decidedByAgentId?: string; readonly decidedByUserId?: string; readonly supersedesId?: string;
  }): Promise<DecisionRecord> {
    if (input.decidedByAgentId && input.decidedByUserId) throw new ValidationError("decision author must be one actor");
    const id = input.id ?? createId("decision");
    const now = nowIso();
    await this.database.prepare(
      `INSERT INTO decision_records (
        id, thread_id, title, status, decision_text, rationale, evidence_json,
        decided_by_agent_id, decided_by_user_id, supersedes_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, input.threadId, requireNonEmpty(input.title, "decision.title"), input.status ?? "proposed",
      requireNonEmpty(input.decisionText, "decision.text"), input.rationale ?? null,
      encodeJson(input.evidence ?? [], "decision evidence"), input.decidedByAgentId ?? null, input.decidedByUserId ?? null,
      input.supersedesId ?? null, now, now,
    ).run();
    const row = await this.database.prepare("SELECT * FROM decision_records WHERE id = ?").bind(id).first<DecisionRow>();
    if (!row) throw new NotFoundError("decision", id);
    const record = mapDecision(row);
    await replaceMemorySearchRecord(this.database, {
      sourceKind: "decision", sourceId: record.id, title: record.title, contentText: `${record.decisionText}\n${record.rationale ?? ""}`,
      tagsText: record.status, authority: 85, updatedAt: record.updatedAt,
    });
    return record;
  }

  async listForThread(threadId: string, limit = 20): Promise<readonly DecisionRecord[]> {
    const safeLimit = requireLimit(limit, "decision limit", 100);
    const rows = await this.database.prepare(
      "SELECT * FROM decision_records WHERE thread_id = ? ORDER BY updated_at DESC LIMIT ?",
    ).bind(threadId, safeLimit).all<DecisionRow>();
    return rows.results.map(mapDecision);
  }
}

export class ThreadSummaryRepository {
  constructor(private readonly database: DatabaseClient) {}

  async get(threadId: string, phaseKey = "overall"): Promise<ThreadSummaryRecord | null> {
    const row = await this.database.prepare(
      "SELECT * FROM thread_summaries WHERE thread_id = ? AND phase_key = ?",
    ).bind(threadId, phaseKey).first<SummaryRow>();
    return row ? mapSummary(row) : null;
  }

  async upsert(input: ThreadSummaryInput): Promise<ThreadSummaryRecord> {
    const phaseKey = input.phaseKey ?? "overall";
    if (input.idempotencyKey) {
      const existingVersion = await this.database.prepare(
        "SELECT summary_id FROM thread_summary_versions WHERE idempotency_key = ?",
      ).bind(input.idempotencyKey).first<{ summary_id: string }>();
      if (existingVersion) {
        const existing = await this.database.prepare("SELECT * FROM thread_summaries WHERE id = ?").bind(existingVersion.summary_id).first<SummaryRow>();
        if (existing) return mapSummary(existing);
      }
    }
    const current = await this.get(input.threadId, phaseKey);
    const now = nowIso();
    const summaryId = current?.id ?? createId("thread-summary");
    const version = (current?.currentVersion ?? 0) + 1;
    await this.database.batch([
      this.database.prepare(
        `INSERT INTO thread_summaries (
          id, thread_id, phase_key, summary_markdown, message_count, last_message_id,
          current_version, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, phase_key) DO UPDATE SET
          summary_markdown = excluded.summary_markdown, message_count = excluded.message_count,
          last_message_id = excluded.last_message_id, current_version = excluded.current_version,
          metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
      ).bind(
        summaryId, input.threadId, phaseKey, requireNonEmpty(input.summaryMarkdown, "thread summary"), input.messageCount,
        input.lastMessageId ?? null, version, encodeObject(input.metadata, "thread summary metadata"), now, now,
      ),
      this.database.prepare(
        `INSERT INTO thread_summary_versions (
          id, summary_id, version_number, summary_markdown, message_count, last_message_id,
          provider_name, model_name, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        createId("thread-summary-version"), summaryId, version, input.summaryMarkdown, input.messageCount,
        input.lastMessageId ?? null, input.providerName ?? null, input.modelName ?? null, input.idempotencyKey ?? null, now,
      ),
    ]);
    const row = await this.database.prepare("SELECT * FROM thread_summaries WHERE id = ?").bind(summaryId).first<SummaryRow>();
    if (!row) throw new NotFoundError("thread summary", summaryId);
    const record = mapSummary(row);
    await replaceMemorySearchRecord(this.database, {
      sourceKind: "thread_summary", sourceId: record.id, title: `Thread summary: ${record.phaseKey}`,
      contentText: record.summaryMarkdown, tagsText: record.phaseKey, authority: 80, updatedAt: record.updatedAt,
    });
    return record;
  }

  async listVersions(summaryId: string, limit = 20): Promise<readonly ThreadSummaryVersionRecord[]> {
    const safeLimit = requireLimit(limit, "summary history limit", 100);
    const rows = await this.database.prepare(
      "SELECT * FROM thread_summary_versions WHERE summary_id = ? ORDER BY version_number DESC LIMIT ?",
    ).bind(summaryId, safeLimit).all<SummaryVersionRow>();
    return rows.results.map(mapSummaryVersion);
  }
}

export class KnowledgeSourceRepository {
  constructor(private readonly database: DatabaseClient) {}

  async ensureOfficialSources(definitions: readonly KnowledgeSourceDefinition[]): Promise<void> {
    if (definitions.length === 0) return;
    const existing = await this.database.prepare(
      `SELECT canonical_key FROM knowledge_sources WHERE canonical_key IN (${definitions.map(() => "?").join(", ")})`,
    ).bind(...definitions.map((definition) => definition.canonicalKey)).all<{ canonical_key: string }>();
    const present = new Set(existing.results.map((row) => row.canonical_key));
    const missing = definitions.filter((definition) => !present.has(definition.canonicalKey));
    if (missing.length === 0) return;
    const now = nowIso();
    await this.database.batch(missing.map((definition) => this.database.prepare(
      `INSERT OR IGNORE INTO knowledge_sources (
        id, source_type, canonical_key, title, uri, status, metadata_json, created_at, updated_at
      ) VALUES (?, 'url', ?, ?, ?, 'active', ?, ?, ?)
      `,
    ).bind(
      `knowledge-source-${definition.slug}`, definition.canonicalKey, definition.title, definition.url,
      encodeObject({ official: true, sourceKey: definition.key }, "knowledge source metadata"), now, now,
    )));
  }

  async getByKey(canonicalKey: string): Promise<KnowledgeSourceRecord | null> {
    const row = await this.database.prepare("SELECT * FROM knowledge_sources WHERE canonical_key = ? LIMIT 1").bind(canonicalKey).first<KnowledgeSourceRow>();
    return row ? mapSource(row) : null;
  }

  async listAll(limit = 100): Promise<readonly KnowledgeSourceRecord[]> {
    const rows = await this.database.prepare("SELECT * FROM knowledge_sources ORDER BY canonical_key LIMIT ?").bind(requireLimit(limit, "source limit", 100)).all<KnowledgeSourceRow>();
    return rows.results.map(mapSource);
  }

  async listDue(asOf: string, limit = 1): Promise<readonly KnowledgeSourceRecord[]> {
    const rows = await this.database.prepare(
      `SELECT * FROM knowledge_sources
       WHERE source_type = 'url' AND status <> 'archived'
         AND (next_refresh_at IS NULL OR next_refresh_at <= ?)
       ORDER BY COALESCE(next_refresh_at, ''), canonical_key LIMIT ?`,
    ).bind(asOf, requireLimit(limit, "due source limit", 20)).all<KnowledgeSourceRow>();
    return rows.results.map(mapSource);
  }

  async updateSyncState(input: {
    readonly sourceId: string; readonly status: KnowledgeSourceRecord["status"]; readonly attemptedAt: string;
    readonly successfulAt?: string | null; readonly nextRefreshAt?: string | null; readonly etag?: string | null;
    readonly lastModified?: string | null; readonly normalizedContent?: string | null; readonly contentHash?: string | null;
    readonly errorSummary?: string | null; readonly incrementVersion?: boolean;
  }): Promise<KnowledgeSourceRecord> {
    const source = await this.database.prepare("SELECT * FROM knowledge_sources WHERE id = ?").bind(input.sourceId).first<KnowledgeSourceRow>();
    if (!source) throw new NotFoundError("knowledge source", input.sourceId);
    const version = source.content_version + (input.incrementVersion ? 1 : 0);
    await this.database.prepare(
      `UPDATE knowledge_sources SET status = ?, last_attempted_at = ?, last_successful_fetch_at = COALESCE(?, last_successful_fetch_at),
        next_refresh_at = COALESCE(?, next_refresh_at), etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified),
        normalized_content = COALESCE(?, normalized_content), content_hash = COALESCE(?, content_hash),
        error_summary = ?, content_version = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      input.status, input.attemptedAt, input.successfulAt ?? null, input.nextRefreshAt ?? null,
      input.etag ?? null, input.lastModified ?? null, input.normalizedContent ?? null, input.contentHash ?? null,
      input.errorSummary ?? null, version, input.attemptedAt, input.sourceId,
    ).run();
    const updated = await this.database.prepare("SELECT * FROM knowledge_sources WHERE id = ?").bind(input.sourceId).first<KnowledgeSourceRow>();
    if (!updated) throw new NotFoundError("knowledge source", input.sourceId);
    return mapSource(updated);
  }

  async setDocumentId(sourceId: string, documentId: string): Promise<void> {
    await this.database.prepare("UPDATE knowledge_sources SET document_id = ?, updated_at = ? WHERE id = ?").bind(documentId, nowIso(), sourceId).run();
  }

  async replaceChunks(sourceId: string, chunks: readonly {
    readonly id: string; readonly documentVersionId?: string; readonly ordinal: number; readonly heading?: string;
    readonly headingPath?: string; readonly contentText: string; readonly contentHash: string; readonly tokenEstimate?: number;
    readonly metadata?: JsonObject;
  }[]): Promise<readonly KnowledgeChunkRecord[]> {
    await removeMemorySearchRecord(this.database, "knowledge_source", sourceId);
    const existing = await this.database.prepare("SELECT id FROM knowledge_chunks WHERE source_id = ?").bind(sourceId).all<{ id: string }>();
    const statements = [this.database.prepare("DELETE FROM knowledge_chunks WHERE source_id = ?").bind(sourceId)];
    for (const row of existing.results) statements.push(this.database.prepare("DELETE FROM institutional_memory_fts WHERE source_kind = 'knowledge_chunk' AND source_id = ?").bind(row.id));
    for (const chunk of chunks) {
      statements.push(this.database.prepare(
        `INSERT INTO knowledge_chunks (
          id, source_id, document_version_id, ordinal, heading, heading_path, content_text,
          content_hash, token_estimate, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        chunk.id, sourceId, chunk.documentVersionId ?? null, chunk.ordinal, chunk.heading ?? null, chunk.headingPath ?? null,
        chunk.contentText, chunk.contentHash, chunk.tokenEstimate ?? null, encodeObject(chunk.metadata, "knowledge chunk metadata"), nowIso(),
      ));
      statements.push(this.database.prepare(
        `INSERT INTO institutional_memory_fts (
          source_kind, source_id, title, path_or_url, content_text, tags_text, authority, updated_at
        ) VALUES ('knowledge_chunk', ?, ?, ?, ?, ?, 100, ?)`,
      ).bind(chunk.id, chunk.heading ?? "LUMA official knowledge", null, chunk.contentText, chunk.headingPath ?? "", nowIso()));
    }
    await this.database.batch(statements);
    const rows = await this.database.prepare("SELECT * FROM knowledge_chunks WHERE source_id = ? ORDER BY ordinal LIMIT ?").bind(sourceId, requireLimit(Math.max(1, chunks.length), "chunk limit", 1000)).all<KnowledgeChunkRow>();
    return rows.results.map(mapChunk);
  }

  async listChunks(sourceId: string, limit = 100): Promise<readonly KnowledgeChunkRecord[]> {
    const rows = await this.database.prepare("SELECT * FROM knowledge_chunks WHERE source_id = ? ORDER BY ordinal LIMIT ?").bind(sourceId, requireLimit(limit, "chunk limit", 1000)).all<KnowledgeChunkRow>();
    return rows.results.map(mapChunk);
  }
}
