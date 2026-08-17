import type { createRepositories } from "../database/repositories";
import { nowIso } from "../database/ids";
import type {
  AgentRecord,
  AgentTurnRecord,
  JobRecord,
  MessageRecord,
  ThreadRecord,
} from "../database/types";
import type { JsonObject, JsonValue } from "../database/validation";
import { InvalidTransitionError, NotFoundError } from "../database/errors";
import { FOUNDATION_GUARDRAILS } from "../guardrails";
import {
  AgentActionValidationError,
  AgentAcquisitionValidationError,
  AGENT_STEP_SCHEMA,
  parseAgentStep,
  type AgentAction,
  type AgentAcquisitionRequest,
  type AgentStep,
} from "./actions";
import { AgentDocumentTools } from "./memory-tools";
import { buildAgentPrompt, TELEGRAM_PRESENTATION_GUIDANCE } from "./prompts";
import {
  chooseCandidateFromScores,
  scoreCandidates,
  type AgentCandidateProfile,
  type AgentSelectionActivity,
  type ScoredCandidate,
} from "./selection";
import {
  LLMProviderError,
  normalizeProviderError,
  type LLMGenerateResponse,
  type LLMProvider,
} from "../llm";
import type { TelegramApplicationService } from "../telegram";
import { ContextPackService } from "../memory/retrieval";
import type { MemoryServices } from "../memory";
import type { ReputationService } from "../reputation/service";
import { assessOfficialGrounding, type OfficialGroundingAssessment } from "./grounding";
import { assessCurrentStateGrounding, qualifyUnsupportedCurrentClaim, type CurrentStateGroundingAssessment } from "./grounding";
import { DEFAULT_RUNTIME_SETTINGS, loadEffectiveRuntimeSettings, type EffectiveRuntimeSettings } from "../admin/settings";
import { HumanTaskService } from "../human-tasks";
import { DiagramService } from "../diagrams";
import { assessContributionDuplication, isObviousRepeatedContent } from "./repetition";
import { buildConversationFocus, type ConversationFocus } from "./conversation-focus";
import { countDailyAutonomyJobs, nextUtcDay } from "../autonomy-budgets";

type RuntimeRepositories = ReturnType<typeof createRepositories>;

export interface AgentRuntimeDependencies {
  readonly repositories: RuntimeRepositories;
  readonly provider: LLMProvider;
  readonly telegram?: Pick<TelegramApplicationService, "projectAgentMessage">;
  readonly modelKey: string;
  readonly memory?: MemoryServices;
  readonly reputation?: ReputationService;
  readonly runtimeSettings?: EffectiveRuntimeSettings;
  readonly now?: () => string;
  readonly rng?: () => number;
}

export interface RuntimeBurstResult {
  readonly jobId: string;
  readonly threadId: string;
  readonly turns: number;
  readonly completedTurns: number;
  readonly publicMessages: number;
  readonly waits: number;
  readonly stoppedReason: string;
}

interface TurnContext {
  readonly job: JobRecord;
  readonly thread: ThreadRecord;
  readonly wakeMessage: MessageRecord | null;
  readonly agent: AgentRecord;
  readonly turn: AgentTurnRecord;
  readonly recentMessages: readonly MessageRecord[];
  readonly profiles: readonly AgentCandidateProfile[];
  readonly addressedAgentId: string | null;
  readonly requestedAgentIds: readonly string[];
  readonly replyToMessageId: string | undefined;
  readonly wakeReason: string;
  readonly settings: EffectiveRuntimeSettings;
  readonly conversationFocus: ConversationFocus;
  readonly coveredDomains: readonly string[];
  readonly contributionRole: "CONTRIBUTE" | "SYNTHESIZE";
  readonly priorBurstContributions: readonly string[];
}

interface TurnExecutionResult {
  readonly action: AgentAction | null;
  readonly outputMessageId: string | undefined;
  readonly wait: boolean;
  readonly retryableFailure: boolean;
  readonly stopBurst: boolean;
  readonly repetitionSuppressed: boolean;
}

