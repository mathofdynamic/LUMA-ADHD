import type { AgentRecord, AgentSpecialtyRecord, AgentInterestRecord, ThreadRecord } from "../database/types";
import { normalizeReputationDomain } from "../reputation/model";

export interface AgentCandidateProfile {
  readonly agent: AgentRecord;
  readonly specialties: readonly AgentSpecialtyRecord[];
  readonly interests: readonly AgentInterestRecord[];
}

export interface CandidateSelectionInput {
  readonly profiles: readonly AgentCandidateProfile[];
  readonly messageText: string;
  readonly thread: ThreadRecord;
  readonly addressedAgentId?: string | null;
  readonly requestedAgentIds?: readonly string[];
  readonly recentAgentIds?: readonly string[];
  readonly activityByAgentId?: Readonly<Record<string, AgentSelectionActivity>>;
  readonly preferredAgentId?: string | null;
  readonly reputationByAgentId?: Readonly<Record<string, number>>;
  readonly turnIndex: number;
  readonly now?: string;
  readonly explorationRate?: number;
  readonly rng?: () => number;
}

export interface AgentSelectionActivity {
  readonly lastTurnAt: string | null;
  readonly lastThreadTurnAt: string | null;
  readonly lastAmbientOpportunityAt: string | null;
  readonly recentOpportunityCount: number;
  readonly recentMeaningfulContributionCount: number;
  readonly recentThreadOpportunityCount: number;
  readonly recentThreadMeaningfulContributionCount: number;
}

export interface SelectionSignals {
  readonly threadRecencyPenalty: number;
  readonly organizationRecencyPenalty: number;
  readonly neglectedOpportunityBoost: number;
  readonly reputationSignal: number;
  readonly relevanceScore: number;
  readonly phaseFit: boolean;
}

export interface ScoredCandidate {
  readonly agentId: string;
  readonly score: number;
  readonly relevanceScore: number;
  readonly explorationValue: number;
  readonly signals: SelectionSignals;
  readonly reasons: readonly string[];
}

export interface SelectionDecision {
  readonly candidate: ScoredCandidate | null;
  readonly usedExploration: boolean;
  readonly explorationPool: readonly string[];
  readonly reason: string;
}

const PHASE_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  open: ["product_strategy", "customer_experience", "growth"],
  exploring: ["product_strategy", "growth", "customer_experience"],
  debating: ["critical_analysis", "product_strategy", "finance_pricing"],
  evidence_gathering: ["engineering_architecture", "critical_analysis", "customer_experience"],
  developing: ["engineering_architecture", "operations", "ux_creative"],
  synthesizing: ["product_strategy", "operations", "finance_pricing"],
  human_required: ["customer_experience", "operations"],
  blocked: ["critical_analysis", "operations", "engineering_architecture"],
  reopened: ["critical_analysis", "product_strategy", "customer_experience"],
};

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[يى]/gu, "ی")
    .replace(/[ك]/gu, "ک")
    .replace(/[\u200c\u200d\u200e\u200f]/gu, "")
    .toLocaleLowerCase();
}

