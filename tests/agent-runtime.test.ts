import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  AgentActionValidationError,
  AgentRuntimeService,
  AgentScheduler,
  buildAgentPrompt,
  parseAgentAction,
  scoreCandidates,
} from "../src/agents";
import { createRepositories } from "../src/database";
import type { JobRecord } from "../src/database/types";
import {
  FakeProvider,
  NebulaProvider,
  providerFailure,
} from "../src/llm";
import {
  createTelegramApplication,
  parseTelegramConfig,
  type TelegramSendTextInput,
  type TelegramSentMessage,
  type TelegramTransport,
} from "../src/telegram";

const repositories = createRepositories(env.DB);
const groupId = "-100300400";

function testId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function action(
  intent: string,
  options?: {
    readonly content?: string | null;
    readonly targetAgentId?: string | null;
    readonly targetThreadId?: string | null;
    readonly confidence?: number;
    readonly metadata?: Record<string, unknown>;
  },
): string {
  return JSON.stringify({
    intent,
    content: options?.content ?? null,
    confidence: options?.confidence ?? 0.8,
    reason_summary: "A bounded test action with a concise rationale.",
    target_agent_id: options?.targetAgentId ?? null,
    target_thread_id: options?.targetThreadId ?? null,
    metadata: options?.metadata ?? {},
  });
}

class FakeTelegramTransport implements TelegramTransport {
  readonly calls: TelegramSendTextInput[] = [];

  async sendTextMessage(input: TelegramSendTextInput): Promise<TelegramSentMessage> {
    this.calls.push(input);
    return {
      telegramMessageId: String(70_000 + this.calls.length),
      telegramChatId: input.telegramChatId,
    };
  }
}

async function fixture(text = "How should LUMA improve next?", options?: { addressedAgentId?: string }): Promise<{
  readonly job: JobRecord;
  readonly threadId: string;
  readonly messageId: string;
  readonly chatId: string;
}> {
  const user = await repositories.users.create({
    id: testId("runtime-user"),
    externalKey: testId("runtime-external"),
    displayName: "Runtime Test Human",
  });
  const chat = await repositories.chats.upsertByTelegramId({
    id: testId("runtime-chat"),
    telegramChatId: groupId,
    chatType: "supergroup",
    title: "LUMA runtime test",
    isWorkspace: true,
  });
  const thread = await repositories.threads.create({
    id: testId("runtime-thread"),
    chatId: chat.id,
    title: "A bounded runtime question",
    summary: text,
    createdByUserId: user.id,
  });
  const message = await repositories.messages.create({
    id: testId("runtime-message"),
    threadId: thread.id,
    chatId: chat.id,
    authorType: "human",
    authorUserId: user.id,
    contentText: text,
    origin: "telegram",
    telegramChatId: groupId,
    telegramMessageId: testId("telegram-message"),
    telegramBotAlias: "gateway",
    telegramUpdateId: testId("telegram-update"),
  });
  const job = await repositories.jobs.create({
    id: testId("runtime-job"),
    jobType: "telegram.interactive_message",
    payload: {
      source: "test",
      messageId: message.id,
      threadId: thread.id,
      chatId: chat.id,
      addressedAgentId: options?.addressedAgentId ?? null,
    },
    idempotencyKey: testId("runtime-job-key"),
    dueAt: "2026-08-15T00:00:00.000Z",
    maxAttempts: 3,
  });
  return { job, threadId: thread.id, messageId: message.id, chatId: chat.id };
}

function runtime(provider: FakeProvider, transport?: FakeTelegramTransport): AgentRuntimeService {
  const config = parseTelegramConfig({
    TELEGRAM_GROUP_ID: groupId,
    TELEGRAM_WEBHOOK_SECRET: "runtime-test-secret",
    TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({
      product: { telegramUserId: "9101", username: "runtime_product" },
      growth: { telegramUserId: "9102", username: "runtime_growth" },
    }),
    TELEGRAM_PRODUCT_BOT_TOKEN: "test-product-token",
    TELEGRAM_GROWTH_BOT_TOKEN: "test-growth-token",
  });
  const telegram = transport
    ? createTelegramApplication({ repositories, config, transport })
    : undefined;
  return new AgentRuntimeService({
    repositories,
    provider,
    telegram,
    modelKey: "test-model",
    now: () => "2026-08-15T12:00:00.000Z",
    rng: () => 0,
  });
}

