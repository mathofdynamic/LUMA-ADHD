import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireLimit, requireNonEmpty } from "../validation";
import { canonicalizeLogicalPath } from "../../memory/paths";
import { removeMemorySearchRecord, replaceMemorySearchRecord } from "../../memory/fts";
import type {
  AppendDocumentRevisionInput,
  CreateDocumentInput,
  DocumentRecord,
  DocumentReferenceRecord,
  DocumentShareRecord,
  DocumentVersionRecord,
  DocumentWithCurrentVersion,
} from "../types";

interface DocumentRow {
  id: string;
  scope: DocumentRecord["scope"];
  owner_agent_id: string | null;
  thread_id: string | null;
  title: string;
  slug: string | null;
  logical_path: string;
  tags_json: string;
  document_type: string;
  current_version: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface DocumentVersionRow {
  id: string;
  document_id: string;
  version_number: number;
  parent_version_id: string | null;
  content_markdown: string;
  change_summary: string | null;
  checksum: string | null;
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
}

interface DocumentShareRow {
  id: string;
  document_id: string;
  agent_id: string;
  granted_by_agent_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface DocumentReferenceRow {
  id: string;
  document_id: string;
  thread_id: string | null;
  message_id: string | null;
  referenced_by_agent_id: string | null;
  relation: string;
  metadata_json: string;
  idempotency_key: string;
  created_at: string;
}

function parseTags(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("tags must be an array of strings");
    }
    return parsed as string[];
  } catch (error: unknown) {
    throw new ValidationError(`documents.tags_json is invalid: ${String(error)}`);
  }
}

function normalizeTags(tags: readonly string[] | undefined): readonly string[] {
  const values = [...new Set((tags ?? []).map((tag) => tag.normalize("NFC").trim()).filter(Boolean))];
  if (values.length > 32 || values.some((tag) => Array.from(tag).length > 80)) {
    throw new ValidationError("document tags are limited to 32 values of 80 characters each");
  }
  return values;
}

function fallbackLogicalPath(input: CreateDocumentInput, id: string): string {
  const slug = (input.slug ?? input.title)
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || id;
  const prefix = input.scope === "shared" ? "/shared/legacy" : `/legacy/${input.scope}`;
  return `${prefix}/${slug}-${id}.md`;
}

function mapDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    scope: row.scope,
    ownerAgentId: toNullableString(row.owner_agent_id),
    threadId: toNullableString(row.thread_id),
    title: row.title,
    slug: toNullableString(row.slug),
    logicalPath: row.logical_path,
    tags: parseTags(row.tags_json),
    documentType: row.document_type,
    currentVersion: toNumber(row.current_version, "documents.current_version"),
    metadata: toJsonObject(row.metadata_json, "documents.metadata_json"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: toNullableString(row.deleted_at),
  };
}

function mapVersion(row: DocumentVersionRow): DocumentVersionRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    versionNumber: toNumber(row.version_number, "document_versions.version_number"),
    parentVersionId: toNullableString(row.parent_version_id),
    contentMarkdown: row.content_markdown,
    changeSummary: toNullableString(row.change_summary),
    checksum: toNullableString(row.checksum),
    createdByAgentId: toNullableString(row.created_by_agent_id),
    createdByUserId: toNullableString(row.created_by_user_id),
    createdAt: row.created_at,
  };
}

function mapShare(row: DocumentShareRow): DocumentShareRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    agentId: row.agent_id,
    grantedByAgentId: toNullableString(row.granted_by_agent_id),
    createdAt: row.created_at,
    revokedAt: toNullableString(row.revoked_at),
  };
}

function mapReference(row: DocumentReferenceRow): DocumentReferenceRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    threadId: toNullableString(row.thread_id),
    messageId: toNullableString(row.message_id),
    referencedByAgentId: toNullableString(row.referenced_by_agent_id),
    relation: row.relation,
    metadata: toJsonObject(row.metadata_json, "document_references.metadata_json"),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

function validateOwnership(input: CreateDocumentInput): void {
  if (input.scope === "shared" && (input.ownerAgentId !== undefined || input.threadId !== undefined)) {
    throw new ValidationError("shared documents cannot have an agent owner or thread");
  }

  if (input.scope === "agent" && (input.ownerAgentId === undefined || input.threadId !== undefined)) {
    throw new ValidationError("agent documents require an agent owner and cannot have a thread");
  }

  if (input.scope === "thread" && input.threadId === undefined) {
    throw new ValidationError("thread documents require a thread");
  }
}

function validateRevisionAuthor(input: { readonly createdByAgentId?: string; readonly createdByUserId?: string }): void {
  if (input.createdByAgentId !== undefined && input.createdByUserId !== undefined) {
    throw new ValidationError("document revision author must be an agent or a user, not both");
  }
}

export class DocumentRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateDocumentInput): Promise<DocumentWithCurrentVersion> {
    validateOwnership(input);
    validateRevisionAuthor(input);
    const id = input.id ?? createId("document");
    const title = requireNonEmpty(input.title, "document.title");
    const logicalPath = canonicalizeLogicalPath(input.logicalPath ?? fallbackLogicalPath(input, id));
    const tags = normalizeTags(input.tags);
    const timestamp = nowIso();

