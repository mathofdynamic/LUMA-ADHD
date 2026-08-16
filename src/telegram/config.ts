import { ValidationError } from "../database/errors";

export const TELEGRAM_BOT_ALIASES = [
  "gateway",
  "product",
  "growth",
  "creative",
  "technical",
  "finance",
  "customer",
  "operations",
  "heretic",
] as const;

export type TelegramBotAlias = typeof TELEGRAM_BOT_ALIASES[number];

const TOKEN_KEY_BY_ALIAS: Readonly<Record<TelegramBotAlias, string>> = {
  gateway: "TELEGRAM_GATEWAY_BOT_TOKEN",
  product: "TELEGRAM_PRODUCT_BOT_TOKEN",
  growth: "TELEGRAM_GROWTH_BOT_TOKEN",
  creative: "TELEGRAM_CREATIVE_BOT_TOKEN",
  technical: "TELEGRAM_TECH_BOT_TOKEN",
  finance: "TELEGRAM_FINANCE_BOT_TOKEN",
  customer: "TELEGRAM_CUSTOMER_BOT_TOKEN",
  operations: "TELEGRAM_OPERATIONS_BOT_TOKEN",
  heretic: "TELEGRAM_HERETIC_BOT_TOKEN",
};

const AGENT_ID_BY_ALIAS: Readonly<Record<TelegramBotAlias, string | null>> = {
  gateway: null,
  product: "agent-product",
  growth: "agent-growth",
  creative: "agent-creative",
  technical: "agent-technical",
  finance: "agent-finance",
  customer: "agent-customer",
  operations: "agent-operations",
  heretic: "agent-heretic",
};

export interface TelegramBotIdentityConfig {
  readonly alias: TelegramBotAlias;
  readonly agentId: string | null;
  readonly token: string | null;
  readonly telegramUserId: string | null;
  readonly username: string | null;
}

export interface TelegramConfig {
  readonly groupId: string | null;
  readonly adminUserIds: ReadonlySet<string>;
  readonly webhookSecret: string | null;
  readonly bots: ReadonlyMap<TelegramBotAlias, TelegramBotIdentityConfig>;
  readonly webhookReady: boolean;
}

export class TelegramConfigurationError extends ValidationError {
  constructor(message: string) {
    super(`Telegram configuration: ${message}`);
    this.name = "TelegramConfigurationError";
  }
}

function readValue(source: object, key: string): unknown {
  const values = source as Record<string, unknown>;
  return values[key];
}

function readString(source: object, key: string): string | null {
  const value = readValue(source, key);
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TelegramConfigurationError(`${key} must be a string`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumericIdentifier(value: string | null, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  if (!/^-?\d+$/.test(value)) {
    throw new TelegramConfigurationError(`${fieldName} must be a Telegram numeric identifier`);
  }

  return value;
}

function parseAdminIds(value: string | null): ReadonlySet<string> {
  if (value === null) {
    return new Set<string>();
  }

  return new Set(
    value
      .split(/[\s,]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => normalizeNumericIdentifier(item, "TELEGRAM_ADMIN_USER_IDS") as string),
  );
}

interface RawIdentityValue {
  readonly telegramUserId?: unknown;
  readonly username?: unknown;
}

function parseBotIdentities(value: string | null): ReadonlyMap<TelegramBotAlias, RawIdentityValue> {
  if (value === null) {
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error: unknown) {
    throw new TelegramConfigurationError(`TELEGRAM_BOT_IDENTITIES_JSON is invalid JSON: ${String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_IDENTITIES_JSON must be a JSON object");
  }

  const result = new Map<TelegramBotAlias, RawIdentityValue>();
  const values = parsed as Record<string, unknown>;
  for (const alias of TELEGRAM_BOT_ALIASES) {
    const raw = values[alias];
    if (raw === undefined) {
      continue;
    }

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new TelegramConfigurationError(`bot identity '${alias}' must be an object`);
    }

    const identity = raw as RawIdentityValue;
    if (identity.telegramUserId !== undefined && typeof identity.telegramUserId !== "string") {
      throw new TelegramConfigurationError(`bot identity '${alias}'.telegramUserId must be a string`);
    }
    if (identity.username !== undefined && typeof identity.username !== "string") {
      throw new TelegramConfigurationError(`bot identity '${alias}'.username must be a string`);
    }

    result.set(alias, identity);
  }

  return result;
}

function normalizeUsername(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new TelegramConfigurationError(`${fieldName} must be a string`);
  }

  const normalized = value.trim().replace(/^@/u, "").toLowerCase();
  if (normalized.length === 0) {
    return null;
  }
  if (!/^[a-z0-9_]{5,32}$/u.test(normalized)) {
    throw new TelegramConfigurationError(`${fieldName} must be a Telegram username without @`);
  }

  return normalized;
}

export function parseTelegramConfig(source: object): TelegramConfig {
  const identities = parseBotIdentities(readString(source, "TELEGRAM_BOT_IDENTITIES_JSON"));
  const bots = new Map<TelegramBotAlias, TelegramBotIdentityConfig>();

  for (const alias of TELEGRAM_BOT_ALIASES) {
    const identity = identities.get(alias);
    const token = readString(source, TOKEN_KEY_BY_ALIAS[alias]);
    bots.set(alias, {
      alias,
      agentId: AGENT_ID_BY_ALIAS[alias],
      token,
      telegramUserId: normalizeNumericIdentifier(
        typeof identity?.telegramUserId === "string" ? identity.telegramUserId.trim() || null : null,
        `bot identity '${alias}'.telegramUserId`,
      ),
      username: normalizeUsername(identity?.username, `bot identity '${alias}'.username`),
    });
  }

  const groupId = normalizeNumericIdentifier(readString(source, "TELEGRAM_GROUP_ID"), "TELEGRAM_GROUP_ID");
  const webhookSecret = readString(source, "TELEGRAM_WEBHOOK_SECRET");
  if (webhookSecret !== null && !/^[A-Za-z0-9_-]{1,256}$/u.test(webhookSecret)) {
    throw new TelegramConfigurationError(
      "TELEGRAM_WEBHOOK_SECRET must use Telegram's allowed 1-256 character format",
    );
  }

  return {
    groupId,
    adminUserIds: parseAdminIds(readString(source, "TELEGRAM_ADMIN_USER_IDS")),
    webhookSecret,
    bots,
    webhookReady: groupId !== null && webhookSecret !== null,
  };
}

export function getTelegramBot(
  config: TelegramConfig,
  alias: string,
): TelegramBotIdentityConfig | null {
  return (TELEGRAM_BOT_ALIASES as readonly string[]).includes(alias)
    ? config.bots.get(alias as TelegramBotAlias) ?? null
    : null;
}

export function findTelegramBotForAgent(
  config: TelegramConfig,
  agentId: string,
): TelegramBotIdentityConfig | null {
  for (const bot of config.bots.values()) {
    if (bot.agentId === agentId) {
      return bot;
    }
  }

  return null;
}

export function resolveConfiguredAgent(
  config: TelegramConfig,
  identity: { readonly telegramUserId?: string; readonly username?: string },
): string | null {
  const telegramUserId = identity.telegramUserId;
  const username = identity.username?.replace(/^@/u, "").toLowerCase();

  for (const bot of config.bots.values()) {
    if (
      (telegramUserId !== undefined && bot.telegramUserId === telegramUserId) ||
      (username !== undefined && bot.username === username)
    ) {
      return bot.agentId;
    }
  }

  return null;
}

export function tokenKeyForBot(alias: TelegramBotAlias): string {
  return TOKEN_KEY_BY_ALIAS[alias];
}
