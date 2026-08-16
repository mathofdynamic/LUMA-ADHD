import { InvalidTransitionError, NotFoundError, ValidationError } from "../database/errors";
import { nowIso } from "../database/ids";
import type { createRepositories } from "../database/repositories";
import type { HumanTaskRecord, HumanTaskStatus, JobRecord } from "../database/types";
import type { JsonObject } from "../database/validation";
import { TelegramConfigurationError, type TelegramApplicationService } from "../telegram";

type Repositories = ReturnType<typeof createRepositories>;

const TERMINAL_STATUSES = new Set<HumanTaskStatus>(["completed", "rejected", "cancelled"]);

function boundedText(value: string, field: string, max: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) throw new ValidationError(`${field} must not be empty`);
  if (Array.from(normalized).length > max) throw new ValidationError(`${field} is too long`);
  return normalized;
}

function normalizeRequestKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u200c\u200d]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 220);
}

function escapeTelegramHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function priorityLabel(priority: number): string {
  if (priority >= 75) return "بالا";
  if (priority >= 40) return "متوسط";
  return "پایین";
}

function requestMessage(task: {
  readonly title: string;
  readonly description: string;
  readonly reason: string;
  readonly priority: number;
  readonly blocking: boolean;
}): string {
  return [
    "<b>نیاز به کمک انسانی</b>",
    "",
    `<b>درخواست:</b>\n${escapeTelegramHtml(task.description)}`,
    "",
    `<b>چرا لازم است:</b>\n${escapeTelegramHtml(task.reason)}`,
    "",
    `<b>اولویت:</b> ${priorityLabel(task.priority)}`,
    `<b>وضعیت:</b> ${task.blocking ? "مانع ادامه" : "غیرمسدودکننده"}`,
    "",
    "در پاسخ به همین پیام جواب بده.",
  ].join("\n");
}

export interface HumanTaskServiceDependencies {
  readonly repositories: Repositories;
  readonly telegram?: Pick<TelegramApplicationService, "projectAgentMessage">;
  readonly now?: () => string;
}

export interface CreateAgentHumanTaskInput {
  readonly threadId: string;
  readonly chatId?: string | null;
  readonly requestedByAgentId: string;
  readonly title: string;
  readonly description: string;
  readonly reason: string;
  readonly priority?: number;
  readonly blocking: boolean;
  readonly targetHumanUserId?: string;
  readonly requestKey?: string;
  readonly idempotencyKey: string;
  readonly metadata?: JsonObject;
}

export interface HumanTaskResolutionResult {
  readonly task: HumanTaskRecord;
  readonly responseMessageId: string;
  readonly wakeJob: JobRecord | null;
  readonly alreadyResolved: boolean;
}

export class HumanTaskService {
  private readonly now: () => string;

  constructor(private readonly dependencies: HumanTaskServiceDependencies) {
    this.now = dependencies.now ?? nowIso;
  }

  async createFromAgent(input: CreateAgentHumanTaskInput): Promise<{ readonly task: HumanTaskRecord; readonly reused: boolean }> {
    const description = boundedText(input.description, "humanTask.description", 4000);
    const reason = boundedText(input.reason, "humanTask.reason", 1600);
    const title = boundedText(input.title, "humanTask.title", 240);
    const priority = input.priority ?? 60;
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      throw new ValidationError("humanTask.priority must be an integer between 0 and 100");
    }
    const requestKey = normalizeRequestKey(input.requestKey ?? `${title}|${description}`);
    if (requestKey.length === 0) throw new ValidationError("humanTask.requestKey must not be empty");

    const existing = await this.dependencies.repositories.humanTasks.findOpenEquivalent({
      threadId: input.threadId,
      requestedByAgentId: input.requestedByAgentId,
      requestKey,
    });
    if (existing) return { task: existing, reused: true };

    const task = await this.dependencies.repositories.humanTasks.create({
      threadId: input.threadId,
      requestedByAgentId: input.requestedByAgentId,
      title,
      description,
      reason,
      blocking: input.blocking,
      targetHumanUserId: input.targetHumanUserId,
      requestKey,
      priority,
      idempotencyKey: input.idempotencyKey,
      metadata: { ...(input.metadata ?? {}), requestKey, blocking: input.blocking },
    });

    await this.dependencies.repositories.events.append({
      eventType: "human_task.created",
      aggregateType: "human_task",
      aggregateId: task.id,
      threadId: input.threadId,
      actor: { type: "agent", agentId: input.requestedByAgentId },
      idempotencyKey: `human-task-created:${task.id}`,
      payload: { blocking: input.blocking, priority, requestKey },
    });

