import type { JsonObject } from "./validation";

export type AgentId = string;
export type UserId = string;
export type ThreadId = string;
export type MessageId = string;
export type JobId = string;
export type DocumentId = string;

export type ThreadState =
  | "open"
  | "exploring"
  | "debating"
  | "evidence_gathering"
  | "developing"
  | "synthesizing"
  | "human_required"
  | "blocked"
  | "decided"
  | "rejected"
  | "parked"
  | "reopened";

export type ThreadParticipantRole = "owner" | "contributor" | "observer";
export type MessageAuthorType = "human" | "agent" | "system";
export type MessageVisibility = "public" | "internal" | "private";
export type MessageOrigin = "internal" | "telegram" | "system" | "external";
export type JobStatus = "pending" | "claimed" | "retry_scheduled" | "completed" | "failed" | "cancelled";
export type JobRunStatus = "claimed" | "completed" | "failed" | "abandoned";
export type HumanTaskStatus =
  | "open"
  | "claimed"
  | "in_progress"
  | "blocked"
  | "completed"
  | "rejected"
  | "cancelled";

export interface AgentRecord {
  readonly id: AgentId;
  readonly slug: string;
  readonly displayName: string;
  readonly specialty: string;
  readonly specialtyDescription: string;
  readonly soul: string;
  readonly personality: string;
  readonly rank: number;
  readonly isSupervisor: boolean;
  readonly isActive: boolean;
  readonly config: JsonObject;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface AgentConfigurationRecord {
  readonly id: string;
  readonly agentId: AgentId;
  readonly version: number;
  readonly providerRole: string;
  readonly modelKey: string | null;
  readonly promptVersion: string | null;
  readonly config: JsonObject;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface UserRecord {
  readonly id: UserId;
  readonly externalKey: string | null;
  readonly displayName: string;
  readonly username: string | null;
  readonly isAdmin: boolean;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface ChatRecord {
  readonly id: string;
  readonly telegramChatId: string | null;
  readonly chatType: "private" | "group" | "supergroup" | "channel" | "internal";
  readonly title: string | null;
  readonly isWorkspace: boolean;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface ThreadRecord {
  readonly id: ThreadId;
  readonly chatId: string | null;
  readonly title: string;
  readonly state: ThreadState;
  readonly priority: number;
  readonly summary: string | null;
  readonly turnBudget: number;
  readonly turnsUsed: number;
  readonly phaseBudget: number;
  readonly phaseTurnsUsed: number;
  readonly cycleBudget: number;
  readonly cycleDepth: number;
  readonly createdByUserId: UserId | null;
  readonly createdByAgentId: AgentId | null;
  readonly telegramTopicId: string | null;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastActivityAt: string;
  readonly closedAt: string | null;
  readonly deletedAt: string | null;
}

export interface MessageRecord {
  readonly id: MessageId;
  readonly threadId: ThreadId;
  readonly chatId: string | null;
  readonly authorType: MessageAuthorType;
  readonly authorUserId: UserId | null;
  readonly authorAgentId: AgentId | null;
  readonly contentText: string;
  readonly replyToMessageId: MessageId | null;
  readonly visibility: MessageVisibility;
  readonly origin: MessageOrigin;
  readonly telegramChatId: string | null;
  readonly telegramMessageId: string | null;
  readonly telegramBotAlias: string | null;
  readonly telegramUpdateId: string | null;
  readonly idempotencyKey: string | null;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deletedAt: string | null;
}

export interface JobRecord {
  readonly id: JobId;
  readonly jobType: string;
  readonly status: JobStatus;
  readonly payload: JsonObject;
  readonly idempotencyKey: string;
  readonly dueAt: string;
  readonly priority: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly chainDepth: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
}

export interface HumanTaskRecord {
  readonly id: string;
  readonly threadId: ThreadId | null;
  readonly requestedByAgentId: AgentId | null;
  readonly requestedByUserId: UserId | null;
  readonly assigneeUserId: UserId | null;
  readonly title: string;
  readonly description: string;
  readonly status: HumanTaskStatus;
  readonly priority: number;
  readonly dueAt: string | null;
  readonly resolution: string | null;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly deletedAt: string | null;
}

export type DocumentScope = "shared" | "agent" | "thread";

export interface DocumentRecord {
  readonly id: DocumentId;
  readonly scope: DocumentScope;
  readonly ownerAgentId: AgentId | null;
  readonly threadId: ThreadId | null;
  readonly title: string;
  readonly slug: string | null;
  readonly documentType: string;
  readonly currentVersion: number;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface DocumentVersionRecord {
  readonly id: string;
  readonly documentId: DocumentId;
  readonly versionNumber: number;
  readonly contentMarkdown: string;
  readonly changeSummary: string | null;
  readonly checksum: string | null;
  readonly createdByAgentId: AgentId | null;
  readonly createdByUserId: UserId | null;
  readonly createdAt: string;
}

export interface DocumentWithCurrentVersion {
  readonly document: DocumentRecord;
  readonly currentVersion: DocumentVersionRecord | null;
}

export interface StoredEvent {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly threadId: ThreadId | null;
  readonly jobId: JobId | null;
  readonly actorType: MessageAuthorType;
  readonly actorUserId: UserId | null;
  readonly actorAgentId: AgentId | null;
  readonly idempotencyKey: string;
  readonly payload: JsonObject;
  readonly occurredAt: string;
  readonly processedAt: string | null;
}

export interface ActorRef {
  readonly type: MessageAuthorType;
  readonly userId?: UserId;
  readonly agentId?: AgentId;
}

export interface CreateAgentInput {
  readonly id?: AgentId;
  readonly slug: string;
  readonly displayName: string;
  readonly specialty: string;
  readonly specialtyDescription?: string;
  readonly soul?: string;
  readonly personality?: string;
  readonly rank?: number;
  readonly isSupervisor?: boolean;
  readonly config?: JsonObject;
  readonly metadata?: JsonObject;
}

export interface CreateUserInput {
  readonly id?: UserId;
  readonly externalKey?: string;
  readonly displayName: string;
  readonly username?: string;
  readonly isAdmin?: boolean;
  readonly metadata?: JsonObject;
}

export interface CreateChatInput {
  readonly id?: string;
  readonly telegramChatId?: string;
  readonly chatType: ChatRecord["chatType"];
  readonly title?: string;
  readonly isWorkspace?: boolean;
  readonly metadata?: JsonObject;
}

export interface CreateThreadInput {
  readonly id?: ThreadId;
  readonly chatId?: string;
  readonly title: string;
  readonly state?: ThreadState;
  readonly priority?: number;
  readonly summary?: string;
  readonly turnBudget?: number;
  readonly phaseBudget?: number;
  readonly cycleBudget?: number;
  readonly createdByUserId?: UserId;
  readonly createdByAgentId?: AgentId;
  readonly metadata?: JsonObject;
}

export interface CreateMessageInput {
  readonly id?: MessageId;
  readonly threadId: ThreadId;
  readonly chatId?: string;
  readonly authorType: MessageAuthorType;
  readonly authorUserId?: UserId;
  readonly authorAgentId?: AgentId;
  readonly contentText: string;
  readonly replyToMessageId?: MessageId;
  readonly visibility?: MessageVisibility;
  readonly origin?: MessageOrigin;
  readonly telegramChatId?: string;
  readonly telegramMessageId?: string;
  readonly telegramBotAlias?: string;
  readonly telegramUpdateId?: string;
  readonly idempotencyKey?: string;
  readonly metadata?: JsonObject;
}

export interface CreateJobInput {
  readonly id?: JobId;
  readonly jobType: string;
  readonly payload?: JsonObject;
  readonly idempotencyKey: string;
  readonly dueAt: string;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly chainDepth?: number;
}

export interface CreateHumanTaskInput {
  readonly id?: string;
  readonly threadId?: ThreadId;
  readonly requestedByAgentId?: AgentId;
  readonly requestedByUserId?: UserId;
  readonly assigneeUserId?: UserId;
  readonly title: string;
  readonly description: string;
  readonly priority?: number;
  readonly dueAt?: string;
  readonly metadata?: JsonObject;
}

export interface CreateDocumentInput {
  readonly id?: DocumentId;
  readonly scope: DocumentScope;
  readonly ownerAgentId?: AgentId;
  readonly threadId?: ThreadId;
  readonly title: string;
  readonly slug?: string;
  readonly documentType?: string;
  readonly initialContent?: string;
  readonly changeSummary?: string;
  readonly createdByAgentId?: AgentId;
  readonly createdByUserId?: UserId;
  readonly metadata?: JsonObject;
}

export interface AppendDocumentRevisionInput {
  readonly documentId: DocumentId;
  readonly contentMarkdown: string;
  readonly changeSummary?: string;
  readonly checksum?: string;
  readonly createdByAgentId?: AgentId;
  readonly createdByUserId?: UserId;
}

export interface CreateEventInput {
  readonly id?: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly threadId?: ThreadId;
  readonly jobId?: JobId;
  readonly actor?: ActorRef;
  readonly idempotencyKey: string;
  readonly payload?: JsonObject;
  readonly occurredAt?: string;
}

export interface ClaimedJob extends JobRecord {
  readonly runId: string;
}

export interface ScheduledJobRecord {
  readonly id: string;
  readonly scheduleKey: string;
  readonly jobType: string;
  readonly scheduleExpression: string;
  readonly payload: JsonObject;
  readonly nextRunAt: string;
  readonly lastEnqueuedAt: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTurnRecord {
  readonly id: string;
  readonly jobId: JobId | null;
  readonly threadId: ThreadId;
  readonly agentId: AgentId;
  readonly sequenceNumber: number;
  readonly status: "planned" | "running" | "completed" | "failed" | "skipped";
  readonly inputMessageId: MessageId | null;
  readonly outputMessageId: MessageId | null;
  readonly wakeReason: string | null;
  readonly budgetUnits: number;
  readonly metadata: JsonObject;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}
