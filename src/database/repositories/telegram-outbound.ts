import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireNonEmpty } from "../validation";
import type { JsonObject } from "../validation";

export type TelegramOutboundStatus = "pending" | "claimed" | "sent" | "failed" | "cancelled";
export type TelegramOutboundPartStatus = "pending" | "claimed" | "sent" | "failed";

export interface TelegramOutboundRecord {
  readonly id: string;
  readonly messageId: string | null;
  readonly threadId: string | null;
  readonly chatId: string | null;
  readonly agentId: string | null;
  readonly botAlias: string;
  readonly telegramChatId: string;
  readonly status: TelegramOutboundStatus;
  readonly payload: JsonObject;
  readonly telegramMessageId: string | null;
  readonly idempotencyKey: string;
  readonly attemptCount: number;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sentAt: string | null;
}

export interface TelegramOutboundPartRecord {
  readonly id: string;
  readonly outboundId: string;
  readonly partIndex: number;
  readonly text: string;
  readonly status: TelegramOutboundPartStatus;
  readonly telegramMessageId: string | null;
  readonly replyToTelegramMessageId: string | null;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly nextAttemptAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sentAt: string | null;
}

export interface CreateTelegramOutboundInput {
  readonly id?: string;
  readonly messageId?: string;
  readonly threadId?: string;
  readonly chatId?: string;
  readonly agentId?: string;
  readonly botAlias: string;
  readonly telegramChatId: string;
  readonly payload?: JsonObject;
  readonly idempotencyKey: string;
}

interface TelegramOutboundRow {
  id: string;
  message_id: string | null;
  thread_id: string | null;
  chat_id: string | null;
  agent_id: string | null;
  bot_alias: string;
  telegram_chat_id: string;
  status: TelegramOutboundStatus;
  payload_json: string;
  telegram_message_id: string | null;
  idempotency_key: string;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

interface TelegramOutboundPartRow {
  id: string;
  outbound_id: string;
  part_index: number;
  text: string;
  status: TelegramOutboundPartStatus;
  telegram_message_id: string | null;
  reply_to_telegram_message_id: string | null;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

function mapOutbound(row: TelegramOutboundRow): TelegramOutboundRecord {
  return {
    id: row.id,
    messageId: toNullableString(row.message_id),
    threadId: toNullableString(row.thread_id),
    chatId: toNullableString(row.chat_id),
    agentId: toNullableString(row.agent_id),
    botAlias: row.bot_alias,
    telegramChatId: row.telegram_chat_id,
    status: row.status,
    payload: toJsonObject(row.payload_json, "telegram_outbound.payload_json"),
    telegramMessageId: toNullableString(row.telegram_message_id),
    idempotencyKey: row.idempotency_key,
    attemptCount: toNumber(row.attempt_count, "telegram_outbound.attempt_count"),
    nextAttemptAt: toNullableString(row.next_attempt_at),
    lastError: toNullableString(row.last_error),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: toNullableString(row.sent_at),
  };
}

function mapPart(row: TelegramOutboundPartRow): TelegramOutboundPartRecord {
  return {
    id: row.id,
    outboundId: row.outbound_id,
    partIndex: toNumber(row.part_index, "telegram_outbound_parts.part_index"),
    text: row.text,
    status: row.status,
    telegramMessageId: toNullableString(row.telegram_message_id),
    replyToTelegramMessageId: toNullableString(row.reply_to_telegram_message_id),
    attemptCount: toNumber(row.attempt_count, "telegram_outbound_parts.attempt_count"),
    lastError: toNullableString(row.last_error),
    nextAttemptAt: toNullableString(row.next_attempt_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: toNullableString(row.sent_at),
  };
}

function addSeconds(timestamp: string, seconds: number): string {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) {
    throw new ValidationError("Telegram retry timestamp must be a valid ISO timestamp");
  }

  return new Date(milliseconds + seconds * 1000).toISOString();
}

export class TelegramOutboundRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateTelegramOutboundInput): Promise<TelegramOutboundRecord> {
    const id = input.id ?? createId("telegram-outbound");
    const botAlias = requireNonEmpty(input.botAlias, "telegramOutbound.botAlias");
    const telegramChatId = requireNonEmpty(input.telegramChatId, "telegramOutbound.telegramChatId");
    const idempotencyKey = requireNonEmpty(input.idempotencyKey, "telegramOutbound.idempotencyKey");
    const timestamp = nowIso();

