import type { createRepositories } from "../database/repositories";
import { ValidationError } from "../database/errors";
import { requireLimit } from "../database/validation";
import type { JsonObject } from "../database/validation";
import { canonicalizeLogicalPath, pathScope, pathSegments } from "./paths";
import type { DocumentRecord, DocumentWithCurrentVersion } from "../database/types";
import type { MemoryActor } from "./types";
import { InstitutionalMemorySearch } from "./retrieval";

type Repositories = ReturnType<typeof createRepositories>;

function unauthorized(): never {
  throw new ValidationError("agent does not have access to this logical document path");
}

export class DocumentService {
  private readonly searchService: InstitutionalMemorySearch;

  constructor(private readonly repositories: Repositories) {
    this.searchService = new InstitutionalMemorySearch(repositories.database);
  }

  async create(input: {
    readonly actor?: MemoryActor;
    readonly logicalPath: string;
    readonly title: string;
    readonly contentMarkdown: string;
    readonly tags?: readonly string[];
    readonly threadId?: string;
    readonly metadata?: JsonObject;
    readonly changeSummary?: string;
  }): Promise<DocumentWithCurrentVersion> {
    const path = canonicalizeLogicalPath(input.logicalPath);
    const scope = await this.resolveScope(path, input.threadId);
    await this.assertWriteAccess(scope, input.actor);
    return this.repositories.documents.create({
      scope: scope.scope,
      ownerAgentId: scope.ownerAgentId,
      threadId: scope.threadId,
      logicalPath: path,
      title: input.title,
      initialContent: input.contentMarkdown,
      tags: input.tags,
      metadata: input.metadata,
      changeSummary: input.changeSummary ?? "Initial document version",
      createdByAgentId: input.actor?.agentId,
      createdByUserId: input.actor?.userId,
    });
  }

  async read(logicalPath: string, actor?: MemoryActor): Promise<DocumentWithCurrentVersion> {
    const document = await this.getActive(logicalPath);
    await this.assertReadAccess(document, actor);
    return this.repositories.documents.getWithCurrentVersion(document.id);
  }

  async edit(input: {
    readonly actor?: MemoryActor;
    readonly logicalPath: string;
    readonly contentMarkdown: string;
    readonly changeSummary?: string;
  }): Promise<DocumentWithCurrentVersion> {
    const document = await this.getActive(input.logicalPath);
    await this.assertWriteAccess(document, input.actor);
    await this.repositories.documents.appendRevision({
      documentId: document.id,
      contentMarkdown: input.contentMarkdown,
      changeSummary: input.changeSummary,
      createdByAgentId: input.actor?.agentId,
      createdByUserId: input.actor?.userId,
    });
    return this.repositories.documents.getWithCurrentVersion(document.id);
  }

  async restoreVersion(input: {
    readonly actor?: MemoryActor;
    readonly logicalPath: string;
    readonly versionNumber: number;
    readonly changeSummary?: string;
  }): Promise<DocumentWithCurrentVersion> {
    const document = await this.getActive(input.logicalPath);
    await this.assertWriteAccess(document, input.actor);
    const version = await this.repositories.documents.getVersion(document.id, input.versionNumber);
    if (!version) throw new ValidationError("document version was not found");
    await this.repositories.documents.appendRevision({
      documentId: document.id,
      contentMarkdown: version.contentMarkdown,
      changeSummary: input.changeSummary ?? `Restored content from version ${input.versionNumber}`,
      createdByAgentId: input.actor?.agentId,
      createdByUserId: input.actor?.userId,
      parentVersionId: (await this.repositories.documents.getVersion(document.id, document.currentVersion))?.id,
    });
    return this.repositories.documents.getWithCurrentVersion(document.id);
  }

  async history(logicalPath: string, actor?: MemoryActor) {
    const document = await this.getIncludingDeleted(logicalPath);
    await this.assertReadAccess(document, actor);
    return this.repositories.documents.listVersions(document.id);
  }

