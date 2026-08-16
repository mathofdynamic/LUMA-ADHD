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
  AGENT_ACTION_SCHEMA,
  parseAgentAction,
  type AgentAction,
} from "./actions";
import { buildAgentPrompt, TELEGRAM_PRESENTATION_GUIDANCE } from "./prompts";
import {
  scoreCandidates,
  type AgentCandidateProfile,
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

type RuntimeRepositories = ReturnType<typeof createRepositories>;

export interface AgentRuntimeDependencies {
  readonly repositories: RuntimeRepositories;
  readonly provider: LLMProvider;
  readonly telegram?: Pick<TelegramApplicationService, "projectAgentMessage">;
  readonly modelKey: string;
  readonly memory?: MemoryServices;
  readonly reputation?: ReputationService;
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
}

interface TurnExecutionResult {
  readonly action: AgentAction | null;
  readonly outputMessageId: string | undefined;
  readonly wait: boolean;
  readonly retryableFailure: boolean;
  readonly stopBurst: boolean;
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

function actionMetadata(action: AgentAction, repairAttempts: number): JsonObject {
  return {
    intent: action.intent,
    confidence: action.confidence,
    reasonSummary: action.reasonSummary,
    targetAgentId: action.targetAgentId,
    targetThreadId: action.targetThreadId,
    repairAttempts,
    actionMetadata: action.metadata,
  };
}

function messageTextForSelection(message: MessageRecord | null, thread: ThreadRecord): string {
  return message?.contentText ?? thread.summary ?? thread.title;
}

export class AgentRuntimeService {
  private readonly now: () => string;
  private readonly rng: () => number;

  constructor(private readonly dependencies: AgentRuntimeDependencies) {
    this.now = dependencies.now ?? nowIso;
    this.rng = dependencies.rng ?? Math.random;
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
      return this.runAmbientOpportunity(job, threadId);
    }

    if (job.jobType === "agent.deep_work") {
      const threadId = stringField(job.payload, "threadId");
      if (!threadId || (!booleanField(job.payload, "eligible") && stringField(job.payload, "trigger") === null)) {
        return null;
      }
      return this.runDeepWork(job, threadId, stringField(job.payload, "trigger") ?? "explicit_request");
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
    return this.runBoundedBurst({
      ...input,
      mode: "interactive",
      maxTurns: FOUNDATION_GUARDRAILS.interactiveBurstMaxTurns,
    });
  }

  async runDeepWork(job: JobRecord, threadId: string, trigger: string): Promise<RuntimeBurstResult> {
    return this.runBoundedBurst({
      job,
      messageId: stringField(job.payload, "messageId") ?? "",
      threadId,
      addressedAgentId: stringField(job.payload, "addressedAgentId"),
      wakeReason: `deep_work:${trigger}`,
      mode: "deep_work",
      maxTurns: FOUNDATION_GUARDRAILS.deepWorkMaxTurns,
    });
  }

  async runAmbientOpportunity(job: JobRecord, threadId: string): Promise<RuntimeBurstResult> {
    return this.runBoundedBurst({
      job,
      messageId: stringField(job.payload, "messageId") ?? "",
      threadId,
      addressedAgentId: null,
      wakeReason: stringField(job.payload, "wakeReason") ?? "ambient_opportunity",
      mode: "ambient",
      maxTurns: 1,
    });
  }

  private async runBoundedBurst(input: {
    readonly job: JobRecord;
    readonly messageId: string;
    readonly threadId: string;
    readonly addressedAgentId?: string | null;
    readonly wakeReason: string;
    readonly mode: "interactive" | "ambient" | "deep_work";
    readonly maxTurns: number;
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
    const profiles = await this.loadProfiles();
    const requestedAgentIds = await this.loadRequestedAgentIds(input.threadId);
    const existingTurns = await this.dependencies.repositories.agentTurns.listByJob(input.job.id, input.maxTurns);
    let recentMessages = (await this.dependencies.repositories.messages.listRecentByThread(
      input.threadId,
      FOUNDATION_GUARDRAILS.recentContextMessageLimit,
    )).filter((message) => message.visibility !== "private");

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

    while (turnCount < input.maxTurns) {
      if (input.mode === "interactive" && publicMessages >= 4) {
        stoppedReason = "public_message_budget_exhausted";
        break;
      }
      if (waits >= 2 && turnCount > 0) {
        stoppedReason = "two_bounded_waits";
        break;
      }

      const scored = scoreCandidates({
        profiles,
        messageText: messageTextForSelection(wakeMessage, thread),
        thread,
        addressedAgentId: input.addressedAgentId,
        requestedAgentIds: requested,
        recentAgentIds,
        reputationByAgentId: {
          ...Object.fromEntries(profiles.map((profile) => [profile.agent.id, (profile.agent.rank - 10) / 10])),
          ...(this.dependencies.reputation
            ? await this.dependencies.reputation.selectionSignals(profiles.map((profile) => profile.agent.id))
            : {}),
        },
        turnIndex: turnCount,
        rng: this.rng,
      });
      const candidate = this.chooseCandidate(scored, recentAgentIds.at(-1), input.addressedAgentId, turnCount);
      if (!candidate) {
        stoppedReason = "no_candidate";
        break;
      }
      const profile = profiles.find((item) => item.agent.id === candidate.agentId);
      if (!profile) {
        stoppedReason = "candidate_profile_missing";
        break;
      }

      const turn = await this.createOrGetTurn({
        job: input.job,
        thread,
        agent: profile.agent,
        sequenceNumber: await this.dependencies.repositories.agentTurns.nextSequence(input.threadId),
        inputMessageId: input.messageId || undefined,
        wakeReason: input.wakeReason,
        mode: input.mode,
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
      });
      await this.dependencies.repositories.threads.incrementTurnUsage(input.threadId, this.now());
      turnCount += 1;
      recentAgentIds.push(profile.agent.id);
      if (result.action?.intent === "REQUEST_AGENT" && result.action.targetAgentId) {
        requested.push(result.action.targetAgentId);
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
            .slice(-FOUNDATION_GUARDRAILS.recentContextMessageLimit);
        }
      }
      if (result.retryableFailure) {
        stoppedReason = "retryable_provider_failure";
        throw new RuntimeProviderFailure("bounded provider failure");
      }
      if (result.stopBurst) {
        stoppedReason = "turn_stopped_after_safe_failure";
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

  private chooseCandidate(
    scored: readonly ScoredCandidate[],
    lastAgentId: string | undefined,
    addressedAgentId: string | null | undefined,
    turnIndex: number,
  ): ScoredCandidate | null {
    if (scored.length === 0) return null;
    if (turnIndex === 0 && addressedAgentId) {
      return scored.find((candidate) => candidate.agentId === addressedAgentId) ?? scored[0] ?? null;
    }
    return scored.find((candidate) => candidate.agentId !== lastAgentId) ?? scored[0] ?? null;
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

  private async loadRequestedAgentIds(threadId: string): Promise<readonly string[]> {
    return this.dependencies.repositories.agentRequests.listOpenForThread(threadId)
      .then((requests) => requests.map((request) => request.requestedAgentId));
  }

  private async createOrGetTurn(input: {
    readonly job: JobRecord;
    readonly thread: ThreadRecord;
    readonly agent: AgentRecord;
    readonly sequenceNumber: number;
    readonly inputMessageId?: string;
    readonly wakeReason: string;
    readonly mode: string;
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
          metadata: { mode: input.mode, promptVersion: "phase-03-v2-telegram-html" },
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
    const contextPack = this.dependencies.memory
      ? await this.dependencies.memory.context.build({
        query: context.wakeMessage?.contentText ?? thread.summary ?? thread.title,
        actor: { agentId: agent.id },
        threadId: thread.id,
        recentMessages: context.recentMessages,
        topK: 8,
        maxCharacters: 6_000,
      })
      : null;
    const prompt = buildAgentPrompt({
      agent,
      specialties,
      interests,
      thread,
      wakeReason: context.wakeReason,
      recentMessages: context.recentMessages,
      addressedAgentId: context.addressedAgentId,
      requestedAgentIds: context.requestedAgentIds,
      participants: [
        ...context.profiles.map((profile) => ({
          id: profile.agent.id,
          displayName: profile.agent.displayName,
          kind: "agent" as const,
        })),
        ...(human ? [{ id: human.id, displayName: human.displayName, kind: "human" as const }] : []),
      ],
      humanDisplayName: human?.displayName,
      reputationContext: {
        trackRecord: agent.rank >= 12 ? "strong relevant track record" : agent.rank <= 8 ? "recent evidence concern" : "limited or neutral evidence",
      },
      retrievedContext: contextPack ? ContextPackService.toPromptText(contextPack) : undefined,
    });

    let response: LLMGenerateResponse;
    let repairAttempts = 0;
    const usageKey = `provider-usage:${turn.id}:initial`;
    const startedAt = Date.now();
    try {
      response = await this.dependencies.provider.generate({
        modelKey: this.dependencies.modelKey,
        systemPrompt: prompt.systemPrompt,
        messages: prompt.messages,
        temperature: 0,
        maxOutputTokens: 512,
        timeoutMs: FOUNDATION_GUARDRAILS.providerTimeoutMilliseconds,
        metadata: { agentId: agent.id, threadId: thread.id },
      });
      await this.recordUsage(usageKey, context.job, turn, response, undefined, Date.now() - startedAt);
    } catch (error: unknown) {
      const normalized = normalizeProviderError(error);
      await this.recordUsage(
        usageKey,
        context.job,
        turn,
        undefined,
        normalized,
        Date.now() - startedAt,
      );
      await this.dependencies.repositories.agentTurns.updateStatus(turn.id, "failed", undefined, {
        mode: context.wakeReason,
        providerFailure: safeErrorSummary(normalized),
      });
      return {
        action: null,
        outputMessageId: undefined,
        wait: false,
        retryableFailure: normalized.failure.retryable,
        stopBurst: true,
      };
    }

    let action: AgentAction;
    try {
      action = parseAgentAction(response.text);
    } catch (error: unknown) {
      if (!(error instanceof AgentActionValidationError)) {
        throw error;
      }
      repairAttempts = 1;
      const repairStartedAt = Date.now();
      try {
        const recentContext = context.recentMessages
          .slice(-4)
          .map((message) => `${message.authorType}:${message.contentText}`)
          .join("\n")
          .slice(0, 3_000);
        const repaired = await this.dependencies.provider.generate({
          modelKey: this.dependencies.modelKey,
          systemPrompt: [
            "You are repairing one LUMA ADHD agent action. Return only one complete JSON object.",
            `agent_id: ${agent.id}`,
            `agent_name: ${agent.displayName}`,
            `agent_specialty: ${agent.specialty}`,
            `human_display_name: ${human?.displayName ?? "none"}`,
            `thread_objective: ${thread.summary ?? thread.title}`,
            `wake_reason: ${context.wakeReason}`,
            `addressed_agent_id: ${context.addressedAgentId ?? "none"}`,
            `known_participants: ${context.profiles.map((profile) => `${profile.agent.id}=${profile.agent.displayName}`).join(", ") || "none"}`,
            `recent_context:\n${recentContext || "none"}`,
            TELEGRAM_PRESENTATION_GUIDANCE,
            AGENT_ACTION_SCHEMA,
            "Use literal UTF-8 Persian or English text. Do not emit \\uXXXX escapes.",
            "Keep content under 4096 Unicode characters and reason_summary under 160 characters. Use null targets unless the intent requires one.",
            "Do not add prose, Markdown fences, or hidden reasoning. Reply in the language of recent_context.",
          ].join("\n"),
          messages: [{
            role: "user",
            content: JSON.stringify({
              invalid_response: response.text.slice(0, 4_000),
              validation_errors: error.problems,
              instruction: "Return the corrected action now.",
            }),
          }],
          temperature: 0,
          maxOutputTokens: 256,
          timeoutMs: FOUNDATION_GUARDRAILS.providerTimeoutMilliseconds,
          metadata: { repair: "true", agentId: agent.id, threadId: thread.id },
        });
        await this.recordUsage(
          `provider-usage:${turn.id}:repair`,
          context.job,
          turn,
          repaired,
          undefined,
          Date.now() - repairStartedAt,
        );
        action = parseAgentAction(repaired.text);
        response = repaired;
      } catch (repairError: unknown) {
        if (repairError instanceof LLMProviderError) {
          await this.recordUsage(
            `provider-usage:${turn.id}:repair`,
            context.job,
            turn,
            undefined,
            repairError,
            Date.now() - repairStartedAt,
          );
        }
        const summary = repairError instanceof AgentActionValidationError
          ? repairError.problems
          : [safeErrorSummary(repairError)];
        await this.dependencies.repositories.agentTurns.updateStatus(turn.id, "failed", undefined, {
          intent: "INVALID",
          repairAttempts,
          validationErrors: summary.slice(0, 5),
        });
        await this.dependencies.repositories.events.append({
          eventType: "runtime.action_validation_failed",
          aggregateType: "agent_turn",
          aggregateId: turn.id,
          threadId: thread.id,
          jobId: context.job.id,
          actor: { type: "agent", agentId: agent.id },
          idempotencyKey: `runtime-action-validation-failed:${turn.id}`,
          payload: { repairAttempts, validationErrors: summary.slice(0, 5) },
        });
        return { action: null, outputMessageId: undefined, wait: false, retryableFailure: false, stopBurst: true };
      }
    }

    let outputMessageId: string | undefined;
    let deliveryStatus: string | undefined;
    try {
      const execution = await this.executeAction(context, action);
      outputMessageId = execution.outputMessageId;
      deliveryStatus = execution.deliveryStatus;
    } catch (error: unknown) {
      await this.dependencies.repositories.agentTurns.updateStatus(turn.id, "failed", undefined, {
        ...actionMetadata(action, repairAttempts),
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
      return { action: null, outputMessageId: undefined, wait: false, retryableFailure: false, stopBurst: true };
    }

    await this.dependencies.repositories.agentTurns.updateStatus(
      turn.id,
      "completed",
      outputMessageId,
      {
        ...actionMetadata(action, repairAttempts),
        provider: response.provider,
        model: response.model,
        requestId: response.requestId ?? null,
        latencyMs: response.latencyMs,
        finishReason: response.finishReason ?? null,
        deliveryStatus: deliveryStatus ?? null,
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
      stopBurst: false,
    };
  }

  private async executeAction(
    context: TurnContext,
    action: AgentAction,
  ): Promise<{ readonly outputMessageId?: string; readonly deliveryStatus?: string }> {
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
        await this.dependencies.repositories.humanTasks.create({
          threadId: context.thread.id,
          requestedByAgentId: context.agent.id,
          title,
          description: action.content ?? action.reasonSummary,
          priority: typeof metadata.priority === "number" ? Math.max(0, Math.min(100, Math.round(metadata.priority))) : 60,
          idempotencyKey: actionKey,
          metadata: { confidence: action.confidence, source: "agent_runtime" },
        });
        await this.dependencies.repositories.threadLifecycle
          .transition({ threadId: context.thread.id, to: "human_required", actor: { type: "agent", agentId: context.agent.id }, reason: action.reasonSummary })
          .catch((error: unknown) => {
            if (!(error instanceof InvalidTransitionError)) throw error;
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
        if (["create_document", "read_document", "edit_document", "reference_document", "share_document"].includes(operation) && !logicalPath) {
          throw new InvalidTransitionError("FILE_WORK", "missing_path");
        }
        const actor = { agentId: context.agent.id };
        let result: JsonObject;
        switch (operation) {
          case "create_document": {
            const created = await this.dependencies.memory.documents.create({
              actor,
              logicalPath: logicalPath as string,
              title: stringField(work, "title") ?? (action.content ?? "Untitled document").slice(0, 120),
              contentMarkdown: action.content ?? stringField(work, "content") ?? "",
              tags: Array.isArray(work.tags) ? work.tags.filter((item): item is string => typeof item === "string") : undefined,
              threadId: stringField(work, "threadId") ?? undefined,
            });
            result = { operation, documentId: created.document.id, version: created.document.currentVersion, path: created.document.logicalPath };
            break;
          }
          case "read_document": {
            const read = await this.dependencies.memory.documents.read(logicalPath as string, actor);
            result = { operation, documentId: read.document.id, version: read.document.currentVersion, contentCharacters: read.currentVersion?.contentMarkdown.length ?? 0, path: read.document.logicalPath };
            break;
          }
          case "edit_document": {
            const edited = await this.dependencies.memory.documents.edit({ actor, logicalPath: logicalPath as string, contentMarkdown: action.content ?? stringField(work, "content") ?? "", changeSummary: stringField(work, "changeSummary") ?? action.reasonSummary });
            result = { operation, documentId: edited.document.id, version: edited.document.currentVersion, path: edited.document.logicalPath };
            break;
          }
          case "search_documents": {
            const query = stringField(work, "query") ?? action.content ?? "";
            const matches = await this.dependencies.memory.search.search(query, { agentId: context.agent.id, threadId: context.thread.id, topK: 5 });
            result = { operation, matchCount: matches.length, matches: matches.map((match) => ({ sourceId: match.sourceId, type: match.type, title: match.title, pathOrUrl: match.pathOrUrl })) };
            break;
          }
          case "reference_document": {
            const reference = await this.dependencies.memory.documents.reference({
              actor, logicalPath: logicalPath as string, threadId: context.thread.id, messageId: context.wakeMessage?.id,
              relation: stringField(work, "relation") ?? "reference", idempotencyKey: actionKey,
            });
            result = { operation, referenceId: reference.id, documentId: reference.documentId, path: logicalPath as string };
            break;
          }
          case "share_document": {
            const targetAgentId = action.targetAgentId ?? stringField(work, "targetAgentId");
            if (!targetAgentId) throw new InvalidTransitionError("FILE_WORK", "missing_share_target");
            const share = await this.dependencies.memory.documents.share({ actor, logicalPath: logicalPath as string, targetAgentId });
            result = { operation, shareId: share.id, targetAgentId: share.agentId, path: logicalPath as string };
            break;
          }
          default:
            throw new InvalidTransitionError("FILE_WORK", operation);
        }
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

      case "DRAW":
        await this.dependencies.repositories.events.append({
          eventType: "runtime.draw_deferred",
          aggregateType: "thread",
          aggregateId: context.thread.id,
          threadId: context.thread.id,
          jobId: context.job.id,
          actor: { type: "agent", agentId: context.agent.id },
          idempotencyKey: actionKey,
          payload: {
            intent: action.intent,
            content: action.content ?? "",
            metadata: action.metadata,
            deferredTo: "phase-07",
          },
        });
        return {};

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
