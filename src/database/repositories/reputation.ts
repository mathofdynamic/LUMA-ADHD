import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toBoolean, toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, encodeJson, requireLimit, requireNonEmpty } from "../validation";
import type { JsonObject } from "../validation";
import {
  normalizeReputationDomain,
  isNormalAgentId,
  isSupportedReputationDomain,
  REPUTATION_SCORING_VERSION,
} from "../../reputation/model";
import {
  PEER_FEEDBACK_TAGS,
  REPUTATION_DIMENSIONS,
  REPUTATION_DOMAINS,
  type CreateEvaluationInput,
  type CreateReputationEventInput,
  type EvaluationRecord,
  type GodDirectiveRecord,
  type GodReviewRecord,
  type GodScheduleRecord,
  type PeerFeedbackRecord,
  type PeerFeedbackTag,
  type ReputationDimension,
  type ReputationDomain,
  type ReputationDomainStateRecord,
  type ReputationEventRecord,
  type ReputationEvidenceType,
  type ReputationScoringRunRecord,
  type ReputationSnapshotRecord,
} from "../../reputation/types";

interface ReputationEventRow {
  id: string;
  agent_id: string;
  domain: string;
  dimension: string;
  event_type: ReputationEvidenceType;
  source_type: string;
  source_id: string | null;
  evaluation_id: string | null;
  signal: number;
  evidence_summary: string | null;
  probability: number | null;
  observed_result: number | null;
  confidence: number | null;
  processed_at: string | null;
  scoring_run_id: string | null;
  scoring_version: string | null;
  metadata_json: string;
  idempotency_key: string;
  created_at: string;
}

interface DomainStateRow {
  agent_id: string;
  domain: string;
  epistemic: number;
  contribution: number;
  outcome: number;
  collaboration: number;
  rank: number;
  evidence_count: number;
  updated_at: string;
}

interface SnapshotRow {
  id: string;
  agent_id: string;
  domain: string;
  epistemic: number;
  contribution: number;
  outcome: number;
  collaboration: number;
  epistemic_before: number | null;
  contribution_before: number | null;
  outcome_before: number | null;
  collaboration_before: number | null;
  rank: number;
  combined_score: number | null;
  rank_before: number | null;
  rank_after: number | null;
  rank_delta: number | null;
  target_rank: number | null;
  influence_weight: number | null;
  evidence_count: number | null;
  scoring_run_id: string | null;
  scoring_day: string | null;
  scoring_version: string | null;
  basis_json: string;
  captured_at: string;
}

interface RunRow {
  id: string;
  scoring_day: string;
  scoring_version: string;
  status: ReputationScoringRunRecord["status"];
  idempotency_key: string;
  evidence_count: number;
  snapshot_count: number;
  metadata_json: string;
  error_summary: string | null;
  started_at: string;
  completed_at: string | null;
}

interface EvaluationRow {
  id: string;
  thread_id: string | null;
  message_id: string | null;
  document_id: string | null;
  target_agent_id: string | null;
  evaluator_agent_id: string | null;
  evaluator_user_id: string | null;
  evaluation_type: EvaluationRecord["evaluationType"];
  domain: string | null;
  dimension: string | null;
  outcome: string | null;
  signal: number | null;
  scores_json: string;
  rationale: string | null;
  evidence_summary: string | null;
  idempotency_key: string | null;
  created_at: string;
}

interface PeerFeedbackRow {
  id: string;
  evaluation_id: string | null;
  target_message_id: string | null;
  target_agent_id: string;
  reviewer_agent_id: string;
  domain: string;
  dimension: string;
  tags_json: string;
  score: number | null;
  reviewer_weight: number;
  rationale: string | null;
  idempotency_key: string | null;
  created_at: string;
}

interface GodReviewRow {
  id: string;
  thread_id: string | null;
  review_period_start: string | null;
  review_period_end: string | null;
  status: GodReviewRecord["status"];
  summary: string | null;
  findings_json: string;
  briefing_json: string;
  provider_name: string | null;
  model_name: string | null;
  repair_attempts: number;
  failure_summary: string | null;
  public_message_id: string | null;
  idempotency_key: string | null;
  created_at: string;
  completed_at: string | null;
}

interface GodDirectiveRow {
  id: string;
  review_id: string;
  target_agent_id: string | null;
  target_thread_id: string | null;
  directive: string;
  status: GodDirectiveRecord["status"];
  priority: number;
  due_at: string | null;
  resolution: string | null;
  source_summary: string | null;
  idempotency_key: string | null;
  created_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
}

interface ScheduleRow {
  schedule_key: string;
  next_due_at: string;
  last_enqueued_at: string | null;
  last_review_id: string | null;
  idempotency_key: string;
  updated_at: string;
}

function dimension(value: string | null | undefined, fallback: ReputationDimension = "contribution"): ReputationDimension {
  return REPUTATION_DIMENSIONS.includes(value as ReputationDimension) ? value as ReputationDimension : fallback;
}

