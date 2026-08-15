import { jsonResponse, methodNotAllowed } from "../src/api/http";
import { createAgentRuntime, type AgentRuntimeEnvironment } from "../src/agents/factory";
import { RuntimeProviderFailure } from "../src/agents/runtime";
import { AgentScheduler } from "../src/agents/scheduler";
import { createRepositories } from "../src/database/repositories";
import { parseTelegramConfig } from "../src/telegram/config";

interface AmbientSmokeEnvironment extends AgentRuntimeEnvironment {
  readonly SMOKE_SECRET: string;
}

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

export default {
  async fetch(request: Request, env: AmbientSmokeEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__luma_agent_smoke/ready") {
      return request.method === "GET"
        ? jsonResponse({ ok: true })
        : methodNotAllowed();
    }
    if (url.pathname !== "/__luma_agent_smoke/ambient") {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }
    if (request.method !== "POST") {
      return methodNotAllowed();
    }

    const suppliedSecret = request.headers.get("X-Luma-Smoke-Secret");
    if (suppliedSecret === null || !constantTimeEqual(suppliedSecret, env.SMOKE_SECRET)) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    let body: Record<string, unknown> = {};
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 4096) {
        return jsonResponse({ ok: false, error: "request_body_too_large" }, 413);
      }
      const parsed = raw.length === 0 ? {} : JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) {
        return jsonResponse({ ok: false, error: "invalid_request" }, 400);
      }
      body = parsed;
    } catch {
      return jsonResponse({ ok: false, error: "invalid_request" }, 400);
    }

    const requestedThreadId = body.threadId;
    if (requestedThreadId !== undefined && typeof requestedThreadId !== "string") {
      return jsonResponse({ ok: false, error: "invalid_thread_id" }, 400);
    }

    let stage = "initializing";
    try {
      const repositories = createRepositories(env.DB);
      stage = "loading_telegram_config";
      const config = parseTelegramConfig(env);
      stage = "resolving_workspace";
      const chat = config.groupId === null
        ? null
        : await repositories.chats.findByTelegramId(config.groupId);
      if (chat === null) {
        return jsonResponse({ ok: false, error: "telegram_workspace_not_initialized" }, 409);
      }

      const thread = requestedThreadId === undefined
        ? await repositories.threads.findMostRecentActiveByChat(chat.id)
        : await repositories.threads.getById(requestedThreadId).catch(() => null);
      if (thread === null || thread.chatId !== chat.id) {
        return jsonResponse({ ok: false, error: "active_workspace_thread_not_found" }, 409);
      }

      const queued: unknown[] = [];
      stage = "creating_ambient_job";
      const scheduler = new AgentScheduler({
        repositories,
        queue: {
          async send(message: unknown): Promise<void> {
            queued.push(message);
          },
        },
      });
      const jobId = await scheduler.createImmediateAmbientJob(thread.id, "operator_ambient_smoke");
      const job = await repositories.jobs.getById(jobId);
      const leaseOwner = `ambient-smoke:${crypto.randomUUID()}`;
      stage = "claiming_ambient_job";
      const claimed = await repositories.jobs.claim(job.id, leaseOwner, 120);
      if (claimed === null) {
        return jsonResponse({ ok: false, error: "ambient_job_not_claimable" }, 409);
      }

      try {
        stage = "running_agent_runtime";
        const result = await createAgentRuntime(env).processJob(claimed);
        stage = "completing_ambient_job";
        await repositories.jobs.complete(job.id, leaseOwner);
        return jsonResponse({
          ok: true,
          jobId,
          threadId: thread.id,
          queueMessageCount: queued.length,
          turns: result?.turns ?? 0,
          publicMessages: result?.publicMessages ?? 0,
          waits: result?.waits ?? 0,
          stoppedReason: result?.stoppedReason ?? "no_result",
        });
      } catch (error: unknown) {
        try {
          await repositories.jobs.fail(
            job.id,
            leaseOwner,
            error instanceof RuntimeProviderFailure ? "bounded provider failure" : "ambient smoke execution failure",
            false,
            new Date().toISOString(),
          );
        } catch {
          // Preserve the original safe diagnostic below if failure recording
          // itself cannot complete in the operator harness.
        }
        return jsonResponse({
          ok: false,
          error: "ambient_smoke_failed",
          stage,
          errorName: error instanceof Error ? error.name : "unknown",
        }, 502);
      }
    } catch (error: unknown) {
      return jsonResponse({
        ok: false,
        error: "ambient_smoke_unavailable",
        stage,
        errorName: error instanceof Error ? error.name : "unknown",
      }, 503);
    }
  },
};
