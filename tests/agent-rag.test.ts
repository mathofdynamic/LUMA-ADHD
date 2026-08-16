import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createRepositories } from "../src/database";
import { AgentDocumentTools } from "../src/agents/memory-tools";
import { AgentRuntimeService, buildAgentPrompt } from "../src/agents";
import { createMemoryServices } from "../src/memory";
import { ContextPackService, classifyRetrievalIntent } from "../src/memory/retrieval";
import { FakeProvider } from "../src/llm";
import { KnowledgeSyncService } from "../src/knowledge/sync";
import { OFFICIAL_LUMA_SOURCES } from "../src/knowledge/sources";
import type { JobRecord } from "../src/database/types";

const repositories = createRepositories(env.DB);

function testId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function action(content: string): Record<string, unknown> {
  return {
    intent: "SPEAK",
    content,
    confidence: 0.8,
    reason_summary: "The stored source supports a concise grounded answer.",
    target_agent_id: null,
    target_thread_id: null,
    metadata: {},
  };
}

async function syncOfficialFixture(): Promise<string> {
  const definition = OFFICIAL_LUMA_SOURCES[0]!;
  const body = [
    "# LUMA",
    "",
    "LUMA یک سازمان و محصول هوش مصنوعی برای تبدیل ایده به خروجی قابل‌استفاده است.",
    "",
    "## Capabilities",
    "",
    "مستند رسمی لوما درباره قابلیت‌ها، مسیر کاربر و ابزارهای محصول توضیح می‌دهد.",
  ].join("\n");
  const sync = new KnowledgeSyncService(repositories, {
    now: () => new Date().toISOString(),
    fetcher: async () => new Response(body, {
      status: 200,
      headers: { etag: `agent-rag-${body.length}` },
    }),
  });
  await sync.syncSource(definition.key);
  return body;
}

async function runtimeFixture(text: string): Promise<{ readonly job: JobRecord; readonly messageId: string; readonly threadId: string }> {
  const user = await repositories.users.create({ id: testId("rag-user"), displayName: "RAG Test Human" });
  const chat = await repositories.chats.create({ id: testId("rag-chat"), chatType: "supergroup", title: "RAG test", isWorkspace: true });
  const thread = await repositories.threads.create({
    id: testId("rag-thread"), chatId: chat.id, title: "Grounded question", summary: text, createdByUserId: user.id,
  });
  const message = await repositories.messages.create({
    id: testId("rag-message"), threadId: thread.id, chatId: chat.id, authorType: "human", authorUserId: user.id,
    contentText: text, origin: "internal", visibility: "public",
  });
  const job = await repositories.jobs.create({
    id: testId("rag-job"), jobType: "telegram.interactive_message", payload: { messageId: message.id, threadId: thread.id },
    idempotencyKey: testId("rag-job-key"), dueAt: "2026-08-15T00:00:00.000Z", maxAttempts: 2,
  });
  return { job, messageId: message.id, threadId: thread.id };
}

