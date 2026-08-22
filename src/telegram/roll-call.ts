import type { createRepositories } from "../database/repositories";
import type { JobRecord } from "../database/types";
import { nowIso } from "../database/ids";
import type { JsonObject, JsonValue } from "../database/validation";
import type { TelegramConfig } from "./config";
import type { TelegramAgentProjectionResult } from "./types";

type TelegramRepositories = ReturnType<typeof createRepositories>;

function stringField(payload: JsonObject, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArray(value: JsonValue | undefined): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export interface TelegramRollCallResult {
  readonly targetedAgentIds: readonly string[];
  readonly respondedAgentIds: readonly string[];
  readonly failedAgentIds: readonly string[];
  readonly skippedAgentIds: readonly string[];
}

export interface TelegramRollCallDependencies {
  readonly repositories: TelegramRepositories;
  readonly config: TelegramConfig;
  readonly projectAgentMessage: (input: {
    readonly threadId: string;
    readonly chatId: string;
    readonly agentId: string;
    readonly contentText: string;
    readonly contentFormat: "telegram_html";
    readonly idempotencyKey: string;
    readonly replyToMessageId?: string;
    readonly metadata?: JsonObject;
  }) => Promise<TelegramAgentProjectionResult>;
  readonly now?: () => string;
}

export class TelegramRollCallService {
  private readonly now: () => string;

  constructor(private readonly dependencies: TelegramRollCallDependencies) {
    this.now = dependencies.now ?? nowIso;
  }

  async run(job: JobRecord): Promise<TelegramRollCallResult> {
    const completedKey = `telegram-roll-call:${job.id}:completed`;
    const existing = await this.dependencies.repositories.events.getByIdempotencyKey(completedKey).catch(() => null);
    if (existing) {
      return {
        targetedAgentIds: stringArray(existing.payload.targetedAgentIds),
        respondedAgentIds: stringArray(existing.payload.respondedAgentIds),
        failedAgentIds: stringArray(existing.payload.failedAgentIds),
        skippedAgentIds: stringArray(existing.payload.skippedAgentIds),
      };
    }

    const threadId = stringField(job.payload, "threadId");
    const chatId = stringField(job.payload, "chatId");
    const messageId = stringField(job.payload, "messageId");
    if (!threadId || !chatId || !messageId) {
      throw new Error("roll_call_job_missing_context");
    }

    const activeAgents = (await this.dependencies.repositories.agents.listActive(20))
      .filter((agent) => !agent.isSupervisor)
      .sort((left, right) => left.id.localeCompare(right.id));
    const targetedAgentIds = activeAgents.map((agent) => agent.id);
    const respondedAgentIds: string[] = [];
    const failedAgentIds: string[] = [];
    const skippedAgentIds: string[] = [];

    for (const agent of activeAgents) {
      try {
        const result = await this.dependencies.projectAgentMessage({
          threadId,
          chatId,
          agentId: agent.id,
          contentText: "حاضرم 👋",
          contentFormat: "telegram_html",
          idempotencyKey: `roll-call:${messageId}:${agent.id}`,
          replyToMessageId: messageId,
          metadata: {
            source: "telegram_roll_call",
            interactionMode: "roll_call",
            attendanceAcknowledgement: true,
          },
        });
        if (result.status === "failed" || result.status === "retry_scheduled") {
          failedAgentIds.push(agent.id);
        } else {
          respondedAgentIds.push(agent.id);
        }
      } catch (error: unknown) {
        failedAgentIds.push(agent.id);
        await this.dependencies.repositories.events.append({
          eventType: "telegram.roll_call_projection_failed",
          aggregateType: "job",
          aggregateId: job.id,
          threadId,
          jobId: job.id,
          idempotencyKey: `telegram-roll-call:${job.id}:agent:${agent.id}:failed`,
          payload: {
            agentId: agent.id,
            errorCategory: error instanceof Error ? error.name : "unknown",
          },
        });
      }
    }

    await this.dependencies.repositories.events.append({
      eventType: "telegram.roll_call_completed",
      aggregateType: "job",
      aggregateId: job.id,
      threadId,
      jobId: job.id,
      idempotencyKey: completedKey,
      occurredAt: this.now(),
      payload: {
        targetedAgentIds,
        respondedAgentIds,
        failedAgentIds,
        skippedAgentIds,
        gatewayIncluded: false,
        godIncluded: false,
      },
    });
    return { targetedAgentIds, respondedAgentIds, failedAgentIds, skippedAgentIds };
  }
}