describe("Phase 03 action contract and provider boundary", () => {
  it("accepts valid actions and rejects invalid intentions/content", () => {
    expect(parseAgentAction(action("WAIT")).intent).toBe("WAIT");
    expect(() => parseAgentAction(action("NOT_ALLOWED"))).toThrow(AgentActionValidationError);
    expect(() => parseAgentAction(action("SPEAK", { content: "x".repeat(12_001) }))).toThrow(
      "content must not exceed",
    );
  });

  it("preserves literal text when a provider emits an invalid Unicode escape", () => {
    const malformed = [
      '{"intent":"SPEAK","content":"',
      "\\u06f",
      '","confidence":0.72,"reason_summary":"A useful step.","target_agent_id":null,"target_thread_id":null,"metadata":{}}',
    ].join("");

    expect(parseAgentAction(malformed).content).toBe("\\u06f");
  });

  it("repairs one malformed provider response and persists usage", async () => {
    const provider = new FakeProvider().enqueueJson("not-json").enqueueJson(action("SPEAK", { content: "A repaired contribution." }));
    const context = await fixture("Repair this response once.", { addressedAgentId: "agent-product" });
    const result = await runtime(provider).runInteractiveBurst({
      job: context.job,
      messageId: context.messageId,
      threadId: context.threadId,
      addressedAgentId: "agent-product",
      wakeReason: "human_message",
    });

    expect(result.publicMessages).toBe(1);
    expect(provider.calls).toHaveLength(4);
    expect(provider.calls.some((request) => request.systemPrompt.includes('"required"'))).toBe(true);
    expect(provider.calls.some((request) => request.systemPrompt.includes("thread_objective"))).toBe(true);
    const turns = await repositories.agentTurns.listByJob(context.job.id);
    expect(turns[0]?.metadata.repairAttempts).toBe(1);
    const usage = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM provider_usage WHERE job_id = ?")
      .bind(context.job.id)
      .first<{ count: number }>();
    expect(usage?.count).toBe(4);
  });

  it("stops safely when the one structured-output repair also fails", async () => {
    const provider = new FakeProvider().enqueueJson("not-json").enqueueJson("still-not-json");
    const context = await fixture("Repair failure");
    const result = await runtime(provider).runInteractiveBurst({
      job: context.job,
      messageId: context.messageId,
      threadId: context.threadId,
      wakeReason: "human_message",
    });

    expect(result.turns).toBe(1);
    expect(result.publicMessages).toBe(0);
    expect(result.stoppedReason).toBe("turn_stopped_after_safe_failure");
    expect((await repositories.agentTurns.listByJob(context.job.id))[0]?.status).toBe("failed");
    const usage = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM provider_usage WHERE job_id = ?")
      .bind(context.job.id)
      .first<{ count: number }>();
    expect(usage?.count).toBe(2);
  });

  it("normalizes a provider timeout without leaking credentials", async () => {
    const provider = new FakeProvider().enqueueFailure(
      providerFailure("timeout", "request timed out", { retryable: true }),
    );
    const context = await fixture("Provider timeout");
    await expect(runtime(provider).runInteractiveBurst({
      job: context.job,
      messageId: context.messageId,
      threadId: context.threadId,
      wakeReason: "human_message",
    })).rejects.toThrow("bounded provider failure");

    const usage = await env.DB
      .prepare("SELECT status, error_summary FROM provider_usage WHERE job_id = ? LIMIT 1")
      .bind(context.job.id)
      .first<{ status: string; error_summary: string | null }>();
    expect(usage?.status).toBe("timed_out");
    expect(usage?.error_summary).not.toContain("Bearer");
  });

  it("uses the verified Nebula chat contract and normalizes success metadata", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> | null = null;
    const provider = new NebulaProvider({
      apiKey: "nebula-test-key",
      baseUrl: "https://nebula.test/v1",
      model: "test-model",
      maxAttempts: 1,
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: "nebula-request-1",
          model: "test-model",
          choices: [{ message: { role: "assistant", content: action("WAIT") }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 },
        }), {
          status: 200,
          headers: { "x-routed-via": "test-provider", "x-fallback-attempts": "0" },
        });
      },
    });
    const result = await provider.generate({
      modelKey: "test-model",
      systemPrompt: "Return JSON.",
      messages: [{ role: "user", content: "Wait." }],
      temperature: 0.2,
      maxOutputTokens: 128,
    });

    expect(requestUrl).toBe("https://nebula.test/v1/chat/completions");
    expect(requestBody).toMatchObject({ model: "test-model", stream: false, max_tokens: 128 });
    expect((requestBody?.messages as readonly unknown[]).length).toBe(2);
    expect(result).toMatchObject({
      provider: "nebula",
      model: "test-model",
      requestId: "nebula-request-1",
      usage: { promptTokens: 11, completionTokens: 9, totalTokens: 20 },
    });
    expect(result.metadata).toEqual({ routedVia: "test-provider", fallbackAttempts: "0" });
  });

  it("classifies Nebula authentication and malformed-response failures", async () => {
    const unauthorized = new NebulaProvider({
      apiKey: "nebula-test-key",
      maxAttempts: 1,
      fetcher: async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
    });
    await expect(unauthorized.generate({ modelKey: "auto", systemPrompt: "x", messages: [] }))
      .rejects.toMatchObject({ failure: { kind: "authentication", retryable: false } });

    const malformed = new NebulaProvider({
      apiKey: "nebula-test-key",
      maxAttempts: 1,
      fetcher: async () => new Response("not-json", { status: 200 }),
    });
    await expect(malformed.generate({ modelKey: "auto", systemPrompt: "x", messages: [] }))
      .rejects.toMatchObject({ failure: { kind: "malformed_response", retryable: false } });
  });

  it("bounds a Nebula timeout", async () => {
    const timeoutProvider = new NebulaProvider({
      apiKey: "nebula-test-key",
      maxAttempts: 1,
      defaultTimeoutMs: 1,
      fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true });
      }),
    });
    await expect(timeoutProvider.generate({ modelKey: "auto", systemPrompt: "x", messages: [] }))
      .rejects.toMatchObject({ failure: { kind: "timeout", retryable: true } });
  });
});