describe("Phase 05 persistent Agent RAG", () => {
  it("classifies LUMA factual questions and reserves official knowledge in a bounded pack", async () => {
    const officialBody = await syncOfficialFixture();
    expect(classifyRetrievalIntent("لوما چی هست و چه قابلیت‌هایی دارد؟")).toBe("official_factual");
    const user = await repositories.users.create({ id: testId("rag-pack-user"), displayName: "Pack Human" });
    const thread = await repositories.threads.create({ id: testId("rag-pack-thread"), title: "LUMA facts", createdByUserId: user.id });
    const noisyMessages = await Promise.all(Array.from({ length: 4 }, (_, index) => repositories.messages.create({
      id: testId(`rag-noise-${index}`), threadId: thread.id, authorType: "human", authorUserId: user.id,
      contentText: `Discussion noise ${index} ${"unrelated context ".repeat(70)}`, origin: "internal", visibility: "public",
    })));
    const pack = await new ContextPackService(repositories.database).build({
      query: "لوما چی هست و چه قابلیت‌هایی دارد؟",
      actor: { agentId: "agent-customer" }, threadId: thread.id, recentMessages: noisyMessages, topK: 6, maxCharacters: 1_800,
    });
    expect(pack.telemetry.queryIntent).toBe("official_factual");
    expect(pack.telemetry.officialKnowledgeCount).toBeGreaterThan(0);
    expect(pack.items.some((item) => item.type === "knowledge_chunk" && item.excerpt.includes("لوما"))).toBe(true);
    expect(ContextPackService.toPromptText(pack)).toContain(officialBody.slice(0, 40));
    expect(pack.totalCharacters).toBeLessThanOrEqual(1_800);
  });

  it("gives multiple Agents the same official facts while preserving workspace and specialty context", async () => {
    await syncOfficialFixture();
    const user = await repositories.users.create({ id: testId("rag-prompt-user"), displayName: "Prompt Human" });
    const thread = await repositories.threads.create({ id: testId("rag-prompt-thread"), title: "LUMA capability question", createdByUserId: user.id });
    const pack = await new ContextPackService(repositories.database).build({
      query: "لوما چیست و چه ابزارهایی دارد؟", actor: { agentId: "agent-customer" }, threadId: thread.id,
      maxCharacters: 4_000,
    });
    const officialText = ContextPackService.toPromptText(pack);
    for (const agentId of ["agent-customer", "agent-product", "agent-finance", "agent-growth", "agent-technical"]) {
      const agent = await repositories.agents.getById(agentId);
      const prompt = buildAgentPrompt({
        agent,
        specialties: await repositories.agents.listSpecialties(agent.id),
        interests: await repositories.agents.listInterests(agent.id),
        thread,
        wakeReason: "human_message",
        recentMessages: [],
        retrievedContext: officialText,
        retrievalTelemetry: pack.telemetry,
      });
      expect(prompt.systemPrompt).toContain("CURRENT OFFICIAL FACT");
      expect(prompt.systemPrompt).toContain("persistent_workspace: /agents/");
      expect(prompt.systemPrompt).toContain(agent.slug);
      expect(prompt.systemPrompt).toContain("LUMA");
    }
  });

  it("injects official grounding and retrieval telemetry into a real runtime turn", async () => {
    await syncOfficialFixture();
    const context = await runtimeFixture("لوما چیست و مهم‌ترین قابلیت‌هایش چه هستند؟");
    const provider = new FakeProvider().enqueueJson(action("طبق مستند رسمی، لوما برای تبدیل ایده به خروجی قابل‌استفاده ساخته شده است."));
    const runtime = new AgentRuntimeService({
      repositories,
      provider,
      memory: createMemoryServices(repositories),
      modelKey: "fake",
      now: () => "2026-08-15T12:00:00.000Z",
      rng: () => 0,
    });
    const result = await runtime.runInteractiveBurst({
      job: context.job, messageId: context.messageId, threadId: context.threadId,
      addressedAgentId: "agent-customer", wakeReason: "human_message",
    });
    expect(result.publicMessages).toBe(1);
    expect(provider.calls[0]?.systemPrompt).toContain("برای تبدیل ایده");
    expect(provider.calls[0]?.systemPrompt).toContain("Official LUMA material outranks");
    const turn = (await repositories.agentTurns.listByJob(context.job.id))[0];
    expect(turn?.metadata.retrieval).toMatchObject({ officialKnowledgeCount: expect.any(Number), retrievalCount: expect.any(Number) });
    expect(Array.isArray(turn?.metadata.retrieval && (turn.metadata.retrieval as Record<string, unknown>).selectedSources)).toBe(true);
  });

  it("repairs a valid but unsupported LUMA answer once before persisting it", async () => {
    await syncOfficialFixture();
    const context = await runtimeFixture("لوما چیست و مهم‌ترین قابلیت‌هایش چه هستند؟");
    const provider = new FakeProvider()
      .enqueueJson(action("لوما یک ابزار هوشمند است."))
      .enqueueJson(action("طبق مستند رسمی، لوما برای تبدیل ایده به خروجی قابل‌استفاده ساخته شده است."))
      .enqueueJson({ intent: "WAIT", content: null, confidence: 0.8, reason_summary: "No additional contribution.", target_agent_id: null, target_thread_id: null, metadata: {} })
      .enqueueJson({ intent: "WAIT", content: null, confidence: 0.8, reason_summary: "No additional contribution.", target_agent_id: null, target_thread_id: null, metadata: {} });
    const runtime = new AgentRuntimeService({
      repositories,
      provider,
      memory: createMemoryServices(repositories),
      modelKey: "fake",
      now: () => "2026-08-15T12:00:00.000Z",
      rng: () => 0,
    });
    const result = await runtime.runInteractiveBurst({
      job: context.job, messageId: context.messageId, threadId: context.threadId,
      addressedAgentId: "agent-customer", wakeReason: "human_message",
    });
    expect(result.publicMessages).toBe(1);
    expect(provider.calls.length).toBeGreaterThanOrEqual(2);
    const turn = (await repositories.agentTurns.listByJob(context.job.id))[0];
    expect(turn?.metadata.repairAttempts).toBe(1);
    expect(turn?.metadata.grounding).toMatchObject({ required: true, satisfied: true });
    const message = turn?.outputMessageId ? await repositories.messages.getById(turn.outputMessageId) : null;
    expect(message?.contentText).toContain("تبدیل ایده");
  });

  it("supports bounded search-to-read-to-answer acquisition without provider-native tools", async () => {
    const memory = createMemoryServices(repositories);
    const path = `/agents/product/${testId("acquisition")}.md`;
    await memory.documents.create({
      actor: { agentId: "agent-product" }, logicalPath: path, title: "Acquisition note",
      contentMarkdown: "Durable fact: the first useful product result should be measurable.",
    });
    const context = await runtimeFixture("Find the durable product fact.");
    const provider = new FakeProvider()
      .enqueueJson({ step: "ACQUIRE", operation: "READ_DOCUMENT", query: null, logical_path: path, version_number: null, limit: 5 })
      .enqueueJson(action("The stored product note says the first useful result should be measurable."));
    const runtime = new AgentRuntimeService({ repositories, provider, memory, modelKey: "fake", rng: () => 0 });
    const result = await runtime.runAmbientOpportunity(context.job, context.threadId);
    expect(result.publicMessages).toBe(1);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.systemPrompt).toContain("first useful product result should be measurable");
    const turn = (await repositories.agentTurns.listByJob(context.job.id))[0];
    expect(turn?.metadata.acquisitionOperations).toBe(1);
  });

  it("exposes complete bounded file operations with soft delete, history, sharing, and access control", async () => {
    const memory = createMemoryServices(repositories);
    const tools = new AgentDocumentTools(memory);
    const path = `/agents/product/${testId("complete-file")}.md`;
    const created = await tools.execute({
      operation: "create_document", actor: { agentId: "agent-product" }, logicalPath: path,
      title: "Complete file workflow", contentMarkdown: "v1 durable fact", idempotencyKey: testId("create-file"),
    });
    expect(created.currentVersion).toBe(1);
    await expect(tools.execute({
      operation: "read_document", actor: { agentId: "agent-growth" }, logicalPath: path, idempotencyKey: testId("unauthorized-read"),
    })).rejects.toThrow("access");
    await tools.execute({
      operation: "share_document", actor: { agentId: "agent-product" }, logicalPath: path,
      targetAgentId: "agent-growth", idempotencyKey: testId("share-file"),
    });
    expect((await tools.execute({
      operation: "read_document", actor: { agentId: "agent-growth" }, logicalPath: path, idempotencyKey: testId("shared-read"),
    })).contentMarkdown).toContain("v1 durable fact");
    await tools.execute({
      operation: "edit_document", actor: { agentId: "agent-product" }, logicalPath: path,
      contentMarkdown: "v2 refined fact", changeSummary: "Clarify the durable fact", idempotencyKey: testId("edit-file"),
    });
    const history = await tools.execute({ operation: "document_history", actor: { agentId: "agent-product" }, logicalPath: path, idempotencyKey: testId("history-file") });
    expect(JSON.stringify(history)).toContain("v1 durable fact");
    expect((await tools.execute({
      operation: "read_document_version", actor: { agentId: "agent-product" }, logicalPath: path, versionNumber: 1, idempotencyKey: testId("version-file"),
    })).contentMarkdown).toContain("v1 durable fact");
    await tools.execute({ operation: "delete_document", actor: { agentId: "agent-product" }, logicalPath: path, idempotencyKey: testId("delete-file") });
    const deletedSearch = await tools.execute({ operation: "search_documents", actor: { agentId: "agent-product" }, query: "refined fact", idempotencyKey: testId("deleted-search") });
    expect(JSON.stringify(deletedSearch)).not.toContain(path);
    await tools.execute({ operation: "restore_document", actor: { agentId: "agent-product" }, logicalPath: path, idempotencyKey: testId("restore-file") });
    expect((await tools.execute({ operation: "read_document", actor: { agentId: "agent-product" }, logicalPath: path, idempotencyKey: testId("restored-read") })).contentMarkdown).toContain("v2 refined fact");
    expect((await tools.execute({ operation: "list_documents", actor: { agentId: "agent-product" }, idempotencyKey: testId("list-files") })).documents).toBeDefined();
  });

  it("stops acquisition at the hard bound instead of looping indefinitely", async () => {
    const context = await runtimeFixture("Bound information acquisition.");
    const request = { step: "ACQUIRE", operation: "SEARCH_MEMORY", query: "bound", logical_path: null, version_number: null, limit: 1 };
    const provider = new FakeProvider().enqueueJson(request).enqueueJson(request).enqueueJson(request).enqueueJson(request).enqueueJson(request);
    const runtime = new AgentRuntimeService({ repositories, provider, memory: createMemoryServices(repositories), modelKey: "fake", rng: () => 0 });
    const result = await runtime.runAmbientOpportunity(context.job, context.threadId);
    expect(result.turns).toBe(1);
    expect(provider.calls.length).toBeLessThanOrEqual(5);
    expect(result.stoppedReason).toBe("turn_stopped_after_safe_failure");
  });
});
