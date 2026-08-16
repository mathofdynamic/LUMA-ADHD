import type { AgentId, DocumentId, JobId, MessageId, ThreadId, UserId } from "../database/types";
import type { JsonObject } from "../database/validation";

export const REPUTATION_DIMENSIONS = [
  "epistemic",
  "contribution",
  "outcome",
  "collaboration",
] as const;

export type ReputationDimension = typeof REPUTATION_DIMENSIONS[number];

export const REPUTATION_DOMAINS = [
  "product_strategy",
  "growth",
  "ux_creative",
  "engineering_architecture",
  "finance_pricing",
  "customer_experience",
  "operations",
  "critical_analysis",
  "general",
] as const;

export type ReputationDomain = typeof REPUTATION_DOMAINS[number];

export type ReputationEvidenceType =
  | "proposal"
  | "prediction"
  | "critique"
  | "outcome"
  | "human"
  | "god"
  | "system";

export interface ReputationEventRecord {
  readonly id: string;
  readonly agentId: AgentId;
  readonly domain: ReputationDomain;
  readonly dimension: ReputationDimension;
  readonly eventType: ReputationEvidenceType;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly evaluationId: string | null;
  readonly signal: number;
  readonly evidenceSummary: string | null;
  readonly probability: number | null;
  readonly observedResult: boolean | null;
  readonly confidence: number | null;
  readonly processedAt: string | null;
  readonly scoringRunId: string | null;
  readonly scoringVersion: string | null;
  readonly metadata: JsonObject;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface ReputationDomainStateRecord {
  readonly agentId: AgentId;
  readonly domain: ReputationDomain;
  readonly epistemic: number;
  readonly contribution: number;
  readonly outcome: number;
  readonly collaboration: number;
  readonly rank: number;
  readonly evidenceCount: number;
  readonly updatedAt: string;
}

export interface ReputationSnapshotRecord {
  readonly id: string;
  readonly agentId: AgentId;
  readonly domain: ReputationDomain;
  readonly epistemic: number;
  readonly contribution: number;
  readonly outcome: number;
  readonly collaboration: number;
  readonly epistemicBefore: number;
  readonly contributionBefore: number;
  readonly outcomeBefore: number;
  readonly collaborationBefore: number;
  readonly combinedScore: number;
  readonly rankBefore: number;
  readonly rankAfter: number;
  readonly rankDelta: number;
  readonly targetRank: number;
  readonly influenceWeight: number;
  readonly evidenceCount: number;
  readonly scoringRunId: string | null;
  readonly scoringDay: string | null;
  readonly scoringVersion: string;
  readonly basis: JsonObject;
  readonly capturedAt: string;
}

export interface ReputationScoringRunRecord {
  readonly id: string;
  readonly scoringDay: string;
  readonly scoringVersion: string;
  readonly status: "running" | "completed" | "failed";
  readonly idempotencyKey: string;
  readonly evidenceCount: number;
  readonly snapshotCount: number;
  readonly metadata: JsonObject;
  readonly errorSummary: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface CreateReputationEventInput {
  readonly id?: string;
  readonly agentId: AgentId;
  readonly domain: ReputationDomain;
  readonly dimension: ReputationDimension;
  readonly eventType: ReputationEvidenceType;
  readonly sourceType: string;
  readonly sourceId?: string;
  readonly evaluationId?: string;
  readonly signal: number;
  readonly evidenceSummary?: string;
  readonly probability?: number;
  readonly observedResult?: boolean;
  readonly confidence?: number;
  readonly metadata?: JsonObject;
  readonly idempotencyKey: string;
}

export interface CreateEvaluationInput {
  readonly id?: string;
  readonly threadId?: ThreadId;
  readonly messageId?: MessageId;
  readonly documentId?: DocumentId;
  readonly targetAgentId: AgentId;
  readonly evaluatorAgentId?: AgentId;
  readonly evaluatorUserId?: UserId;
  readonly evaluationType: "god" | "human" | "peer" | "outcome" | "system";
  readonly domain: ReputationDomain;
  readonly dimension: ReputationDimension;
  readonly outcome?: string;
  readonly signal?: number;
  readonly scores?: JsonObject;
  readonly rationale?: string;
  readonly evidenceSummary?: string;
  readonly idempotencyKey: string;
}

export interface EvaluationRecord {
  readonly id: string;
  readonly threadId: ThreadId | null;
  readonly messageId: MessageId | null;
  readonly documentId: DocumentId | null;
  readonly targetAgentId: AgentId | null;
  readonly evaluatorAgentId: AgentId | null;
  readonly evaluatorUserId: UserId | null;
  readonly evaluationType: CreateEvaluationInput["evaluationType"];
  readonly domain: ReputationDomain | null;
  readonly dimension: ReputationDimension | null;
  readonly outcome: string | null;
  readonly signal: number | null;
  readonly scores: JsonObject;
  readonly rationale: string | null;
  readonly evidenceSummary: string | null;
  readonly idempotencyKey: string | null;
  readonly createdAt: string;
}

export const PEER_FEEDBACK_TAGS = [
  "crucial_risk",
  "improved_clarity",
  "useful_evidence",
  "useful_refinement",
  "novel_contribution",
  "feasible",
  "redundant",
  "misleading",
  "unsupported",
  "missed_constraint",
] as const;

export type PeerFeedbackTag = typeof PEER_FEEDBACK_TAGS[number];

export interface PeerFeedbackRecord {
  readonly id: string;
  readonly evaluationId: string | null;
  readonly targetMessageId: MessageId | null;
  readonly targetAgentId: AgentId;
  readonly reviewerAgentId: AgentId;
  readonly domain: ReputationDomain;
  readonly dimension: ReputationDimension;
  readonly tags: readonly PeerFeedbackTag[];
  readonly score: number | null;
  readonly reviewerWeight: number;
  readonly rationale: string | null;
  readonly idempotencyKey: string | null;
  readonly createdAt: string;
}

export interface GodReviewRecord {
  readonly id: string;
  readonly threadId: ThreadId | null;
  readonly reviewPeriodStart: string | null;
  readonly reviewPeriodEnd: string | null;
  readonly status: "pending" | "completed" | "failed" | "superseded";
  readonly summary: string | null;
  readonly findings: JsonObject;
  readonly briefing: JsonObject;
  readonly providerName: string | null;
  readonly modelName: string | null;
  readonly repairAttempts: number;
  readonly failureSummary: string | null;
  readonly publicMessageId: MessageId | null;
  readonly idempotencyKey: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface GodDirectiveRecord {
  readonly id: string;
  readonly reviewId: string;
  readonly targetAgentId: AgentId | null;
  readonly targetThreadId: ThreadId | null;
  readonly directive: string;
  readonly status: "open" | "acknowledged" | "completed" | "dismissed";
  readonly priority: number;
  readonly dueAt: string | null;
  readonly resolution: string | null;
  readonly sourceSummary: string | null;
  readonly idempotencyKey: string | null;
  readonly createdAt: string;
  readonly acknowledgedAt: string | null;
  readonly completedAt: string | null;
}

export interface GodBriefing {
  readonly generatedAt: string;
  readonly threads: readonly JsonObject[];
  readonly messages: readonly JsonObject[];
  readonly decisions: readonly JsonObject[];
  readonly humanRequired: readonly JsonObject[];
  readonly directives: readonly JsonObject[];
  readonly reputation: readonly JsonObject[];
  readonly contextPack: readonly JsonObject[];
  readonly maskedContributors: Readonly<Record<string, AgentId>>;
  readonly characterCount: number;
}

export interface GodReviewOutput {
  readonly executiveSummary: string;
  readonly importantFindings: readonly string[];
  readonly weakReasoning: readonly string[];
  readonly unsupportedAssumptions: readonly string[];
  readonly highValueWork: readonly string[];
  readonly unresolvedRisks: readonly string[];
  readonly missingPerspectives: readonly string[];
  readonly threadRecommendations: readonly { readonly threadId?: string; readonly recommendation: string }[];
  readonly agentEvaluations: readonly {
    readonly agentId: AgentId;
    readonly domain: ReputationDomain;
    readonly dimension: ReputationDimension;
    readonly signal: number;
    readonly rationale: string;
    readonly sourceMessageId?: MessageId;
  }[];
  readonly humanRequired: readonly string[];
  readonly directives: readonly {
    readonly targetAgentId?: AgentId;
    readonly targetThreadId?: ThreadId;
    readonly directive: string;
    readonly priority?: number;
  }[];
  readonly publicSummary?: string;
}

export interface ReputationCalculationResult {
  readonly run: ReputationScoringRunRecord;
  readonly snapshots: readonly ReputationSnapshotRecord[];
  readonly processedEvidence: number;
}

export interface GodReviewResult {
  readonly review: GodReviewRecord;
  readonly directives: readonly GodDirectiveRecord[];
  readonly evaluations: readonly EvaluationRecord[];
  readonly evidence: readonly ReputationEventRecord[];
  readonly publicMessageId: MessageId | null;
}

export interface GodScheduleRecord {
  readonly scheduleKey: string;
  readonly nextDueAt: string;
  readonly lastEnqueuedAt: string | null;
  readonly lastReviewId: string | null;
  readonly idempotencyKey: string;
  readonly updatedAt: string;
}

export interface GodJobPayload {
  readonly source: "scheduler" | "operator";
  readonly reviewId?: string;
  readonly publishTelegram?: boolean;
  readonly trigger?: string;
}

export type ReputationSourceType = "message" | "document" | "decision" | "thread" | "outcome" | "god_review" | "operator";
export type ReputationJobType = "reputation.daily_score" | "reputation.off_cycle_score" | "god.review";
export type GodJobId = JobId;
