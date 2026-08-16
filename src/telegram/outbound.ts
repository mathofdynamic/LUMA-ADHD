import { nowIso } from "../database/ids";
import type { createRepositories } from "../database/repositories";
import { FOUNDATION_GUARDRAILS } from "../guardrails";
import { findTelegramBotForAgent, getTelegramBot, TelegramConfigurationError, type TelegramConfig } from "./config";
import { renderTelegramText } from "./format";
import {
  TelegramTransportError,
  type TelegramAgentProjectionInput,
  type TelegramAgentProjectionResult,
  type TelegramTransport,
} from "./types";

type TelegramRepositories = ReturnType<typeof createRepositories>;

interface FailureDetails {
  readonly retryable: boolean;
  readonly retryAfterSeconds: number;
  readonly summary: string;
}

function classifyFailure(error: unknown): FailureDetails {
  if (error instanceof TelegramTransportError) {
    const retryable = error.kind === "retryable_transport" || error.kind === "rate_limited";
    return {
      retryable,
      retryAfterSeconds: error.retryAfterSeconds ?? 0,
      summary: JSON.stringify({
        kind: error.kind,
        message: error.message,
        errorCode: error.errorCode ?? null,
        retryAfterSeconds: error.retryAfterSeconds ?? null,
      }),
    };
  }

  return {
    retryable: true,
    retryAfterSeconds: 0,
    summary: JSON.stringify({
      kind: "retryable_transport",
      message: String(error),
    }),
  };
}

export interface TelegramOutboundDependencies {
  readonly repositories: TelegramRepositories;
  readonly config: TelegramConfig;
  readonly transport: TelegramTransport;
  readonly now?: () => string;
  readonly maxAttempts?: number;
}

export class TelegramOutboundService {
  private readonly now: () => string;
  private readonly maxAttempts: number;

  constructor(private readonly dependencies: TelegramOutboundDependencies) {
    this.now = dependencies.now ?? nowIso;
    this.maxAttempts = dependencies.maxAttempts ?? FOUNDATION_GUARDRAILS.maxRetries;
  }

