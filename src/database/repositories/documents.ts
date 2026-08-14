import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireLimit, requireNonEmpty } from "../validation";
import type {
  AppendDocumentRevisionInput,
  CreateDocumentInput,
  DocumentRecord,
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
  content_markdown: string;
  change_summary: string | null;
  checksum: string | null;
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
}

function mapDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    scope: row.scope,
    ownerAgentId: toNullableString(row.owner_agent_id),
    threadId: toNullableString(row.thread_id),
    title: row.title,
    slug: toNullableString(row.slug),
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
    contentMarkdown: row.content_markdown,
    changeSummary: toNullableString(row.change_summary),
    checksum: toNullableString(row.checksum),
    createdByAgentId: toNullableString(row.created_by_agent_id),
    createdByUserId: toNullableString(row.created_by_user_id),
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
    const timestamp = nowIso();

    await this.database
      .prepare(
        `INSERT INTO documents (
          id, scope, owner_agent_id, thread_id, title, slug, document_type,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.scope,
        input.ownerAgentId ?? null,
        input.threadId ?? null,
        title,
        input.slug ?? null,
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

    if (!row) {
      throw new NotFoundError("document", id);
    }

    return mapDocument(row);
  }

  async getWithCurrentVersion(id: string): Promise<DocumentWithCurrentVersion> {
    const document = await this.getById(id);
    const row = await this.database
      .prepare(
        `SELECT * FROM document_versions
         WHERE document_id = ? AND version_number = ?`,
      )
      .bind(id, document.currentVersion)
      .first<DocumentVersionRow>();

    return {
      document,
      currentVersion: row ? mapVersion(row) : null,
    };
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
    if (document.deletedAt !== null) {
      throw new ValidationError("cannot revise a deleted document");
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
            id, document_id, version_number, content_markdown, change_summary,
            checksum, created_by_agent_id, created_by_user_id, created_at
          )
          SELECT ?, id, current_version, ?, ?, ?, ?, ?, ?
          FROM documents
          WHERE id = ? AND current_version = ? AND deleted_at IS NULL`,
        )
        .bind(
          versionId,
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
    if (!row) {
      throw new NotFoundError("document version", versionId);
    }

    return mapVersion(row);
  }

  async softDelete(id: string): Promise<void> {
    const timestamp = nowIso();
    const result = await this.database
      .prepare("UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(timestamp, timestamp, id)
      .run();

    if (result.meta.changes !== 1) {
      throw new NotFoundError("document", id);
    }
  }
}