function domain(value: string | null | undefined, fallback: ReputationDomain = "general"): ReputationDomain {
  const normalized = normalizeReputationDomain(value ?? fallback);
  return REPUTATION_DOMAINS.includes(normalized) ? normalized : fallback;
}

function mapEvent(row: ReputationEventRow): ReputationEventRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    domain: domain(row.domain),
    dimension: dimension(row.dimension),
    eventType: row.event_type,
    sourceType: row.source_type,
    sourceId: toNullableString(row.source_id),
    evaluationId: toNullableString(row.evaluation_id),
    signal: toNumber(row.signal, "reputation_events.signal"),
    evidenceSummary: toNullableString(row.evidence_summary),
    probability: row.probability === null ? null : toNumber(row.probability, "reputation_events.probability"),
    observedResult: row.observed_result === null ? null : toBoolean(row.observed_result),
    confidence: row.confidence === null ? null : toNumber(row.confidence, "reputation_events.confidence"),
    processedAt: toNullableString(row.processed_at),
    scoringRunId: toNullableString(row.scoring_run_id),
    scoringVersion: toNullableString(row.scoring_version),
    metadata: toJsonObject(row.metadata_json, "reputation_events.metadata_json"),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

function mapState(row: DomainStateRow): ReputationDomainStateRecord {
  return {
    agentId: row.agent_id,
    domain: domain(row.domain),
    epistemic: toNumber(row.epistemic, "reputation_domain_state.epistemic"),
    contribution: toNumber(row.contribution, "reputation_domain_state.contribution"),
    outcome: toNumber(row.outcome, "reputation_domain_state.outcome"),
    collaboration: toNumber(row.collaboration, "reputation_domain_state.collaboration"),
    rank: toNumber(row.rank, "reputation_domain_state.rank"),
    evidenceCount: toNumber(row.evidence_count, "reputation_domain_state.evidence_count"),
    updatedAt: row.updated_at,
  };
}

function mapSnapshot(row: SnapshotRow): ReputationSnapshotRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    domain: domain(row.domain),
    epistemic: toNumber(row.epistemic, "reputation_snapshots.epistemic"),
    contribution: toNumber(row.contribution, "reputation_snapshots.contribution"),
    outcome: toNumber(row.outcome, "reputation_snapshots.outcome"),
    collaboration: toNumber(row.collaboration, "reputation_snapshots.collaboration"),
    epistemicBefore: toNumber(row.epistemic_before ?? 0, "reputation_snapshots.epistemic_before"),
    contributionBefore: toNumber(row.contribution_before ?? 0, "reputation_snapshots.contribution_before"),
    outcomeBefore: toNumber(row.outcome_before ?? 0, "reputation_snapshots.outcome_before"),
    collaborationBefore: toNumber(row.collaboration_before ?? 0, "reputation_snapshots.collaboration_before"),
    combinedScore: toNumber(row.combined_score ?? 0, "reputation_snapshots.combined_score"),
    rankBefore: toNumber(row.rank_before ?? row.rank_after ?? 10, "reputation_snapshots.rank_before"),
    rankAfter: toNumber(row.rank_after ?? row.rank ?? 10, "reputation_snapshots.rank_after"),
    rankDelta: toNumber(row.rank_delta ?? 0, "reputation_snapshots.rank_delta"),
    targetRank: toNumber(row.target_rank ?? row.rank_after ?? 10, "reputation_snapshots.target_rank"),
    influenceWeight: toNumber(row.influence_weight ?? 1, "reputation_snapshots.influence_weight"),
    evidenceCount: toNumber(row.evidence_count ?? 0, "reputation_snapshots.evidence_count"),
    scoringRunId: toNullableString(row.scoring_run_id),
    scoringDay: toNullableString(row.scoring_day),
    scoringVersion: row.scoring_version ?? REPUTATION_SCORING_VERSION,
    basis: toJsonObject(row.basis_json, "reputation_snapshots.basis_json"),
    capturedAt: row.captured_at,
  };
}

function mapRun(row: RunRow): ReputationScoringRunRecord {
  return {
    id: row.id,
    scoringDay: row.scoring_day,
    scoringVersion: row.scoring_version,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    evidenceCount: toNumber(row.evidence_count, "reputation_scoring_runs.evidence_count"),
    snapshotCount: toNumber(row.snapshot_count, "reputation_scoring_runs.snapshot_count"),
    metadata: toJsonObject(row.metadata_json, "reputation_scoring_runs.metadata_json"),
    errorSummary: toNullableString(row.error_summary),
    startedAt: row.started_at,
    completedAt: toNullableString(row.completed_at),
  };
}

