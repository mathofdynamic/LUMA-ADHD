import type { D1Database } from "@cloudflare/workers-types";

import { jsonResponse, methodNotAllowed } from "../src/api/http";
import { createRepositories } from "../src/database/repositories";
import { TelegramConfigurationError, parseTelegramConfig } from "../src/telegram/config";
import { createTelegramApplication } from "../src/telegram/index";
import { TelegramBotApiTransport } from "../src/telegram/transport";
import { TelegramTransportError, type TelegramTransport } from "../src/telegram/types";

interface SmokeEnvironment {
  readonly DB: D1Database;
  readonly SMOKE_SECRET: string;
  readonly TELEGRAM_GROUP_ID: string;
  readonly TELEGRAM_ADMIN_USER_IDS: string;
  readonly TELEGRAM_BOT_IDENTITIES_JSON: string;
  readonly TELEGRAM_WEBHOOK_SECRET: string;
  readonly TELEGRAM_PRODUCT_BOT_TOKEN?: string;
  readonly TELEGRAM_HERETIC_BOT_TOKEN?: string;
}

interface SmokeRequest {
  readonly agentId?: unknown;
  readonly contentText?: unknown;
  readonly idempotencyKey?: unknown;
  readonly threadId?: unknown;
  readonly simulateFailure?: unknown;
}

interface ParsedSmokeRequest {
  readonly agentId: "agent-product" | "agent-heretic";
  readonly contentText: string;
  readonly idempotencyKey: string;
  readonly threadId?: string;
  readonly simulateFailure: boolean;
}

const MAX_BODY_BYTES = 32_768;
const ALLOWED_AGENT_IDS = new Set(["agent-product", "agent-heretic"]);

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSmokeRequest(value: unknown): ParsedSmokeRequest {
  if (!isRecord(value)) {
    throw new Error("request body must be an object");
  }

  const agentId = value.agentId;
  const contentText = value.contentText;
  const idempotencyKey = value.idempotencyKey;
  const threadId = value.threadId;
  const simulateFailure = value.simulateFailure;
  if (
    typeof agentId !== "string" ||
    !ALLOWED_AGENT_IDS.has(agentId) ||
    typeof contentText !== "string" ||
    contentText.length === 0 ||
    Array.from(contentText).length > 20_000 ||
    typeof idempotencyKey !== "string" ||
    !/^phase02-live-[a-z0-9-]{8,80}$/u.test(idempotencyKey)
  ) {
    throw new Error("agentId, contentText, or idempotencyKey is invalid");
  }
  if (threadId !== undefined && typeof threadId !== "string") {
    throw new Error("threadId must be a string when provided");
  }
  if (simulateFailure !== undefined && typeof simulateFailure !== "boolean") {
    throw new Error("simulateFailure must be a boolean when provided");
  }

  return {
    agentId: agentId as ParsedSmokeRequest["agentId"],
    contentText,
    idempotencyKey,
    ...(typeof threadId === "string" ? { threadId } : {}),
    simulateFailure: simulateFailure === true,
  };
}

class ControlledFailureTransport implements TelegramTransport {
  async sendTextMessage(): Promise<never> {
    throw new TelegramTransportError(
      "rate_limited",
      "Phase 02 controlled failure",
      { retryAfterSeconds: 30, errorCode: 429 },
    );
  }
}

export default {
  async fetch(request: Request, env: SmokeEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__luma_smoke/ready") {
      return request.method === "GET"
        ? jsonResponse({ ok: true })
        : methodNotAllowed();
    }
    if (url.pathname !== "/__luma_smoke/project") {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }
    if (request.method !== "POST") {
      return methodNotAllowed();
    }

    const suppliedSecret = request.headers.get("X-Luma-Smoke-Secret");
    if (
      suppliedSecret === null ||
      !constantTimeEqual(suppliedSecret, env.SMOKE_SECRET)
    ) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "request_body_too_large" }, 413);
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "request_body_too_large" }, 413);
    }

    let input: ReturnType<typeof readSmokeRequest>;
    try {
      input = readSmokeRequest(JSON.parse(body));
    } catch {
      return jsonResponse({ ok: false, error: "invalid_smoke_request" }, 400);
    }

    try {
      const config = parseTelegramConfig(env);
      const repositories = createRepositories(env.DB);
      const chat = config.groupId === null
        ? null
        : await repositories.chats.findByTelegramId(config.groupId);
      if (chat === null) {
        return jsonResponse({ ok: false, error: "telegram_workspace_not_initialized" }, 409);
      }

      const thread = input.threadId === undefined
        ? await repositories.threads.findMostRecentActiveByChat(chat.id)
        : await repositories.threads.getById(input.threadId);
      if (thread === null || thread.chatId !== chat.id) {
        return jsonResponse({ ok: false, error: "active_workspace_thread_not_found" }, 409);
      }

      const application = createTelegramApplication({
        repositories,
        config,
        transport: input.simulateFailure
          ? new ControlledFailureTransport()
          : new TelegramBotApiTransport(config),
      });
      const result = await application.projectAgentMessage({
        threadId: thread.id,
        chatId: chat.id,
        agentId: input.agentId,
        contentText: input.contentText,
        idempotencyKey: input.idempotencyKey,
        metadata: { source: "phase02_local_smoke" },
      });

      return jsonResponse({ ok: true, ...result });
    } catch (error: unknown) {
      if (error instanceof TelegramConfigurationError) {
        return jsonResponse({ ok: false, error: "telegram_not_configured" }, 503);
      }
      return jsonResponse({ ok: false, error: "smoke_execution_failed" }, 500);
    }
  },
};
