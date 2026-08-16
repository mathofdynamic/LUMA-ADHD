import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import { ContextPackService } from "../memory/retrieval";
import type { MemoryServices } from "../memory";
import type { GodBriefing } from "../reputation/types";
import type { JsonObject } from "../database/validation";

type GodRepositories = ReturnType<typeof createRepositories>;

export interface GodBriefingDependencies {
  readonly repositories: GodRepositories;
  readonly memory?: MemoryServices;
  readonly now?: () => string;
  readonly maxCharacters?: number;
}

function maskContributors(messages: readonly Record<string, unknown>[], additionalAgentIds: readonly string[] = []): { readonly messages: readonly Record<string, unknown>[]; readonly mapping: Readonly<Record<string, string>> } {
  const ids = [...new Set([
    ...messages.map((message) => message.authorAgentId),
    ...additionalAgentIds,
  ].filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
  const mapping: Record<string, string> = {};
  ids.forEach((agentId, index) => { mapping[`Contributor ${String.fromCharCode(65 + index)}`] = agentId; });
  const reverse = new Map(Object.entries(mapping).map(([label, agentId]) => [agentId, label]));
  return {
    mapping,
    messages: messages.map((message) => ({
      ...message,
      authorAgentId: typeof message.authorAgentId === "string" ? reverse.get(message.authorAgentId) ?? "Contributor" : message.authorAgentId,
    })),
  };
}

function contributorLabel(mapping: Readonly<Record<string, string>>, agentId: unknown): string {
  if (typeof agentId !== "string") return "Contributor";
  return Object.entries(mapping).find(([, mappedAgentId]) => mappedAgentId === agentId)?.[0] ?? "Contributor";
}

function trimObject(value: Record<string, unknown>, maxContent = 1_000): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    typeof item === "string" ? item.slice(0, maxContent) : item,
  ]));
}

function boundedBriefing(base: {
  readonly generatedAt: string;
  readonly threads: readonly Record<string, unknown>[];
  readonly messages: readonly Record<string, unknown>[];
  readonly decisions: readonly Record<string, unknown>[];
  readonly humanRequired: readonly Record<string, unknown>[];
  readonly directives: readonly Record<string, unknown>[];
  readonly reputation: readonly Record<string, unknown>[];
  readonly contextPack: readonly Record<string, unknown>[];
}, maxCharacters: number): string {
  const compact = {
    generatedAt: base.generatedAt,
    threads: base.threads.slice(0, 6).map((item) => trimObject(item, 320)),
    messages: base.messages.slice(-10).map((item) => trimObject(item, 420)),
    decisions: base.decisions.slice(0, 6).map((item) => trimObject(item, 420)),
    humanRequired: base.humanRequired.slice(0, 6).map((item) => trimObject(item, 320)),
    directives: base.directives.slice(0, 6).map((item) => trimObject(item, 420)),
    reputation: base.reputation.slice(0, 10).map((item) => trimObject(item, 320)),
    contextPack: base.contextPack.slice(0, 5).map((item) => trimObject(item, 420)),
  };
  let serialized = JSON.stringify(compact);
  if (serialized.length <= maxCharacters) return serialized;

  const minimal = {
    generatedAt: base.generatedAt,
    threads: compact.threads.slice(0, 2).map((item) => trimObject(item, 160)),
    messages: compact.messages.slice(-4).map((item) => trimObject(item, 220)),
    decisions: compact.decisions.slice(0, 2).map((item) => trimObject(item, 220)),
    humanRequired: compact.humanRequired.slice(0, 2).map((item) => trimObject(item, 160)),
    directives: compact.directives.slice(0, 2).map((item) => trimObject(item, 220)),
    reputation: compact.reputation.slice(0, 4).map((item) => trimObject(item, 160)),
    contextPack: compact.contextPack.slice(0, 2).map((item) => trimObject(item, 220)),
  };
  serialized = JSON.stringify(minimal);
  if (serialized.length <= maxCharacters) return serialized;

  return JSON.stringify({
    generatedAt: base.generatedAt,
    threads: [],
    messages: [],
    decisions: [],
    humanRequired: [],
    directives: [],
    reputation: [],
    contextPack: [],
  });
}

export class GodBriefingService {
  private readonly now: () => string;
  private readonly maxCharacters: number;

