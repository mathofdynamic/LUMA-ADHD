import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import { ValidationError } from "../database/errors";
import {
  boundedRankAfter,
  clampSignal,
  combinedReputationScore,
  epistemicSignal,
  evidenceWeight,
  isNormalAgentId,
  isSupportedReputationDomain,
  normalizeReputationDomain,
  peerSignal,
  rankInfluenceWeight,
  rankTargetFromScore,
  REPUTATION_SCORING_VERSION,
} from "./model";
import type {
  CreateEvaluationInput,
  CreateReputationEventInput,
  EvaluationRecord,
  PeerFeedbackRecord,
  ReputationCalculationResult,
  ReputationDimension,
  ReputationDomain,
  ReputationEventRecord,
  ReputationDomainStateRecord,
  ReputationSnapshotRecord,
  ReputationSourceType,
} from "./types";

type ReputationRepositories = ReturnType<typeof createRepositories>;

export interface ReputationServiceDependencies {
  readonly repositories: ReputationRepositories;
  readonly now?: () => string;
}

function utcDay(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new ValidationError("scoring timestamp must be valid");
  return date.toISOString().slice(0, 10);
}

function applyEvidence(
  current: number,
  events: readonly ReputationEventRecord[],
): number {
  let value = clampSignal(current);
  for (const event of events) {
    if (Math.abs(event.signal) < 0.000001) continue;
    const confidence = event.confidence === null ? 1 : Math.max(0, Math.min(1, event.confidence));
    const alpha = Math.max(0.05, Math.min(0.35, 0.08 + evidenceWeight(event.eventType) * 0.18 * confidence));
    value = clampSignal((value * (1 - alpha)) + (event.signal * alpha));
  }
  return Number(value.toFixed(6));
}

function dimensionsFromState(state: ReputationDomainStateRecord): Record<ReputationDimension, number> {
  return {
    epistemic: state.epistemic,
    contribution: state.contribution,
    outcome: state.outcome,
    collaboration: state.collaboration,
  };
}

export class ReputationService {
  private readonly now: () => string;

  constructor(private readonly dependencies: ReputationServiceDependencies) {
    this.now = dependencies.now ?? nowIso;
  }

  async addEvidence(input: CreateReputationEventInput): Promise<ReputationEventRecord> {
    if (!isSupportedReputationDomain(input.domain)) throw new ValidationError("unknown reputation domain");
    return this.dependencies.repositories.reputation.createEvent({
      ...input,
      domain: normalizeReputationDomain(input.domain),
    });
  }

  async recordEvaluation(input: CreateEvaluationInput): Promise<{ readonly evaluation: EvaluationRecord; readonly evidence: ReputationEventRecord }> {
    if (!isNormalAgentId(input.targetAgentId)) throw new ValidationError("evaluation target must be a normal agent");
    if (!isSupportedReputationDomain(input.domain)) throw new ValidationError("unknown reputation domain");
    const evaluation = await this.dependencies.repositories.reputation.createEvaluation({
      ...input,
      domain: normalizeReputationDomain(input.domain),
    });
    const evidence = await this.addEvidence({
      agentId: input.targetAgentId,
      domain: normalizeReputationDomain(input.domain),
      dimension: input.dimension,
      eventType: input.evaluationType === "outcome" ? "outcome" : input.evaluationType === "god" ? "god" : input.evaluationType === "peer" ? "critique" : input.evaluationType === "human" ? "human" : "system",
      sourceType: input.evaluationType,
      sourceId: input.messageId ?? input.documentId ?? input.threadId ?? evaluation.id,
      evaluationId: evaluation.id,
      signal: input.signal ?? 0,
      evidenceSummary: input.evidenceSummary ?? input.rationale,
      metadata: { evaluationType: input.evaluationType },
      idempotencyKey: `${input.idempotencyKey}:evidence`,
    });
    return { evaluation, evidence };
  }

