import type { AgentRecord, AgentSpecialtyRecord, AgentInterestRecord, ThreadRecord } from "../database/types";

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
  readonly reputationByAgentId?: Readonly<Record<string, number>>;
  readonly turnIndex: number;
  readonly rng?: () => number;
}

export interface ScoredCandidate {
  readonly agentId: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

const PHASE_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  open: ["product_strategy", "customer_experience", "growth_strategy"],
  exploring: ["product_strategy", "growth_strategy", "customer_experience"],
  debating: ["critical_analysis", "product_strategy", "finance_pricing"],
  evidence_gathering: ["technical_architecture", "critical_analysis", "customer_experience"],
  developing: ["technical_architecture", "operations_strategy", "ux_creative"],
  synthesizing: ["product_strategy", "operations_strategy", "finance_pricing"],
  human_required: ["customer_experience", "operations_strategy"],
  blocked: ["critical_analysis", "operations_strategy", "technical_architecture"],
  reopened: ["critical_analysis", "product_strategy", "customer_experience"],
};

function tokens(value: string): readonly string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
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

export function scoreCandidates(input: CandidateSelectionInput): readonly ScoredCandidate[] {
  const random = Math.max(0, Math.min(1, input.rng?.() ?? 0.5));
  const phaseDomains = PHASE_DOMAINS[input.thread.state] ?? [];
  const recent = input.recentAgentIds ?? [];
  const requested = new Set(input.requestedAgentIds ?? []);

  return input.profiles
    .filter((profile) => profile.agent.isActive && !profile.agent.isSupervisor)
    .map((profile) => {
      const reasons: string[] = [];
      let score = 10;
      const agentId = profile.agent.id;
      if (input.addressedAgentId === agentId) {
        score += input.turnIndex === 0 ? 120 : 60;
        reasons.push("explicitly addressed");
      }
      if (requested.has(agentId)) {
        score += 24;
        reasons.push("requested by another agent");
      }
      const relevance = lexicalRelevance(profile, input.messageText);
      if (relevance > 0) {
        score += relevance;
        reasons.push("lexical specialty or interest relevance");
      }
      const phaseFit = profile.specialties.some((item) => phaseDomains.includes(item.domain));
      if (phaseFit) {
        score += 14;
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
      score += Math.max(-5, Math.min(5, reputation * 5));
      if (reputation !== 0) reasons.push("bounded reputation signal");
      score += random * 4;
      reasons.push("exploration factor");
      return { agentId, score, reasons };
    })
    .sort((left, right) => right.score - left.score || left.agentId.localeCompare(right.agentId));
}

export function selectNextAgent(input: CandidateSelectionInput): ScoredCandidate | null {
  return scoreCandidates(input)[0] ?? null;
}