describe("Phase 03 bounded orchestration", () => {
  it("uses the social fast path for a greeting and never performs RAG or a multi-Agent burst", async () => {
    const provider = new FakeProvider().enqueueJson(action("SPEAK", { content: "سلام!" }));
    const transport = new FakeTelegramTransport();
    const context = await fixture("سلام");
    const result = await runtime(provider, transport).runInteractiveBurst({
      job: context.job,
      messageId: context.messageId,
      threadId: context.threadId,
      wakeReason: "human_message",
    });

    expect(result.turns).toBe(1);
    expect(result.publicMessages).toBe(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.systemPrompt).toContain("SOCIAL / ACKNOWLEDGEMENT FAST PATH");
    expect(provider.calls[0]?.systemPrompt).not.toContain("bounded_retrieval_context");
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.text).toBe("سلام!");
  });

  it("skips a provider result when a newer correction supersedes the in-flight turn", async () => {
    const context = await fixture("وضعیت فعلی محصول را بررسی کنید");
    const provider = new FakeProvider();
    provider.enqueue(async () => {
      const wake = await repositories.messages.getById(context.messageId);
      await repositories.messages.create({
        id: testId("runtime-correction"),
        threadId: context.threadId,
        chatId: context.chatId,
        authorType: "human",
        authorUserId: wake.authorUserId as string,
        contentText: "گفتم سلام فقط",
        origin: "internal",
        visibility: "public",
      });
      return {
        text: action("SPEAK", { content: "این پاسخ دیگر منطبق با درخواست فعلی نیست." }),
        provider: "fake",
        model: "fake",
        finishReason: "stop",
        latencyMs: 0,
      };
    });

    const result = await runtime(provider).runInteractiveBurst({
      job: context.job,
      messageId: context.messageId,
      threadId: context.threadId,
      wakeReason: "human_message",
    });
    const turns = await repositories.agentTurns.listByJob(context.job.id);
    const publicMessages = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE thread_id = ? AND author_type = 'agent' AND visibility = 'public'")
      .bind(context.threadId)
      .first<{ count: number }>();

    expect(result.stoppedReason).toBe("superseded_by_new_human_boundary");
    expect(turns[0]?.status).toBe("skipped");
    expect(turns[0]?.metadata.superseded).toBe(true);
    expect(publicMessages?.count).toBe(0);
  });

  it("builds participant-aware Telegram guidance without making formatting personality-bound", async () => {
    const context = await fixture("یک سؤال فارسی درباره بهبود مسیر کاربر", { addressedAgentId: "agent-product" });
    const agent = await repositories.agents.getById("agent-product");
    const thread = await repositories.threads.getById(context.threadId);
    const message = await repositories.messages.getById(context.messageId);
    const human = await repositories.users.getById(message.authorUserId as string);
    const prompt = buildAgentPrompt({
      agent,
      specialties: await repositories.agents.listSpecialties(agent.id),
      interests: await repositories.agents.listInterests(agent.id),
      thread,
      wakeReason: "human_reply_to_agent",
      recentMessages: [message],
      addressedAgentId: agent.id,
      participants: [
        { id: agent.id, displayName: agent.displayName, kind: "agent" },
        { id: human.id, displayName: human.displayName, kind: "human" },
      ],
      humanDisplayName: human.displayName,
    });

    expect(prompt.systemPrompt).toContain("known_participants");
    expect(prompt.systemPrompt).toContain(agent.displayName);
    expect(prompt.systemPrompt).toContain("Telegram presentation");
    expect(prompt.systemPrompt).toContain("Never emit Markdown markers");
    expect(prompt.systemPrompt).toContain("Do not restate the whole replied-to message");
  });

  it("prioritizes an addressed agent, projects SPEAK once, hides WAIT, and prevents domination", async () => {
    const provider = new FakeProvider();
    provider.enqueueJson(action("SPEAK", { content: "<b>رادین</b>، از یک تست کوچک با کاربر جدید شروع کنیم." }));
    provider.enqueueJson(action("WAIT"));
    provider.enqueueJson(action("WAIT"));
    const transport = new FakeTelegramTransport();
    const context = await fixture("Reply to product", { addressedAgentId: "agent-product" });
    const result = await runtime(provider, transport).runInteractiveBurst({
      job: context.job,
      messageId: context.messageId,
      threadId: context.threadId,
      addressedAgentId: "agent-product",
      wakeReason: "human_reply_to_agent",
    });

    expect(result.turns).toBe(3);
    expect(result.publicMessages).toBe(1);
    expect(result.waits).toBe(2);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.text).toContain("<b>رادین</b>");
    const turns = await repositories.agentTurns.listByJob(context.job.id);
    expect(turns[0]?.agentId).toBe("agent-product");
    expect(turns[1]?.outputMessageId).toBeNull();
    const outbound = await repositories.telegramOutbound.getByIdempotencyKey(
      `agent-output:${context.job.id}:1:agent-product`,
    );
    expect(outbound.botAlias).toBe("product");
  });

  it("keeps an interactive burst bounded and idempotent on replay", async () => {
    const provider = new FakeProvider();
    for (let index = 0; index < 8; index += 1) {
      provider.enqueueJson(action("SPEAK", { content: `Contribution ${index + 1}` }));
    }
    const context = await fixture("Bound this exchange");
    const first = await runtime(provider).runInteractiveBurst({
      job: context.job,
      messageId: context.messageId,
      threadId: context.threadId,
      wakeReason: "human_message",
    });
    const callsAfterFirst = provider.calls.length;
    const second = await runtime(provider).runInteractiveBurst({
      job: context.job,
      messageId: context.messageId,
      threadId: context.threadId,
      wakeReason: "replayed_queue_job",
    });

    expect(first.turns).toBeLessThanOrEqual(6);
    expect(first.publicMessages).toBeLessThanOrEqual(4);
    expect(second.turns).toBe(first.turns);
    expect(provider.calls.length).toBe(callsAfterFirst);
    const messageCount = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE thread_id = ? AND author_type = 'agent'")
      .bind(context.threadId)
      .first<{ count: number }>();
    expect(messageCount?.count).toBe(first.publicMessages);

    const nextJob = await repositories.jobs.create({
      id: testId("runtime-followup-job"),
      jobType: "telegram.interactive_message",
      payload: { messageId: context.messageId, threadId: context.threadId },
      idempotencyKey: testId("runtime-followup-key"),
      dueAt: "2026-08-15T00:00:00.000Z",
    });
    provider.enqueueJson(action("WAIT"));
    const followup = await runtime(provider).runInteractiveBurst({
      job: nextJob,
      messageId: context.messageId,
      threadId: context.threadId,
      wakeReason: "new_human_message",
    });
    const followupTurns = await repositories.agentTurns.listByJob(nextJob.id);
    expect(followup.turns).toBeGreaterThanOrEqual(1);
    expect(followupTurns[0]?.sequenceNumber).toBe(first.turns + 1);
  });

  it("records request-agent, human-task, vote, and deferred capability actions", async () => {
    const targetActions = [
      action("REQUEST_AGENT", { targetAgentId: "agent-growth", content: "Ask Growth for a distribution angle." }),
      action("REQUEST_HUMAN", { content: "Confirm the target customer segment.", metadata: { title: "Confirm customer segment", priority: 80 } }),
      action("VOTE", { content: "smallest-experiment", metadata: { option: "smallest-experiment", confidence: 0.7 } }),
      action("FILE_WORK", { content: "Defer a Markdown revision until Phase 04." }),
      action("DRAW", { content: "Defer diagram rendering until the tools phase." }),
    ];
    for (const response of targetActions) {
      const provider = new FakeProvider().enqueueJson(response);
      const context = await fixture(`Action ${response.slice(0, 12)}`);
      const result = await runtime(provider).runAmbientOpportunity(context.job, context.threadId);
      expect(result.turns).toBe(1);
    }

    const requests = await env.DB.prepare("SELECT COUNT(*) AS count FROM agent_requests").first<{ count: number }>();
    const tasks = await env.DB.prepare("SELECT COUNT(*) AS count FROM human_tasks WHERE title = 'Confirm customer segment'").first<{ count: number }>();
    const votes = await env.DB.prepare("SELECT COUNT(*) AS count FROM agent_votes").first<{ count: number }>();
    const deferred = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM events WHERE event_type IN ('runtime.file_work_deferred', 'runtime.draw_deferred')")
      .first<{ count: number }>();
    expect(requests?.count).toBeGreaterThanOrEqual(1);
    expect(tasks?.count).toBeGreaterThanOrEqual(1);
    expect(votes?.count).toBeGreaterThanOrEqual(1);
    expect(deferred?.count).toBeGreaterThanOrEqual(2);
  });

  it("consumes a requested-agent routing hint after the target receives a turn", async () => {
    const provider = new FakeProvider()
      .enqueueJson(action("REQUEST_AGENT", { targetAgentId: "agent-technical", content: "Ask Technical for the architecture constraint." }))
      .enqueueJson(action("WAIT"));
    const context = await fixture("Architecture constraints", { addressedAgentId: "agent-product" });
    const result = await runtime(provider).runInteractiveBurst({
      job: context.job,
      messageId: context.messageId,
      threadId: context.threadId,
      addressedAgentId: "agent-product",
      wakeReason: "human_message",
    });

    expect(result.turns).toBeGreaterThanOrEqual(2);
    const turns = await repositories.agentTurns.listByJob(context.job.id);
    expect(turns[1]?.agentId).toBe("agent-technical");
    const request = await env.DB
      .prepare("SELECT status FROM agent_requests WHERE job_id = ? AND requested_agent_id = 'agent-technical' LIMIT 1")
      .bind(context.job.id)
      .first<{ status: string }>();
    expect(request?.status).toBe("accepted");
  });

  it("fails an unknown requested agent without creating an invalid request", async () => {
    const provider = new FakeProvider().enqueueJson(
      action("REQUEST_AGENT", { targetAgentId: "agent-does-not-exist", content: "Invalid target." }),
    );
    const context = await fixture("Invalid target");
    const result = await runtime(provider).runAmbientOpportunity(context.job, context.threadId);

    expect(result.stoppedReason).toBe("turn_stopped_after_safe_failure");
    const requests = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM agent_requests WHERE job_id = ?")
      .bind(context.job.id)
      .first<{ count: number }>();
    expect(requests?.count).toBe(0);
  });
});

