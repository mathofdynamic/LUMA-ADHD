import { jsonResponse, methodNotAllowed } from "../src/api/http";
import { AgentRuntimeService } from "../src/agents/runtime";
import type { AgentRuntimeEnvironment } from "../src/agents/factory";
import { createRepositories } from "../src/database/repositories";
import { createMemoryServices } from "../src/memory";
import { NebulaProvider, DEFAULT_NEBULA_MODEL, VERIFIED_NEBULA_BASE_URL } from "../src/llm";
import { ReputationService } from "../src/reputation/service";
import type { JsonObject } from "../src/database/validation";
import { createGodReviewService } from "../src/agents/factory";

interface Phase05SmokeEnvironment extends AgentRuntimeEnvironment {
  readonly SMOKE_SECRET: string;
}

interface UsageRow {
  status: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
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

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4_096) throw new Error("request_body_too_large");
  const parsed = raw.length === 0 ? {} : parseJson(raw);
  if (!isRecord(parsed)) throw new Error("invalid_request");
  return parsed;
}

function safeText(value: string, limit = 2_400): string {
  return value.slice(0, limit);
}

function providerFor(env: Phase05SmokeEnvironment): NebulaProvider {
  return new NebulaProvider({
    apiKey: env.NEBULA_API_KEY ?? "",
    baseUrl: env.NEBULA_BASE_URL || VERIFIED_NEBULA_BASE_URL,
    model: env.NEBULA_MODEL || DEFAULT_NEBULA_MODEL,
  });
}