    await this.database
      .prepare(
        `INSERT INTO documents (
          id, scope, owner_agent_id, thread_id, title, slug, logical_path, tags_json,
          document_type, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.scope,
        input.ownerAgentId ?? null,
        input.threadId ?? null,
        title,
        input.slug ?? null,
        logicalPath,
        JSON.stringify(tags),
        input.documentType ?? "markdown",
        encodeObject(input.metadata, "document.metadata"),
        timestamp,
        timestamp,
      )
      .run();

    if (input.initialContent !== undefined) {
      await this.appendRevision({
        documentId: id,
        contentMarkdown: input.initialContent,
        changeSummary: input.changeSummary,
        createdByAgentId: input.createdByAgentId,
        createdByUserId: input.createdByUserId,
      });
    }

    return this.getWithCurrentVersion(id);
  }

  async getById(id: string): Promise<DocumentRecord> {
    const row = await this.database
      .prepare("SELECT * FROM documents WHERE id = ?")
      .bind(id)
      .first<DocumentRow>();
    if (!row) throw new NotFoundError("document", id);
    return mapDocument(row);
  }

  async getByLogicalPath(logicalPath: string, includeDeleted = false): Promise<DocumentRecord | null> {
    const canonicalPath = canonicalizeLogicalPath(logicalPath);
    const row = await this.database
      .prepare(
        `SELECT * FROM documents
         WHERE logical_path = ? AND (? = 1 OR deleted_at IS NULL)
         LIMIT 1`,
      )
      .bind(canonicalPath, includeDeleted ? 1 : 0)
      .first<DocumentRow>();
    return row ? mapDocument(row) : null;
  }

  async getWithCurrentVersion(id: string): Promise<DocumentWithCurrentVersion> {
    const document = await this.getById(id);
    const row = await this.database
      .prepare("SELECT * FROM document_versions WHERE document_id = ? AND version_number = ?")
      .bind(id, document.currentVersion)
      .first<DocumentVersionRow>();
    return { document, currentVersion: row ? mapVersion(row) : null };
  }

  async listByOwner(ownerAgentId: string | null, limit = 100): Promise<readonly DocumentRecord[]> {
    const safeLimit = requireLimit(limit, "document list limit", 500);
    const result = await this.database
      .prepare(
        `SELECT * FROM documents
         WHERE deleted_at IS NULL AND (
           (owner_agent_id = ? AND scope = 'agent')
           OR (? IS NULL AND scope = 'shared')
         )
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .bind(ownerAgentId, ownerAgentId, safeLimit)
      .all<DocumentRow>();
    return result.results.map(mapDocument);
  }

  async appendRevision(input: AppendDocumentRevisionInput): Promise<DocumentVersionRecord> {
    validateRevisionAuthor(input);
    const document = await this.getById(input.documentId);
    if (document.deletedAt !== null) throw new ValidationError("cannot revise a deleted document");
    const currentVersion = await this.getVersion(input.documentId, document.currentVersion);
    if (input.parentVersionId !== undefined && input.parentVersionId !== (currentVersion?.id ?? null)) {
      throw new ValidationError("document revision parent does not match the current version");
    }
    const versionNumber = document.currentVersion + 1;
    const versionId = createId("document-version");
    const timestamp = nowIso();
    const results = await this.database.batch<DocumentVersionRow>([
      this.database
        .prepare(
          `UPDATE documents
           SET current_version = current_version + 1, updated_at = ?
           WHERE id = ? AND current_version = ? AND deleted_at IS NULL`,
        )
        .bind(timestamp, input.documentId, document.currentVersion),
      this.database
        .prepare(
          `INSERT INTO document_versions (
            id, document_id, version_number, parent_version_id, content_markdown,
            change_summary, checksum, created_by_agent_id, created_by_user_id, created_at
          )
          SELECT ?, id, current_version, ?, ?, ?, ?, ?, ?, ?
          FROM documents
          WHERE id = ? AND current_version = ? AND deleted_at IS NULL`,
        )
        .bind(
          versionId,
          currentVersion?.id ?? null,
          input.contentMarkdown,
          input.changeSummary ?? null,
          input.checksum ?? null,
          input.createdByAgentId ?? null,
          input.createdByUserId ?? null,
          timestamp,
          input.documentId,
          versionNumber,
        ),
      this.database.prepare("SELECT * FROM document_versions WHERE id = ?").bind(versionId),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      throw new ValidationError("document changed while a revision was being appended; retry the operation");
    }
    const row = results[2]?.results[0];
    if (!row) throw new NotFoundError("document version", versionId);
    const version = mapVersion(row);
    await this.refreshSearchIndex(input.documentId);
    return version;
  }

  async getVersion(documentId: string, versionNumber: number): Promise<DocumentVersionRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM document_versions WHERE document_id = ? AND version_number = ?")
      .bind(documentId, versionNumber)
      .first<DocumentVersionRow>();
    return row ? mapVersion(row) : null;
  }