function tokens(value: string): readonly string[] {
  return normalizeText(value).match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

function lexicalRelevance(profile: AgentCandidateProfile, messageText: string): number {
  const messageTokens = new Set(tokens(messageText));
  if (messageTokens.size === 0) return 0;
  const vocabulary = [
    profile.agent.specialty,
    profile.agent.specialtyDescription,
    ...profile.specialties.map((item) => `${item.domain} ${item.description}`),
    ...profile.interests.map((item) => item.interest),
  ];
  const overlap = new Set(tokens(vocabulary.join(" ")));
  let matches = 0;
  for (const token of messageTokens) {
    if (overlap.has(token)) matches += 1;
  }
  return Math.min(24, matches * 4);
}

function boundedRandom(rng: (() => number) | undefined): number {
  const value = rng?.() ?? 0.5;
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

function hoursSince(now: string, earlier: string | null): number {
  if (!earlier) return Number.POSITIVE_INFINITY;
  const difference = Date.parse(now) - Date.parse(earlier);
  return Number.isFinite(difference) ? Math.max(0, difference / 3_600_000) : Number.POSITIVE_INFINITY;
}

function activityFor(
  input: CandidateSelectionInput,
  agentId: string,
): AgentSelectionActivity {
  return input.activityByAgentId?.[agentId] ?? {
    lastTurnAt: null,
    lastThreadTurnAt: null,
    lastAmbientOpportunityAt: null,
    recentOpportunityCount: 0,
    recentMeaningfulContributionCount: 0,
    recentThreadOpportunityCount: 0,
    recentThreadMeaningfulContributionCount: 0,
  };
}

function isRelevantCandidate(
  addressed: boolean,
  requested: boolean,
  lexicalScore: number,
  phaseFit: boolean,
): boolean {
  return addressed || requested || lexicalScore > 0 || phaseFit;
}

export function scoreCandidates(input: CandidateSelectionInput): readonly ScoredCandidate[] {
  const phaseDomains = PHASE_DOMAINS[input.thread.state] ?? [];
  const recent = input.recentAgentIds ?? [];
  const requested = new Set(input.requestedAgentIds ?? []);
  const now = input.now ?? new Date().toISOString();

  return input.profiles
    .filter((profile) => profile.agent.isActive && !profile.agent.isSupervisor)
    .map((profile) => {
      const reasons: string[] = [];
      let score = 10;
      const agentId = profile.agent.id;
      const addressed = input.addressedAgentId === agentId;
      const requestedByAgent = requested.has(agentId);
      if (addressed) {
        score += input.turnIndex === 0 ? 120 : 60;
        reasons.push("explicitly addressed");
      }
      if (requestedByAgent) {
        score += 24;
        reasons.push("requested by another agent");
      }
      const relevance = lexicalRelevance(profile, input.messageText);
      if (relevance > 0) {
        score += relevance;
        reasons.push("lexical specialty or interest relevance");
      }
      const phaseFit = profile.specialties.some((item) => phaseDomains.includes(normalizeReputationDomain(item.domain)));
      if (phaseFit) {
        // Phase fit is useful relevance evidence, but must not become a
        // deterministic winner for broad states such as open/exploring.
        score += 10;
        reasons.push("thread phase fit");
      }
      const recentCount = recent.filter((recentId) => recentId === agentId).length;
      score -= recentCount * 9;
      if (recentCount > 0) reasons.push("recent participation penalty");
      if (recent.at(-1) === agentId) {
        score -= input.addressedAgentId === agentId && input.turnIndex === 0 ? 0 : 40;
        reasons.push("consecutive-turn penalty");
      }
      const reputation = input.reputationByAgentId?.[agentId] ?? 0;
      const reputationSignal = Math.max(-5, Math.min(5, reputation * 5));
      score += reputationSignal;
      if (reputationSignal !== 0) reasons.push("bounded reputation signal");

      const activity = activityFor(input, agentId);
      const threadRecencyPenalty = Math.min(9, activity.recentThreadOpportunityCount * 3);
      const organizationRecencyPenalty = Math.min(4.5, activity.recentOpportunityCount * 0.75);
      score -= threadRecencyPenalty + organizationRecencyPenalty;
      if (threadRecencyPenalty > 0) reasons.push("cross-job thread recency penalty");
      if (organizationRecencyPenalty > 0) reasons.push("organization recency penalty");

      const relevant = isRelevantCandidate(addressed, requestedByAgent, relevance, phaseFit);
      const opportunityAgeHours = hoursSince(now, activity.lastTurnAt);
      const neglectedOpportunityBoost = relevant
        ? activity.recentOpportunityCount === 0 && opportunityAgeHours >= 36
          ? 6
          : activity.recentOpportunityCount <= 1 && opportunityAgeHours >= 24
            ? 3
            : 0
        : 0;
      score += neglectedOpportunityBoost;
      if (neglectedOpportunityBoost > 0) reasons.push("neglected relevant opportunity");

      if (input.preferredAgentId === agentId && relevant) {
        score += 6;
        reasons.push("scheduler preferred relevant opportunity");
      }

      // Candidate-specific bounded variation fixes the former shared-random
      // bug. It is deliberately small; relevance remains the primary signal.
      const explorationValue = boundedRandom(input.rng) * 2;
      score += explorationValue;
      reasons.push("candidate-specific exploration");

      const relevanceScore = relevance + (phaseFit ? 10 : 0) + (requestedByAgent ? 24 : 0);
      return {
        agentId,
        score,
        relevanceScore,
        explorationValue,
        signals: {
          threadRecencyPenalty,
          organizationRecencyPenalty,
          neglectedOpportunityBoost,
          reputationSignal,
          relevanceScore,
          phaseFit,
        },
        reasons,
      };
    })
    .sort((left, right) => right.score - left.score || left.agentId.localeCompare(right.agentId));
}

export function chooseCandidateFromScores(
  scored: readonly ScoredCandidate[],
  input: Pick<CandidateSelectionInput, "addressedAgentId" | "turnIndex" | "rng" | "explorationRate"> & {
    readonly lastAgentId?: string;
  },
): SelectionDecision {
  if (scored.length === 0) {
    return { candidate: null, usedExploration: false, explorationPool: [], reason: "no_candidate" };
  }

  const addressed = input.addressedAgentId
    ? scored.find((candidate) => candidate.agentId === input.addressedAgentId)
    : undefined;
  if (input.turnIndex === 0 && addressed) {
    return { candidate: addressed, usedExploration: false, explorationPool: [addressed.agentId], reason: "explicit_address" };
  }

  const eligible = scored.filter((candidate) => candidate.relevanceScore > 0);
  const pool = (eligible.length > 0 ? eligible : scored).slice(0, 3);
  const withoutLast = pool.filter((candidate) => candidate.agentId !== input.lastAgentId);
  const usablePool = withoutLast.length > 0 ? withoutLast : pool;
  const explorationRate = Math.max(0, Math.min(0.25, input.explorationRate ?? 0.1));
  // A zero-valued injected RNG remains the deterministic exploitation path
  // used by existing runtime fixtures. The upper tail is the exploration band.
  const shouldExplore = usablePool.length > 1 && boundedRandom(input.rng) > 1 - explorationRate;
  if (shouldExplore) {
    const index = Math.min(usablePool.length - 1, Math.floor(boundedRandom(input.rng) * usablePool.length) + 1);
    const candidate = usablePool[index] ?? usablePool[0];
    return {
      candidate,
      usedExploration: candidate.agentId !== usablePool[0]?.agentId,
      explorationPool: usablePool.map((item) => item.agentId),
      reason: "bounded_relevant_exploration",
    };
  }

  const candidate = usablePool[0] ?? scored[0] ?? null;
  return {
    candidate,
    usedExploration: false,
    explorationPool: usablePool.map((item) => item.agentId),
    reason: candidate?.agentId === scored[0]?.agentId ? "highest_bounded_value" : "cooldown_adjusted_value",
  };
}

export function selectNextAgent(input: CandidateSelectionInput): ScoredCandidate | null {
  return chooseCandidateFromScores(scoreCandidates(input), input).candidate;
}