function mapEvaluation(row: EvaluationRow): EvaluationRecord {
  return {
    id: row.id,
    threadId: toNullableString(row.thread_id),
    messageId: toNullableString(row.message_id),
    documentId: toNullableString(row.document_id),
    targetAgentId: toNullableString(row.target_agent_id),
    evaluatorAgentId: toNullableString(row.evaluator_agent_id),
    evaluatorUserId: toNullableString(row.evaluator_user_id),
    evaluationType: row.evaluation_type,
    domain: row.domain === null ? null : domain(row.domain),
    dimension: row.dimension === null ? null : dimension(row.dimension),
    outcome: toNullableString(row.outcome),
    signal: row.signal === null ? null : toNumber(row.signal, "evaluations.signal"),
    scores: toJsonObject(row.scores_json, "evaluations.scores_json"),
    rationale: toNullableString(row.rationale),
    evidenceSummary: toNullableString(row.evidence_summary),
    idempotencyKey: toNullableString(row.idempotency_key),
    createdAt: row.created_at,
  };
}

function mapTags(value: string): readonly PeerFeedbackTag[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((tag): tag is PeerFeedbackTag => PEER_FEEDBACK_TAGS.includes(tag as PeerFeedbackTag));
}

function mapPeerFeedback(row: PeerFeedbackRow): PeerFeedbackRecord {
  return {
    id: row.id,
    evaluationId: toNullableString(row.evaluation_id),
    targetMessageId: toNullableString(row.target_message_id),
    targetAgentId: row.target_agent_id,
    reviewerAgentId: row.reviewer_agent_id,
    domain: domain(row.domain),
    dimension: dimension(row.dimension, "collaboration"),
    tags: mapTags(row.tags_json),
    score: row.score === null ? null : toNumber(row.score, "peer_feedback.score"),
    reviewerWeight: toNumber(row.reviewer_weight, "peer_feedback.reviewer_weight"),
    rationale: toNullableString(row.rationale),
    idempotencyKey: toNullableString(row.idempotency_key),
    createdAt: row.created_at,
  };
}

function mapReview(row: GodReviewRow): GodReviewRecord {
  return {
    id: row.id,
    threadId: toNullableString(row.thread_id),
    reviewPeriodStart: toNullableString(row.review_period_start),
    reviewPeriodEnd: toNullableString(row.review_period_end),
    status: row.status,
    summary: toNullableString(row.summary),
    findings: toJsonObject(row.findings_json, "god_reviews.findings_json"),
    briefing: toJsonObject(row.briefing_json, "god_reviews.briefing_json"),
    providerName: toNullableString(row.provider_name),
    modelName: toNullableString(row.model_name),
    repairAttempts: toNumber(row.repair_attempts, "god_reviews.repair_attempts"),
    failureSummary: toNullableString(row.failure_summary),
    publicMessageId: toNullableString(row.public_message_id),
    idempotencyKey: toNullableString(row.idempotency_key),
    createdAt: row.created_at,
    completedAt: toNullableString(row.completed_at),
  };
}

function mapDirective(row: GodDirectiveRow): GodDirectiveRecord {
  return {
    id: row.id,
    reviewId: row.review_id,
    targetAgentId: toNullableString(row.target_agent_id),
    targetThreadId: toNullableString(row.target_thread_id),
    directive: row.directive,
    status: row.status,
    priority: toNumber(row.priority, "god_directives.priority"),
    dueAt: toNullableString(row.due_at),
    resolution: toNullableString(row.resolution),
    sourceSummary: toNullableString(row.source_summary),
    idempotencyKey: toNullableString(row.idempotency_key),
    createdAt: row.created_at,
    acknowledgedAt: toNullableString(row.acknowledged_at),
    completedAt: toNullableString(row.completed_at),
  };
}

function mapSchedule(row: ScheduleRow): GodScheduleRecord {
  return {
    scheduleKey: row.schedule_key,
    nextDueAt: row.next_due_at,
    lastEnqueuedAt: toNullableString(row.last_enqueued_at),
    lastReviewId: toNullableString(row.last_review_id),
    idempotencyKey: row.idempotency_key,
    updatedAt: row.updated_at,
  };
}

export interface CreatePeerFeedbackInput {
  readonly id?: string;
  readonly evaluationId?: string;
  readonly targetMessageId?: string;
  readonly targetAgentId: string;
  readonly reviewerAgentId: string;
  readonly domain: ReputationDomain;
  readonly dimension?: ReputationDimension;
  readonly tags: readonly string[];
  readonly score?: number;
  readonly rationale?: string;
  readonly reviewerWeight?: number;
  readonly idempotencyKey: string;
}

export interface CreateGodReviewInput {
  readonly id?: string;
  readonly threadId?: string;
  readonly reviewPeriodStart?: string;
  readonly reviewPeriodEnd?: string;
  readonly briefing: JsonObject;
  readonly idempotencyKey: string;
}

export interface CreateGodDirectiveInput {
  readonly id?: string;
  readonly reviewId: string;
  readonly targetAgentId?: string;
  readonly targetThreadId?: string;
  readonly directive: string;
  readonly priority?: number;
  readonly dueAt?: string;
  readonly sourceSummary?: string;
  readonly idempotencyKey: string;
}