function stringField(payload: JsonObject, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function booleanField(payload: JsonObject, key: string): boolean {
  return payload[key] === true;
}

function numberField(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectField(payload: JsonObject, key: string): JsonObject {
  const value = payload[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}

function safeErrorSummary(error: unknown): string {
  if (error instanceof LLMProviderError) {
    return JSON.stringify({
      kind: error.failure.kind,
      retryable: error.failure.retryable,
      status: error.failure.status ?? null,
      retryAfterSeconds: error.failure.retryAfterSeconds ?? null,
    });
  }
  return JSON.stringify({ kind: "runtime", message: String(error).slice(0, 300) });
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof LLMProviderError ? error.failure.retryable : true;
}

function actionMetadata(
  action: AgentAction,
  repairAttempts: number,
  retrievalTelemetry?: JsonObject,
  acquisitionOperations = 0,
  grounding?: OfficialGroundingAssessment,
  currentStateGrounding?: CurrentStateGroundingAssessment,
  repetitionSuppressed = false,
): JsonObject {
  return {
    intent: action.intent,
    confidence: action.confidence,
    reasonSummary: action.reasonSummary,
    targetAgentId: action.targetAgentId,
    targetThreadId: action.targetThreadId,
    repairAttempts,
    retrieval: retrievalTelemetry ? { ...retrievalTelemetry, acquisitionOperations } : {},
    acquisitionOperations,
    grounding: grounding ? {
      required: grounding.required,
      satisfied: grounding.satisfied,
      sourceIds: grounding.sourceIds,
      matchedTerms: grounding.matchedTerms,
      bestSourceMatchCount: grounding.bestSourceMatchCount,
    } : {},
    currentStateGrounding: currentStateGrounding ? {
      claimDetected: currentStateGrounding.claimDetected,
      supported: currentStateGrounding.supported,
      evidenceKinds: currentStateGrounding.evidenceKinds,
      matchedTerms: currentStateGrounding.matchedTerms,
      proposalOnly: currentStateGrounding.proposalOnly,
      state: currentStateGrounding.state,
    } : {},
    repetitionSuppressed,
    actionMetadata: action.metadata,
  };
}

function groundingMetadata(grounding: OfficialGroundingAssessment): JsonObject {
  return {
    required: grounding.required,
    satisfied: grounding.satisfied,
    sourceIds: grounding.sourceIds,
    matchedTerms: grounding.matchedTerms,
    bestSourceMatchCount: grounding.bestSourceMatchCount,
  };
}

export class AgentRuntimeService {
  private readonly now: () => string;
  private readonly rng: () => number;
  private readonly runtimeSettings: Promise<EffectiveRuntimeSettings>;

  constructor(private readonly dependencies: AgentRuntimeDependencies) {
    this.now = dependencies.now ?? nowIso;
    this.rng = dependencies.rng ?? Math.random;
    this.runtimeSettings = dependencies.runtimeSettings
      ? Promise.resolve(dependencies.runtimeSettings)
      : loadEffectiveRuntimeSettings(dependencies.repositories.database).catch(() => DEFAULT_RUNTIME_SETTINGS);
  }

  get repositories(): RuntimeRepositories {
    return this.dependencies.repositories;
  }

  async processJob(job: JobRecord): Promise<RuntimeBurstResult | null> {
    if (job.jobType === "telegram.interactive_message") {
      const messageId = stringField(job.payload, "messageId");
      const threadId = stringField(job.payload, "threadId");
      if (!messageId || !threadId) {
        throw new Error("interactive job is missing messageId or threadId");
      }
      return this.runInteractiveBurst({
        job,
        messageId,
        threadId,
        addressedAgentId: stringField(job.payload, "addressedAgentId"),
        wakeReason: "human_message",
      });
    }

    if (job.jobType === "agent.ambient") {
      const threadId = stringField(job.payload, "threadId");
      if (!threadId) {
        return null;
      }
      return this.runAmbientOpportunity(job, threadId, stringField(job.payload, "preferredAgentId"));
    }

    if (job.jobType === "agent.deep_work") {
      const threadId = stringField(job.payload, "threadId");
      if (!threadId || (!booleanField(job.payload, "eligible") && stringField(job.payload, "trigger") === null)) {
        return null;
      }
      return this.runDeepWork(job, threadId, stringField(job.payload, "trigger") ?? "explicit_request");
    }

    if (job.jobType === "human_task.wake") {
      const taskId = stringField(job.payload, "taskId");
      const threadId = stringField(job.payload, "threadId");
      const messageId = stringField(job.payload, "messageId");
      if (!taskId || !threadId || !messageId) return null;
      const task = await this.dependencies.repositories.humanTasks.getById(taskId);
      if (task.status !== "completed") return null;
      return this.runInteractiveBurst({
        job,
        messageId,
        threadId,
        addressedAgentId: task.requestedByAgentId,
        wakeReason: "human_task_response",
      });
    }

    if (job.jobType === "diagram.render") {
      const artifactId = stringField(job.payload, "artifactId");
      if (artifactId) await new DiagramService(this.dependencies.repositories).render(artifactId);
      return null;
    }

    await this.dependencies.repositories.events.append({
      eventType: "runtime.job_ignored",
      aggregateType: "job",
      aggregateId: job.id,
      jobId: job.id,
      idempotencyKey: `runtime-job-ignored:${job.id}`,
      payload: { jobType: job.jobType },
    });
    return null;
  }

  async runInteractiveBurst(input: {
    readonly job: JobRecord;
    readonly messageId: string;
    readonly threadId: string;
    readonly addressedAgentId?: string | null;
    readonly wakeReason: string;
  }): Promise<RuntimeBurstResult> {
    const settings = await this.runtimeSettings;
    return this.runBoundedBurst({
      ...input,
      mode: "interactive",
      maxTurns: settings.interactiveBurstMaxTurns,
      settings,
    });
  }

  async runDeepWork(job: JobRecord, threadId: string, trigger: string): Promise<RuntimeBurstResult> {
    const settings = await this.runtimeSettings;
    const dailyDeepWorkJobs = await countDailyAutonomyJobs(this.dependencies.repositories.database, "deep_work", this.now());
    if (dailyDeepWorkJobs > settings.deepWorkDailyJobBudget) {
      const nextDueAt = nextUtcDay(this.now());
      const deferredJob = await this.dependencies.repositories.jobs.create({
        jobType: job.jobType,
        payload: {
          ...job.payload,
          source: "daily_safety_budget_deferred",
          deferredFromJobId: job.id,
        },
        idempotencyKey: `deep-work-budget:${job.id}:${nextDueAt}`,
        dueAt: nextDueAt,
        priority: job.priority,
        maxAttempts: job.maxAttempts,
        chainDepth: job.chainDepth,
      });
      await this.dependencies.repositories.events.append({
        eventType: "runtime.autonomy_budget_deferred",
        aggregateType: "job",
        aggregateId: job.id,
        threadId,
        jobId: job.id,
        idempotencyKey: `runtime-budget:${job.id}`,
        payload: {
          budget: "deep_work",
          used: dailyDeepWorkJobs,
          limit: settings.deepWorkDailyJobBudget,
          deferredJobId: deferredJob.id,
          dueAt: deferredJob.dueAt,
        },
      });
      return {
        jobId: job.id,
        threadId,
        turns: 0,
        completedTurns: 0,
        publicMessages: 0,
        waits: 0,
        stoppedReason: "daily_safety_budget_exhausted",
      };
    }
    return this.runBoundedBurst({
      job,
      messageId: stringField(job.payload, "messageId") ?? "",
      threadId,
      addressedAgentId: stringField(job.payload, "addressedAgentId"),
      wakeReason: `deep_work:${trigger}`,
      mode: "deep_work",
      maxTurns: settings.deepWorkMaxTurns,
      settings,
    });
  }

  async runAmbientOpportunity(job: JobRecord, threadId: string, preferredAgentId?: string | null): Promise<RuntimeBurstResult> {
    return this.runAmbientOpportunityWithPreference(
      job,
      threadId,
      preferredAgentId ?? stringField(job.payload, "preferredAgentId"),
    );
  }

  private async runAmbientOpportunityWithPreference(
    job: JobRecord,
    threadId: string,
    preferredAgentId: string | null,
  ): Promise<RuntimeBurstResult> {
    const settings = await this.runtimeSettings;
    return this.runBoundedBurst({
      job,
      messageId: stringField(job.payload, "messageId") ?? "",
      threadId,
      addressedAgentId: null,
      preferredAgentId,
      wakeReason: stringField(job.payload, "wakeReason") ?? "ambient_opportunity",
      mode: "ambient",
      maxTurns: 1,
      settings,
    });
  }

  private async runBoundedBurst(input: {
    readonly job: JobRecord;
    readonly messageId: string;
    readonly threadId: string;
    readonly addressedAgentId?: string | null;
    readonly preferredAgentId?: string | null;
    readonly wakeReason: string;
    readonly mode: "interactive" | "ambient" | "deep_work";
    readonly maxTurns: number;
    readonly settings: EffectiveRuntimeSettings;
  }): Promise<RuntimeBurstResult> {
    const completedEvent = await this.dependencies.repositories.events
      .getByIdempotencyKey(`runtime-burst-completed:${input.job.id}`)
      .catch(() => null);
    if (completedEvent) {
      return {
        jobId: input.job.id,
        threadId: input.threadId,
        turns: numberField(completedEvent.payload.turns) ?? 0,
        completedTurns: numberField(completedEvent.payload.completedTurns) ?? 0,
        publicMessages: numberField(completedEvent.payload.publicMessages) ?? 0,
        waits: numberField(completedEvent.payload.waits) ?? 0,
        stoppedReason: stringField(completedEvent.payload, "stoppedReason") ?? "already_completed",
      };
    }

    const thread = await this.dependencies.repositories.threads.getById(input.threadId);
    const wakeMessage = input.messageId.length > 0
      ? await this.dependencies.repositories.messages.getById(input.messageId).catch(() => null)
      : null;
    const anchorMessage = wakeMessage?.replyToMessageId
      ? await this.dependencies.repositories.messages.getById(wakeMessage.replyToMessageId).catch(() => null)
      : null;
    const profiles = await this.loadProfiles();
    const requestedAgentIds = await this.loadRequestedAgentIds(
      input.threadId,
      input.mode === "interactive" ? anchorMessage?.createdAt ?? wakeMessage?.createdAt ?? null : null,
    );
    const selectionActivityRows = await this.dependencies.repositories.agentTurns.getSelectionActivity(
      profiles.map((profile) => profile.agent.id),
      input.threadId,
      this.now(),
      72,
    );
    const activityByAgentId: Readonly<Record<string, AgentSelectionActivity>> = Object.fromEntries(
      Object.entries(selectionActivityRows).map(([agentId, row]) => [agentId, {
        lastTurnAt: row.last_turn_at,
        lastThreadTurnAt: row.last_thread_turn_at,
        lastAmbientOpportunityAt: row.last_ambient_opportunity_at,
        recentOpportunityCount: row.recent_opportunity_count,
        recentMeaningfulContributionCount: row.recent_meaningful_count,
        recentThreadOpportunityCount: row.recent_thread_opportunity_count,
        recentThreadMeaningfulContributionCount: row.recent_thread_meaningful_count,
      }]),
    );
    const reputationByAgentId = {
      ...Object.fromEntries(profiles.map((profile) => [profile.agent.id, (profile.agent.rank - 10) / 10])),
      ...(this.dependencies.reputation
        ? await this.dependencies.reputation.selectionSignals(profiles.map((profile) => profile.agent.id))
        : {}),
    };
    const hardTurnLimit = input.mode === "interactive"
      ? FOUNDATION_GUARDRAILS.interactiveBurstMaxTurns
      : input.mode === "deep_work"
        ? FOUNDATION_GUARDRAILS.deepWorkMaxTurns
        : 1;
    const maxTurns = Math.min(Math.max(0, input.maxTurns), hardTurnLimit);
    const existingTurns = await this.dependencies.repositories.agentTurns.listByJob(input.job.id, Math.max(1, maxTurns));
    let recentMessages = (await this.dependencies.repositories.messages.listRecentByThread(
      input.threadId,
      input.settings.recentMessageContextCount,
    )).filter((message) => message.visibility !== "private");
    let conversationFocus = buildConversationFocus({ thread, wakeMessage, anchorMessage, recentMessages });

    let turnCount = existingTurns.length;
    let completedTurns = existingTurns.filter((turn) => turn.status === "completed").length;
    let publicMessages = existingTurns.filter((turn) => turn.outputMessageId !== null).length;
    let waits = existingTurns.filter((turn) => turn.metadata.intent === "WAIT").length;
    let stoppedReason = "turn_budget_exhausted";
    // Ambient activity is a standalone organizational opportunity. Reusing an
    // old Telegram reply target can point at a deleted or expired message;
    // interactive bursts retain the direct conversation relationship.
    let replyToMessageId = input.mode === "ambient"
      ? undefined
      : recentMessages.at(-1)?.id ?? (wakeMessage?.id || undefined);
    const recentAgentIds = existingTurns
      .map((turn) => turn.agentId)
      .filter((agentId): agentId is string => typeof agentId === "string");
    const requested = [...requestedAgentIds];
    const coveredDomains = new Set<string>();
    const priorBurstContributions: string[] = [];
    for (const existingTurn of existingTurns) {
      if (!existingTurn.outputMessageId) continue;
      const output = await this.dependencies.repositories.messages.getById(existingTurn.outputMessageId).catch(() => null);
      if (output?.contentText) priorBurstContributions.push(output.contentText);
    }

    while (turnCount < maxTurns) {
      if (input.mode === "interactive" && publicMessages >= 4) {
        stoppedReason = "public_message_budget_exhausted";
        break;
      }
      if (waits >= 2 && turnCount > 0) {
        stoppedReason = "two_bounded_waits";
        break;
      }

      conversationFocus = buildConversationFocus({ thread, wakeMessage, anchorMessage, recentMessages });
      const contributionRole = input.mode === "interactive"
        && conversationFocus.isBroadQuestion
        && coveredDomains.size >= 2
        && turnCount >= 2
        ? "SYNTHESIZE" as const
        : "CONTRIBUTE" as const;
      const scored = scoreCandidates({
        profiles,
        messageText: conversationFocus.selectionQuery,
        thread,
        addressedAgentId: input.addressedAgentId,
        requestedAgentIds: requested,
        recentAgentIds,
        activityByAgentId,
        preferredAgentId: input.preferredAgentId,
        reputationByAgentId,
        turnIndex: turnCount,
        now: this.now(),
        mode: input.mode,
        isBroadQuestion: conversationFocus.isBroadQuestion,
        coveredDomains: [...coveredDomains],
        contributionRole,
        ambientOpportunityIntervalMinutes: input.settings.ambientOpportunityIntervalMinutes,
        rng: this.rng,
      });
      const decision = chooseCandidateFromScores(scored, {
        lastAgentId: recentAgentIds.at(-1),
        addressedAgentId: input.addressedAgentId,
        turnIndex: turnCount,
        rng: this.rng,
        mode: input.mode,
      });
      const candidate = decision.candidate;
      if (candidate === null) {
        stoppedReason = "no_candidate";
        break;
      }
      const profile = profiles.find((item) => item.agent.id === candidate.agentId);
      if (!profile) {
        stoppedReason = "candidate_profile_missing";
        break;
      }

      if (requested.includes(candidate.agentId)) {
        await this.dependencies.repositories.agentRequests.acceptOpenForThreadTarget({
          threadId: input.threadId,
          requestedAgentId: candidate.agentId,
          minimumCreatedAt: input.mode === "interactive"
            ? anchorMessage?.createdAt ?? wakeMessage?.createdAt ?? null
            : null,
        });
      }

      const turn = await this.createOrGetTurn({
        job: input.job,
        thread,
        agent: profile.agent,
        sequenceNumber: await this.dependencies.repositories.agentTurns.nextSequence(input.threadId),
        inputMessageId: input.messageId || undefined,
        wakeReason: input.wakeReason,
        mode: input.mode,
        selection: this.selectionTelemetry({
          input,
          candidate,
          scored,
          decision,
          activity: activityByAgentId[candidate.agentId],
          focus: conversationFocus,
          coveredDomains: [...coveredDomains],
          contributionRole,
        }),
      });
      await this.dependencies.repositories.events.append({
        eventType: "runtime.agent_turn_selected",
        aggregateType: "agent_turn",
        aggregateId: turn.id,
        threadId: input.threadId,
        jobId: input.job.id,
        actor: { type: "agent", agentId: candidate.agentId },
        idempotencyKey: `agent-turn-selected:${turn.id}`,
        payload: this.selectionTelemetry({
          input,
          candidate,
          scored,
          decision,
          activity: activityByAgentId[candidate.agentId],
          focus: conversationFocus,
          coveredDomains: [...coveredDomains],
          contributionRole,
        }),
      });
      if (turn.status === "completed") {
        turnCount += 1;
        completedTurns += 1;
        if (turn.outputMessageId) publicMessages += 1;
        if (turn.metadata.intent === "WAIT") waits += 1;
        recentAgentIds.push(profile.agent.id);
        continue;
      }

      const result = await this.executeTurn({
        job: input.job,
        thread,
        wakeMessage,
        agent: profile.agent,
        turn,
        recentMessages,
        profiles,
        addressedAgentId: input.addressedAgentId ?? null,
        requestedAgentIds: requested,
        replyToMessageId,
        wakeReason: input.wakeReason,
        settings: input.settings,
        conversationFocus,
        coveredDomains: [...coveredDomains],
        contributionRole,
        priorBurstContributions: [...priorBurstContributions],
      });
      await this.dependencies.repositories.threads.incrementTurnUsage(input.threadId, this.now());
      turnCount += 1;
      recentAgentIds.push(profile.agent.id);
      if (result.action?.intent === "REQUEST_AGENT" && result.action.targetAgentId) {
        requested.push(result.action.targetAgentId);
      }
      if (result.action?.intent === "SPEAK" && result.outputMessageId) {
        const domain = profiles.find((item) => item.agent.id === profile.agent.id)?.specialties.find((item) => item.isPrimary)?.domain
          ?? profiles.find((item) => item.agent.id === profile.agent.id)?.specialties[0]?.domain;
        if (domain) coveredDomains.add(domain);
        const outputMessage = await this.dependencies.repositories.messages.getById(result.outputMessageId).catch(() => null);
        if (outputMessage?.contentText) priorBurstContributions.push(outputMessage.contentText);
      }
      if (result.wait) waits += 1;
      if (result.action !== null) completedTurns += 1;
      if (result.outputMessageId) {
        publicMessages += 1;
        replyToMessageId = result.outputMessageId;
        const outputMessage = await this.dependencies.repositories.messages
          .getById(result.outputMessageId)
          .catch(() => null);
        if (outputMessage) {
          recentMessages = [...recentMessages, outputMessage]
            .filter((message) => message.visibility !== "private")
            .slice(-input.settings.recentMessageContextCount);
        }
      }
      if (result.retryableFailure) {
        stoppedReason = "retryable_provider_failure";
        throw new RuntimeProviderFailure("bounded provider failure");
      }
      if (result.stopBurst) {
        stoppedReason = result.repetitionSuppressed
          ? "repeated_content_suppressed"
          : "turn_stopped_after_safe_failure";
        break;
      }
      if (result.action?.intent === "REQUEST_HUMAN") {
        stoppedReason = "human_required";
        break;
      }
    }

    await this.dependencies.repositories.events.append({
      eventType: `runtime.${input.mode}_burst_completed`,
      aggregateType: "thread",
      aggregateId: input.threadId,
      threadId: input.threadId,
      jobId: input.job.id,
      idempotencyKey: `runtime-burst-completed:${input.job.id}`,
      payload: {
        turns: turnCount,
        completedTurns,
        publicMessages,
        waits,
        stoppedReason,
      },
    });

    if (this.dependencies.memory && input.mode !== "ambient") {
      await this.dependencies.memory.summaries
        .maybeCompact({ threadId: input.threadId, force: input.mode === "deep_work" })
        .catch(() => null);
    }

    return {
      jobId: input.job.id,
      threadId: input.threadId,
      turns: turnCount,
      completedTurns,
      publicMessages,
      waits,
      stoppedReason,
    };
  }

  private selectionTelemetry(input: {
    readonly input: { readonly mode: string; readonly threadId: string; readonly preferredAgentId?: string | null };
    readonly candidate: ScoredCandidate;
    readonly scored: readonly ScoredCandidate[];
    readonly decision: { readonly usedExploration: boolean; readonly explorationPool: readonly string[]; readonly reason: string };
    readonly activity: AgentSelectionActivity | undefined;
    readonly focus: ConversationFocus;
    readonly coveredDomains: readonly string[];
    readonly contributionRole: "CONTRIBUTE" | "SYNTHESIZE";
  }): JsonObject {
    const round = (value: number): number => Math.round(value * 100) / 100;
    return {
      selectedAgentId: input.candidate.agentId,
      mode: input.input.mode,
      threadId: input.input.threadId,
      selectedScore: round(input.candidate.score),
      relevanceScore: round(input.candidate.relevanceScore),
      explorationValue: round(input.candidate.explorationValue),
      reasons: input.candidate.reasons.slice(0, 8),
      decision: input.decision.reason,
      explorationUsed: input.decision.usedExploration,
      explorationPool: input.decision.explorationPool.slice(0, 3),
      preferredAgentId: input.input.preferredAgentId ?? null,
      threadRecencyPenalty: round(input.candidate.signals.threadRecencyPenalty),
      organizationRecencyPenalty: round(input.candidate.signals.organizationRecencyPenalty),
      neglectedOpportunityBoost: round(input.candidate.signals.neglectedOpportunityBoost),
      reputationSignal: round(input.candidate.signals.reputationSignal),
      lexicalRelevance: round(input.candidate.signals.lexicalRelevance),
      phaseFit: input.candidate.signals.phaseFit,
      perspectiveDomain: input.candidate.signals.perspectiveDomain,
      relevant: input.candidate.signals.relevant,
      coverageBonus: round(input.candidate.signals.coverageBonus),
      coveragePenalty: round(input.candidate.signals.coveragePenalty),
      ambientCooldownPenalty: round(input.candidate.signals.ambientCooldownPenalty),
      conversationFocus: {
        primaryQuery: input.focus.primaryQuery,
        interactionIntent: input.focus.interactionIntent,
        keyTerms: input.focus.keyTerms,
        isBroadQuestion: input.focus.isBroadQuestion,
        isCurrentStateQuestion: input.focus.isCurrentStateQuestion,
      },
      coveredDomains: input.coveredDomains.slice(0, 8),
      contributionRole: input.contributionRole,
      recentOpportunityCount: input.activity?.recentOpportunityCount ?? 0,
      recentThreadOpportunityCount: input.activity?.recentThreadOpportunityCount ?? 0,
      topCandidates: input.scored.slice(0, 8).map((candidate) => ({
        agentId: candidate.agentId,
        score: round(candidate.score),
        relevanceScore: round(candidate.relevanceScore),
        perspectiveDomain: candidate.signals.perspectiveDomain,
        lexicalRelevance: round(candidate.signals.lexicalRelevance),
        coverageBonus: round(candidate.signals.coverageBonus),
        coveragePenalty: round(candidate.signals.coveragePenalty),
        reasons: candidate.reasons.slice(0, 4),
      })),
    };
  }

  private async loadProfiles(): Promise<readonly AgentCandidateProfile[]> {
    const agents = (await this.dependencies.repositories.agents.listActive(20))
      .filter((agent) => !agent.isSupervisor);
    return Promise.all(agents.map(async (agent) => ({
      agent,
      specialties: await this.dependencies.repositories.agents.listSpecialties(agent.id),
      interests: await this.dependencies.repositories.agents.listInterests(agent.id),
    })));
  }

  private async loadRequestedAgentIds(threadId: string, minimumCreatedAt: string | null = null): Promise<readonly string[]> {
    return this.dependencies.repositories.agentRequests.listOpenForThread(threadId)
      .then((requests) => requests
        .filter((request) => minimumCreatedAt === null || request.createdAt >= minimumCreatedAt)
        .map((request) => request.requestedAgentId));
  }

  private async createOrGetTurn(input: {
    readonly job: JobRecord;
    readonly thread: ThreadRecord;
    readonly agent: AgentRecord;
    readonly sequenceNumber: number;
    readonly inputMessageId?: string;
    readonly wakeReason: string;
    readonly mode: string;
    readonly selection: JsonObject;
  }): Promise<AgentTurnRecord> {
    let sequenceNumber = input.sequenceNumber;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const idempotencyKey = `agent-turn:${input.job.id}:${sequenceNumber}:${input.agent.id}`;
      const existing = await this.dependencies.repositories.agentTurns
        .getByIdempotencyKey(idempotencyKey)
        .catch(() => null);
      if (existing) return existing;

      try {
        return await this.dependencies.repositories.agentTurns.create({
          threadId: input.thread.id,
          jobId: input.job.id,
          agentId: input.agent.id,
          sequenceNumber,
          inputMessageId: input.inputMessageId,
          wakeReason: input.wakeReason,
          idempotencyKey,
          metadata: {
            mode: input.mode,
            promptVersion: "postv1-interactive-quality-v1",
            selection: input.selection,
          },
        });
      } catch (error: unknown) {
        if (!(error instanceof NotFoundError) || attempt === 3) throw error;
        sequenceNumber = await this.dependencies.repositories.agentTurns.nextSequence(input.thread.id);
      }
    }

    throw new Error("agent turn creation exhausted its bounded sequence retries");
  }

  private async executeTurn(context: TurnContext): Promise<TurnExecutionResult> {
    const { turn, agent, thread } = context;
    await this.dependencies.repositories.agentTurns.updateStatus(turn.id, "running");
    const specialties = await this.dependencies.repositories.agents.listSpecialties(agent.id);
    const interests = await this.dependencies.repositories.agents.listInterests(agent.id);
    const human = context.wakeMessage?.authorUserId
      ? await this.dependencies.repositories.users.getById(context.wakeMessage.authorUserId).catch(() => null)
      : null;
    const query = context.conversationFocus.retrievalQuery || thread.summary || thread.title;
    const contextPack = await (this.dependencies.memory
      ? this.dependencies.memory.context.build({
        query,
        actor: { agentId: agent.id },
        threadId: thread.id,
        recentMessages: context.recentMessages,
        topK: 8,
        maxCharacters: context.settings.ragContextBudget,
      })
      : new ContextPackService(this.dependencies.repositories.database).build({
        query,
        actor: { agentId: agent.id },
        threadId: thread.id,
        recentMessages: context.recentMessages,
        topK: 8,
        maxCharacters: context.settings.ragContextBudget,
      }));
    const retrievalTelemetry: JsonObject = {
      ...contextPack.telemetry,
      sourceTypeCounts: { ...contextPack.telemetry.sourceTypeCounts },
      selectedSources: contextPack.telemetry.selectedSources
        ? contextPack.telemetry.selectedSources.map((source) => ({ ...source }))
        : [],
    };
    const participants = [
      ...context.profiles.map((profile) => ({
        id: profile.agent.id,
        displayName: profile.agent.displayName,
        kind: "agent" as const,
      })),
      ...(human ? [{ id: human.id, displayName: human.displayName, kind: "human" as const }] : []),
    ];
    let acquisitionContext: string[] = [];
    const buildPrompt = () => buildAgentPrompt({
      agent,
      specialties,
      interests,
      thread,
      wakeReason: context.wakeReason,
      recentMessages: context.recentMessages,
      addressedAgentId: context.addressedAgentId,
      requestedAgentIds: context.requestedAgentIds,
      conversationFocus: context.conversationFocus,
      coveredDomains: context.coveredDomains,
      contributionRole: context.contributionRole,
      participants,
      humanDisplayName: human?.displayName,
      reputationContext: {
        trackRecord: agent.rank >= 12 ? "strong relevant track record" : agent.rank <= 8 ? "recent evidence concern" : "limited or neutral evidence",
      },
      retrievalTelemetry: { ...contextPack.telemetry, acquisitionOperations: acquisitionContext.length },
      retrievedContext: ContextPackService.toPromptText(contextPack),
      acquisitionContext,
    });

    let prompt = buildPrompt();
    let response: LLMGenerateResponse;
    let repairAttempts = 0;
    let acquisitionOperations = 0;
    const callProvider = async (
      systemPrompt: string,
      messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[],
      usageSuffix: string,
      maxOutputTokens: number,
      metadata: JsonObject,
    ): Promise<LLMGenerateResponse> => {
      const startedAt = Date.now();
      try {
        const generated = await this.dependencies.provider.generate({
          modelKey: this.dependencies.modelKey,
          systemPrompt,
          messages,
          temperature: 0,
          maxOutputTokens,
          timeoutMs: FOUNDATION_GUARDRAILS.providerTimeoutMilliseconds,
          metadata: Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])),
        });
        await this.recordUsage(`provider-usage:${turn.id}:${usageSuffix}`, context.job, turn, generated, undefined, Date.now() - startedAt);
        return generated;
      } catch (error: unknown) {
        const normalized = normalizeProviderError(error);
        await this.recordUsage(`provider-usage:${turn.id}:${usageSuffix}`, context.job, turn, undefined, normalized, Date.now() - startedAt);
        throw normalized;
      }
    };
    const parseWithRepair = async (candidate: LLMGenerateResponse): Promise<{ readonly step: AgentStep; readonly response: LLMGenerateResponse }> => {
      try {
        return { step: parseAgentStep(candidate.text), response: candidate };
      } catch (error: unknown) {
        if (!(error instanceof AgentActionValidationError) && !(error instanceof AgentAcquisitionValidationError)) throw error;
        if (repairAttempts >= 1) throw error;
        repairAttempts = 1;
        const recentContext = context.recentMessages
          .slice(-4)
          .map((message) => `${message.authorType}:${message.contentText}`)
          .join("\n")
          .slice(0, 3_000);
        const repaired = await callProvider(
          [
            "You are repairing one LUMA ADHD agent step. Return only one complete JSON object.",
            `agent_id: ${agent.id}`,
            `agent_name: ${agent.displayName}`,
            `agent_specialty: ${agent.specialty}`,
            `human_display_name: ${human?.displayName ?? "none"}`,
            `thread_objective: ${thread.summary ?? thread.title}`,
            `wake_reason: ${context.wakeReason}`,
            `conversation_focus: ${context.conversationFocus.primaryQuery}`,
            `covered_perspectives: ${context.coveredDomains.join(", ") || "none"}`,
            "Return WAIT rather than paraphrasing an already-covered contribution.",
            `addressed_agent_id: ${context.addressedAgentId ?? "none"}`,
            `known_participants: ${context.profiles.map((profile) => `${profile.agent.id}=${profile.agent.displayName}`).join(", ") || "none"}`,
            `recent_context:\n${recentContext || "none"}`,
            TELEGRAM_PRESENTATION_GUIDANCE,
            AGENT_STEP_SCHEMA,
            "Use literal UTF-8 Persian or English text. Do not emit \\uXXXX escapes.",
            "Keep content under 4096 Unicode characters and reason_summary under 160 characters. Use null targets unless the intent requires one.",
            "Do not add prose, Markdown fences, or hidden reasoning. Reply in the language of recent_context.",
          ].join("\n"),
          [{
            role: "user",
            content: JSON.stringify({
              invalid_response: candidate.text.slice(0, 4_000),
              validation_errors: error.problems,
              instruction: "Return the corrected step now.",
            }),
          }],
          "repair",
          256,
          { repair: "true", agentId: agent.id, threadId: thread.id },
        );
        return { step: parseAgentStep(repaired.text), response: repaired };
      }
    };

    let step: AgentStep;
    let grounding: OfficialGroundingAssessment = {
      required: false,
      satisfied: true,
      sourceIds: [],
      matchedTerms: [],
      bestSourceMatchCount: 0,
    };
    try {
      response = await callProvider(
        prompt.systemPrompt,
        prompt.messages,
        "initial",
        512,
        { agentId: agent.id, threadId: thread.id, retrieval: retrievalTelemetry },
      );
      ({ step, response } = await parseWithRepair(response));
      while (step.kind === "acquisition") {
        const acquisitionLimit = Math.min(
          context.settings.ragMaxAcquisitionSteps,
          FOUNDATION_GUARDRAILS.acquisitionMaxOperations,
        );
        if (acquisitionOperations >= acquisitionLimit) {
          acquisitionContext = [...acquisitionContext, "The bounded acquisition limit has been reached. Return a final action using only the information already available."];
          prompt = buildPrompt();
          response = await callProvider(
            prompt.systemPrompt,
            prompt.messages,
            "acquisition-final",
            512,
            { agentId: agent.id, threadId: thread.id, acquisitionLimitReached: true },
          );
          ({ step, response } = await parseWithRepair(response));
          if (step.kind === "acquisition") throw new AgentAcquisitionValidationError(["acquisition limit reached; a final action is required"]);
          break;
        }
        const acquisition = await this.executeAcquisition(context, step.request, acquisitionOperations + 1);
        acquisitionOperations += 1;
        acquisitionContext = [...acquisitionContext, acquisition.promptText];
        prompt = buildPrompt();
        response = await callProvider(
          prompt.systemPrompt,
          prompt.messages,
          `acquisition-${acquisitionOperations}`,
          512,
          { agentId: agent.id, threadId: thread.id, acquisitionOperation: step.request.operation, acquisitionNumber: acquisitionOperations },
        );
        ({ step, response } = await parseWithRepair(response));
      }
      if (step.kind !== "action") throw new AgentAcquisitionValidationError(["a final action is required after acquisition"]);
      if (step.action.intent === "SPEAK") {
        grounding = assessOfficialGrounding(step.action.content ?? "", contextPack);
        if (grounding.required && !grounding.satisfied) {
          if (repairAttempts >= 1) {
            throw new AgentActionValidationError(["SPEAK did not contain enough distinctive material from retrieved official LUMA knowledge"]);
          }
          repairAttempts = 1;
          const repaired = await callProvider(
            [
              "You are repairing one LUMA ADHD answer that failed the official-source grounding check.",
              "Return exactly one final SPEAK action as JSON. Do not return an acquisition step.",
              "Use only claims supported by the retrieved official_luma_knowledge excerpts below.",
              "If the excerpts do not establish a requested fact, state that the current official context is insufficient instead of using generic model memory.",
              `retrieved_official_sources: ${grounding.sourceIds.join(", ") || "none"}`,
              `retrieved_context:\n${ContextPackService.toPromptText(contextPack)}`,
              `grounding_validation: matched_terms=${grounding.matchedTerms.join(", ") || "none"}; best_source_match_count=${grounding.bestSourceMatchCount}`,
              TELEGRAM_PRESENTATION_GUIDANCE,
              AGENT_STEP_SCHEMA,
              "Use literal UTF-8 Persian or English text. Do not emit \\uXXXX escapes.",
              "Do not include citations or source IDs in the visible message unless naturally useful; provenance is retained internally.",
              "Do not add prose, Markdown fences, or hidden reasoning.",
            ].join("\n"),
            [{ role: "user", content: "Return the grounded final SPEAK action now." }],
            "grounding-repair",
            512,
            { repair: "grounding", agentId: agent.id, threadId: thread.id },
          );
          ({ step, response } = await parseWithRepair(repaired));
          if (step.kind !== "action" || step.action.intent !== "SPEAK") {
            throw new AgentActionValidationError(["grounding repair must return a final SPEAK action"]);
          }
          grounding = assessOfficialGrounding(step.action.content ?? "", contextPack);
          if (grounding.required && !grounding.satisfied) {
            throw new AgentActionValidationError(["grounding repair still did not use retrieved official LUMA knowledge"]);
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof LLMProviderError) {
        await this.dependencies.repositories.agentTurns.updateStatus(turn.id, "failed", undefined, {
          mode: context.wakeReason,
          providerFailure: safeErrorSummary(error),
          retrieval: retrievalTelemetry,
          grounding: groundingMetadata(grounding),
          acquisitionOperations,
        });
        return { action: null, outputMessageId: undefined, wait: false, retryableFailure: error.failure.retryable, stopBurst: true, repetitionSuppressed: false };
      }
      const summary = error instanceof AgentActionValidationError || error instanceof AgentAcquisitionValidationError
        ? error.problems
        : [safeErrorSummary(error)];
      await this.dependencies.repositories.agentTurns.updateStatus(turn.id, "failed", undefined, {
        intent: "INVALID",
        repairAttempts,
        validationErrors: summary.slice(0, 5),
        retrieval: retrievalTelemetry,
        grounding: groundingMetadata(grounding),
        acquisitionOperations,
      });
      await this.dependencies.repositories.events.append({
        eventType: "runtime.action_validation_failed",
        aggregateType: "agent_turn",
        aggregateId: turn.id,
        threadId: thread.id,
        jobId: context.job.id,
        actor: { type: "agent", agentId: agent.id },
        idempotencyKey: `runtime-action-validation-failed:${turn.id}`,
        payload: { repairAttempts, validationErrors: summary.slice(0, 5), acquisitionOperations },
      });
      return { action: null, outputMessageId: undefined, wait: false, retryableFailure: false, stopBurst: true, repetitionSuppressed: false };
    }

    let action: AgentAction = step.action;
    let currentStateGrounding: CurrentStateGroundingAssessment = {
      claimDetected: false,
      supported: true,
      evidenceKinds: [],
      matchedTerms: [],
      proposalOnly: false,
      state: "not_applicable",
    };
    let repetitionSuppressed = false;
    if (action.intent === "SPEAK") {
      currentStateGrounding = assessCurrentStateGrounding(action.content ?? "", contextPack);
      if (currentStateGrounding.claimDetected && !currentStateGrounding.supported) {
        action = {
          ...action,
          content: qualifyUnsupportedCurrentClaim(action.content ?? "", currentStateGrounding),
          reasonSummary: "Qualified unsupported current-state ranking as a hypothesis.",
          metadata: {
            ...action.metadata,
            currentStateGrounding: {
              state: currentStateGrounding.state,
              matchedTerms: currentStateGrounding.matchedTerms,
            },
          },
        };
      }
      const previousContributions = [
        ...context.recentMessages.filter((message) => message.authorType === "agent").map((message) => message.contentText),
        ...context.priorBurstContributions,
      ];
      const duplicate = isObviousRepeatedContent(action.content ?? "", previousContributions)
        ? {
            duplicate: true,
            similarity: 1,
            sharedTerms: [],
            reason: "near_exact" as const,
          }
        : assessContributionDuplication(action.content ?? "", previousContributions);
      if (duplicate.duplicate) {
        repetitionSuppressed = true;
        await this.dependencies.repositories.events.append({
          eventType: "runtime.repeated_content_suppressed",
          aggregateType: "agent_turn",
          aggregateId: turn.id,
          threadId: thread.id,
          jobId: context.job.id,
          actor: { type: "agent", agentId: agent.id },
          idempotencyKey: `agent-action:${turn.id}:repetition`,
          payload: {
            contentCharacters: Array.from(action.content ?? "").length,
            similarity: duplicate.similarity,
            sharedTerms: duplicate.sharedTerms,
            reason: duplicate.reason,
          },
        });
        action = {
          intent: "WAIT",
          content: null,
          confidence: Math.min(action.confidence, 0.8),
          reasonSummary: "No materially distinct contribution beyond the prior Agent message.",
          targetAgentId: null,
          targetThreadId: null,
          metadata: {
            ...action.metadata,
            suppressedIntent: "SPEAK",
            duplication: {
              duplicate: duplicate.duplicate,
              similarity: duplicate.similarity,
              sharedTerms: duplicate.sharedTerms,
              reason: duplicate.reason,
            },
          },
        };
      }
    }

    let outputMessageId: string | undefined;
    let deliveryStatus: string | undefined;
    try {
      const execution = await this.executeAction(context, action);
      outputMessageId = execution.outputMessageId;
      deliveryStatus = execution.deliveryStatus;
      repetitionSuppressed = repetitionSuppressed || execution.repetitionSuppressed === true;
    } catch (error: unknown) {
      await this.dependencies.repositories.agentTurns.updateStatus(turn.id, "failed", undefined, {
        ...actionMetadata(action, repairAttempts, retrievalTelemetry, acquisitionOperations, grounding, currentStateGrounding, repetitionSuppressed),
        executionFailure: safeErrorSummary(error),
      });
      await this.dependencies.repositories.events.append({
        eventType: "runtime.action_execution_failed",
        aggregateType: "agent_turn",
        aggregateId: turn.id,
        threadId: thread.id,
        jobId: context.job.id,
        actor: { type: "agent", agentId: agent.id },
        idempotencyKey: `runtime-action-execution-failed:${turn.id}`,
        payload: { intent: action.intent, error: safeErrorSummary(error) },
      });
      return { action: null, outputMessageId: undefined, wait: false, retryableFailure: false, stopBurst: true, repetitionSuppressed: false };
    }

    await this.dependencies.repositories.agentTurns.updateStatus(
      turn.id,
      "completed",
      outputMessageId,
      {
        ...actionMetadata(action, repairAttempts, retrievalTelemetry, acquisitionOperations, grounding, currentStateGrounding, repetitionSuppressed),
        provider: response.provider,
        model: response.model,
        requestId: response.requestId ?? null,
        latencyMs: response.latencyMs,
        finishReason: response.finishReason ?? null,
        deliveryStatus: deliveryStatus ?? null,
        repetitionSuppressed,
      },
    );
    await this.dependencies.repositories.events.append({
      eventType: "runtime.agent_turn_completed",
      aggregateType: "agent_turn",
      aggregateId: turn.id,
      threadId: thread.id,
      jobId: context.job.id,
      actor: { type: "agent", agentId: agent.id },
      idempotencyKey: `runtime-agent-turn-completed:${turn.id}`,
      payload: { intent: action.intent, outputMessageId: outputMessageId ?? null },
    });

    return {
      action,
      outputMessageId,
      wait: action.intent === "WAIT",
      retryableFailure: false,
      stopBurst: repetitionSuppressed,
      repetitionSuppressed,
    };
  }

  private async executeAcquisition(
    context: TurnContext,
    request: AgentAcquisitionRequest,
    sequence: number,
  ): Promise<{ readonly promptText: string }> {
    const operationLabel = `${request.operation} #${sequence}`;
    if (!this.dependencies.memory) {
      return { promptText: `[${operationLabel}] No memory service is available in this execution environment.` };
    }
    try {
      if (request.operation === "SEARCH_MEMORY") {
        const pack = await this.dependencies.memory.context.build({
          query: request.query ?? "",
          actor: { agentId: context.agent.id },
          threadId: context.thread.id,
          recentMessages: context.recentMessages,
          topK: request.limit,
          maxCharacters: 3_500,
        });
        return {
          promptText: `[${operationLabel}] Bounded memory search result. Official LUMA material is authoritative when present.\n${ContextPackService.toPromptText(pack)}`,
        };
      }

      const tools = new AgentDocumentTools(this.dependencies.memory);
      const documentOperation = request.operation === "SEARCH_DOCUMENTS"
        ? "search_documents"
        : request.operation === "READ_DOCUMENT"
          ? "read_document"
          : request.operation === "READ_DOCUMENT_VERSION"
            ? "read_document_version"
            : "list_documents";
      const result = await tools.execute({
        operation: documentOperation,
        actor: { agentId: context.agent.id },
        logicalPath: request.logicalPath ?? undefined,
        query: request.query ?? undefined,
        versionNumber: request.versionNumber ?? undefined,
        threadId: context.thread.id,
        idempotencyKey: `agent-acquisition:${context.turn.id}:${sequence}`,
      });
      return {
        promptText: `[${operationLabel}] Validated document operation result:\n${JSON.stringify(result)}`,
      };
    } catch (error: unknown) {
      return {
        promptText: `[${operationLabel}] The validated information request failed safely: ${String(error).slice(0, 300)}`,
      };
    }
  }

  private async executeAction(
    context: TurnContext,
    action: AgentAction,
  ): Promise<{ readonly outputMessageId?: string; readonly deliveryStatus?: string; readonly repetitionSuppressed?: boolean }> {
    const actionKey = `agent-action:${context.turn.id}`;
    switch (action.intent) {
      case "WAIT":
        await this.dependencies.repositories.events.append({
          eventType: "runtime.agent_waited",
          aggregateType: "agent_turn",
          aggregateId: context.turn.id,
          threadId: context.thread.id,
          jobId: context.job.id,
          actor: { type: "agent", agentId: context.agent.id },
          idempotencyKey: actionKey,
          payload: { reasonSummary: action.reasonSummary, confidence: action.confidence },
        });
        return {};

      case "SPEAK": {
        const content = action.content as string;
        const projectionKey = `agent-output:${context.job.id}:${context.turn.sequenceNumber}:${context.agent.id}`;
        await this.dependencies.repositories.threads.addParticipant(context.thread.id, {
          agentId: context.agent.id,
          role: "contributor",
        });
        const canonical = await this.dependencies.repositories.messages.create({
          threadId: context.thread.id,
          chatId: context.thread.chatId ?? undefined,
          authorType: "agent",
          authorAgentId: context.agent.id,
          contentText: content,
          replyToMessageId: context.replyToMessageId,
          origin: "internal",
          visibility: "public",
          idempotencyKey: `telegram-agent-message:${projectionKey}`,
          metadata: {
            source: "agent_runtime",
            projectionKey,
            intent: action.intent,
            reasonSummary: action.reasonSummary,
            confidence: action.confidence,
          },
        });
        await this.dependencies.repositories.threads.touchActivity(context.thread.id, this.now());
        let deliveryStatus: string | undefined;
        if (this.dependencies.telegram && context.thread.chatId) {
          try {
            const projected = await this.dependencies.telegram.projectAgentMessage({
              threadId: context.thread.id,
              chatId: context.thread.chatId,
              agentId: context.agent.id,
              contentText: content,
              contentFormat: "telegram_html",
              idempotencyKey: projectionKey,
              replyToMessageId: context.replyToMessageId,
              metadata: { runtimeTurnId: context.turn.id },
            });
            deliveryStatus = projected.status;
          } catch (error: unknown) {
            deliveryStatus = `failed:${error instanceof Error ? error.name : "unknown"}`;
          }
        }
        return { outputMessageId: canonical.id, deliveryStatus };
      }

      case "REQUEST_AGENT": {
        if (!action.targetAgentId) return {};
        await this.dependencies.repositories.agentRequests.create({
          threadId: context.thread.id,
          jobId: context.job.id,
          agentTurnId: context.turn.id,
          requestedByAgentId: context.agent.id,
          requestedAgentId: action.targetAgentId,
          requestText: action.content ?? action.reasonSummary,
          idempotencyKey: actionKey,
          metadata: { confidence: action.confidence, source: "agent_runtime" },
        });
        return {};
      }

      case "REQUEST_HUMAN": {
        const nestedMetadata = objectField(action.metadata, "humanTask");
        const metadata = Object.keys(nestedMetadata).length > 0 ? nestedMetadata : action.metadata;
        const title = typeof metadata.title === "string" && metadata.title.trim().length > 0
          ? metadata.title
          : "LUMA ADHD human input requested";
        const reason = stringField(metadata, "reason") ?? action.reasonSummary;
        const blocking = booleanField(metadata, "blocking");
        const taskService = new HumanTaskService({
          repositories: this.dependencies.repositories,
          telegram: this.dependencies.telegram,
          now: this.now,
        });
        await taskService.createFromAgent({
          threadId: context.thread.id,
          chatId: context.thread.chatId,
          requestedByAgentId: context.agent.id,
          title,
          description: action.content ?? action.reasonSummary,
          reason,
          blocking,
          targetHumanUserId: stringField(metadata, "targetHumanUserId") ?? undefined,
          requestKey: stringField(metadata, "requestKey") ?? stringField(metadata, "category") ?? undefined,
          priority: typeof metadata.priority === "number" ? Math.max(0, Math.min(100, Math.round(metadata.priority))) : 60,
          idempotencyKey: actionKey,
          metadata: { confidence: action.confidence, source: "agent_runtime", turnId: context.turn.id },
        });
        return {};
      }

      case "PROPOSE_THREAD": {
        const proposedThreadId = `runtime-thread-${context.job.id}-${context.turn.sequenceNumber}`;
        const existing = await this.dependencies.repositories.threads.getById(proposedThreadId).catch(() => null);
        const proposed = existing ?? await this.dependencies.repositories.threads.create({
          id: proposedThreadId,
          chatId: context.thread.chatId ?? undefined,
          title: (action.content as string).slice(0, 160),
          summary: action.content as string,
          createdByAgentId: context.agent.id,
          metadata: { source: "agent_runtime", parentThreadId: context.thread.id },
        });
        await this.dependencies.repositories.threads.addParticipant(proposed.id, {
          agentId: context.agent.id,
          role: "owner",
        });
        await this.dependencies.repositories.events.append({
          eventType: "runtime.thread_proposed",
          aggregateType: "thread",
          aggregateId: proposed.id,
          threadId: proposed.id,
          jobId: context.job.id,
          actor: { type: "agent", agentId: context.agent.id },
          idempotencyKey: actionKey,
          payload: { parentThreadId: context.thread.id, title: proposed.title },
        });
        return {};
      }

      case "REOPEN_THREAD": {
        const targetId = action.targetThreadId ?? context.thread.id;
        const target = await this.dependencies.repositories.threads.getById(targetId);
        if (["decided", "rejected", "parked", "human_required", "blocked"].includes(target.state)) {
          await this.dependencies.repositories.threadLifecycle.transition({
            threadId: targetId,
            to: "reopened",
            actor: { type: "agent", agentId: context.agent.id },
            reason: action.reasonSummary,
          });
        }
        await this.dependencies.repositories.events.append({
          eventType: "runtime.thread_reopened_requested",
          aggregateType: "thread",
          aggregateId: targetId,
          threadId: targetId,
          jobId: context.job.id,
          actor: { type: "agent", agentId: context.agent.id },
          idempotencyKey: actionKey,
          payload: { reasonSummary: action.reasonSummary },
        });
        return {};
      }

      case "FILE_WORK": {
        if (!this.dependencies.memory) {
          await this.dependencies.repositories.events.append({
            eventType: "runtime.file_work_deferred",
            aggregateType: "thread",
            aggregateId: context.thread.id,
            threadId: context.thread.id,
            jobId: context.job.id,
            actor: { type: "agent", agentId: context.agent.id },
            idempotencyKey: actionKey,
            payload: { intent: action.intent, content: action.content ?? "", metadata: action.metadata, deferredTo: "phase-04" },
          });
          return {};
        }
        const work = objectField(action.metadata, "fileWork");
        const operation = stringField(work, "operation") ?? stringField(action.metadata, "operation");
        const logicalPath = stringField(work, "path") ?? stringField(work, "logicalPath")
          ?? stringField(action.metadata, "path") ?? stringField(action.metadata, "logicalPath");
        if (!operation) throw new InvalidTransitionError("FILE_WORK", "missing_operation");
        const tools = new AgentDocumentTools(this.dependencies.memory);
        const result = await tools.execute({
          operation,
          actor: { agentId: context.agent.id },
          logicalPath: logicalPath ?? undefined,
          title: stringField(work, "title") ?? (action.content ?? "Untitled document").slice(0, 120),
          contentMarkdown: action.content ?? stringField(work, "content") ?? "",
          query: stringField(work, "query") ?? action.content ?? undefined,
          versionNumber: numberField(work.versionNumber) ?? numberField(work.version_number) ?? undefined,
          targetAgentId: action.targetAgentId ?? stringField(work, "targetAgentId") ?? undefined,
          threadId: operation === "create_document"
            ? stringField(work, "threadId") ?? undefined
            : context.thread.id,
          messageId: context.wakeMessage?.id,
          relation: stringField(work, "relation") ?? "reference",
          changeSummary: stringField(work, "changeSummary") ?? action.reasonSummary,
          tags: Array.isArray(work.tags) ? work.tags.filter((item): item is string => typeof item === "string") : undefined,
          idempotencyKey: actionKey,
        });
        await this.dependencies.repositories.events.append({
          eventType: "runtime.file_work_completed",
          aggregateType: "agent_turn",
          aggregateId: context.turn.id,
          threadId: context.thread.id,
          jobId: context.job.id,
          actor: { type: "agent", agentId: context.agent.id },
          idempotencyKey: `${actionKey}:completed`,
          payload: { ...result, intent: action.intent },
        });
        return {};
      }

      case "DRAW": {
        const candidate = action.metadata.diagramSpec ?? action.metadata.diagram;
        const diagramSpec = candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? candidate
          : {
              diagram_type: "flow",
              title: (action.content ?? "LUMA diagram").slice(0, 120),
              direction: /[\u0600-\u06ff]/u.test(action.content ?? "") ? "rtl" : "ltr",
              nodes: [{ id: "main", label: (action.content ?? "LUMA diagram").slice(0, 180) }],
              edges: [],
              groups: [],
              notes: [],
            };
        const diagram = await new DiagramService(this.dependencies.repositories).create({
          spec: diagramSpec,
          threadId: context.thread.id,
          messageId: context.wakeMessage?.id,
          actor: { agentId: context.agent.id },
          idempotencyKey: actionKey,
          metadata: { runtimeTurnId: context.turn.id, source: "agent_runtime" },
        });
        await this.dependencies.repositories.events.append({
          eventType: "runtime.draw_created",
          aggregateType: "thread",
          aggregateId: context.thread.id,
          threadId: context.thread.id,
          jobId: context.job.id,
          actor: { type: "agent", agentId: context.agent.id },
          idempotencyKey: actionKey,
          payload: {
            intent: action.intent,
            artifactId: diagram.artifact.id,
            diagramType: diagram.spec.diagramType,
            sourceOnly: true,
          },
        });
        // Kept as a compatibility telemetry alias for Phase 03 observability
        // consumers. DRAW is now a real D1-backed artifact operation.
        await this.dependencies.repositories.events.append({
          eventType: "runtime.draw_deferred",
          aggregateType: "artifact",
          aggregateId: diagram.artifact.id,
          threadId: context.thread.id,
          jobId: context.job.id,
          actor: { type: "agent", agentId: context.agent.id },
          idempotencyKey: `${actionKey}:compatibility`,
          payload: { artifactId: diagram.artifact.id, sourceOnly: true, compatibilityAlias: true },
        });
        return {};
      }

      case "VOTE": {
        const option = typeof action.metadata.option === "string" ? action.metadata.option : action.content;
        if (!option) return {};
        const confidence = numberField(action.metadata.confidence) ?? action.confidence;
        await this.dependencies.repositories.agentVotes.create({
          threadId: context.thread.id,
          agentTurnId: context.turn.id,
          agentId: context.agent.id,
          optionKey: option,
          confidence: Math.max(0, Math.min(1, confidence)),
          rationale: action.reasonSummary,
          idempotencyKey: actionKey,
          metadata: { source: "agent_runtime", rawActionMetadata: action.metadata },
        });
        return {};
      }
    }
  }

  private async recordUsage(
    idempotencyKey: string,
    job: JobRecord,
    turn: AgentTurnRecord,
    response: LLMGenerateResponse | undefined,
    failure: LLMProviderError | undefined,
    durationMs: number,
  ): Promise<void> {
    await this.dependencies.repositories.providerUsage.create({
      providerName: response?.provider ?? this.dependencies.provider.name,
      modelName: response?.model ?? this.dependencies.modelKey,
      jobId: job.id,
      agentTurnId: turn.id,
      requestId: response?.requestId,
      status: failure?.failure.kind === "timeout" ? "timed_out" : failure ? "failed" : "completed",
      promptTokens: response?.usage?.promptTokens,
      completionTokens: response?.usage?.completionTokens,
      totalTokens: response?.usage?.totalTokens,
      durationMs,
      errorSummary: failure ? safeErrorSummary(failure) : undefined,
      idempotencyKey,
      metadata: response?.metadata ? { ...response.metadata } : {},
    }).catch((error: unknown) => {
      if (!(error instanceof NotFoundError)) throw error;
    });
  }
}

export class RuntimeProviderFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeProviderFailure";
  }
}