    await this.database
      .prepare(
        `INSERT INTO telegram_outbound (
          id, message_id, thread_id, chat_id, agent_id, bot_alias,
          telegram_chat_id, payload_json, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(
        id,
        input.messageId ?? null,
        input.threadId ?? null,
        input.chatId ?? null,
        input.agentId ?? null,
        botAlias,
        telegramChatId,
        encodeObject(input.payload, "telegramOutbound.payload"),
        idempotencyKey,
        timestamp,
        timestamp,
      )
      .run();

    return this.getByIdempotencyKey(idempotencyKey);
  }

  async getById(id: string): Promise<TelegramOutboundRecord> {
    const row = await this.database
      .prepare("SELECT * FROM telegram_outbound WHERE id = ?")
      .bind(id)
      .first<TelegramOutboundRow>();

    if (!row) {
      throw new NotFoundError("Telegram outbound", id);
    }

    return mapOutbound(row);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<TelegramOutboundRecord> {
    const row = await this.database
      .prepare("SELECT * FROM telegram_outbound WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<TelegramOutboundRow>();

    if (!row) {
      throw new NotFoundError("Telegram outbound idempotency key", idempotencyKey);
    }

    return mapOutbound(row);
  }

  async createParts(
    outboundId: string,
    parts: readonly { readonly partIndex: number; readonly text: string; readonly replyToTelegramMessageId?: string }[],
  ): Promise<readonly TelegramOutboundPartRecord[]> {
    for (const part of parts) {
      if (!Number.isInteger(part.partIndex) || part.partIndex < 0) {
        throw new ValidationError("Telegram outbound part index must be a non-negative integer");
      }

      const text = requireNonEmpty(part.text, "telegramOutboundPart.text");
      await this.database
        .prepare(
          `INSERT INTO telegram_outbound_parts (
            id, outbound_id, part_index, text, reply_to_telegram_message_id
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (outbound_id, part_index) DO NOTHING`,
        )
        .bind(
          createId("telegram-outbound-part"),
          outboundId,
          part.partIndex,
          text,
          part.replyToTelegramMessageId ?? null,
        )
        .run();
    }

    return this.listParts(outboundId);
  }

  async listParts(outboundId: string): Promise<readonly TelegramOutboundPartRecord[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM telegram_outbound_parts
         WHERE outbound_id = ? ORDER BY part_index ASC`,
      )
      .bind(outboundId)
      .all<TelegramOutboundPartRow>();

    return result.results.map(mapPart);
  }

  async beginAttempt(
    outboundId: string,
    maxAttempts: number,
    asOf = nowIso(),
  ): Promise<TelegramOutboundRecord | null> {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new ValidationError("Telegram outbound maxAttempts must be a positive integer");
    }

    const result = await this.database
      .prepare(
        `UPDATE telegram_outbound SET
           status = 'claimed', attempt_count = attempt_count + 1,
           updated_at = ?
         WHERE id = ? AND status IN ('pending', 'failed')
           AND attempt_count < ?
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
      )
      .bind(asOf, outboundId, maxAttempts, asOf)
      .run();

    return result.meta.changes === 1 ? this.getById(outboundId) : null;
  }

  async beginPartAttempt(
    partId: string,
    maxAttempts: number,
    asOf = nowIso(),
  ): Promise<TelegramOutboundPartRecord | null> {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new ValidationError("Telegram outbound part maxAttempts must be a positive integer");
    }

    const result = await this.database
      .prepare(
        `UPDATE telegram_outbound_parts SET
           status = 'claimed', attempt_count = attempt_count + 1,
           updated_at = ?
         WHERE id = ? AND status IN ('pending', 'failed')
           AND attempt_count < ?
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
      )
      .bind(asOf, partId, maxAttempts, asOf)
      .run();

    return result.meta.changes === 1 ? this.getPartById(partId) : null;
  }

