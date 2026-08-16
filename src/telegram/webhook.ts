import type { D1Database } from "@cloudflare/workers-types";

import { jsonResponse, methodNotAllowed } from "../api/http";
import { createRepositories } from "../database/repositories";
import { TelegramConfigurationError, getTelegramBot, parseTelegramConfig } from "./config";
import { createTelegramApplication, webhookPath } from "./index";
import { TelegramUpdateValidationError } from "./normalize";

const MAX_WEBHOOK_BODY_BYTES = 262_144;

type TelegramSecretName =
  | "TELEGRAM_WEBHOOK_SECRET"
  | "TELEGRAM_GATEWAY_BOT_TOKEN"
  | "TELEGRAM_PRODUCT_BOT_TOKEN"
  | "TELEGRAM_GROWTH_BOT_TOKEN"
  | "TELEGRAM_CREATIVE_BOT_TOKEN"
  | "TELEGRAM_TECH_BOT_TOKEN"
  | "TELEGRAM_FINANCE_BOT_TOKEN"
  | "TELEGRAM_CUSTOMER_BOT_TOKEN"
  | "TELEGRAM_OPERATIONS_BOT_TOKEN"
  | "TELEGRAM_HERETIC_BOT_TOKEN";

export type TelegramRuntimeEnv = {
  readonly DB: D1Database;
  readonly AGENT_JOBS?: {
    send(message: {
      readonly kind: "agent.job";
      readonly jobId: string;
      readonly depth: number;
      readonly createdAt: string;
        }): Promise<unknown>;
  };
  readonly TELEGRAM_GROUP_ID: string;
  readonly TELEGRAM_ADMIN_USER_IDS: string;
  readonly TELEGRAM_BOT_IDENTITIES_JSON: string;
} & Partial<Record<TelegramSecretName, string>>;

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

function aliasFromPath(pathname: string): string | null {
  const prefix = "/telegram/webhook/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const suffix = pathname.slice(prefix.length);
  if (suffix.length === 0 || suffix.includes("/")) {
    return null;
  }

  return suffix;
}

function bodyTooLarge(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) {
    return false;
  }

  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed > MAX_WEBHOOK_BODY_BYTES;
}

export async function handleTelegramWebhook(
  request: Request,
  env: TelegramRuntimeEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  const alias = aliasFromPath(new URL(request.url).pathname);
  if (alias === null) {
    return jsonResponse({ ok: false, error: "telegram_webhook_not_found" }, 404);
  }

  let config: ReturnType<typeof parseTelegramConfig>;
  try {
    config = parseTelegramConfig(env);
  } catch (error: unknown) {
    if (error instanceof TelegramConfigurationError) {
      return jsonResponse({ ok: false, error: "telegram_configuration_invalid" }, 503);
    }
    throw error;
  }

  if (getTelegramBot(config, alias) === null || webhookPath(alias) !== new URL(request.url).pathname) {
    return jsonResponse({ ok: false, error: "telegram_webhook_not_found" }, 404);
  }
  if (!config.webhookReady || config.webhookSecret === null) {
    return jsonResponse({ ok: false, error: "telegram_not_configured" }, 503);
  }

  const suppliedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (suppliedSecret === null || !constantTimeEqual(suppliedSecret, config.webhookSecret)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  if (bodyTooLarge(request)) {
    return jsonResponse({ ok: false, error: "request_body_too_large" }, 413);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "request_body_too_large" }, 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  try {
    const repositories = createRepositories(env.DB);
    const application = createTelegramApplication({ repositories, config });
    const result = await application.ingest({
      botAlias: alias,
      receivedAt: new Date().toISOString(),
      payload,
    });

    if (env.AGENT_JOBS && result.jobId && (result.status === "accepted" || result.status === "duplicate")) {
      const job = await repositories.jobs.getById(result.jobId).catch(() => null);
      if (job && (job.status === "pending" || job.status === "retry_scheduled") && job.lastEnqueuedAt === null) {
        try {
          await env.AGENT_JOBS.send({
            kind: "agent.job",
            jobId: job.id,
            depth: job.chainDepth,
            createdAt: new Date().toISOString(),
          });
          await repositories.jobs.markEnqueued(job.id);
        } catch {
          // The D1 job remains durable and the scheduled recovery path will
          // enqueue it later. Do not turn a successful Telegram ingest into a
          // duplicate Telegram delivery because Queue was briefly unavailable.
          console.warn(JSON.stringify({ event: "agent_job_enqueue_deferred", jobId: job.id }));
        }
      }
    }

    return jsonResponse({ ok: true, ...result });
  } catch (error: unknown) {
    if (error instanceof TelegramUpdateValidationError) {
      return jsonResponse({ ok: false, error: "invalid_update" }, 400);
    }
    if (error instanceof TelegramConfigurationError) {
      return jsonResponse({ ok: false, error: "telegram_not_configured" }, 503);
    }
    throw error;
  }
}