  constructor(private readonly dependencies: GodBriefingDependencies) {
    this.now = dependencies.now ?? nowIso;
    this.maxCharacters = Math.max(4_000, Math.min(dependencies.maxCharacters ?? 14_000, 24_000));
  }

  async build(): Promise<GodBriefing> {
    const threads = await this.dependencies.repositories.reputation.listBriefingThreads(12);
    const messages = await this.dependencies.repositories.reputation.listBriefingMessages(threads.map((thread) => String(thread.threadId)), 6);
    const decisions = await this.dependencies.repositories.reputation.listBriefingDecisions(10);
    const humanRequired = await this.dependencies.repositories.reputation.listBriefingHumanTasks(10);
    const directives = (await this.dependencies.repositories.reputation.listRecentDirectives(16)).map((directive) => ({
      directiveId: directive.id, targetAgentId: directive.targetAgentId, targetThreadId: directive.targetThreadId,
      directive: directive.directive, status: directive.status, priority: directive.priority, createdAt: directive.createdAt,
    }));
    const reputationEvents = await this.dependencies.repositories.reputation.listRecent(30);
    const masked = maskContributors(
      messages as readonly Record<string, unknown>[],
      reputationEvents.map((event) => event.agentId),
    );
    const reputation = reputationEvents.map((event) => ({
      evidenceId: event.id, contributor: contributorLabel(masked.mapping, event.agentId), domain: event.domain, dimension: event.dimension,
      eventType: event.eventType, signal: event.signal, summary: event.evidenceSummary ?? "", createdAt: event.createdAt,
    }));
    const contextPack = this.dependencies.memory
      ? (await this.dependencies.memory.context.build({
        query: "LUMA unresolved risk decision product strategy official knowledge",
        actor: { agentId: "agent-god" },
        topK: 8,
        maxCharacters: 5_000,
      })).items.map((item) => ({
        type: item.type, sourceId: item.sourceId, title: item.title, pathOrUrl: item.pathOrUrl,
        excerpt: item.excerpt, authority: item.authority, score: item.score, updatedAt: item.updatedAt,
        provenance: item.provenance,
      }))
      : [];
    const base = {
      generatedAt: this.now(),
      threads: threads.map((thread) => trimObject(thread)),
      messages: masked.messages.map((message) => trimObject(message)),
      decisions: decisions.map((decision) => trimObject(decision)),
      humanRequired: humanRequired.map((task) => trimObject(task)),
      directives,
      reputation,
      contextPack: contextPack.map((item) => trimObject(item)),
    };
    const initialSerialized = JSON.stringify(base);
    const serialized = initialSerialized.length <= this.maxCharacters
      ? initialSerialized
      : boundedBriefing(base, this.maxCharacters);
    const promptBase = JSON.parse(serialized) as Record<string, unknown>;
    return {
      generatedAt: String(promptBase.generatedAt),
      threads: JSON.parse(JSON.stringify(promptBase.threads ?? [])) as readonly JsonObject[],
      messages: JSON.parse(JSON.stringify(promptBase.messages ?? [])) as readonly JsonObject[],
      decisions: JSON.parse(JSON.stringify(promptBase.decisions ?? [])) as readonly JsonObject[],
      humanRequired: JSON.parse(JSON.stringify(promptBase.humanRequired ?? [])) as readonly JsonObject[],
      directives: JSON.parse(JSON.stringify(promptBase.directives ?? [])) as readonly JsonObject[],
      reputation: JSON.parse(JSON.stringify(promptBase.reputation ?? [])) as readonly JsonObject[],
      contextPack: JSON.parse(JSON.stringify(promptBase.contextPack ?? [])) as readonly JsonObject[],
      maskedContributors: masked.mapping,
      characterCount: serialized.length,
    };
  }

  static toPromptText(briefing: GodBriefing): string {
    const prompt = {
      generated_at: briefing.generatedAt,
      threads: briefing.threads,
      messages: briefing.messages,
      decisions: briefing.decisions,
      human_required: briefing.humanRequired,
      open_directives: briefing.directives,
      recent_reputation_evidence: briefing.reputation,
      official_and_retrieved_context: briefing.contextPack,
      context_character_count: briefing.characterCount,
    };
    return JSON.stringify(prompt);
  }

  static maskingMap(briefing: GodBriefing): Readonly<Record<string, string>> {
    return briefing.maskedContributors;
  }
}
