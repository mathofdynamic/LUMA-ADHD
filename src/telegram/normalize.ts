import type {
  TelegramMessage,
  TelegramMessageEntity,
  TelegramUpdate,
  NormalizedTelegramUpdate,
} from "./types";

export class TelegramUpdateValidationError extends Error {
  constructor(message: string) {
    super(`Invalid Telegram update: ${message}`);
    this.name = "TelegramUpdateValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTelegramId(value: unknown, fieldName: string): string {
  if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }

  throw new TelegramUpdateValidationError(`${fieldName} must be a safe Telegram identifier`);
}

function readUser(value: unknown, fieldName: string): TelegramMessage["from"] {
  if (!isRecord(value)) {
    throw new TelegramUpdateValidationError(`${fieldName} must be an object`);
  }

  const firstName = value.first_name;
  if (typeof firstName !== "string" || firstName.trim().length === 0) {
    throw new TelegramUpdateValidationError(`${fieldName}.first_name must be a non-empty string`);
  }
  if (typeof value.is_bot !== "boolean") {
    throw new TelegramUpdateValidationError(`${fieldName}.is_bot must be boolean`);
  }

  const lastName = value.last_name;
  const username = value.username;
  if (lastName !== undefined && typeof lastName !== "string") {
    throw new TelegramUpdateValidationError(`${fieldName}.last_name must be a string`);
  }
  if (username !== undefined && typeof username !== "string") {
    throw new TelegramUpdateValidationError(`${fieldName}.username must be a string`);
  }

  return {
    id: readTelegramId(value.id, `${fieldName}.id`),
    is_bot: value.is_bot,
    first_name: firstName,
    last_name: lastName,
    username,
  };
}

function readChat(value: unknown, fieldName: string): TelegramMessage["chat"] {
  if (!isRecord(value)) {
    throw new TelegramUpdateValidationError(`${fieldName} must be an object`);
  }

  const type = value.type;
  if (type !== "private" && type !== "group" && type !== "supergroup" && type !== "channel") {
    throw new TelegramUpdateValidationError(`${fieldName}.type is unsupported`);
  }

  const title = value.title;
  const username = value.username;
  if (title !== undefined && typeof title !== "string") {
    throw new TelegramUpdateValidationError(`${fieldName}.title must be a string`);
  }
  if (username !== undefined && typeof username !== "string") {
    throw new TelegramUpdateValidationError(`${fieldName}.username must be a string`);
  }

  return {
    id: readTelegramId(value.id, `${fieldName}.id`),
    type,
    title,
    username,
  };
}

function readEntities(value: unknown, fieldName: string): readonly TelegramMessageEntity[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TelegramUpdateValidationError(`${fieldName} must be an array`);
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new TelegramUpdateValidationError(`${fieldName}[${index}] must be an object`);
    }
    if (
      typeof item.type !== "string" ||
      typeof item.offset !== "number" ||
      typeof item.length !== "number" ||
      !Number.isInteger(item.offset) ||
      !Number.isInteger(item.length) ||
      item.offset < 0 ||
      item.length < 0
    ) {
      throw new TelegramUpdateValidationError(`${fieldName}[${index}] has invalid offsets`);
    }

    return {
      type: item.type,
      offset: item.offset,
      length: item.length,
      user: item.user === undefined ? undefined : readUser(item.user, `${fieldName}[${index}].user`),
    };
  });
}

function readMessage(value: unknown, fieldName: string): TelegramMessage | null {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    throw new TelegramUpdateValidationError(`${fieldName} must be an object`);
  }
  if (value.text !== undefined && typeof value.text !== "string") {
    throw new TelegramUpdateValidationError(`${fieldName}.text must be a string`);
  }
  if (typeof value.date !== "number" || !Number.isFinite(value.date)) {
    throw new TelegramUpdateValidationError(`${fieldName}.date must be a finite number`);
  }

  const replyTo = readMessage(value.reply_to_message, `${fieldName}.reply_to_message`);
  const messageThreadId = value.message_thread_id;
  if (
    messageThreadId !== undefined &&
    !(typeof messageThreadId === "number" && Number.isSafeInteger(messageThreadId)) &&
    !(typeof messageThreadId === "string" && /^\d+$/u.test(messageThreadId))
  ) {
    throw new TelegramUpdateValidationError(`${fieldName}.message_thread_id must be an integer`);
  }

  return {
    message_id: readTelegramId(value.message_id, `${fieldName}.message_id`),
    from: value.from === undefined ? undefined : readUser(value.from, `${fieldName}.from`),
    chat: readChat(value.chat, `${fieldName}.chat`),
    date: value.date,
    text: value.text,
    entities: readEntities(value.entities, `${fieldName}.entities`),
    reply_to_message: replyTo ?? undefined,
    message_thread_id: messageThreadId === undefined ? undefined : String(messageThreadId),
  };
}

export function normalizeTelegramUpdate(
  payload: unknown,
): NormalizedTelegramUpdate | null {
  if (!isRecord(payload)) {
    throw new TelegramUpdateValidationError("payload must be an object");
  }

  const update: TelegramUpdate = {
    update_id: readTelegramId(payload.update_id, "update_id"),
    message: readMessage(payload.message, "message") ?? undefined,
    edited_message: readMessage(payload.edited_message, "edited_message") ?? undefined,
    channel_post: readMessage(payload.channel_post, "channel_post") ?? undefined,
    edited_channel_post: readMessage(payload.edited_channel_post, "edited_channel_post") ?? undefined,
  };

  const message = update.message;
  if (!message || message.text === undefined || message.text.trim().length === 0) {
    return null;
  }

  const sender = message.from;
  if (!sender) {
    return null;
  }

  const reply = message.reply_to_message;
  return {
    updateId: String(update.update_id),
    messageId: String(message.message_id),
    chat: {
      id: String(message.chat.id),
      type: message.chat.type,
      title: message.chat.title,
    },
    sender: {
      id: String(sender.id),
      isBot: sender.is_bot,
      displayName: [sender.first_name, sender.last_name].filter(Boolean).join(" "),
      username: sender.username,
    },
    text: message.text,
    entities: message.entities ?? [],
    replyTo: reply
      ? {
          telegramChatId: String(reply.chat.id),
          telegramMessageId: String(reply.message_id),
          senderTelegramUserId: reply.from === undefined ? undefined : String(reply.from.id),
          senderUsername: reply.from?.username,
        }
      : undefined,
    topicId: message.message_thread_id === undefined ? undefined : String(message.message_thread_id),
  };
}
