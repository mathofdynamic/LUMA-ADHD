import { getTelegramBot, type TelegramConfig } from "./config";
import { TELEGRAM_PARSE_MODE } from "./format";
import {
  TelegramTransportError,
  type TelegramSendTextInput,
  type TelegramSentMessage,
  type TelegramTransport,
} from "./types";

interface TelegramApiResponse {
  readonly ok?: unknown;
  readonly result?: unknown;
  readonly error_code?: unknown;
  readonly description?: unknown;
  readonly parameters?: unknown;
}

interface TelegramApiMessage {
  readonly message_id?: unknown;
  readonly chat?: { readonly id?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function readTelegramResponse(response: Response): Promise<TelegramApiResponse> {
  const body = await response.text();
  if (body.length > 65536) {
    throw new TelegramTransportError("retryable_transport", "Telegram response exceeded the bounded response size");
  }

  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) {
      throw new Error("response is not an object");
    }
    return parsed;
  } catch (error: unknown) {
    throw new TelegramTransportError(
      response.status >= 500 ? "retryable_transport" : "permanent_rejection",
      `Telegram returned invalid JSON: ${String(error)}`,
      { errorCode: response.status },
    );
  }
}

export class TelegramBotApiTransport implements TelegramTransport {
  readonly requiresBotToken = true;
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly config: TelegramConfig,
    fetcher: typeof fetch = fetch,
  ) {
    // Cloudflare's global fetch requires its global receiver. Calling it as
    // a class property otherwise produces an Illegal invocation error.
    this.fetcher = fetcher.bind(globalThis);
  }

  async sendTextMessage(input: TelegramSendTextInput): Promise<TelegramSentMessage> {
    const bot = getTelegramBot(this.config, input.botAlias);
    if (!bot?.token) {
      throw new TelegramTransportError(
        "invalid_configuration",
        `No token is configured for Telegram bot '${input.botAlias}'`,
      );
    }

    const payload: Record<string, unknown> = {
      chat_id: input.telegramChatId,
      text: input.text,
      parse_mode: TELEGRAM_PARSE_MODE,
      link_preview_options: { is_disabled: true },
    };
    if (input.replyToTelegramMessageId !== undefined) {
      payload.reply_parameters = {
        message_id: input.replyToTelegramMessageId,
        allow_sending_without_reply: false,
      };
    }

    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.telegram.org/bot${bot.token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
    } catch (error: unknown) {
      throw new TelegramTransportError("retryable_transport", `Telegram transport failed: ${String(error)}`);
    }

    const parsed = await readTelegramResponse(response);
    const errorCode = numericValue(parsed.error_code);
    const parameters = isRecord(parsed.parameters) ? parsed.parameters : undefined;
    const retryAfterSeconds = numericValue(parameters?.retry_after);

    if (!response.ok || parsed.ok !== true) {
      const description = stringValue(parsed.description) ?? `Telegram HTTP ${response.status}`;
      if (response.status === 429 || errorCode === 429) {
        throw new TelegramTransportError("rate_limited", description, {
          retryAfterSeconds,
          errorCode,
        });
      }
      if (response.status >= 500 || response.status === 408 || response.status === 425) {
        throw new TelegramTransportError("retryable_transport", description, {
          retryAfterSeconds,
          errorCode,
        });
      }
      throw new TelegramTransportError(
        response.status === 401 || response.status === 403
          ? "invalid_configuration"
          : "permanent_rejection",
        description,
        { errorCode },
      );
    }

    if (!isRecord(parsed.result)) {
      throw new TelegramTransportError("permanent_rejection", "Telegram response omitted the sent message");
    }

    const result = parsed.result as TelegramApiMessage;
    const telegramMessageId = result.message_id;
    const chatId = result.chat?.id;
    if (
      (typeof telegramMessageId !== "number" && typeof telegramMessageId !== "string") ||
      (typeof chatId !== "number" && typeof chatId !== "string")
    ) {
      throw new TelegramTransportError("permanent_rejection", "Telegram response contained invalid message identifiers");
    }

    return {
      telegramMessageId: String(telegramMessageId),
      telegramChatId: String(chatId),
    };
  }
}