  async readVersion(input: {
    readonly logicalPath: string;
    readonly versionNumber: number;
    readonly actor?: MemoryActor;
  }) {
    if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1 || input.versionNumber > 500) {
      throw new ValidationError("document version must be an integer between 1 and 500");
    }
    const document = await this.getIncludingDeleted(input.logicalPath);
    await this.assertReadAccess(document, input.actor);
    const version = await this.repositories.documents.getVersion(document.id, input.versionNumber);
    if (!version) throw new ValidationError("document version was not found");
    return version;
  }

  async search(input: {
    readonly query: string;
    readonly actor?: MemoryActor;
    readonly threadId?: string;
    readonly limit?: number;
  }) {
    if (typeof input.query !== "string" || input.query.trim().length === 0) return [];
    const matches = await this.searchService.search(input.query, {
      agentId: input.actor?.agentId,
      threadId: input.threadId,
      topK: requireLimit(input.limit ?? 5, "document search limit", 20),
      sourceKinds: ["document"],
    });
    return matches.filter((match) => match.type === "document");
  }

  async list(input: {
    readonly actor?: MemoryActor;
    readonly threadId?: string;
    readonly includeDeleted?: boolean;
    readonly limit?: number;
  } = {}) {
    if (!input.actor?.system && !input.actor?.agentId && !input.actor?.userId) unauthorized();
    return this.repositories.documents.listAccessible({
      agentId: input.actor?.agentId,
      threadId: input.threadId,
      system: input.actor?.system,
      includeDeleted: input.includeDeleted,
      limit: input.limit,
    });
  }

  async delete(logicalPath: string, actor?: MemoryActor): Promise<void> {
    const document = await this.getActive(logicalPath);
    await this.assertWriteAccess(document, actor);
    await this.repositories.documents.softDelete(document.id);
  }

  async restore(logicalPath: string, actor?: MemoryActor): Promise<DocumentRecord> {
    const document = await this.getIncludingDeleted(logicalPath);
    await this.assertWriteAccess(document, actor);
    return this.repositories.documents.restore(document.id);
  }

  async reference(input: {
    readonly logicalPath: string;
    readonly actor?: MemoryActor;
    readonly threadId?: string;
    readonly messageId?: string;
    readonly relation?: string;
    readonly idempotencyKey: string;
  }) {
    const document = await this.getActive(input.logicalPath);
    await this.assertReadAccess(document, input.actor);
    return this.repositories.documents.reference({
      documentId: document.id,
      threadId: input.threadId,
      messageId: input.messageId,
      referencedByAgentId: input.actor?.agentId,
      relation: input.relation,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async share(input: {
    readonly logicalPath: string;
    readonly actor?: MemoryActor;
    readonly targetAgentId: string;
  }) {
    const document = await this.getActive(input.logicalPath);
    if (!input.actor?.system && !input.actor?.agentId && !input.actor?.userId) unauthorized();
    if (!input.actor?.system && input.actor?.agentId !== document.ownerAgentId && document.scope !== "shared") unauthorized();
    return this.repositories.documents.share({
      documentId: document.id,
      agentId: input.targetAgentId,
      grantedByAgentId: input.actor?.agentId,
    });
  }

  private async getActive(logicalPath: string): Promise<DocumentRecord> {
    const document = await this.repositories.documents.getByLogicalPath(logicalPath);
    if (!document) throw new ValidationError("logical document was not found");
    return document;
  }

  private async getIncludingDeleted(logicalPath: string): Promise<DocumentRecord> {
    const document = await this.repositories.documents.getByLogicalPath(logicalPath, true);
    if (!document) throw new ValidationError("logical document was not found");
    return document;
  }

  private async resolveScope(path: string, threadId?: string): Promise<{
    readonly scope: "shared" | "agent" | "thread";
    readonly ownerAgentId?: string;
    readonly threadId?: string;
  }> {
    const kind = pathScope(path);
    const segments = pathSegments(path);
    if (kind === "shared") {
      if (threadId) throw new ValidationError("shared documents cannot belong to a thread");
      return { scope: "shared" };
    }
    if (kind === "agent") {
      if (segments.length < 3) throw new ValidationError("agent document path must include an agent and file name");
      const agent = await this.repositories.agents.findBySlug(segments[1] as string);
      if (!agent) throw new ValidationError("agent workspace does not exist");
      if (threadId) throw new ValidationError("agent documents cannot belong to a thread");
      return { scope: "agent", ownerAgentId: agent.id };
    }
    if (kind === "god") {
      if (threadId) throw new ValidationError("GOD review documents cannot belong to a thread");
      const god = await this.repositories.agents.findBySlug("god");
      if (!god) throw new ValidationError("GOD identity does not exist");
      return { scope: "agent", ownerAgentId: god.id };
    }
    if (segments[0] === "threads" && segments.length >= 3 && threadId) {
      if (segments[1] !== threadId) throw new ValidationError("thread logical path does not match threadId");
      return { scope: "thread", threadId };
    }
    throw new ValidationError("logical path must be under /agents, /shared, /god, or /threads");
  }

  private async assertReadAccess(document: DocumentRecord, actor?: MemoryActor): Promise<void> {
    if (!actor?.system && !actor?.agentId && !actor?.userId) unauthorized();
    if (actor?.system || document.scope === "shared") return;
    if (document.scope === "agent" && actor?.agentId === document.ownerAgentId) return;
    if (document.scope === "agent" && actor?.agentId && await this.repositories.documents.hasActiveShare(document.id, actor.agentId)) return;
    if (document.scope === "thread" && (actor?.agentId || actor?.userId)) return;
    unauthorized();
  }

  private async assertWriteAccess(
    documentOrScope: DocumentRecord | { readonly scope: "shared" | "agent" | "thread"; readonly ownerAgentId?: string },
    actor?: MemoryActor,
  ): Promise<void> {
    if (!actor?.system && !actor?.agentId && !actor?.userId) unauthorized();
    if (actor?.system || documentOrScope.scope === "shared") return;
    if (documentOrScope.scope === "agent" && actor?.agentId === documentOrScope.ownerAgentId) return;
    if (documentOrScope.scope === "thread" && (actor?.agentId || actor?.userId)) return;
    unauthorized();
  }
}
