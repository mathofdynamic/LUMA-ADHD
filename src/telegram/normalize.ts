import type {
  TelegramMessage,
  TelegramMessageEntity,
  TelegramPhotoSize,
  TelegramUpdate,
  TelegramImageAttachmentMetadata,
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

function readPhotoSizes(value: unknown, fieldName: string): readonly TelegramPhotoSize[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TelegramUpdateValidationError(`${fieldName} must be an array`);
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new TelegramUpdateValidationError(`${fieldName}[${index}] must be an object`);
    }
    const fileId = item.file_id;
    const fileUniqueId = item.file_unique_id;
    const width = item.width;
    const height = item.height;
    const fileSize = item.file_size;
    if (
      typeof fileId !== "string" || fileId.trim().length === 0 || fileId.length > 256 ||
      typeof fileUniqueId !== "string" || fileUniqueId.trim().length === 0 || fileUniqueId.length > 256 ||
      typeof width !== "number" || !Number.isSafeInteger(width) || width < 1 || width > 20_000 ||
      typeof height !== "number" || !Number.isSafeInteger(height) || height < 1 || height > 20_000 ||
      (fileSize !== undefined && (typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize < 0))
    ) {
      throw new TelegramUpdateValidationError(`${fieldName}[${index}] has invalid photo metadata`);
    }
    return {
      file_id: fileId,
      file_unique_id: fileUniqueId,
      width,
      height,
      ...(fileSize === undefined ? {} : { file_size: fileSize }),
    };
  });
}

function readDocument(value: unknown, fieldName: string): TelegramMessage["document"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TelegramUpdateValidationError(`${fieldName} must be an object`);
  }
  const fileId = value.file_id;
  const fileUniqueId = value.file_unique_id;
  const fileName = value.file_name;
  const mimeType = value.mime_type;
  const fileSize = value.file_size;
  if (
    typeof fileId !== "string" || fileId.trim().length === 0 || fileId.length > 256 ||
    typeof fileUniqueId !== "string" || fileUniqueId.trim().length === 0 || fileUniqueId.length > 256 ||
    (fileName !== undefined && (typeof fileName !== "string" || fileName.length > 512)) ||
    (mimeType !== undefined && (typeof mimeType !== "string" || mimeType.length > 128)) ||
    (fileSize !== undefined && (typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize < 0))
  ) {
    throw new TelegramUpdateValidationError(`${fieldName} has invalid document metadata`);
  }
  return {
    file_id: fileId,
    file_unique_id: fileUniqueId,
    ...(fileName === undefined ? {} : { file_name: fileName }),
    ...(mimeType === undefined ? {} : { mime_type: mimeType }),
    ...(fileSize === undefined ? {} : { file_size: fileSize }),
  };
}

function imageAttachment(
  photo: readonly TelegramPhotoSize[] | undefined,
  document: TelegramMessage["document"],
): TelegramImageAttachmentMetadata | undefined {
  if (photo && photo.length > 0) {
    const largest = [...photo].sort((left, right) => {
      const areaDifference = right.width * right.height - left.width * left.height;
      return areaDifference !== 0 ? areaDifference : (right.file_size ?? 0) - (left.file_size ?? 0);
    })[0];
    if (!largest) return undefined;
    return {
      type: "image",
      source: "photo",
      telegramFileId: largest.file_id,
      telegramFileUniqueId: largest.file_unique_id,
      width: largest.width,
      height: largest.height,
      ...(largest.file_size === undefined ? {} : { fileSize: largest.file_size }),
    };
  }
  if (document && document.mime_type?.toLowerCase().startsWith("image/")) {
    return {
      type: "image",
      source: "document",
      telegramFileId: document.file_id,
      telegramFileUniqueId: document.file_unique_id,
      ...(document.mime_type === undefined ? {} : { mimeType: document.mime_type }),
      ...(document.file_size === undefined ? {} : { fileSize: document.file_size }),
      ...(document.file_name === undefined ? {} : { fileName: document.file_name }),
    };
  }
  return undefined;
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
  if (value.caption !== undefined && typeof value.caption !== "string") {
    throw new TelegramUpdateValidationError(`${fieldName}.caption must be a string`);
  }
  if (typeof value.date !== "number" || !Number.isFinite(value.date)) {
    throw new TelegramUpdateValidationError(`${fieldName}.date must be a finite number`);
  }

  const replyTo = readMessage(value.reply_to_message, `${fieldName}.reply_to_message`);
  const photo = readPhotoSizes(value.photo, `${fieldName}.photo`);
  const document = readDocument(value.document, `${fieldName}.document`);
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
    caption: value.caption,
    caption_entities: readEntities(value.caption_entities, `${fieldName}.caption_entities`),
    entities: readEntities(value.entities, `${fieldName}.entities`),
    photo,
    document,
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
  if (!message) {
    return null;
  }

  const attachment = imageAttachment(message.photo, message.document);
  const text = message.text ?? message.caption ?? "";
  if (text.trim().length === 0 && attachment === undefined) return null;

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
    text,
    entities: message.entities && message.entities.length > 0
      ? message.entities
      : message.caption_entities ?? [],
    ...(attachment === undefined ? {} : { attachment }),
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
