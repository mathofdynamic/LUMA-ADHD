import { ValidationError } from "../database/errors";
import type { JsonObject, JsonValue } from "../database/validation";
import type { MemoryServices } from "../memory";
import type { MemoryActor } from "../memory/types";

export const AGENT_DOCUMENT_OPERATIONS = [
  "create_document",
  "read_document",
  "edit_document",
  "search_documents",
  "delete_document",
  "restore_document",
  "document_history",
  "read_document_version",
  "reference_document",
  "share_document",
  "list_documents",
] as const;

export type AgentDocumentOperation = (typeof AGENT_DOCUMENT_OPERATIONS)[number];

export interface AgentDocumentOperationInput {
  readonly operation: string;
  readonly actor: MemoryActor;
  readonly logicalPath?: string;
  readonly title?: string;
  readonly contentMarkdown?: string;
  readonly query?: string;
  readonly versionNumber?: number;
  readonly targetAgentId?: string;
  readonly threadId?: string;
  readonly messageId?: string;
  readonly relation?: string;
  readonly changeSummary?: string;
  readonly tags?: readonly string[];
  readonly idempotencyKey: string;
}

const MAX_CONTENT_CHARACTERS = 20_000;
const MAX_RESULT_CHARACTERS = 3_000;

function required(value: string | undefined, field: string): string {
  if (!value || value.trim().length === 0) throw new ValidationError(`file operation requires ${field}`);
  return value;
}

function bounded(value: string, field: string, max = MAX_CONTENT_CHARACTERS): string {
  if (Array.from(value).length > max) throw new ValidationError(`${field} exceeds the bounded file-operation limit`);
  return value;
}

function excerpt(value: string, max = MAX_RESULT_CHARACTERS): string {
  const normalized = value.replace(/\r\n?/gu, "\n");
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}\n[truncated]`;
}

function documentSummary(document: {
  readonly id: string;
  readonly logicalPath: string;
  readonly title: string;
  readonly scope: string;
  readonly ownerAgentId: string | null;
  readonly currentVersion: number;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}): JsonObject {
  return {
    documentId: document.id,
    path: document.logicalPath,
    title: document.title,
    scope: document.scope,
    ownerAgentId: document.ownerAgentId,
    currentVersion: document.currentVersion,
    updatedAt: document.updatedAt,
    deletedAt: document.deletedAt,
  };
}

export class AgentDocumentTools {
  constructor(private readonly memory: MemoryServices) {}

  async execute(input: AgentDocumentOperationInput): Promise<JsonObject> {
    if (!(AGENT_DOCUMENT_OPERATIONS as readonly string[]).includes(input.operation)) {
      throw new ValidationError(`unsupported agent document operation: ${input.operation}`);
    }
    const operation = input.operation as AgentDocumentOperation;
    const actor = input.actor;
    const path = input.logicalPath;

    switch (operation) {
      case "create_document": {
        const created = await this.memory.documents.create({
          actor,
          logicalPath: required(path, "logicalPath"),
          title: required(input.title, "title"),
          contentMarkdown: bounded(input.contentMarkdown ?? "", "contentMarkdown"),
          tags: input.tags,
          threadId: input.threadId,
          changeSummary: input.changeSummary ?? "Initial document version",
        });
        return { operation, ...documentSummary(created.document), contentCharacters: created.currentVersion?.contentMarkdown.length ?? 0 };
      }
      case "read_document": {
        const read = await this.memory.documents.read(required(path, "logicalPath"), actor);
        return {
          operation,
          ...documentSummary(read.document),
          contentMarkdown: excerpt(read.currentVersion?.contentMarkdown ?? ""),
          contentTruncated: (read.currentVersion?.contentMarkdown.length ?? 0) > MAX_RESULT_CHARACTERS,
        };
      }
      case "edit_document": {
        const edited = await this.memory.documents.edit({
          actor,
          logicalPath: required(path, "logicalPath"),
          contentMarkdown: bounded(input.contentMarkdown ?? "", "contentMarkdown"),
          changeSummary: input.changeSummary ?? "Agent document edit",
        });
        return { operation, ...documentSummary(edited.document), contentCharacters: edited.currentVersion?.contentMarkdown.length ?? 0 };
      }
      case "search_documents": {
        const matches = await this.memory.documents.search({
          actor,
          query: bounded(required(input.query, "query"), "query", 500),
          threadId: input.threadId,
          limit: 5,
        });
        return {
          operation,
          matchCount: matches.length,
          matches: matches.map((match) => ({
            sourceId: match.sourceId,
            title: match.title,
            pathOrUrl: match.pathOrUrl,
            excerpt: match.excerpt,
            provenance: match.provenance,
          })) as readonly JsonValue[],
        };
      }
      case "delete_document": {
        await this.memory.documents.delete(required(path, "logicalPath"), actor);
        return { operation, path: required(path, "logicalPath"), deleted: true };
      }
      case "restore_document": {
        const restored = await this.memory.documents.restore(required(path, "logicalPath"), actor);
        return { operation, ...documentSummary(restored), restored: true };
      }
      case "document_history": {
        const history = await this.memory.documents.history(required(path, "logicalPath"), actor);
        return {
          operation,
          path: required(path, "logicalPath"),
          versions: history.map((version) => ({
            versionNumber: version.versionNumber,
            parentVersionId: version.parentVersionId,
            changeSummary: version.changeSummary,
            createdAt: version.createdAt,
            contentMarkdown: excerpt(version.contentMarkdown, 800),
          })) as readonly JsonValue[],
        };
      }
      case "read_document_version": {
        if (!Number.isInteger(input.versionNumber)) throw new ValidationError("read_document_version requires versionNumber");
        const version = await this.memory.documents.readVersion({
          logicalPath: required(path, "logicalPath"),
          versionNumber: input.versionNumber as number,
          actor,
        });
        return {
          operation,
          path: required(path, "logicalPath"),
          versionNumber: version.versionNumber,
          contentMarkdown: excerpt(version.contentMarkdown),
          contentTruncated: version.contentMarkdown.length > MAX_RESULT_CHARACTERS,
          changeSummary: version.changeSummary,
        };
      }
      case "reference_document": {
        const reference = await this.memory.documents.reference({
          actor,
          logicalPath: required(path, "logicalPath"),
          threadId: input.threadId,
          messageId: input.messageId,
          relation: input.relation ?? "reference",
          idempotencyKey: input.idempotencyKey,
        });
        return { operation, referenceId: reference.id, documentId: reference.documentId, path: required(path, "logicalPath") };
      }
      case "share_document": {
        const share = await this.memory.documents.share({
          actor,
          logicalPath: required(path, "logicalPath"),
          targetAgentId: required(input.targetAgentId, "targetAgentId"),
        });
        return { operation, shareId: share.id, documentId: share.documentId, targetAgentId: share.agentId, path: required(path, "logicalPath") };
      }
      case "list_documents": {
        const documents = await this.memory.documents.list({ actor, threadId: input.threadId, limit: 10 });
        return {
          operation,
          documents: documents.map((document) => documentSummary(document)) as readonly JsonValue[],
        };
      }
    }
  }
}
