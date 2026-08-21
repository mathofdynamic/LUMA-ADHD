import { nowIso } from "../database/ids";
import type { createRepositories } from "../database/repositories";
import {
  TelegramConfigurationError,
  getTelegramBot,
  resolveConfiguredAgent,
  type TelegramConfig,
} from "./config";
import { normalizeTelegramUpdate } from "./normalize";
import type {
  NormalizedTelegramUpdate,
  TelegramInboundResult,
} from "./types";
import { HumanTaskService } from "../human-tasks";
import { DatabaseError } from "../database/errors";
import { classifyConversationIntent, decideThreadContinuation } from "../agents/conversation-focus";

type TelegramRepositories = ReturnType<typeof createRepositories>;

function titleFromMessage(text: string): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  return `Telegram discussion: ${characters.slice(0, 80).join("") || "Untitled"}`;
}

function mentionedAgentId(
  config: TelegramConfig,
  text: string,
): string | null {
  const mentions = text.matchAll(/@([a-z0-9_]{5,32})/giu);
  for (const mention of mentions) {
    const agentId = (() => {
      for (const bot of config.bots.values()) {
        if (bot.username === mention[1].toLowerCase()) {
          return bot.agentId;
        }
      }
      return null;
    })();
    if (agentId !== null) {
      return agentId;
    }
  }

  return null;
}

function replyAgentId(
  config: TelegramConfig,
  update: NormalizedTelegramUpdate,
  repliedMessageAgentId: string | null,
): string | null {
  if (repliedMessageAgentId !== null) {
    return repliedMessageAgentId;
  }
  const configuredReplyAgentId = update.replyTo
    ? resolveConfiguredAgent(config, {
        telegramUserId: update.replyTo.senderTelegramUserId,
        username: update.replyTo.senderUsername,
      })
    : null;
  if (configuredReplyAgentId !== null) {
    return configuredReplyAgentId;
  }

  return mentionedAgentId(config, update.text);
}

export interface TelegramInboundDependencies {
  readonly repositories: TelegramRepositories;
  readonly config: TelegramConfig;
  readonly now?: () => string;
}

export class TelegramInboundService {
  private readonly now: () => string;

  constructor(private readonly dependencies: TelegramInboundDependencies) {
    this.now = dependencies.now ?? nowIso;
  }