  async getPartById(partId: string): Promise<TelegramOutboundPartRecord> {
    const row = await this.database
      .prepare("SELECT * FROM telegram_outbound_parts WHERE id = ?")
      .bind(partId)
      .first<TelegramOutboundPartRow>();

    if (!row) {
      throw new NotFoundError("Telegram outbound part", partId);
    }

    return mapPart(row);
  }

  async setPartReplyTarget(partId: string, replyToTelegramMessageId: string): Promise<void> {
    const replyId = requireNonEmpty(replyToTelegramMessageId, "telegramOutboundPart.replyToTelegramMessageId");
    await this.database
      .prepare(
        `UPDATE telegram_outbound_parts
         SET reply_to_telegram_message_id = ?, updated_at = ?
         WHERE id = ? AND status = 'claimed' AND reply_to_telegram_message_id IS NULL`,
      )
      .bind(replyId, nowIso(), partId)
      .run();
  }

  async markPartSent(
    partId: string,
    telegramMessageId: string,
    asOf = nowIso(),
  ): Promise<TelegramOutboundPartRecord> {
    const messageId = requireNonEmpty(telegramMessageId, "telegramOutboundPart.telegramMessageId");
    const result = await this.database
      .prepare(
        `UPDATE telegram_outbound_parts SET
           status = 'sent', telegram_message_id = ?, next_attempt_at = NULL,
           last_error = NULL, sent_at = ?, updated_at = ?
         WHERE id = ? AND status = 'claimed'`,
      )
      .bind(messageId, asOf, asOf, partId)
      .run();

    if (result.meta.changes !== 1) {
      throw new ValidationError(`Telegram outbound part '${partId}' is not claimed`);
    }

    return this.getPartById(partId);
  }

  async markPartFailed(
    partId: string,
    error: string,
    retryable: boolean,
    retryAfterSeconds = 0,
    asOf = nowIso(),
  ): Promise<TelegramOutboundPartRecord> {
    const summary = requireNonEmpty(error, "telegramOutboundPart.error");
    const nextAttemptAt = retryable
      ? addSeconds(asOf, Math.max(0, retryAfterSeconds))
      : null;
    const result = await this.database
      .prepare(
        `UPDATE telegram_outbound_parts SET
           status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = ?
         WHERE id = ? AND status = 'claimed'`,
      )
      .bind(summary, nextAttemptAt, asOf, partId)
      .run();

    if (result.meta.changes !== 1) {
      throw new ValidationError(`Telegram outbound part '${partId}' is not claimed`);
    }

    return this.getPartById(partId);
  }

  async markSent(outboundId: string, telegramMessageId: string, asOf = nowIso()): Promise<TelegramOutboundRecord> {
    const messageId = requireNonEmpty(telegramMessageId, "telegramOutbound.telegramMessageId");
    const result = await this.database
      .prepare(
        `UPDATE telegram_outbound SET
           status = 'sent', telegram_message_id = ?, next_attempt_at = NULL,
           last_error = NULL, sent_at = ?, updated_at = ?
         WHERE id = ? AND status = 'claimed'`,
      )
      .bind(messageId, asOf, asOf, outboundId)
      .run();

    if (result.meta.changes !== 1) {
      throw new ValidationError(`Telegram outbound '${outboundId}' is not claimed`);
    }

    return this.getById(outboundId);
  }

  async markFailed(
    outboundId: string,
    error: string,
    retryable: boolean,
    retryAfterSeconds = 0,
    asOf = nowIso(),
  ): Promise<TelegramOutboundRecord> {
    const summary = requireNonEmpty(error, "telegramOutbound.error");
    const nextAttemptAt = retryable
      ? addSeconds(asOf, Math.max(0, retryAfterSeconds))
      : null;
    const result = await this.database
      .prepare(
        `UPDATE telegram_outbound SET
           status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = ?
         WHERE id = ? AND status = 'claimed'`,
      )
      .bind(summary, nextAttemptAt, asOf, outboundId)
      .run();

    if (result.meta.changes !== 1) {
      throw new ValidationError(`Telegram outbound '${outboundId}' is not claimed`);
    }

    return this.getById(outboundId);
  }
}