describe("Phase 03 selection and scheduling", () => {
  it("combines explicit addressing, phase fit, relevance, recency, and exploration", async () => {
    const agents = await repositories.agents.listActive(20);
    const profiles = await Promise.all(agents.filter((agent) => !agent.isSupervisor).map(async (agent) => ({
      agent,
      specialties: await repositories.agents.listSpecialties(agent.id),
      interests: await repositories.agents.listInterests(agent.id),
    })));
    const thread = await repositories.threads.create({ id: testId("selection-thread"), title: "Pricing question", state: "debating" });
    const scores = scoreCandidates({
      profiles,
      messageText: "unit economics and pricing risk",
      thread,
      addressedAgentId: "agent-finance",
      recentAgentIds: ["agent-finance"],
      reputationByAgentId: { "agent-finance": 0.5 },
      turnIndex: 1,
      rng: () => 0,
    });
    expect(scores[0]?.agentId).toBe("agent-finance");
    expect(scores.find((candidate) => candidate.agentId === "agent-finance")?.reasons).toContain("bounded reputation signal");
  });

  it("creates due ambient work only for quiet threads and recovers inactivity", async () => {
    const context = await fixture("A quiet unresolved thread");
    await env.DB
      .prepare("UPDATE threads SET last_activity_at = ?, updated_at = ? WHERE id = ?")
      .bind("2026-08-14T00:00:00.000Z", "2026-08-14T00:00:00.000Z", context.threadId)
      .run();
    const queue: { readonly messages: unknown[]; send(message: unknown): Promise<unknown> } = {
      messages: [],
      async send(message: unknown): Promise<unknown> {
        this.messages.push(message);
        return undefined;
      },
    };
    const scheduler = new AgentScheduler({
      repositories,
      queue,
      now: () => "2026-08-15T12:00:00.000Z",
      rng: () => 0,
    });
    const result = await scheduler.tick();
    expect(result.ambientJobsCreated).toBeGreaterThanOrEqual(1);
    expect(result.inactivityRecovery).toBe(true);
    expect(queue.messages.length).toBeGreaterThanOrEqual(1);

    const futureSchedule = await repositories.scheduledJobs.getByKey("agent-runtime-ambient-opportunities");
    expect(futureSchedule.nextRunAt > "2026-08-15T12:00:00.000Z").toBe(true);
    const noOp = await scheduler.tick();
    expect(noOp.dueSchedule).toBe(false);
  });
});

describe("Phase 03 deep work", () => {
  it("allows eligible deep work but keeps the hard cap", async () => {
    const provider = new FakeProvider();
    for (let index = 0; index < 20; index += 1) {
      provider.enqueueJson(action("SPEAK", { content: `Deep contribution ${index + 1}` }));
    }
    const context = await fixture("A promising unresolved proposal");
    const deepJob = await repositories.jobs.create({
      id: testId("deep-job"),
      jobType: "agent.deep_work",
      payload: { threadId: context.threadId, messageId: context.messageId, eligible: true, trigger: "strong_disagreement" },
      idempotencyKey: testId("deep-key"),
      dueAt: "2026-08-15T00:00:00.000Z",
      maxAttempts: 2,
    });
    const result = await runtime(provider).runDeepWork(deepJob, context.threadId, "strong_disagreement");
    expect(result.turns).toBeLessThanOrEqual(12);
    expect(result.publicMessages).toBeLessThanOrEqual(12);
  });
});
