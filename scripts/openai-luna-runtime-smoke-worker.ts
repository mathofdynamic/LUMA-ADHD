import { jsonResponse, methodNotAllowed } from "../src/api/http";
import { AgentRuntimeService } from "../src/agents/runtime";
import { createMemoryServices } from "../src/memory";
import { createRepositories } from "../src/database/repositories";
import { resolveNormalAgentConfig, resolveOpenAIKey, type AgentRuntimeEnvironment } from "../src/agents/factory";
import { OpenAIProvider } from "../src/llm";
import { ReputationService } from "../src/reputation/service";

interface SmokeEnvironment extends AgentRuntimeEnvironment {
  readonly SMOKE_SECRET: string;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 8_000) throw new Error("request_body_too_large");
  if (raw.trim().length === 0) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("request_body_must_be_object");
  return parsed;
}

interface UsageRow {
  readonly provider_name: string;
  readonly model_name: string;
  readonly status: string;
  readonly prompt_tokens: number | null;
  readonly completion_tokens: number | null;
  readonly total_tokens: number | null;
  readonly duration_ms: number | null;
  readonly metadata_json: string;
}

function safeUsage(rows: readonly UsageRow[]) {
  return {
    calls: rows.length,
    successfulCalls: rows.filter((row) => row.status === "completed").length,
    failedCalls: rows.filter((row) => row.status !== "completed").length,
    providers: [...new Set(rows.map((row) => row.provider_name))],
    models: [...new Set(rows.map((row) => row.model_name))],
    reasoningEfforts: [...new Set(rows.flatMap((row) => {
      try {
        const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
        return typeof metadata.reasoningEffort === "string" ? [metadata.reasoningEffort] : [];
      } catch {
        return [];
      }
    }))],
    inputTokens: rows.reduce((sum, row) => sum + (row.prompt_tokens ?? 0), 0),
    outputTokens: rows.reduce((sum, row) => sum + (row.completion_tokens ?? 0), 0),
    totalTokens: rows.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0),
    latencyMs: rows.reduce((sum, row) => sum + (row.duration_ms ?? 0), 0),
  };
}

async function runSmoke(env: SmokeEnvironment, body: Record<string, unknown>) {
  const normal = resolveNormalAgentConfig(env);
  if (normal.provider !== "openai") throw new Error("normal_provider_is_not_openai");
  const apiKey = resolveOpenAIKey(env);
  if (!apiKey) throw new Error("openai_key_not_configured");
  const repositories = createRepositories(env.DB);
  const provider = new OpenAIProvider({ apiKey, baseUrl: normal.baseUrl, model: normal.model, maxAttempts: 1 });
  const memory = createMemoryServices(repositories, { provider, modelKey: normal.model, reasoningEffort: normal.reasoningEffort });
  const reputation = new ReputationService({ repositories });
  const runtime = new AgentRuntimeService({
    repositories,
    provider,
    modelKey: normal.model,
    reasoningEffort: normal.reasoningEffort,
    memory,
    reputation,
  });
  const suffix = crypto.randomUUID();
  const threadId = `postv1-luna-provider-smoke-thread-${suffix}`;
  const messageId = `postv1-luna-provider-smoke-message-${suffix}`;
  const jobId = `postv1-luna-provider-smoke-job-${suffix}`;
  const question = typeof body.question === "string" && body.question.trim().length > 0
    ? body.question.trim().slice(0, 1_000)
    : "این یک تست محدود اپراتوری است؛ بدون ارسال تلگرام، یک پاسخ کوتاه و مستند درباره لوما بده.";

  await repositories.threads.create({
    id: threadId,
    title: "Post-v1 OpenAI Luna provider smoke",
    summary: question,
    metadata: { smoke: "postv1-openai-luna", operatorOnly: true },
  });
  await repositories.messages.create({
    id: messageId,
    threadId,
    authorType: "system",
    contentText: question,
    origin: "system",
    visibility: "internal",
    idempotencyKey: `postv1-luna-provider-smoke-message:${suffix}`,
    metadata: { smoke: "postv1-openai-luna", operatorOnly: true },
  });
  const job = await repositories.jobs.create({
    id: jobId,
    jobType: "telegram.interactive_message",
    payload: { messageId, threadId },
    idempotencyKey: `postv1-luna-provider-smoke-job:${suffix}`,
    dueAt: new Date().toISOString(),
    maxAttempts: 1,
  });
  const leaseOwner = `postv1-luna-provider-smoke:${crypto.randomUUID()}`;
  const claimed = await repositories.jobs.claim(job.id, leaseOwner, 180);
  if (!claimed) throw new Error("smoke_job_not_claimable");
  const startedAt = Date.now();
  try {
    const result = await runtime.processJob(claimed);
    await repositories.jobs.complete(job.id, leaseOwner);
    const turns = await repositories.agentTurns.listByJob(job.id, 20);
    const usageRows = await repositories.database.prepare(
      `SELECT provider_name, model_name, status, prompt_tokens, completion_tokens, total_tokens, duration_ms, metadata_json
       FROM provider_usage WHERE job_id = ? ORDER BY created_at ASC`,
    ).bind(job.id).all<UsageRow>();
    return {
      ok: true,
      provider: normal.provider,
      model: normal.model,
      reasoningEffort: normal.reasoningEffort,
      threadId,
      jobId,
      elapsedMs: Date.now() - startedAt,
      turnCount: turns.length,
      turns: turns.map((turn) => ({ agentId: turn.agentId, status: turn.status, intent: typeof turn.metadata.intent === "string" ? turn.metadata.intent : null })),
      usage: safeUsage(usageRows.results),
      publicProjectionDisabled: true,
      runtimeResult: { stoppedReason: result?.stoppedReason ?? "no_runtime_result" },
    };
  } catch (error: unknown) {
    await repositories.jobs.fail(job.id, leaseOwner, "post-v1 Luna provider smoke failed", false, new Date().toISOString()).catch(() => undefined);
    throw error;
  }
}

export default {
  async fetch(request: Request, env: SmokeEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__luma_luna_smoke/ready") return request.method === "GET" ? jsonResponse({ ok: true }) : methodNotAllowed();
    if (url.pathname !== "/run") return jsonResponse({ ok: false, error: "not_found" }, 404);
    if (request.method !== "POST") return methodNotAllowed();
    const suppliedSecret = request.headers.get("X-Luma-Smoke-Secret");
    if (!suppliedSecret || !constantTimeEqual(suppliedSecret, env.SMOKE_SECRET)) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    try {
      return jsonResponse(await runSmoke(env, await requestBody(request)));
    } catch (error: unknown) {
      return jsonResponse({ ok: false, error: "luna_provider_smoke_failed", errorName: error instanceof Error ? error.name : "unknown" }, 502);
    }
  },
};