    if (input.blocking) {
      await this.dependencies.repositories.threadLifecycle.transition({
        threadId: input.threadId,
        to: "human_required",
        actor: { type: "agent", agentId: input.requestedByAgentId },
        reason,
      }).catch((error: unknown) => {
        if (!(error instanceof InvalidTransitionError)) throw error;
      });
    }

    if (this.dependencies.telegram && input.chatId) {
      await this.projectTask(task, input.chatId);
    }
    return { task: await this.dependencies.repositories.humanTasks.getById(task.id), reused: false };
  }

  private async projectTask(task: HumanTaskRecord, chatId: string): Promise<void> {
    if (!task.requestedByAgentId || !task.threadId) return;
    await this.dependencies.repositories.humanTasks.updateProjection({ id: task.id, status: "pending" });
    try {
      let projected;
      try {
        projected = await this.dependencies.telegram?.projectAgentMessage({
          threadId: task.threadId,
          chatId,
          agentId: task.requestedByAgentId,
          contentText: requestMessage(task),
          contentFormat: "telegram_html",
          idempotencyKey: `human-task-projection:${task.id}`,
          metadata: { humanTaskId: task.id, humanTaskRequest: true, title: task.title },
        });
      } catch (error: unknown) {
        if (!(error instanceof TelegramConfigurationError)) throw error;
        projected = await this.dependencies.telegram?.projectAgentMessage({
          threadId: task.threadId,
          chatId,
          agentId: task.requestedByAgentId,
          transportBotAlias: "gateway",
          contentText: requestMessage(task),
          contentFormat: "telegram_html",
          idempotencyKey: `human-task-projection:${task.id}`,
          metadata: { humanTaskId: task.id, humanTaskRequest: true, title: task.title, transportFallback: "gateway" },
        });
      }
      if (!projected) return;
      const outbound = await this.dependencies.repositories.telegramOutbound.getById(projected.outboundId);
      await this.dependencies.repositories.humanTasks.updateProjection({
        id: task.id,
        status: projected.status === "failed" || projected.status === "retry_scheduled" ? "failed" : "sent",
        telegramChatId: outbound.telegramChatId,
        telegramMessageId: outbound.telegramMessageId ?? projected.telegramMessageIds[0],
        telegramBotAlias: outbound.botAlias,
        telegramOutboundId: outbound.id,
        requestMessageId: projected.messageId,
        error: projected.status === "failed" || projected.status === "retry_scheduled" ? "Telegram delivery pending or failed" : undefined,
      });
      await this.dependencies.repositories.events.append({
        eventType: "human_task.projected",
        aggregateType: "human_task",
        aggregateId: task.id,
        threadId: task.threadId,
        idempotencyKey: `human-task-projected:${task.id}`,
        payload: { outboundId: outbound.id, botAlias: outbound.botAlias, status: projected.status },
      });
    } catch (error: unknown) {
      await this.dependencies.repositories.humanTasks.updateProjection({
        id: task.id,
        status: "failed",
        error: String(error).slice(0, 400),
      }).catch(() => undefined);
      await this.dependencies.repositories.events.append({
        eventType: "human_task.projection_failed",
        aggregateType: "human_task",
        aggregateId: task.id,
        threadId: task.threadId ?? undefined,
        idempotencyKey: `human-task-projection-failed:${task.id}`,
        payload: { error: "bounded Telegram projection failure" },
      }).catch(() => undefined);
    }
  }

  async resolveFromResponse(input: {
    readonly taskId: string;
    readonly threadId?: string;
    readonly responseText: string;
    readonly responseMessageId?: string;
    readonly responderUserId?: string;
    readonly responseSource: "telegram" | "admin";
    readonly responseMetadata?: JsonObject;
  }): Promise<HumanTaskResolutionResult> {
    const task = await this.dependencies.repositories.humanTasks.getById(input.taskId);
    if (input.threadId && task.threadId !== input.threadId) {
      throw new ValidationError("human task response thread does not match the task");
    }
    if (task.targetHumanUserId && task.targetHumanUserId !== input.responderUserId) {
      throw new ValidationError("human task response is from an unexpected human");
    }
    const responseText = boundedText(input.responseText, "humanTask.response", 8000);
    if (TERMINAL_STATUSES.has(task.status)) {
      return { task, responseMessageId: task.responseMessageId ?? input.responseMessageId ?? "", wakeJob: task.wakeJobId ? await this.dependencies.repositories.jobs.getById(task.wakeJobId).catch(() => null) : null, alreadyResolved: true };
    }

    let responseMessageId = input.responseMessageId;
    let effectiveResponderUserId = input.responderUserId;
    if (!responseMessageId && task.threadId) {
      if (!effectiveResponderUserId && input.responseSource === "admin") {
        const operator = await this.dependencies.repositories.users.upsertByExternalKey({
          externalKey: "admin:operator",
          displayName: "LUMA Operator",
          isAdmin: true,
          metadata: { source: "admin_observatory" },
        });
        effectiveResponderUserId = operator.id;
      }
      if (!effectiveResponderUserId) throw new ValidationError("human task response requires a responding user");
      const thread = await this.dependencies.repositories.threads.getById(task.threadId);
      const response = await this.dependencies.repositories.messages.create({
        threadId: task.threadId,
        chatId: thread.chatId ?? undefined,
        authorType: "human",
        authorUserId: effectiveResponderUserId,
        contentText: responseText,
        replyToMessageId: task.requestMessageId ?? undefined,
        origin: input.responseSource === "telegram" ? "telegram" : "internal",
        visibility: "public",
        idempotencyKey: `human-task-response:${task.id}:${input.responseSource}`,
        metadata: { humanTaskId: task.id, responseSource: input.responseSource },
      });
      responseMessageId = response.id;
    }
    if (!responseMessageId) throw new ValidationError("human task response could not be persisted");

    const wakeJob = task.threadId
      ? await this.dependencies.repositories.jobs.create({
          jobType: "human_task.wake",
          payload: { source: "human_task", taskId: task.id, threadId: task.threadId, messageId: responseMessageId },
          idempotencyKey: `human-task-wake:${task.id}`,
          dueAt: this.now(),
          priority: Math.max(70, task.priority),
          maxAttempts: 3,
          chainDepth: 0,
        })
      : null;
    const resolved = await this.dependencies.repositories.humanTasks.resolve({
      id: task.id,
      resolution: responseText,
      responseMessageId,
      respondedByUserId: effectiveResponderUserId,
      responseSource: input.responseSource,
      responseMetadata: input.responseMetadata,
      wakeJobId: wakeJob?.id,
    });

    if (task.threadId && task.blocking && (await this.dependencies.repositories.humanTasks.countOpenBlocking(task.threadId)) === 0) {
      const current = await this.dependencies.repositories.threads.getById(task.threadId);
      if (current.state === "human_required") {
        await this.dependencies.repositories.threadLifecycle.transition({
          threadId: task.threadId,
          to: "reopened",
          actor: effectiveResponderUserId ? { type: "human", userId: effectiveResponderUserId } : undefined,
          reason: "human task resolved",
        });
      }
    }
    await this.dependencies.repositories.events.append({
      eventType: "human_task.resolved",
      aggregateType: "human_task",
      aggregateId: task.id,
      threadId: task.threadId ?? undefined,
      jobId: wakeJob?.id,
      actor: effectiveResponderUserId ? { type: "human", userId: effectiveResponderUserId } : undefined,
      idempotencyKey: `human-task-resolved:${task.id}`,
      payload: { responseSource: input.responseSource, responseMessageId, wakeJobId: wakeJob?.id ?? null },
    });
    return { task: resolved, responseMessageId, wakeJob, alreadyResolved: false };
  }

  async updateStatus(input: {
    readonly taskId: string;
    readonly status: HumanTaskStatus;
    readonly resolution?: string;
    readonly responderUserId?: string;
    readonly responseSource: "admin" | "telegram";
  }): Promise<{ readonly task: HumanTaskRecord; readonly wakeJob: JobRecord | null }> {
    if (input.status === "completed") {
      const resolved = await this.resolveFromResponse({
        taskId: input.taskId,
        responseText: input.resolution ?? "Resolved by operator",
        responderUserId: input.responderUserId,
        responseSource: input.responseSource,
      });
      return { task: resolved.task, wakeJob: resolved.wakeJob };
    }
    const task = await this.dependencies.repositories.humanTasks.updateStatus(input.taskId, input.status, input.resolution, {
      responseSource: ["rejected", "cancelled"].includes(input.status) ? input.responseSource : undefined,
      respondedByUserId: ["rejected", "cancelled"].includes(input.status) ? input.responderUserId : undefined,
    });
    await this.dependencies.repositories.events.append({
      eventType: `human_task.${input.status}`,
      aggregateType: "human_task",
      aggregateId: task.id,
      threadId: task.threadId ?? undefined,
      actor: input.responderUserId ? { type: "human", userId: input.responderUserId } : undefined,
      idempotencyKey: `human-task-status:${task.id}:${input.status}:${task.updatedAt}`,
      payload: { resolution: input.resolution ?? null, responseSource: input.responseSource },
    });
    return { task, wakeJob: null };
  }
}
