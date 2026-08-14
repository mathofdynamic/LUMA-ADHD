import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString } from "../rows";
import { encodeObject, requireLimit, requireNonEmpty } from "../validation";
import type {
  CreateMessageInput,
  MessageRecord,
} from "../types";

interface MessageRow {
  id: string;
  thread_id: string;
  chat_id: string | null;
  author_type: MessageRecord["authorType"];
  author_user_id: string | null;
  author_agent_id: string | null;
  content_text: string;
  reply_to_message_id: string | null;
  visibility: MessageRecord["visibility"];
  origin: MessageRecord["origin"];
  telegram_chat_id: string | null;
  telegram_message_id: string | null;
  telegram_bot_alias: string | null;
  telegram_update_id: string | null;
  idempotency_key: string | null;
  metadata_json: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    chatId: toNullableString(row.chat_id),
    authorType: row.author_type,
    authorUserId: toNullableString(row.author_user_id),
    authorAgentId: toNullableString(row.author_agent_id),
    contentText: row.content_text,
    replyToMessageId: toNullableString(row.reply_to_message_id),
    visibility: row.visibility,
    origin: row.origin,
    telegramChatId: toNullableString(row.telegram_chat_id),
    telegramMessageId: toNullableString(row.telegram_message_id),
    telegramBotAlias: toNullableString(row.telegram_bot_alias),
    telegramUpdateId: toNullableString(row.telegram_update_id),
    idempotencyKey: toNullableString(row.idempotency_key),
    metadata: toJsonObject(row.metadata_json, "messages.metadata_json"),
    createdAt: row.created_at,
    editedAt: toNullableString(row.edited_at),
    deletedAt: toNullableString(row.deleted_at),
  };
}

export class MessageRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateMessageInput): Promise<MessageRecord> {
    const id = input.id ?? createId("message");
    const contentText = requireNonEmpty(input.contentText, "message.contentText");
    const hasUser = input.authorUserId !== undefined;
    const hasAgent = input.authorAgentId !== undefined;

    if (input.authorType === "human" && (!hasUser || hasAgent)) {
      throw new ValidationError("human messages require only authorUserId");
    }

    if (input.authorType === "agent" && (!hasAgent || hasUser)) {
      throw new ValidationError("agent messages require only authorAgentId");
    }

    if (input.authorType === "system" && (hasUser || hasAgent)) {
      throw new ValidationError("system messages cannot include an author id");
    }

    if (
      (input.telegramMessageId === undefined) !==
      (input.telegramChatId === undefined)
    ) {
      throw new ValidationError("Telegram message and chat ids must be supplied together");
    }

    const idempotencyKey = input.idempotencyKey ?? (
      input.telegramUpdateId === undefined
        ? null
        : `telegram-message:${input.telegramBotAlias ?? "unknown"}:${input.telegramUpdateId}`
    );
    const timestamp = nowIso();

    await this.database
      .prepare(
        `INSERT INTO messages (
          id, thread_id, chat_id, author_type, author_user_id, author_agent_id,
          content_text, reply_to_message_id, visibility, origin,
          telegram_chat_id, telegram_message_id, telegram_bot_alias,
          telegram_update_id, idempotency_key, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(
        id,
        input.threadId,
        input.chatId ?? null,
        input.authorType,
        input.authorUserId ?? null,
        input.authorAgentId ?? null,
        contentText,
        input.replyToMessageId ?? null,
        input.visibility ?? "public",
        input.origin ?? "internal",
        input.telegramChatId ?? null,
        input.telegramMessageId ?? null,
        input.telegramBotAlias ?? null,
        input.telegramUpdateId ?? null,
        idempotencyKey,
        encodeObject(input.metadata, "message.metadata"),
        timestamp,
      )
      .run();

    return idempotencyKey === null
      ? this.getById(id)
      : this.getByIdempotencyKey(idempotencyKey);
  }

  async getById(id: string): Promise<MessageRecord> {
    const row = await this.database
      .prepare("SELECT * FROM messages WHERE id = ?")
      .bind(id)
      .first<MessageRow>();

    if (!row) {
      throw new NotFoundError("message", id);
    }

    return mapMessage(row);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<MessageRecord> {
    const row = await this.database
      .prepare("SELECT * FROM messages WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<MessageRow>();

    if (!row) {
      throw new NotFoundError("message idempotency key", idempotencyKey);
    }

    return mapMessage(row);
  }

  async listRecentByThread(threadId: string, limit = 30): Promise<readonly MessageRecord[]> {
    const safeLimit = requireLimit(limit, "message list limit", 200);
    const result = await this.database
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE thread_id = ? AND deleted_at IS NULL
           ORDER BY created_at DESC, id DESC
           LIMIT ?
         ) recent
         ORDER BY created_at ASC, id ASC`,
      )
      .bind(threadId, safeLimit)
      .all<MessageRow>();

    return result.results.map(mapMessage);
  }

  async softDelete(id: string): Promise<void> {
    const result = await this.database
      .prepare(
        `UPDATE messages
         SET deleted_at = COALESCE(deleted_at, ?), edited_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(nowIso(), nowIso(), id)
      .run();

    if (result.meta.changes !== 1) {
      throw new NotFoundError("message", id);
    }
  }
}
