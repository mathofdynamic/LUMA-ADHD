import type { JsonObject } from "../database/validation";
import type { TelegramBotAlias } from "./config";

export interface TelegramUser {
  readonly id: number | string;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface TelegramChat {
  readonly id: number | string;
  readonly type: "private" | "group" | "supergroup" | "channel";
  readonly title?: string;
  readonly username?: string;
}

export interface TelegramMessageEntity {
  readonly type: string;
  readonly offset: number;
  readonly length: number;
  readonly user?: TelegramUser;
}

export interface TelegramMessage {
  readonly message_id: number | string;
  readonly from?: TelegramUser;
  readonly chat: TelegramChat;
  readonly date: number;
  readonly text?: string;
  readonly entities?: readonly TelegramMessageEntity[];
  readonly reply_to_message?: TelegramMessage;
  readonly message_thread_id?: number | string;
}

export interface TelegramUpdate {
  readonly update_id: number | string;
  readonly message?: TelegramMessage;
  readonly edited_message?: TelegramMessage;
  readonly channel_post?: TelegramMessage;
  readonly edited_channel_post?: TelegramMessage;
}

export interface TelegramReplyReference {
  readonly telegramChatId: string;
  readonly telegramMessageId: string;
  readonly senderTelegramUserId: string | undefined;
  readonly senderUsername: string | undefined;
}

export interface NormalizedTelegramUpdate {
  readonly updateId: string;
  readonly messageId: string;
  readonly chat: {
    readonly id: string;
    readonly type: TelegramChat["type"];
    readonly title: string | undefined;
  };
  readonly sender: {
    readonly id: string;
    readonly isBot: boolean;
    readonly displayName: string;
    readonly username: string | undefined;
  };
  readonly text: string;
  readonly entities: readonly TelegramMessageEntity[];
  readonly replyTo: TelegramReplyReference | undefined;
  readonly topicId: string | undefined;
}

export interface TelegramUpdateEnvelope {
  readonly botAlias: string;
  readonly receivedAt: string;
  readonly payload: unknown;
}

export interface TelegramSendTextInput {
  readonly botAlias: TelegramBotAlias;
  readonly telegramChatId: string;
  readonly text: string;
  readonly replyToTelegramMessageId?: string;
}

export type TelegramContentFormat = "plain_text" | "telegram_html";

export interface TelegramSentMessage {
  readonly telegramMessageId: string;
  readonly telegramChatId: string;
}

export type TelegramFailureKind =
  | "retryable_transport"
  | "rate_limited"
  | "permanent_rejection"
  | "invalid_configuration";

export class TelegramTransportError extends Error {
  readonly kind: TelegramFailureKind;
  readonly retryAfterSeconds: number | undefined;
  readonly errorCode: number | undefined;

  constructor(
    kind: TelegramFailureKind,
    message: string,
    options?: { readonly retryAfterSeconds?: number; readonly errorCode?: number },
  ) {
    super(message);
    this.name = "TelegramTransportError";
    this.kind = kind;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.errorCode = options?.errorCode;
  }
}

export interface TelegramTransport {
  sendTextMessage(input: TelegramSendTextInput): Promise<TelegramSentMessage>;
}

export interface TelegramInboundResult {
  readonly status: "accepted" | "duplicate" | "ignored";
  readonly reason?: string;
  readonly messageId?: string;
  readonly threadId?: string;
  readonly jobId?: string;
  readonly addressedAgentId?: string | null;
}

export interface TelegramAgentProjectionInput {
  readonly threadId: string;
  readonly chatId: string;
  readonly agentId: string;
  readonly contentText: string;
  readonly contentFormat?: TelegramContentFormat;
  readonly idempotencyKey: string;
  readonly replyToMessageId?: string;
  readonly metadata?: JsonObject;
}

export interface TelegramAgentProjectionResult {
  readonly messageId: string;
  readonly outboundId: string;
  readonly status: "sent" | "failed" | "already_sent" | "retry_scheduled";
  readonly telegramMessageIds: readonly string[];
}
