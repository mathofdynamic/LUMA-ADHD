import type {
  AgentId,
  DocumentId,
  MessageId,
  ThreadId,
} from "../database/types";
import type { JsonObject } from "../database/validation";

export type MemoryItemType =
  | "document"
  | "knowledge_chunk"
  | "message"
  | "thread_summary"
  | "decision"
  | "memory_note";

export interface MemoryActor {
  readonly agentId?: AgentId;
  readonly userId?: string;
  readonly system?: boolean;
}

export interface ContextPackItem {
  readonly type: MemoryItemType;
  readonly sourceId: string;
  readonly title: string;
  readonly pathOrUrl: string | null;
  readonly excerpt: string;
  readonly authority: number;
  readonly score: number;
  readonly updatedAt: string;
  readonly threadId?: ThreadId | null;
  readonly ownerAgentId?: AgentId | null;
  readonly provenance: Readonly<Record<string, string | number | null>>;
}

export interface ContextPack {
  readonly query: string;
  readonly items: readonly ContextPackItem[];
  readonly totalCharacters: number;
  readonly truncated: boolean;
}

export interface DocumentCreateRequest {
  readonly logicalPath: string;
  readonly title: string;
  readonly contentMarkdown: string;
  readonly tags?: readonly string[];
  readonly threadId?: ThreadId;
  readonly metadata?: JsonObject;
}

export interface DocumentEditRequest {
  readonly logicalPath: string;
  readonly contentMarkdown: string;
  readonly changeSummary?: string;
}

export interface MemoryNoteInput {
  readonly scope: "agent" | "organization" | "thread";
  readonly agentId?: AgentId;
  readonly threadId?: ThreadId;
  readonly title: string;
  readonly contentText: string;
  readonly importance?: number;
  readonly sourceMessageId?: MessageId;
  readonly sourceDocumentId?: DocumentId;
  readonly idempotencyKey?: string;
}

export interface ThreadSummaryInput {
  readonly threadId: ThreadId;
  readonly phaseKey?: string;
  readonly summaryMarkdown: string;
  readonly messageCount: number;
  readonly lastMessageId?: MessageId;
  readonly providerName?: string;
  readonly modelName?: string;
  readonly metadata?: JsonObject;
  readonly idempotencyKey?: string;
}

export interface KnowledgeSourceDefinition {
  readonly key: string;
  readonly canonicalKey: string;
  readonly slug: string;
  readonly title: string;
  readonly url: string;
}

export interface KnowledgeSyncResult {
  readonly sourceKey: string;
  readonly status: "updated" | "unchanged" | "failed";
  readonly chunksCreated: number;
  readonly contentHash: string | null;
  readonly errorSummary?: string;
}
