import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toBoolean, toJsonObject, toNullableString } from "../rows";
import { encodeObject, requireNonEmpty } from "../validation";
import type {
  ChatRecord,
  CreateChatInput,
  CreateUserInput,
  UserRecord,
} from "../types";

interface UserRow {
  id: string;
  external_key: string | null;
  display_name: string;
  username: string | null;
  is_admin: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ChatRow {
  id: string;
  telegram_chat_id: string | null;
  chat_type: ChatRecord["chatType"];
  title: string | null;
  is_workspace: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    externalKey: toNullableString(row.external_key),
    displayName: row.display_name,
    username: toNullableString(row.username),
    isAdmin: toBoolean(row.is_admin),
    metadata: toJsonObject(row.metadata_json, "users.metadata_json"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: toNullableString(row.deleted_at),
  };
}

function mapChat(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    telegramChatId: toNullableString(row.telegram_chat_id),
    chatType: row.chat_type,
    title: toNullableString(row.title),
    isWorkspace: toBoolean(row.is_workspace),
    metadata: toJsonObject(row.metadata_json, "chats.metadata_json"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: toNullableString(row.deleted_at),
  };
}

export interface TelegramIdentityInput {
  readonly id?: string;
  readonly userId?: string;
  readonly agentId?: string;
  readonly telegramUserId: string;
  readonly botAlias?: string;
  readonly username?: string;
  readonly isBot?: boolean;
  readonly isPrimary?: boolean;
  readonly metadata?: import("../validation").JsonObject;
}

export class UserRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateUserInput): Promise<UserRecord> {
    const id = input.id ?? createId("user");
    const displayName = requireNonEmpty(input.displayName, "user.displayName");
    const timestamp = nowIso();

    await this.database
      .prepare(
        `INSERT INTO users (
          id, external_key, display_name, username, is_admin, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.externalKey ?? null,
        displayName,
        input.username ?? null,
        input.isAdmin === true ? 1 : 0,
        encodeObject(input.metadata, "user.metadata"),
        timestamp,
        timestamp,
      )
      .run();

    return this.getById(id);
  }

  async getById(id: string): Promise<UserRecord> {
    const row = await this.database
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(id)
      .first<UserRow>();

    if (!row) {
      throw new NotFoundError("user", id);
    }

    return mapUser(row);
  }

  async findByExternalKey(externalKey: string): Promise<UserRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM users WHERE external_key = ? AND deleted_at IS NULL")
      .bind(externalKey)
      .first<UserRow>();

    return row ? mapUser(row) : null;
  }
}

export class ChatRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateChatInput): Promise<ChatRecord> {
    const id = input.id ?? createId("chat");
    const timestamp = nowIso();

    await this.database
      .prepare(
        `INSERT INTO chats (
          id, telegram_chat_id, chat_type, title, is_workspace, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.telegramChatId ?? null,
        input.chatType,
        input.title ?? null,
        input.isWorkspace === true ? 1 : 0,
        encodeObject(input.metadata, "chat.metadata"),
        timestamp,
        timestamp,
      )
      .run();

    return this.getById(id);
  }

  async getById(id: string): Promise<ChatRecord> {
    const row = await this.database
      .prepare("SELECT * FROM chats WHERE id = ?")
      .bind(id)
      .first<ChatRow>();

    if (!row) {
      throw new NotFoundError("chat", id);
    }

    return mapChat(row);
  }

  async findByTelegramId(telegramChatId: string): Promise<ChatRecord | null> {
    const row = await this.database
      .prepare("SELECT * FROM chats WHERE telegram_chat_id = ? AND deleted_at IS NULL")
      .bind(telegramChatId)
      .first<ChatRow>();

    return row ? mapChat(row) : null;
  }
}

export class TelegramIdentityRepository {
  constructor(private readonly database: DatabaseClient) {}

  async upsert(input: TelegramIdentityInput): Promise<string> {
    const hasUser = input.userId !== undefined;
    const hasAgent = input.agentId !== undefined;
    if (hasUser === hasAgent) {
      throw new ValidationError("telegram identity must reference exactly one user or agent");
    }

    const telegramUserId = requireNonEmpty(input.telegramUserId, "telegramIdentity.telegramUserId");
    const botAlias = input.botAlias ?? "";
    const id = input.id ?? createId("telegram-identity");
    const timestamp = nowIso();

    await this.database
      .prepare(
        `INSERT INTO telegram_identities (
          id, user_id, agent_id, telegram_user_id, bot_alias, username,
          is_bot, is_primary, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (telegram_user_id, bot_alias) DO UPDATE SET
          user_id = excluded.user_id,
          agent_id = excluded.agent_id,
          username = excluded.username,
          is_bot = excluded.is_bot,
          is_primary = excluded.is_primary,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          deleted_at = NULL`,
      )
      .bind(
        id,
        input.userId ?? null,
        input.agentId ?? null,
        telegramUserId,
        botAlias,
        input.username ?? null,
        input.isBot === true ? 1 : 0,
        input.isPrimary === true ? 1 : 0,
        encodeObject(input.metadata, "telegramIdentity.metadata"),
        timestamp,
        timestamp,
      )
      .run();

    const row = await this.database
      .prepare("SELECT id FROM telegram_identities WHERE telegram_user_id = ? AND bot_alias = ?")
      .bind(telegramUserId, botAlias)
      .first<{ id: string }>();

    if (!row) {
      throw new NotFoundError("telegram identity", `${telegramUserId}:${botAlias}`);
    }

    return row.id;
  }
}