  async projectAgentMessage(
    input: TelegramAgentProjectionInput,
  ): Promise<TelegramAgentProjectionResult> {
    const bot = input.transportBotAlias
      ? getTelegramBot(this.dependencies.config, input.transportBotAlias)
      : findTelegramBotForAgent(this.dependencies.config, input.agentId);
    if (!bot) {
      throw new TelegramConfigurationError(`no Telegram persona is mapped to agent '${input.agentId}'`);
    }

    if (bot.telegramUserId !== null && bot.agentId !== null) {
      await this.dependencies.repositories.telegramIdentities.upsert({
        agentId: input.agentId,
        telegramUserId: bot.telegramUserId,
        botAlias: bot.alias,
        username: bot.username ?? undefined,
        isBot: true,
        isPrimary: true,
        metadata: { source: "telegram_configuration" },
      });
    }

    const chat = await this.dependencies.repositories.chats.getById(input.chatId);
    if (chat.telegramChatId === null) {
      throw new TelegramConfigurationError(`chat '${input.chatId}' has no Telegram chat mapping`);
    }
    await this.dependencies.repositories.threads.addParticipant(input.threadId, {
      agentId: input.agentId,
      role: "contributor",
    });

    const message = await this.dependencies.repositories.messages.create({
      threadId: input.threadId,
      chatId: input.chatId,
      authorType: "agent",
      authorAgentId: input.agentId,
      contentText: input.contentText,
      replyToMessageId: input.replyToMessageId,
      origin: "internal",
      idempotencyKey: `telegram-agent-message:${input.idempotencyKey}`,
      metadata: {
        source: "telegram_projection",
        projectionKey: input.idempotencyKey,
        botAlias: bot.alias,
        ...(input.metadata ?? {}),
      },
    });
    await this.dependencies.repositories.threads.touchActivity(input.threadId, this.now());

    const contentFormat = input.contentFormat ?? "plain_text";
    const renderedParts = renderTelegramText(input.contentText, contentFormat);
    const outbound = await this.dependencies.repositories.telegramOutbound.create({
      messageId: message.id,
      threadId: input.threadId,
      chatId: input.chatId,
      agentId: input.agentId,
      botAlias: bot.alias,
      telegramChatId: chat.telegramChatId,
      payload: {
        source: "telegram_projection",
        parseMode: "HTML",
        contentFormat,
        partCount: renderedParts.length,
        idempotencyKey: input.idempotencyKey,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const replyTo = input.replyToMessageId === undefined
      ? null
      : await this.dependencies.repositories.messages.getById(input.replyToMessageId);
    // Telegram can reject a bot reply to a message emitted by a different
    // persona bot even when the canonical message mapping is valid. Keep the
    // internal relationship in D1, but project cross-persona contributions as
    // standalone messages. Human-originated replies remain threaded visibly.
    const crossPersonaBotReply = replyTo?.authorType === "agent"
      && replyTo.telegramBotAlias !== null
      && replyTo.telegramBotAlias !== bot.alias;
    const replyToTelegramMessageId = !crossPersonaBotReply
      && replyTo?.telegramChatId === chat.telegramChatId
      ? replyTo.telegramMessageId ?? undefined
      : undefined;
    const parts = await this.dependencies.repositories.telegramOutbound.createParts(
      outbound.id,
      renderedParts.map((text, partIndex) => ({
        partIndex,
        text,
        replyToTelegramMessageId: partIndex === 0 ? replyToTelegramMessageId : undefined,
      })),
    );

    const existingSentIds = parts
      .filter((part) => part.status === "sent" && part.telegramMessageId !== null)
      .map((part) => part.telegramMessageId as string);
    if (outbound.status === "sent") {
      if (outbound.telegramMessageId !== null) {
        await this.dependencies.repositories.messages.attachTelegramProjection({
          messageId: message.id,
          telegramChatId: chat.telegramChatId,
          telegramMessageId: outbound.telegramMessageId,
          telegramBotAlias: bot.alias,
        });
      }
      return {
        messageId: message.id,
        outboundId: outbound.id,
        status: "already_sent",
        telegramMessageIds: existingSentIds,
      };
    }

    const claimed = await this.dependencies.repositories.telegramOutbound.beginAttempt(
      outbound.id,
      this.maxAttempts,
      this.now(),
    );
    if (!claimed) {
      return {
        messageId: message.id,
        outboundId: outbound.id,
        status: outbound.status === "failed" && outbound.nextAttemptAt !== null
          ? "retry_scheduled"
          : "failed",
        telegramMessageIds: existingSentIds,
      };
    }

    let previousTelegramMessageId = existingSentIds.at(-1);
    for (const part of parts) {
      if (part.status === "sent" && part.telegramMessageId !== null) {
        previousTelegramMessageId = part.telegramMessageId;
        continue;
      }

      const claimedPart = await this.dependencies.repositories.telegramOutbound.beginPartAttempt(
        part.id,
        this.maxAttempts,
        this.now(),
      );
      if (!claimedPart) {
        continue;
      }

      try {
        const replyToTelegramMessageId = claimedPart.replyToTelegramMessageId ?? previousTelegramMessageId;
        if (claimedPart.replyToTelegramMessageId === null && replyToTelegramMessageId !== undefined) {
          await this.dependencies.repositories.telegramOutbound.setPartReplyTarget(
            claimedPart.id,
            replyToTelegramMessageId,
          );
        }
        const sent = await this.dependencies.transport.sendTextMessage({
          botAlias: bot.alias,
          telegramChatId: chat.telegramChatId,
          text: claimedPart.text,
          replyToTelegramMessageId,
        });
        await this.dependencies.repositories.telegramOutbound.markPartSent(
          claimedPart.id,
          sent.telegramMessageId,
          this.now(),
        );
        previousTelegramMessageId = sent.telegramMessageId;
        existingSentIds.push(sent.telegramMessageId);
        if (existingSentIds.length === 1) {
          await this.dependencies.repositories.messages.attachTelegramProjection({
            messageId: message.id,
            telegramChatId: chat.telegramChatId,
            telegramMessageId: sent.telegramMessageId,
            telegramBotAlias: bot.alias,
          });
        }
      } catch (error: unknown) {
        const failure = classifyFailure(error);
        const canRetry = failure.retryable && claimed.attemptCount < this.maxAttempts;
        await this.dependencies.repositories.telegramOutbound.markPartFailed(
          claimedPart.id,
          failure.summary,
          canRetry,
          failure.retryAfterSeconds,
          this.now(),
        );
        const failed = await this.dependencies.repositories.telegramOutbound.markFailed(
          outbound.id,
          failure.summary,
          canRetry,
          failure.retryAfterSeconds,
          this.now(),
        );
        return {
          messageId: message.id,
          outboundId: failed.id,
          status: canRetry ? "retry_scheduled" : "failed",
          telegramMessageIds: existingSentIds,
        };
      }
    }

    const firstTelegramMessageId = existingSentIds[0];
    if (firstTelegramMessageId === undefined) {
      const failure = JSON.stringify({ kind: "permanent_rejection", message: "No Telegram parts were delivered" });
      const failed = await this.dependencies.repositories.telegramOutbound.markFailed(
        outbound.id,
        failure,
        false,
        0,
        this.now(),
      );
      return {
        messageId: message.id,
        outboundId: failed.id,
        status: "failed",
        telegramMessageIds: [],
      };
    }

    const sent = await this.dependencies.repositories.telegramOutbound.markSent(
      outbound.id,
      firstTelegramMessageId,
      this.now(),
    );
    return {
      messageId: message.id,
      outboundId: sent.id,
      status: "sent",
      telegramMessageIds: existingSentIds,
    };
  }
}
