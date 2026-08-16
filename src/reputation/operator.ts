import { ValidationError } from "../database/errors";
import { isNormalAgentId, isSupportedReputationDomain, normalizeReputationDomain } from "./model";
import type { ReputationService } from "./service";
import type { ReputationDomain, ReputationSourceType, ReputationEventRecord, ReputationCalculationResult } from "./types";

type VerifiedOutcomeSourceType = Extract<ReputationSourceType, "message" | "document" | "decision" | "thread">;

export interface RecordVerifiedOutcomeInput {
  readonly agentId: string;
  readonly domain: ReputationDomain;
  readonly sourceType: VerifiedOutcomeSourceType;
  readonly sourceId: string;
  readonly signal: number;
  readonly summary: string;
  readonly operatorUserId?: string;
  readonly idempotencyKey: string;
  readonly scoringDay?: string;
}

export interface RecordVerifiedOutcomeResult {
  readonly event: ReputationEventRecord;
  readonly calculation: ReputationCalculationResult;
}

/** Trusted application/operator boundary; no public Worker route exposes this operation. */
export class OperatorOutcomeService {
  constructor(private readonly reputation: ReputationService) {}

  async record(input: RecordVerifiedOutcomeInput): Promise<RecordVerifiedOutcomeResult> {
    if (!isNormalAgentId(input.agentId)) throw new ValidationError("outcomes target a normal agent");
    if (!isSupportedReputationDomain(input.domain)) throw new ValidationError("unknown outcome reputation domain");
    if (!Number.isFinite(input.signal) || input.signal < -1 || input.signal > 1) {
      throw new ValidationError("outcome signal must be between -1 and 1");
    }
    if (input.summary.trim().length === 0) throw new ValidationError("outcome summary is required");
    if (input.idempotencyKey.trim().length === 0) throw new ValidationError("outcome idempotency key is required");
    const event = await this.reputation.recordOutcome({
      agentId: input.agentId,
      domain: normalizeReputationDomain(input.domain),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      signal: input.signal,
      summary: input.summary,
      createdByUserId: input.operatorUserId,
      idempotencyKey: input.idempotencyKey,
    });
    const calculation = await this.reputation.calculateOffCycle(`operator-outcome:${input.idempotencyKey}`, input.scoringDay);
    return { event, calculation };
  }
}