  async ingest(
    payload: unknown,
    botAlias: string,
    receivedAt = this.now(),
  ): Promise<TelegramInboundResult> {
    const bot = getTelegramBot(this.dependencies.config, botAlias);
    if (!bot) {
      return { status: "ignored", reason: "unknown_bot_alias" };
    }
    if (botAlias !== "gateway") {
      return { status: "ignored", reason: "persona_webhook_is_not_an_ingress_bus" };
    }
    if (!this.dependencies.config.webhookReady || this.dependencies.config.groupId === null) {
      throw new TelegramConfigurationError("TELEGRAM_GROUP_ID and TELEGRAM_WEBHOOK_SECRET are required");
    }

    const update = normalizeTelegramUpdate(payload);
    if (!update) {
      return { status: "ignored", reason: "unsupported_or_non_text_update" };
    }
    if (update.sender.isBot) {
      return { status: "ignored", reason: "bot_message" };
    }
    if (
      update.chat.id !== this.dependencies.config.groupId ||
      (update.chat.type !== "group" && update.chat.type !== "supergroup")
    ) {
      return { status: "ignored", reason: "chat_not_configured" };
    }

    const existing = await this.dependencies.repositories.messages.findByTelegramUpdate(
      update.updateId,
      botAlias,
    );
    const jobKey = `telegram-interactive:${botAlias}:${update.updateId}`;
    if (existing) {
      const existingTaskId = typeof existing.metadata.humanTaskId === "string" ? existing.metadata.humanTaskId : null;
      if (existingTaskId) {
        const existingTask = await this.dependencies.repositories.humanTasks.getById(existingTaskId).catch(() => null);
        if (existingTask?.wakeJobId) {
          return {
            status: "duplicate",
            messageId: existing.id,
            threadId: existing.threadId,
            jobId: existingTask.wakeJobId,
            humanTaskId: existingTask.id,
            humanTaskResolved: true,
            addressedAgentId: existing.metadata.addressedAgentId === null
              ? null
              : typeof existing.metadata.addressedAgentId === "string"
                ? existing.metadata.addressedAgentId
                : null,
          };
        }
      }
      const existingJob = await this.dependencies.repositories.jobs.getByIdempotencyKey(jobKey).catch(() => null);
      const job = existingJob ?? await this.dependencies.repositories.jobs.create({
        jobType: "telegram.interactive_message",
        payload: {
          source: "telegram",
          updateId: update.updateId,
          messageId: existing.id,
          threadId: existing.threadId,
          chatId: existing.chatId,
          addressedAgentId: existing.metadata.addressedAgentId === null
            ? null
            : typeof existing.metadata.addressedAgentId === "string"
              ? existing.metadata.addressedAgentId
              : null,
        },
        idempotencyKey: jobKey,
        dueAt: receivedAt,
        priority: 70,
        maxAttempts: 3,
        chainDepth: 0,
      });
      return {
        status: "duplicate",
        messageId: existing.id,
        threadId: existing.threadId,
        jobId: job?.id,
        addressedAgentId: existing.metadata.addressedAgentId === null
          ? null
          : typeof existing.metadata.addressedAgentId === "string"
            ? existing.metadata.addressedAgentId
            : null,
      };
    }

    const chat = await this.dependencies.repositories.chats.upsertByTelegramId({
      telegramChatId: update.chat.id,
      chatType: update.chat.type,
      title: update.chat.title,
      isWorkspace: true,
      metadata: { source: "telegram", workspace: true },
    });
    const user = await this.dependencies.repositories.users.upsertByExternalKey({
      externalKey: `telegram:user:${update.sender.id}`,
      displayName: update.sender.displayName,
      username: update.sender.username,
      isAdmin: this.dependencies.config.adminUserIds.has(update.sender.id),
      metadata: {
        source: "telegram",
        telegramUserId: update.sender.id,
        botAlias,
      },
    });
    await this.dependencies.repositories.telegramIdentities.upsert({
      userId: user.id,
      telegramUserId: update.sender.id,
      botAlias,
      username: update.sender.username,
      isBot: false,
      isPrimary: true,
      metadata: { source: "telegram", lastSeenAt: receivedAt },
    });

    const repliedMessage = update.replyTo && update.replyTo.telegramChatId === update.chat.id
      ? await this.dependencies.repositories.messages.findByTelegramReference(
          update.chat.id,
          update.replyTo.telegramMessageId,
        )
      : null;
    const repliedHumanTaskId = repliedMessage && typeof repliedMessage.metadata.humanTaskId === "string"
      ? repliedMessage.metadata.humanTaskId
      : null;
    let addressedAgentId = replyAgentId(
      this.dependencies.config,
      update,
      repliedMessage?.authorAgentId ?? null,
    );
    if (!repliedMessage && addressedAgentId === null && update.replyTo?.senderTelegramUserId !== undefined) {
      addressedAgentId = await this.dependencies.repositories.telegramIdentities.findAgentByTelegramUserId(
        update.replyTo.senderTelegramUserId,
      );
    }

    const classification = classifyConversationIntent(update.text);
    let continuationReason: string | null = null;
    let supersedesThreadId: string | null = null;
    let thread = repliedMessage
      ? await this.dependencies.repositories.threads.getById(repliedMessage.threadId)
      : update.topicId
        ? await this.dependencies.repositories.threads.findByTelegramTopic(chat.id, update.topicId)
        : null;

    if (!repliedMessage && !update.topicId) {
      const candidateThread = await this.dependencies.repositories.threads.findMostRecentActiveByChat(chat.id);
      const candidateMessages = candidateThread
        ? await this.dependencies.repositories.messages.listRecentByThread(candidateThread.id, 40)
        : [];
      const continuation = decideThreadContinuation({
        candidateThread,
        recentMessages: candidateMessages,
        text: update.text,
        now: receivedAt,
        hasExplicitAgentAddress: addressedAgentId !== null,
      });
      continuationReason = continuation.reason;
      if (continuation.continueThread) {
        thread = candidateThread;
      } else if (candidateThread) {
        supersedesThreadId = candidateThread.id;
      }
    } else if (repliedMessage) {
      continuationReason = "explicit_telegram_reply";
    } else if (update.topicId) {
      continuationReason = "telegram_topic_binding";
    }

    if (!thread) {
      thread = await this.dependencies.repositories.threads.create({
        chatId: chat.id,
        title: titleFromMessage(update.text),
        createdByUserId: user.id,
        telegramTopicId: update.topicId,
        metadata: {
          source: "telegram",
          createdFromUpdateId: update.updateId,
          interactionIntent: classification.interactionIntent,
          conversationBoundaryReason: continuationReason ?? classification.boundaryReason ?? "no_active_thread",
          supersedesThreadId,
        },
      });
    }

    await this.dependencies.repositories.threads.addParticipant(thread.id, {
      userId: user.id,
      role: thread.createdByUserId === user.id ? "owner" : "contributor",
    });
    if (addressedAgentId !== null) {
      await this.dependencies.repositories.threads.addParticipant(thread.id, {
        agentId: addressedAgentId,
        role: "contributor",
      });
    }

    const message = await this.dependencies.repositories.messages.create({
      threadId: thread.id,
      chatId: chat.id,
      authorType: "human",
      authorUserId: user.id,
      contentText: update.text,
      replyToMessageId: repliedMessage?.id,
      origin: "telegram",
      telegramChatId: update.chat.id,
      telegramMessageId: update.messageId,
      telegramBotAlias: botAlias,
      telegramUpdateId: update.updateId,
      idempotencyKey: `telegram-message:${botAlias}:${update.updateId}`,
      metadata: {
        telegramMessageId: update.messageId,
        telegramUpdateId: update.updateId,
        addressedAgentId,
        humanTaskId: repliedHumanTaskId,
        topicId: update.topicId ?? null,
        interactionIntent: classification.interactionIntent,
        conversationBoundaryReason: continuationReason ?? classification.boundaryReason,
        threadContinuationReason: continuationReason,
        supersedesThreadId,
      },
    });
    await this.dependencies.repositories.threads.touchActivity(thread.id, receivedAt);

    if (repliedHumanTaskId) {
      try {
        const resolved = await new HumanTaskService({
          repositories: this.dependencies.repositories,
          now: this.now,
        }).resolveFromResponse({
          taskId: repliedHumanTaskId,
          threadId: thread.id,
          responseText: update.text,
          responseMessageId: message.id,
          responderUserId: user.id,
          responseSource: "telegram",
          responseMetadata: { telegramUpdateId: update.updateId, telegramMessageId: update.messageId },
        });
        if (resolved.wakeJob) {
          return {
            status: "accepted",
            messageId: message.id,
            threadId: thread.id,
            jobId: resolved.wakeJob.id,
            addressedAgentId: repliedMessage?.authorAgentId ?? addressedAgentId,
            humanTaskId: repliedHumanTaskId,
            humanTaskResolved: !resolved.alreadyResolved,
          };
        }
      } catch (error: unknown) {
        if (!(error instanceof DatabaseError)) throw error;
        await this.dependencies.repositories.events.append({
          eventType: "human_task.mapping_failed",
          aggregateType: "message",
          aggregateId: message.id,
          threadId: thread.id,
          idempotencyKey: `human-task-mapping-failed:${message.id}`,
          payload: { taskId: repliedHumanTaskId, error: error.message.slice(0, 240) },
        });
      }
    }

    const job = await this.dependencies.repositories.jobs.create({
      jobType: "telegram.interactive_message",
      payload: {
        source: "telegram",
        updateId: update.updateId,
        messageId: message.id,
        threadId: thread.id,
        chatId: chat.id,
        addressedAgentId,
      },
      idempotencyKey: jobKey,
      dueAt: receivedAt,
      priority: 70,
      maxAttempts: 3,
      chainDepth: 0,
    });

    return {
      status: "accepted",
      messageId: message.id,
      threadId: thread.id,
      jobId: job.id,
      addressedAgentId,
      humanTaskId: repliedHumanTaskId ?? undefined,
      humanTaskResolved: false,
    };
  }
}
