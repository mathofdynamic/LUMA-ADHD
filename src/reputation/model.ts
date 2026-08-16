import type {
  ReputationDimension,
  ReputationDomain,
  ReputationEvidenceType,
} from "./types";

export const REPUTATION_SCORING_VERSION = "phase-05-v1";
export const REPUTATION_WEIGHTS: Readonly<Record<ReputationDimension, number>> = Object.freeze({
  epistemic: 0.35,
  contribution: 0.25,
  outcome: 0.25,
  collaboration: 0.15,
});

export const NORMAL_AGENT_IDS = [
  "agent-product",
  "agent-growth",
  "agent-creative",
  "agent-technical",
  "agent-finance",
  "agent-customer",
  "agent-operations",
  "agent-heretic",
] as const;

const DOMAIN_ALIASES: Readonly<Record<string, ReputationDomain>> = Object.freeze({
  product_strategy: "product_strategy",
  growth: "growth",
  growth_strategy: "growth",
  ux_creative: "ux_creative",
  creative: "ux_creative",
  engineering_architecture: "engineering_architecture",
  technical_architecture: "engineering_architecture",
  finance_pricing: "finance_pricing",
  customer_experience: "customer_experience",
  operations: "operations",
  operations_strategy: "operations",
  critical_analysis: "critical_analysis",
  general: "general",
});

export function normalizeReputationDomain(value: string): ReputationDomain {
  const normalized = value.trim().toLocaleLowerCase().replace(/\s+/gu, "_");
  return DOMAIN_ALIASES[normalized] ?? "general";
}

export function isSupportedReputationDomain(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase().replace(/\s+/gu, "_");
  return Object.prototype.hasOwnProperty.call(DOMAIN_ALIASES, normalized);
}

export function isNormalAgentId(agentId: string): boolean {
  return (NORMAL_AGENT_IDS as readonly string[]).includes(agentId);
}

export function clampSignal(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) throw new Error("probability must be finite");
  return Math.max(0.001, Math.min(0.999, value));
}

export function combinedReputationScore(values: Readonly<Record<ReputationDimension, number>>): number {
  return clampSignal(
    REPUTATION_WEIGHTS.epistemic * clampSignal(values.epistemic)
      + REPUTATION_WEIGHTS.contribution * clampSignal(values.contribution)
      + REPUTATION_WEIGHTS.outcome * clampSignal(values.outcome)
      + REPUTATION_WEIGHTS.collaboration * clampSignal(values.collaboration),
  );
}

/**
 * A bounded, monotonic mapping. Rank 10 is the neutral point and the final
 * score cannot move a rank outside the human-readable 1..19 range.
 */
export function rankTargetFromScore(score: number): number {
  return Math.max(1, Math.min(19, 10 + (clampSignal(score) * 9)));
}

export function boundedRankAfter(rankBefore: number, targetRank: number, cap = 0.5): number {
  const safeBefore = Number.isFinite(rankBefore) ? Math.max(0, rankBefore) : 10;
  const safeTarget = Number.isFinite(targetRank) ? Math.max(0, targetRank) : safeBefore;
  const safeCap = Math.max(0, Math.min(0.5, cap));
  const delta = Math.max(-safeCap, Math.min(safeCap, safeTarget - safeBefore));
  return Number((safeBefore + delta).toFixed(4));
}

export function rankInfluenceWeight(rank: number, minimum = 0.2, maximum = 1): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, Math.min(20, rank)) : 10;
  const raw = 0.65 + ((normalized - 10) / 10) * 0.35;
  return Math.max(minimum, Math.min(maximum, raw));
}

export function evidenceWeight(type: ReputationEvidenceType): number {
  switch (type) {
    case "outcome":
    case "human":
      return 1;
    case "god":
      return 0.85;
    case "prediction":
      return 0.7;
    case "critique":
      return 0.5;
    case "proposal":
      return 0.45;
    case "system":
      return 0.25;
  }
}

/**
 * Log score mapped to [-1, 1]. A 50% forecast is neutral, a calibrated
 * confident forecast is positive, and a confidently wrong forecast is worse
 * than a cautious wrong forecast.
 */
export function epistemicSignal(probability: number, observedResult: boolean): number {
  const p = clampProbability(probability);
  const likelihood = observedResult ? p : 1 - p;
  return clampSignal(1 + (Math.log(likelihood) / Math.LN2));
}

export function peerSignal(tags: readonly string[], score: number | null): number {
  const positive = new Set([
    "crucial_risk",
    "improved_clarity",
    "useful_evidence",
    "useful_refinement",
    "novel_contribution",
    "feasible",
  ]);
  const negative = new Set(["redundant", "misleading", "unsupported", "missed_constraint"]);
  let tagSignal = 0;
  for (const tag of tags) {
    if (positive.has(tag)) tagSignal += 0.2;
    if (negative.has(tag)) tagSignal -= 0.2;
  }
  return clampSignal((score ?? 0) * 0.6 + tagSignal);
}

export function reciprocalFeedbackWeight(
  reviewerAgentId: string,
  targetAgentId: string,
  reciprocalCount: number,
): number {
  if (reviewerAgentId === targetAgentId) return 0;
  if (reciprocalCount <= 0) return 1;
  return Math.max(0.2, 1 / (1 + Math.min(4, reciprocalCount)));
}