async function runRuntime(
  env: Phase05SmokeEnvironment,
  query: string,
  tag: string,
): Promise<{
  readonly threadId: string;
  readonly jobId: string;
  readonly result: unknown;
  readonly turns: readonly JsonObject[];
  readonly messages: readonly JsonObject[];
  readonly usage: JsonObject;
}> {
  const repositories = createRepositories(env.DB);
  const provider = providerFor(env);
  const modelKey = env.NEBULA_MODEL || DEFAULT_NEBULA_MODEL;
  const memory = createMemoryServices(repositories, { provider, modelKey });
  const reputation = new ReputationService({ repositories });
  const suffix = crypto.randomUUID();
  const threadId = `phase05-live-${tag}-thread-${suffix}`;
  const messageId = `phase05-live-${tag}-message-${suffix}`;
  const jobId = `phase05-live-${tag}-job-${suffix}`;

  await repositories.threads.create({
    id: threadId,
    title: tag === "rag" ? "Phase 05 live RAG grounding smoke" : "Phase 05 live workspace retrieval smoke",
    summary: query,
    metadata: { phase: "05", smoke: tag },
  });
  await repositories.messages.create({
    id: messageId,
    threadId,
    authorType: "system",
    contentText: query,
    origin: "system",
    visibility: "public",
    idempotencyKey: `phase05-live-${tag}-message:${suffix}`,
    metadata: { phase: "05", smoke: tag },
  });
  const job = await repositories.jobs.create({
    id: jobId,
    jobType: "telegram.interactive_message",
    payload: { messageId, threadId, addressedAgentId: "agent-customer" },
    idempotencyKey: `phase05-live-${tag}-job:${suffix}`,
    dueAt: new Date().toISOString(),
    maxAttempts: 1,
  });
  const leaseOwner = `phase05-live:${crypto.randomUUID()}`;
  const claimed = await repositories.jobs.claim(job.id, leaseOwner, 180);
  if (!claimed) throw new Error("smoke_job_not_claimable");

  try {
    const runtime = new AgentRuntimeService({
      repositories,
      provider,
      modelKey,
      memory,
      reputation,
    });
    const result = await runtime.processJob(claimed);
    await repositories.jobs.complete(job.id, leaseOwner);
    const turns = await repositories.agentTurns.listByJob(job.id, 20);
    const turnRows: JsonObject[] = turns.map((turn) => ({
      id: turn.id,
      sequenceNumber: turn.sequenceNumber,
      agentId: turn.agentId,
      status: turn.status,
      outputMessageId: turn.outputMessageId,
      metadata: turn.metadata,
    }));
    const messages: JsonObject[] = [];
    for (const turn of turns) {
      if (!turn.outputMessageId) continue;
      const message = await repositories.messages.getById(turn.outputMessageId);
      messages.push({
        id: message.id,
        agentId: message.authorAgentId,
        contentText: safeText(message.contentText),
      });
    }
    const usageRows = await repositories.database.prepare(
      `SELECT status, prompt_tokens, completion_tokens, total_tokens
       FROM provider_usage WHERE job_id = ? ORDER BY created_at ASC`,
    ).bind(job.id).all<UsageRow>();
    const usage = usageRows.results.reduce<JsonObject>((summary, row) => ({
      calls: Number(summary.calls ?? 0) + 1,
      successfulCalls: Number(summary.successfulCalls ?? 0) + (row.status === "completed" ? 1 : 0),
      failedCalls: Number(summary.failedCalls ?? 0) + (row.status === "completed" ? 0 : 1),
      promptTokens: Number(summary.promptTokens ?? 0) + (row.prompt_tokens ?? 0),
      completionTokens: Number(summary.completionTokens ?? 0) + (row.completion_tokens ?? 0),
      totalTokens: Number(summary.totalTokens ?? 0) + (row.total_tokens ?? 0),
    }), { calls: 0, successfulCalls: 0, failedCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    return { threadId, jobId, result, turns: turnRows, messages, usage };
  } catch (error: unknown) {
    await repositories.jobs.fail(job.id, leaseOwner, "phase05 smoke execution failure", false, new Date().toISOString()).catch(() => undefined);
    throw error;
  }
}

async function runWorkspaceSmoke(env: Phase05SmokeEnvironment): Promise<JsonObject> {
  const repositories = createRepositories(env.DB);
  const memory = createMemoryServices(repositories);
  const suffix = crypto.randomUUID();
  const logicalPath = `/shared/ideas/phase05-live-workspace-${suffix}.md`;
  const content = "# Phase 05 shared workspace smoke\n\nThe phase five workspace rule is to preserve concise durable context before making a new proposal.";
  await memory.documents.create({
    actor: { agentId: "agent-product" },
    logicalPath,
    title: "Phase 05 live shared workspace smoke",
    contentMarkdown: content,
    tags: ["phase05", "smoke"],
    metadata: { phase: "05", smoke: "workspace" },
  });
  try {
    const search = await memory.documents.search({
      query: "phase five workspace rule durable context",
      actor: { agentId: "agent-customer" },
      limit: 5,
    });
    const read = await memory.documents.read(logicalPath, { agentId: "agent-customer" });
    const runtime = await runRuntime(
      env,
      "What does the shared workspace note say about the phase five workspace rule?",
      "workspace",
    );
    return {
      logicalPath,
      searchMatches: search.map((item) => ({ sourceId: item.sourceId, pathOrUrl: item.pathOrUrl, score: item.score })),
      readVersion: read.document.currentVersion,
      readContentLength: read.currentVersion?.contentMarkdown.length ?? 0,
      runtime,
    };
  } finally {
    await memory.documents.delete(logicalPath, { agentId: "agent-product" }).catch(() => undefined);
  }
}

async function runGodReview(env: Phase05SmokeEnvironment, idempotencyKey: string): Promise<JsonObject> {
  const service = createGodReviewService(env);
  if (!service) throw new Error("god_provider_not_configured");
  const result = await service.run({ idempotencyKey, publishTelegram: false });
  return {
    reviewId: result.review.id,
    status: result.review.status,
    provider: result.review.providerName,
    model: result.review.modelName,
    repairAttempts: result.review.repairAttempts,
    directives: result.directives.length,
    evaluations: result.evaluations.length,
    evidence: result.evidence.length,
    publicMessageId: result.publicMessageId,
    failureSummary: result.review.failureSummary,
  };
}

async function runReputationSmoke(
  env: Phase05SmokeEnvironment,
  sourceThreadId: string,
  reviewId: string,
): Promise<JsonObject> {
  const repositories = createRepositories(env.DB);
  const reputation = new ReputationService({ repositories });
  const reviewRun = await reputation.calculateOffCycle(`phase05-live-review:${reviewId}`);
  const syntheticOutcome = await reputation.recordOutcome({
    agentId: "agent-customer",
    domain: "customer_experience",
    sourceType: "thread",
    sourceId: sourceThreadId,
    signal: 0.25,
    summary: "PHASE05_SYNTHETIC_OPERATOR_SMOKE_ONLY: bounded delayed-outcome linkage test.",
    idempotencyKey: `phase05-live-synthetic-outcome:${sourceThreadId}`,
  });
  const outcomeRun = await reputation.calculateOffCycle(`phase05-live-outcome:${sourceThreadId}`);
  const snapshots = [...reviewRun.snapshots, ...outcomeRun.snapshots];
  const maxAbsoluteDelta = snapshots.reduce((maximum, snapshot) => Math.max(maximum, Math.abs(snapshot.rankDelta)), 0);
  const normalAgents = (await repositories.agents.listActive(20))
    .filter((agent) => !agent.isSupervisor)
    .map((agent) => ({ id: agent.id, rank: agent.rank }));
  return {
    reviewRunId: reviewRun.run.id,
    reviewEvidenceProcessed: reviewRun.processedEvidence,
    outcomeRunId: outcomeRun.run.id,
    outcomeEvidenceId: syntheticOutcome.id,
    outcomeEvidenceProcessed: outcomeRun.processedEvidence,
    snapshotCount: snapshots.length,
    maxAbsoluteDelta,
    normalAgents,
  };
}

export default {
  async fetch(request: Request, env: Phase05SmokeEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__luma_phase05_smoke/ready") {
      return request.method === "GET" ? jsonResponse({ ok: true }) : methodNotAllowed();
    }
    if (!["/rag", "/workspace", "/god", "/reputation"].includes(url.pathname)) {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }
    if (request.method !== "POST") return methodNotAllowed();
    const suppliedSecret = request.headers.get("X-Luma-Smoke-Secret");
    if (suppliedSecret === null || !constantTimeEqual(suppliedSecret, env.SMOKE_SECRET)) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }
    try {
      const body = await readBody(request);
      if (url.pathname === "/rag") {
        return jsonResponse({ ok: true, ...await runRuntime(env, "میدونی لوما چی هست؟ اطلاع داری درباره لوما؟", "rag") });
      }
      if (url.pathname === "/workspace") {
        return jsonResponse({ ok: true, ...await runWorkspaceSmoke(env) });
      }
      if (url.pathname === "/god") {
        const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0
          ? body.idempotencyKey
          : `phase05-live-manual-god:${crypto.randomUUID()}`;
        return jsonResponse({ ok: true, ...await runGodReview(env, idempotencyKey) });
      }
      const sourceThreadId = body.sourceThreadId;
      const reviewId = body.reviewId;
      if (typeof sourceThreadId !== "string" || typeof reviewId !== "string") {
        return jsonResponse({ ok: false, error: "sourceThreadId_and_reviewId_required" }, 400);
      }
      return jsonResponse({ ok: true, ...await runReputationSmoke(env, sourceThreadId, reviewId) });
    } catch (error: unknown) {
      return jsonResponse({
        ok: false,
        error: "phase05_smoke_failed",
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      }, 502);
    }
  },
};