  async recordPredictionOutcome(input: {
    readonly agentId: string;
    readonly domain: ReputationDomain;
    readonly sourceId: string;
    readonly probability: number;
    readonly observedResult: boolean;
    readonly summary: string;
    readonly confidence?: number;
    readonly idempotencyKey: string;
  }): Promise<ReputationEventRecord> {
    const signal = epistemicSignal(input.probability, input.observedResult);
    return this.addEvidence({
      agentId: input.agentId,
      domain: normalizeReputationDomain(input.domain),
      dimension: "epistemic",
      eventType: "prediction",
      sourceType: "prediction_outcome",
      sourceId: input.sourceId,
      signal,
      evidenceSummary: input.summary,
      probability: input.probability,
      observedResult: input.observedResult,
      confidence: input.confidence,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async recordPeerFeedback(input: {
    readonly targetAgentId: string;
    readonly reviewerAgentId: string;
    readonly targetMessageId?: string;
    readonly threadId?: string;
    readonly domain: ReputationDomain;
    readonly tags: readonly string[];
    readonly score?: number;
    readonly rationale?: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly feedback: PeerFeedbackRecord; readonly evidence: ReputationEventRecord }> {
    if (!isNormalAgentId(input.targetAgentId) || !isNormalAgentId(input.reviewerAgentId)) throw new ValidationError("peer feedback requires normal agents");
    if (input.targetAgentId === input.reviewerAgentId) throw new ValidationError("self-feedback is not allowed");
    if (!isSupportedReputationDomain(input.domain)) throw new ValidationError("unknown reputation domain");
    const reciprocalCount = await this.dependencies.repositories.reputation.countReciprocalFeedback(input.reviewerAgentId, input.targetAgentId);
    const reviewerWeight = Math.max(0.2, 1 / (1 + Math.min(4, reciprocalCount)));
    const signal = peerSignal(input.tags, input.score ?? null);
    const evaluation = await this.dependencies.repositories.reputation.createEvaluation({
      targetAgentId: input.targetAgentId,
      evaluatorAgentId: input.reviewerAgentId,
      threadId: input.threadId,
      messageId: input.targetMessageId,
      evaluationType: "peer",
      domain: normalizeReputationDomain(input.domain),
      dimension: "collaboration",
      signal: signal * reviewerWeight,
      rationale: input.rationale,
      evidenceSummary: `Structured peer tags: ${input.tags.join(", ")}`,
      idempotencyKey: `${input.idempotencyKey}:evaluation`,
    });
    const feedback = await this.dependencies.repositories.reputation.createPeerFeedback({
      targetAgentId: input.targetAgentId,
      reviewerAgentId: input.reviewerAgentId,
      targetMessageId: input.targetMessageId,
      evaluationId: evaluation.id,
      domain: normalizeReputationDomain(input.domain),
      dimension: "collaboration",
      tags: input.tags,
      score: input.score,
      rationale: input.rationale,
      reviewerWeight,
      idempotencyKey: input.idempotencyKey,
    });
    const evidence = await this.addEvidence({
      agentId: input.targetAgentId,
      domain: normalizeReputationDomain(input.domain),
      dimension: "collaboration",
      eventType: "critique",
      sourceType: "peer_feedback",
      sourceId: input.targetMessageId ?? feedback.id,
      evaluationId: evaluation.id,
      signal: signal * reviewerWeight,
      evidenceSummary: input.rationale ?? `Structured peer tags: ${input.tags.join(", ")}`,
      metadata: { reviewerAgentId: input.reviewerAgentId, reviewerWeight, tags: input.tags },
      idempotencyKey: `${input.idempotencyKey}:evidence`,
    });
    return { feedback, evidence };
  }

  async recordHumanEvaluation(input: {
    readonly targetAgentId: string;
    readonly evaluatorUserId: string;
    readonly domain: ReputationDomain;
    readonly dimension: ReputationDimension;
    readonly signal: number;
    readonly sourceId: string;
    readonly sourceType?: "message" | "document" | "thread";
    readonly outcome: string;
    readonly summary: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly evaluation: EvaluationRecord; readonly evidence: ReputationEventRecord }> {
    const sourceFields = input.sourceType === "document"
      ? { documentId: input.sourceId }
      : input.sourceType === "thread"
        ? { threadId: input.sourceId }
        : input.sourceType === "message"
          ? { messageId: input.sourceId }
          : {};
    return this.recordEvaluation({
      ...sourceFields,
      targetAgentId: input.targetAgentId,
      evaluatorUserId: input.evaluatorUserId,
      evaluationType: "human",
      domain: input.domain,
      dimension: input.dimension,
      signal: input.signal,
      outcome: input.outcome,
      rationale: input.summary,
      evidenceSummary: input.summary,
      idempotencyKey: input.idempotencyKey,
      scores: { sourceId: input.sourceId, sourceType: input.sourceType ?? "unspecified" },
    });
  }

  async recordOutcome(input: {
    readonly agentId: string;
    readonly domain: ReputationDomain;
    readonly sourceType: Extract<ReputationSourceType, "message" | "document" | "decision" | "thread">;
    readonly sourceId: string;
    readonly signal: number;
    readonly summary: string;
    readonly createdByUserId?: string;
    readonly idempotencyKey: string;
  }): Promise<ReputationEventRecord> {
    const existing = await this.dependencies.repositories.reputation
      .getEventByIdempotencyKey(`${input.idempotencyKey}:evidence`)
      .catch(() => null);
    if (existing) return existing;
    if (!isSupportedReputationDomain(input.domain)) throw new ValidationError("unknown reputation domain");
    await this.validateOutcomeSource(input.sourceType, input.sourceId);
    const domain = normalizeReputationDomain(input.domain);
    const outcome = await this.dependencies.repositories.reputation.recordOutcome({ ...input, domain });
    return this.addEvidence({
      agentId: input.agentId,
      domain,
      dimension: "outcome",
      eventType: "outcome",
      sourceType: "outcome",
      sourceId: input.sourceId,
      signal: input.signal,
      evidenceSummary: input.summary,
      metadata: { outcomeId: outcome.id, createdByUserId: input.createdByUserId ?? null },
      idempotencyKey: `${input.idempotencyKey}:evidence`,
    });
  }

  private async validateOutcomeSource(
    sourceType: Extract<ReputationSourceType, "message" | "document" | "decision" | "thread">,
    sourceId: string,
  ): Promise<void> {
    if (sourceType === "message") await this.dependencies.repositories.messages.getById(sourceId);
    else if (sourceType === "document") await this.dependencies.repositories.documents.getById(sourceId);
    else if (sourceType === "decision") await this.dependencies.repositories.decisions.getById(sourceId);
    else await this.dependencies.repositories.threads.getById(sourceId);
  }

  async calculateDaily(scoringDay = utcDay(this.now())): Promise<ReputationCalculationResult> {
    return this.calculateWithRun(scoringDay, `reputation-daily:${scoringDay}:${REPUTATION_SCORING_VERSION}`);
  }

  async calculateOffCycle(idempotencyKey: string, scoringDay = utcDay(this.now())): Promise<ReputationCalculationResult> {
    if (idempotencyKey.trim().length === 0) throw new ValidationError("off-cycle scoring idempotency key is required");
    return this.calculateWithRun(scoringDay, `reputation-offcycle:${idempotencyKey}:${REPUTATION_SCORING_VERSION}`);
  }

  private async calculateWithRun(scoringDay: string, runKey: string): Promise<ReputationCalculationResult> {
    const run = await this.dependencies.repositories.reputation.createScoringRun(scoringDay, runKey, {
      formula: "0.35*epistemic+0.25*contribution+0.25*outcome+0.15*collaboration",
      dailyRankCap: 0.5,
    });
    if (run.status === "completed") {
      return { run, snapshots: await this.dependencies.repositories.reputation.listSnapshotsByRun(run.id), processedEvidence: run.evidenceCount };
    }

    const evidence = await this.dependencies.repositories.reputation.listUnprocessed(2_000);
    const states = await this.dependencies.repositories.reputation.listDomainStates();
    const agents = (await this.dependencies.repositories.agents.listActive(50)).filter((agent) => isNormalAgentId(agent.id));
    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
    const snapshots: ReputationSnapshotRecord[] = [];
    try {
      for (const state of states) {
        if (!agentMap.has(state.agentId)) continue;
        const applicable = evidence.filter((item) => item.agentId === state.agentId && item.domain === state.domain);
        const values = dimensionsFromState(state);
        const nextValues = {
          epistemic: applyEvidence(values.epistemic, applicable.filter((item) => item.dimension === "epistemic")),
          contribution: applyEvidence(values.contribution, applicable.filter((item) => item.dimension === "contribution")),
          outcome: applyEvidence(values.outcome, applicable.filter((item) => item.dimension === "outcome")),
          collaboration: applyEvidence(values.collaboration, applicable.filter((item) => item.dimension === "collaboration")),
        };
        const combinedScore = combinedReputationScore(nextValues);
        const targetRank = rankTargetFromScore(combinedScore);
        const rankAfter = boundedRankAfter(state.rank, targetRank, 0.5);
        const snapshot = await this.dependencies.repositories.reputation.createSnapshot({
          agentId: state.agentId,
          domain: state.domain,
          ...nextValues,
          combinedScore,
          epistemicBefore: values.epistemic,
          contributionBefore: values.contribution,
          outcomeBefore: values.outcome,
          collaborationBefore: values.collaboration,
          rankBefore: state.rank,
          rankAfter,
          rankDelta: Number((rankAfter - state.rank).toFixed(4)),
          targetRank,
          influenceWeight: rankInfluenceWeight(rankAfter),
          evidenceCount: state.evidenceCount + applicable.length,
          scoringRunId: run.id,
          scoringDay,
          basis: {
            evidenceIds: applicable.slice(0, 50).map((item) => item.id),
            evidenceTypes: [...new Set(applicable.map((item) => item.eventType))],
            formula: "0.35*epistemic+0.25*contribution+0.25*outcome+0.15*collaboration",
            volumeExcluded: true,
          },
        });
        snapshots.push(snapshot);
        await this.dependencies.repositories.reputation.updateDomainState({
          agentId: state.agentId,
          domain: state.domain,
          ...nextValues,
          rank: rankAfter,
          evidenceCount: state.evidenceCount + applicable.length,
        });
      }

      for (const agent of agents) {
        const agentSnapshots = snapshots.filter((snapshot) => snapshot.agentId === agent.id);
        if (agentSnapshots.length === 0) continue;
        const averageScore = agentSnapshots.reduce((sum, snapshot) => sum + snapshot.combinedScore, 0) / agentSnapshots.length;
        const targetRank = rankTargetFromScore(averageScore);
        const rankAfter = boundedRankAfter(agent.rank, targetRank, 0.5);
        await this.dependencies.repositories.agents.updateRank(agent.id, rankAfter, this.now());
      }
      await this.dependencies.repositories.reputation.markProcessed(evidence.map((item) => item.id), run.id);
      const completedRun = await this.dependencies.repositories.reputation.completeScoringRun(run.id, evidence.length, snapshots.length);
      return { run: completedRun, snapshots, processedEvidence: evidence.length };
    } catch (error: unknown) {
      await this.dependencies.repositories.reputation.failScoringRun(run.id, String(error));
      throw error;
    }
  }

  async selectionSignals(agentIds: readonly string[]): Promise<Readonly<Record<string, number>>> {
    const result: Record<string, number> = {};
    for (const agentId of agentIds) {
      if (!isNormalAgentId(agentId)) continue;
      const states = await this.dependencies.repositories.reputation.listDomainStates(agentId);
      if (states.length === 0) {
        result[agentId] = 0;
        continue;
      }
      const average = states.reduce((sum, state) => sum + combinedReputationScore(dimensionsFromState(state)), 0) / states.length;
      result[agentId] = clampSignal(average * 0.75);
    }
    return result;
  }

  static isNeutral(state: ReputationDomainStateRecord): boolean {
    return state.epistemic === 0 && state.contribution === 0 && state.outcome === 0 && state.collaboration === 0 && state.rank === 10;
  }
}