export class ReputationRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createEvent(input: CreateReputationEventInput): Promise<ReputationEventRecord> {
    if (!isNormalAgentId(input.agentId)) throw new ValidationError("reputation evidence targets a normal agent");
    if (!REPUTATION_DOMAINS.includes(input.domain)) throw new ValidationError("unknown reputation domain");
    if (!REPUTATION_DIMENSIONS.includes(input.dimension)) throw new ValidationError("unknown reputation dimension");
    if (!Number.isFinite(input.signal) || input.signal < -1 || input.signal > 1) throw new ValidationError("reputation signal must be between -1 and 1");
    if (input.probability !== undefined && (input.probability < 0 || input.probability > 1)) throw new ValidationError("prediction probability must be between 0 and 1");
    const idempotencyKey = requireNonEmpty(input.idempotencyKey, "reputationEvent.idempotencyKey");
    const timestamp = nowIso();
    await this.database.prepare(
      `INSERT INTO reputation_events (
        id, agent_id, domain, event_type, source_id, signal, idempotency_key,
        metadata_json, created_at, dimension, source_type, evaluation_id,
        evidence_summary, probability, observed_result, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (idempotency_key) DO NOTHING`,
    ).bind(
      input.id ?? createId("reputation-event"), input.agentId, input.domain, input.eventType,
      input.sourceId ?? null, input.signal, idempotencyKey, encodeObject(input.metadata, "reputationEvent.metadata"),
      timestamp, input.dimension, requireNonEmpty(input.sourceType, "reputationEvent.sourceType"), input.evaluationId ?? null,
      input.evidenceSummary ?? null, input.probability ?? null, input.observedResult === undefined ? null : input.observedResult ? 1 : 0,
      input.confidence ?? null,
    ).run();
    return this.getEventByIdempotencyKey(idempotencyKey);
  }

  async getEventByIdempotencyKey(key: string): Promise<ReputationEventRecord> {
    const row = await this.database.prepare("SELECT * FROM reputation_events WHERE idempotency_key = ?").bind(key).first<ReputationEventRow>();
    if (!row) throw new NotFoundError("reputation event idempotency key", key);
    return mapEvent(row);
  }

  async listUnprocessed(limit = 500): Promise<readonly ReputationEventRecord[]> {
    const result = await this.database.prepare(
      `SELECT * FROM reputation_events WHERE processed_at IS NULL ORDER BY created_at ASC, id ASC LIMIT ?`,
    ).bind(requireLimit(limit, "reputation evidence limit", 2_000)).all<ReputationEventRow>();
    return result.results.map(mapEvent);
  }

  async listRecent(limit = 100): Promise<readonly ReputationEventRecord[]> {
    const result = await this.database.prepare(
      `SELECT * FROM reputation_events ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(requireLimit(limit, "recent reputation evidence limit", 500)).all<ReputationEventRow>();
    return result.results.map(mapEvent);
  }

  async markProcessed(eventIds: readonly string[], runId: string, scoringVersion = REPUTATION_SCORING_VERSION): Promise<void> {
    if (eventIds.length === 0) return;
    const timestamp = nowIso();
    await this.database.batch(eventIds.map((id) => this.database.prepare(
      `UPDATE reputation_events SET processed_at = ?, scoring_run_id = ?, scoring_version = ?
       WHERE id = ? AND processed_at IS NULL`,
    ).bind(timestamp, runId, scoringVersion, id)));
  }

  async getDomainState(agentId: string, domainValue: ReputationDomain): Promise<ReputationDomainStateRecord> {
    await this.database.prepare(
      `INSERT OR IGNORE INTO reputation_domain_state (agent_id, domain) VALUES (?, ?)`,
    ).bind(agentId, domainValue).run();
    const row = await this.database.prepare(
      `SELECT * FROM reputation_domain_state WHERE agent_id = ? AND domain = ?`,
    ).bind(agentId, domainValue).first<DomainStateRow>();
    if (!row) throw new NotFoundError("reputation domain state", `${agentId}:${domainValue}`);
    return mapState(row);
  }

  async listDomainStates(agentId?: string): Promise<readonly ReputationDomainStateRecord[]> {
    const result = agentId === undefined
      ? await this.database.prepare("SELECT * FROM reputation_domain_state ORDER BY agent_id, domain").all<DomainStateRow>()
      : await this.database.prepare("SELECT * FROM reputation_domain_state WHERE agent_id = ? ORDER BY domain").bind(agentId).all<DomainStateRow>();
    return result.results.map(mapState);
  }

  async updateDomainState(input: {
    readonly agentId: string;
    readonly domain: ReputationDomain;
    readonly epistemic: number;
    readonly contribution: number;
    readonly outcome: number;
    readonly collaboration: number;
    readonly rank: number;
    readonly evidenceCount: number;
  }): Promise<ReputationDomainStateRecord> {
    const timestamp = nowIso();
    await this.database.prepare(
      `INSERT INTO reputation_domain_state (
        agent_id, domain, epistemic, contribution, outcome, collaboration,
        rank, evidence_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, domain) DO UPDATE SET
        epistemic = excluded.epistemic, contribution = excluded.contribution,
        outcome = excluded.outcome, collaboration = excluded.collaboration,
        rank = excluded.rank, evidence_count = excluded.evidence_count,
        updated_at = excluded.updated_at`,
    ).bind(
      input.agentId, input.domain, input.epistemic, input.contribution, input.outcome,
      input.collaboration, input.rank, input.evidenceCount, timestamp,
    ).run();
    return this.getDomainState(input.agentId, input.domain);
  }

  async createScoringRun(scoringDay: string, idempotencyKey: string, metadata: JsonObject = {}): Promise<ReputationScoringRunRecord> {
    await this.database.prepare(
      `INSERT INTO reputation_scoring_runs (id, scoring_day, scoring_version, idempotency_key, metadata_json)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
    ).bind(createId("reputation-run"), requireNonEmpty(scoringDay, "scoringDay"), REPUTATION_SCORING_VERSION, idempotencyKey, encodeObject(metadata, "reputationRun.metadata")).run();
    return this.getScoringRunByIdempotencyKey(idempotencyKey);
  }

  async getScoringRunByIdempotencyKey(key: string): Promise<ReputationScoringRunRecord> {
    const row = await this.database.prepare("SELECT * FROM reputation_scoring_runs WHERE idempotency_key = ?").bind(key).first<RunRow>();
    if (!row) throw new NotFoundError("reputation scoring run", key);
    return mapRun(row);
  }

  async completeScoringRun(id: string, evidenceCount: number, snapshotCount: number): Promise<ReputationScoringRunRecord> {
    await this.database.prepare(
      `UPDATE reputation_scoring_runs SET status = 'completed', evidence_count = ?, snapshot_count = ?, completed_at = ? WHERE id = ?`,
    ).bind(evidenceCount, snapshotCount, nowIso(), id).run();
    const row = await this.database.prepare("SELECT * FROM reputation_scoring_runs WHERE id = ?").bind(id).first<RunRow>();
    if (!row) throw new NotFoundError("reputation scoring run", id);
    return mapRun(row);
  }

  async failScoringRun(id: string, summary: string): Promise<ReputationScoringRunRecord> {
    await this.database.prepare(
      `UPDATE reputation_scoring_runs SET status = 'failed', error_summary = ?, completed_at = ? WHERE id = ?`,
    ).bind(summary.slice(0, 500), nowIso(), id).run();
    const row = await this.database.prepare("SELECT * FROM reputation_scoring_runs WHERE id = ?").bind(id).first<RunRow>();
    if (!row) throw new NotFoundError("reputation scoring run", id);
    return mapRun(row);
  }

  async createSnapshot(input: {
    readonly agentId: string;
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
    readonly scoringRunId: string;
    readonly scoringDay: string;
    readonly basis: JsonObject;
  }): Promise<ReputationSnapshotRecord> {
    const id = createId("reputation-snapshot");
    await this.database.prepare(
      `INSERT INTO reputation_snapshots (
        id, agent_id, domain, epistemic, contribution, collaboration, outcome,
        rank, captured_at, basis_json, scoring_run_id, scoring_day,
        epistemic_before, contribution_before, outcome_before, collaboration_before,
        combined_score, rank_before, rank_after, rank_delta, target_rank,
        influence_weight, evidence_count, scoring_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`,
    ).bind(
      id, input.agentId, input.domain, input.epistemic, input.contribution, input.collaboration, input.outcome,
      input.rankAfter, nowIso(), encodeObject(input.basis, "reputationSnapshot.basis"), input.scoringRunId, input.scoringDay,
      input.epistemicBefore, input.contributionBefore, input.outcomeBefore, input.collaborationBefore, input.combinedScore,
      input.rankBefore, input.rankAfter, input.rankDelta, input.targetRank, input.influenceWeight, input.evidenceCount,
      REPUTATION_SCORING_VERSION,
    ).run();
    const row = await this.database.prepare(
      `SELECT * FROM reputation_snapshots WHERE agent_id = ? AND domain = ? AND scoring_run_id = ?`,
    ).bind(input.agentId, input.domain, input.scoringRunId).first<SnapshotRow>();
    if (!row) throw new NotFoundError("reputation snapshot", `${input.agentId}:${input.domain}:${input.scoringRunId}`);
    return mapSnapshot(row);
  }

  async listSnapshotsByRun(runId: string): Promise<readonly ReputationSnapshotRecord[]> {
    const result = await this.database.prepare("SELECT * FROM reputation_snapshots WHERE scoring_run_id = ? ORDER BY agent_id, domain").bind(runId).all<SnapshotRow>();
    return result.results.map(mapSnapshot);
  }

  async createEvaluation(input: CreateEvaluationInput): Promise<EvaluationRecord> {
    if (input.evaluatorAgentId && input.evaluatorAgentId === input.targetAgentId) throw new ValidationError("self-evaluation is not allowed");
    if (input.evaluatorAgentId && input.evaluatorUserId) throw new ValidationError("evaluation has one evaluator identity");
    if (input.signal !== undefined && (input.signal < -1 || input.signal > 1)) throw new ValidationError("evaluation signal must be between -1 and 1");
    const key = requireNonEmpty(input.idempotencyKey, "evaluation.idempotencyKey");
    await this.database.prepare(
      `INSERT INTO evaluations (
        id, thread_id, message_id, document_id, target_agent_id, evaluator_agent_id,
        evaluator_user_id, evaluation_type, outcome, scores_json, rationale, created_at,
        domain, dimension, signal, evidence_summary, idempotency_key, scoring_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`,
    ).bind(
      input.id ?? createId("evaluation"), input.threadId ?? null, input.messageId ?? null, input.documentId ?? null,
      input.targetAgentId, input.evaluatorAgentId ?? null, input.evaluatorUserId ?? null, input.evaluationType,
      input.outcome ?? null, encodeObject(input.scores, "evaluation.scores"), input.rationale ?? null, nowIso(),
      input.domain, input.dimension, input.signal ?? null, input.evidenceSummary ?? input.rationale ?? null, key, REPUTATION_SCORING_VERSION,
    ).run();
    return this.getEvaluationByIdempotencyKey(key);
  }

  async getEvaluationByIdempotencyKey(key: string): Promise<EvaluationRecord> {
    const row = await this.database.prepare("SELECT * FROM evaluations WHERE idempotency_key = ?").bind(key).first<EvaluationRow>();
    if (!row) throw new NotFoundError("evaluation idempotency key", key);
    return mapEvaluation(row);
  }

  async createPeerFeedback(input: CreatePeerFeedbackInput): Promise<PeerFeedbackRecord> {
    if (input.targetAgentId === input.reviewerAgentId) throw new ValidationError("self-feedback is not allowed");
    const tags = [...new Set(input.tags)].filter((tag) => PEER_FEEDBACK_TAGS.includes(tag as PeerFeedbackTag));
    if (tags.length === 0) throw new ValidationError("peer feedback requires at least one known tag");
    if (input.score !== undefined && (input.score < -1 || input.score > 1)) throw new ValidationError("peer feedback score must be between -1 and 1");
    const key = requireNonEmpty(input.idempotencyKey, "peerFeedback.idempotencyKey");
    await this.database.prepare(
      `INSERT INTO peer_feedback (
        id, evaluation_id, target_message_id, target_agent_id, reviewer_agent_id,
        tags_json, score, rationale, created_at, domain, dimension, idempotency_key, reviewer_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`,
    ).bind(
      input.id ?? createId("peer-feedback"), input.evaluationId ?? null, input.targetMessageId ?? null,
      input.targetAgentId, input.reviewerAgentId, encodeJson(tags, "peerFeedback.tags"), input.score ?? null,
      input.rationale ?? null, nowIso(), input.domain, input.dimension ?? "collaboration", key,
      Math.max(0, Math.min(1, input.reviewerWeight ?? 1)),
    ).run();
    const row = await this.database.prepare("SELECT * FROM peer_feedback WHERE idempotency_key = ?").bind(key).first<PeerFeedbackRow>();
    if (!row) throw new NotFoundError("peer feedback idempotency key", key);
    return mapPeerFeedback(row);
  }

  async countReciprocalFeedback(reviewerAgentId: string, targetAgentId: string): Promise<number> {
    const row = await this.database.prepare(
      `SELECT COUNT(*) AS count FROM peer_feedback
       WHERE reviewer_agent_id = ? AND target_agent_id = ?`,
    ).bind(targetAgentId, reviewerAgentId).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async recordOutcome(input: {
    readonly agentId: string;
    readonly domain: ReputationDomain;
    readonly sourceType: string;
    readonly sourceId: string;
    readonly signal: number;
    readonly summary: string;
    readonly idempotencyKey: string;
    readonly createdByUserId?: string;
  }): Promise<{ readonly id: string; readonly existed: boolean }> {
    if (!isNormalAgentId(input.agentId)) throw new ValidationError("outcomes target a normal agent");
    if (!isSupportedReputationDomain(input.domain)) throw new ValidationError("unknown outcome reputation domain");
    if (input.signal < -1 || input.signal > 1) throw new ValidationError("outcome signal must be between -1 and 1");
    const key = requireNonEmpty(input.idempotencyKey, "outcome.idempotencyKey");
    const existing = await this.database.prepare("SELECT id FROM reputation_outcomes WHERE idempotency_key = ?").bind(key).first<{ id: string }>();
    if (existing) return { id: existing.id, existed: true };
    const id = createId("reputation-outcome");
    await this.database.prepare(
      `INSERT INTO reputation_outcomes (
        id, agent_id, domain, source_type, source_id, signal, outcome_summary,
        idempotency_key, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.agentId, input.domain, requireNonEmpty(input.sourceType, "outcome.sourceType"), requireNonEmpty(input.sourceId, "outcome.sourceId"), input.signal, requireNonEmpty(input.summary, "outcome.summary"), key, input.createdByUserId ?? null).run();
    return { id, existed: false };
  }

  async createReview(input: CreateGodReviewInput): Promise<GodReviewRecord> {
    const key = requireNonEmpty(input.idempotencyKey, "godReview.idempotencyKey");
    await this.database.prepare(
      `INSERT INTO god_reviews (
        id, thread_id, review_period_start, review_period_end, status,
        briefing_json, idempotency_key, scoring_version, created_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`,
    ).bind(input.id ?? createId("god-review"), input.threadId ?? null, input.reviewPeriodStart ?? null, input.reviewPeriodEnd ?? null, encodeObject(input.briefing, "godReview.briefing"), key, REPUTATION_SCORING_VERSION, nowIso()).run();
    return this.getReviewByIdempotencyKey(key);
  }

  async getReviewById(id: string): Promise<GodReviewRecord> {
    const row = await this.database.prepare("SELECT * FROM god_reviews WHERE id = ?").bind(id).first<GodReviewRow>();
    if (!row) throw new NotFoundError("GOD review", id);
    return mapReview(row);
  }

  async getReviewByIdempotencyKey(key: string): Promise<GodReviewRecord> {
    const row = await this.database.prepare("SELECT * FROM god_reviews WHERE idempotency_key = ?").bind(key).first<GodReviewRow>();
    if (!row) throw new NotFoundError("GOD review idempotency key", key);
    return mapReview(row);
  }

  async completeReview(input: { readonly id: string; readonly summary: string; readonly findings: JsonObject; readonly providerName: string; readonly modelName: string; readonly repairAttempts: number; readonly publicMessageId?: string }): Promise<GodReviewRecord> {
    await this.database.prepare(
      `UPDATE god_reviews SET status = 'completed', summary = ?, findings_json = ?,
       provider_name = ?, model_name = ?, repair_attempts = ?, public_message_id = ?,
       completed_at = ?, failure_summary = NULL WHERE id = ?`,
    ).bind(input.summary, encodeObject(input.findings, "godReview.findings"), input.providerName, input.modelName, input.repairAttempts, input.publicMessageId ?? null, nowIso(), input.id).run();
    return this.getReviewById(input.id);
  }

  async failReview(input: { readonly id: string; readonly summary: string; readonly repairAttempts: number; readonly providerName?: string; readonly modelName?: string }): Promise<GodReviewRecord> {
    await this.database.prepare(
      `UPDATE god_reviews SET status = 'failed', failure_summary = ?, repair_attempts = ?,
       provider_name = COALESCE(?, provider_name), model_name = COALESCE(?, model_name), completed_at = ? WHERE id = ?`,
    ).bind(input.summary.slice(0, 500), input.repairAttempts, input.providerName ?? null, input.modelName ?? null, nowIso(), input.id).run();
    return this.getReviewById(input.id);
  }

  async createDirective(input: CreateGodDirectiveInput): Promise<GodDirectiveRecord> {
    const directive = requireNonEmpty(input.directive, "godDirective.directive");
    if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 100)) throw new ValidationError("GOD directive priority must be between 0 and 100");
    const key = requireNonEmpty(input.idempotencyKey, "godDirective.idempotencyKey");
    await this.database.prepare(
      `INSERT INTO god_directives (
        id, review_id, target_agent_id, target_thread_id, directive, status,
        priority, due_at, source_summary, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`,
    ).bind(input.id ?? createId("god-directive"), input.reviewId, input.targetAgentId ?? null, input.targetThreadId ?? null, directive, input.priority ?? 50, input.dueAt ?? null, input.sourceSummary ?? null, key, nowIso()).run();
    const row = await this.database.prepare("SELECT * FROM god_directives WHERE idempotency_key = ?").bind(key).first<GodDirectiveRow>();
    if (!row) throw new NotFoundError("GOD directive idempotency key", key);
    return mapDirective(row);
  }

  async listOpenDirectives(limit = 20): Promise<readonly GodDirectiveRecord[]> {
    const result = await this.database.prepare("SELECT * FROM god_directives WHERE status IN ('open', 'acknowledged') ORDER BY priority DESC, created_at DESC LIMIT ?").bind(requireLimit(limit, "GOD directive limit", 100)).all<GodDirectiveRow>();
    return result.results.map(mapDirective);
  }

  async listRecentDirectives(limit = 20): Promise<readonly GodDirectiveRecord[]> {
    const result = await this.database.prepare(
      "SELECT * FROM god_directives ORDER BY created_at DESC, id DESC LIMIT ?",
    ).bind(requireLimit(limit, "GOD directive history limit", 100)).all<GodDirectiveRow>();
    return result.results.map(mapDirective);
  }

  async getSchedule(scheduleKey: string): Promise<GodScheduleRecord | null> {
    const row = await this.database.prepare("SELECT * FROM god_schedule_state WHERE schedule_key = ?").bind(scheduleKey).first<ScheduleRow>();
    return row ? mapSchedule(row) : null;
  }

  async upsertSchedule(input: { readonly scheduleKey: string; readonly nextDueAt: string; readonly idempotencyKey: string }): Promise<GodScheduleRecord> {
    await this.database.prepare(
      `INSERT INTO god_schedule_state (schedule_key, next_due_at, idempotency_key, updated_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(schedule_key) DO UPDATE SET next_due_at = excluded.next_due_at, updated_at = excluded.updated_at`,
    ).bind(input.scheduleKey, input.nextDueAt, input.idempotencyKey, nowIso()).run();
    const schedule = await this.getSchedule(input.scheduleKey);
    if (!schedule) throw new NotFoundError("GOD schedule", input.scheduleKey);
    return schedule;
  }

  async markScheduleEnqueued(scheduleKey: string, nextDueAt: string, reviewId?: string, asOf = nowIso()): Promise<GodScheduleRecord> {
    await this.database.prepare(
      `UPDATE god_schedule_state SET next_due_at = ?, last_enqueued_at = ?, last_review_id = COALESCE(?, last_review_id), updated_at = ? WHERE schedule_key = ?`,
    ).bind(nextDueAt, asOf, reviewId ?? null, asOf, scheduleKey).run();
    const schedule = await this.getSchedule(scheduleKey);
    if (!schedule) throw new NotFoundError("GOD schedule", scheduleKey);
    return schedule;
  }

  async listBriefingThreads(limit = 12): Promise<readonly JsonObject[]> {
    const result = await this.database.prepare(
      `SELECT id, title, state, priority, summary, last_activity_at
       FROM threads WHERE deleted_at IS NULL AND state NOT IN ('parked', 'rejected')
       ORDER BY CASE state WHEN 'blocked' THEN 3 WHEN 'human_required' THEN 2 ELSE 1 END DESC,
                priority DESC, last_activity_at DESC LIMIT ?`,
    ).bind(requireLimit(limit, "GOD briefing thread limit", 50)).all<Record<string, unknown>>();
    return result.results.map((row) => ({
      threadId: String(row.id), title: String(row.title), state: String(row.state), priority: Number(row.priority),
      summary: row.summary === null ? "" : String(row.summary), lastActivityAt: String(row.last_activity_at),
    }));
  }

  async listBriefingMessages(threadIds: readonly string[], perThread = 6): Promise<readonly JsonObject[]> {
    const rows: JsonObject[] = [];
    for (const threadId of threadIds.slice(0, 12)) {
      const result = await this.database.prepare(
        `SELECT id, thread_id, author_type, author_agent_id, author_user_id, content_text, reply_to_message_id, created_at
         FROM messages WHERE thread_id = ? AND deleted_at IS NULL AND visibility = 'public'
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).bind(threadId, requireLimit(perThread, "GOD briefing message limit", 20)).all<Record<string, unknown>>();
      rows.push(...result.results.reverse().map((row) => ({
        messageId: String(row.id), threadId: String(row.thread_id), authorType: String(row.author_type),
        authorAgentId: row.author_agent_id === null ? null : String(row.author_agent_id),
        authorUserId: row.author_user_id === null ? null : String(row.author_user_id),
        content: String(row.content_text).slice(0, 900), replyToMessageId: row.reply_to_message_id === null ? null : String(row.reply_to_message_id),
        createdAt: String(row.created_at),
      })));
    }
    return rows;
  }

  async listBriefingDecisions(limit = 10): Promise<readonly JsonObject[]> {
    const result = await this.database.prepare(
      `SELECT id, thread_id, title, status, decision_text, rationale, updated_at
       FROM decision_records ORDER BY updated_at DESC LIMIT ?`,
    ).bind(requireLimit(limit, "GOD briefing decision limit", 50)).all<Record<string, unknown>>();
    return result.results.map((row) => ({
      decisionId: String(row.id), threadId: String(row.thread_id), title: String(row.title), status: String(row.status),
      decision: String(row.decision_text).slice(0, 900), rationale: row.rationale === null ? "" : String(row.rationale).slice(0, 500), updatedAt: String(row.updated_at),
    }));
  }

  async listBriefingHumanTasks(limit = 10): Promise<readonly JsonObject[]> {
    const result = await this.database.prepare(
      `SELECT id, thread_id, title, description, status, priority, due_at, updated_at
       FROM human_tasks WHERE deleted_at IS NULL AND status IN ('open', 'in_progress', 'blocked')
       ORDER BY priority DESC, updated_at DESC LIMIT ?`,
    ).bind(requireLimit(limit, "GOD briefing human-task limit", 50)).all<Record<string, unknown>>();
    return result.results.map((row) => ({
      taskId: String(row.id), threadId: row.thread_id === null ? null : String(row.thread_id), title: String(row.title),
      description: String(row.description).slice(0, 700), status: String(row.status), priority: Number(row.priority), dueAt: row.due_at === null ? null : String(row.due_at), updatedAt: String(row.updated_at),
    }));
  }
}

export {
  mapEvent,
  mapState,
  mapSnapshot,
  mapRun,
  mapEvaluation,
  mapPeerFeedback,
  mapReview,
  mapDirective,
};