  async listVersions(documentId: string, limit = 100): Promise<readonly DocumentVersionRecord[]> {
    const safeLimit = requireLimit(limit, "document history limit", 500);
    const result = await this.database
      .prepare(
        `SELECT * FROM document_versions
         WHERE document_id = ? ORDER BY version_number DESC LIMIT ?`,
      )
      .bind(documentId, safeLimit)
      .all<DocumentVersionRow>();
    return result.results.map(mapVersion);
  }

  async softDelete(id: string): Promise<void> {
    const timestamp = nowIso();
    const result = await this.database
      .prepare("UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(timestamp, timestamp, id)
      .run();
    if (result.meta.changes !== 1) throw new NotFoundError("document", id);
    await removeMemorySearchRecord(this.database, "document", id);
  }

  async restore(id: string): Promise<DocumentRecord> {
    const timestamp = nowIso();
    const result = await this.database
      .prepare("UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL")
      .bind(timestamp, id)
      .run();
    if (result.meta.changes !== 1) throw new NotFoundError("deleted document", id);
    await this.refreshSearchIndex(id);
    return this.getById(id);
  }

  async share(input: {
    readonly documentId: string;
    readonly agentId: string;
    readonly grantedByAgentId?: string;
  }): Promise<DocumentShareRecord> {
    const id = createId("document-share");
    const timestamp = nowIso();
    await this.database
      .prepare(
        `INSERT INTO document_shares (id, document_id, agent_id, granted_by_agent_id, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(document_id, agent_id) DO UPDATE SET
           granted_by_agent_id = excluded.granted_by_agent_id, revoked_at = NULL`,
      )
      .bind(id, input.documentId, input.agentId, input.grantedByAgentId ?? null, timestamp)
      .run();
    const row = await this.database
      .prepare("SELECT * FROM document_shares WHERE document_id = ? AND agent_id = ?")
      .bind(input.documentId, input.agentId)
      .first<DocumentShareRow>();
    if (!row) throw new NotFoundError("document share", `${input.documentId}:${input.agentId}`);
    return mapShare(row);
  }

  async revokeShare(documentId: string, agentId: string): Promise<void> {
    await this.database
      .prepare("UPDATE document_shares SET revoked_at = ? WHERE document_id = ? AND agent_id = ? AND revoked_at IS NULL")
      .bind(nowIso(), documentId, agentId)
      .run();
  }

  async hasActiveShare(documentId: string, agentId: string): Promise<boolean> {
    const row = await this.database
      .prepare("SELECT 1 AS present FROM document_shares WHERE document_id = ? AND agent_id = ? AND revoked_at IS NULL")
      .bind(documentId, agentId)
      .first<{ present: number }>();
    return row?.present === 1;
  }

  async reference(input: {
    readonly documentId: string;
    readonly threadId?: string;
    readonly messageId?: string;
    readonly referencedByAgentId?: string;
    readonly relation?: string;
    readonly idempotencyKey: string;
    readonly metadata?: import("../validation").JsonObject;
  }): Promise<DocumentReferenceRecord> {
    if (!input.threadId && !input.messageId) throw new ValidationError("a document reference requires a thread or message");
    const id = createId("document-reference");
    await this.database
      .prepare(
        `INSERT INTO document_references (
          id, document_id, thread_id, message_id, referenced_by_agent_id,
          relation, metadata_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(
        id,
        input.documentId,
        input.threadId ?? null,
        input.messageId ?? null,
        input.referencedByAgentId ?? null,
        input.relation ?? "reference",
        encodeObject(input.metadata, "document reference metadata"),
        input.idempotencyKey,
        nowIso(),
      )
      .run();
    const row = await this.database
      .prepare("SELECT * FROM document_references WHERE idempotency_key = ?")
      .bind(input.idempotencyKey)
      .first<DocumentReferenceRow>();
    if (!row) throw new NotFoundError("document reference", input.idempotencyKey);
    return mapReference(row);
  }

  private async refreshSearchIndex(documentId: string): Promise<void> {
    const row = await this.database
      .prepare(
        `SELECT d.id, d.title, d.logical_path, d.tags_json, d.updated_at,
                v.content_markdown
         FROM documents d
         LEFT JOIN document_versions v
           ON v.document_id = d.id AND v.version_number = d.current_version
         WHERE d.id = ? AND d.deleted_at IS NULL`,
      )
      .bind(documentId)
      .first<{
        id: string;
        title: string;
        logical_path: string;
        tags_json: string;
        updated_at: string;
        content_markdown: string | null;
      }>();
    if (!row || row.content_markdown === null) {
      await removeMemorySearchRecord(this.database, "document", documentId);
      return;
    }
    await replaceMemorySearchRecord(this.database, {
      sourceKind: "document",
      sourceId: row.id,
      title: row.title,
      pathOrUrl: row.logical_path,
      contentText: row.content_markdown,
      tagsText: parseTags(row.tags_json).join(" "),
      authority: 60,
      updatedAt: row.updated_at,
    });
  }
}
