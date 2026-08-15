import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createRepositories } from "../src/database";
import { AgentRuntimeService } from "../src/agents/runtime";
import { FakeProvider } from "../src/llm";
import { createMemoryServices } from "../src/memory";
import { DocumentService } from "../src/memory/document-service";
import { canonicalizeLogicalPath } from "../src/memory/paths";
import { ContextPackService, InstitutionalMemorySearch, normalizeFtsQuery } from "../src/memory/retrieval";
import { ThreadSummaryService } from "../src/memory/summary";
import { KnowledgeSyncService } from "../src/knowledge/sync";
import { OFFICIAL_LUMA_SOURCES } from "../src/knowledge/sources";
import { chunkMarkdown } from "../src/knowledge/markdown";

const repositories = createRepositories(env.DB);
const documents = new DocumentService(repositories);

function testId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

describe("Phase 04 logical workspaces and immutable memory", () => {
  it("canonicalizes safe paths and rejects traversal or malformed paths", () => {
    expect(canonicalizeLogicalPath("//agents//product//idea.md/")).toBe("/agents/product/idea.md");
    expect(canonicalizeLogicalPath("/shared/ایده.md")).toBe("/shared/ایده.md");
    expect(() => canonicalizeLogicalPath("agents/product/idea.md")).toThrow("absolute");
    expect(() => canonicalizeLogicalPath("/agents/product/../growth/idea.md")).toThrow("traversal");
    expect(() => canonicalizeLogicalPath("/agents\\product\\idea.md")).toThrow("unsupported");
    expect(() => canonicalizeLogicalPath("/shared/idea.txt")).toThrow("end with .md");
    expect(() => canonicalizeLogicalPath("/shared/")).toThrow("document");
  });

  it("preserves every document revision and supports reversible deletion", async () => {
    const path = `/agents/product/${testId("phase04")}.md`;
    const actor = { agentId: "agent-product" };
    await documents.create({
      actor, logicalPath: path, title: "Phase 04 product note", contentMarkdown: "# v1\nActivation is unclear.",
      tags: ["product", "activation"],
    });
    await documents.edit({ actor, logicalPath: path, contentMarkdown: "# v2\nActivation needs a shorter path." });
    await documents.edit({ actor, logicalPath: path, contentMarkdown: "# v3\nTest the first useful result." });

    const stored = await documents.read(path, actor);
    expect(stored.document.currentVersion).toBe(3);
    expect(stored.currentVersion?.contentMarkdown).toContain("first useful result");
    const history = await documents.history(path, actor);
    expect(history.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
    expect(history.find((version) => version.versionNumber === 1)?.contentMarkdown).toContain("unclear");
    expect(history[0]?.parentVersionId).toBe(history[1]?.id);
    expect(history[1]?.parentVersionId).toBe(history[2]?.id);
    const reverted = await documents.restoreVersion({ actor, logicalPath: path, versionNumber: 1 });
    expect(reverted.document.currentVersion).toBe(4);
    expect(reverted.currentVersion?.contentMarkdown).toContain("unclear");

    await documents.delete(path, actor);
    await expect(documents.read(path, actor)).rejects.toThrow("not found");
    await documents.restore(path, actor);
    expect((await documents.read(path, actor)).currentVersion?.contentMarkdown).toContain("unclear");
  });

  it("enforces agent ownership while allowing explicit sharing and shared documents", async () => {
    const privatePath = `/agents/product/${testId("private")}.md`;
    await documents.create({
      actor: { agentId: "agent-product" }, logicalPath: privatePath, title: "Private product note", contentMarkdown: "Private fact.",
    });
    await expect(documents.read(privatePath, { agentId: "agent-growth" })).rejects.toThrow("access");
    await documents.share({ logicalPath: privatePath, actor: { agentId: "agent-product" }, targetAgentId: "agent-growth" });
    expect((await documents.read(privatePath, { agentId: "agent-growth" })).document.ownerAgentId).toBe("agent-product");

    const sharedPath = `/shared/ideas/${testId("shared")}.md`;
    await documents.create({
      actor: { agentId: "agent-product" }, logicalPath: sharedPath, title: "Shared idea", contentMarkdown: "Shared institutional idea.",
    });
    expect((await documents.read(sharedPath, { agentId: "agent-growth" })).document.scope).toBe("shared");
  });
});

describe("Phase 04 FTS retrieval and context packs", () => {
  it("handles Persian, English, malformed input, deleted documents, and bounded ranking", async () => {
    expect(normalizeFtsQuery('"growth" (pricing) لوما !!!')).toEqual(["growth", "pricing", "لوما"]);
    expect(normalizeFtsQuery("' ) OR *")).toEqual([]);
    expect(normalizeFtsQuery("*** ???")).toEqual([]);
    const path = `/shared/research/${testId("fts")}.md`;
    await documents.create({
      actor: { agentId: "agent-product" }, logicalPath: path, title: "Growth and pricing research",
      contentMarkdown: "# Growth\nلوما باید قیمت و مسیر فعال‌سازی را با داده واقعی بررسی کند.", tags: ["growth", "pricing"],
    });
    const search = new InstitutionalMemorySearch(repositories.database);
    const english = await search.search("growth pricing", { agentId: "agent-growth", topK: 3 });
    expect(english.some((item) => item.pathOrUrl === path)).toBe(true);
    const persian = await search.search("قیمت", { agentId: "agent-growth", topK: 3 });
    expect(persian.some((item) => item.pathOrUrl === path)).toBe(true);
    expect(await search.search("' ) OR *", { agentId: "agent-growth", topK: 3 })).toEqual([]);
    await documents.delete(path, { agentId: "agent-product" });
    expect((await search.search("growth pricing", { agentId: "agent-growth", topK: 3 })).some((item) => item.pathOrUrl === path)).toBe(false);
  });

  it("combines summary, recent messages, decisions, notes, and retrieved documents within a character budget", async () => {
    const user = await repositories.users.create({ id: testId("memory-user"), displayName: "Memory Test Human" });
    const thread = await repositories.threads.create({ id: testId("memory-thread"), title: "Memory context test", createdByUserId: user.id, summary: "pricing decision" });
    const message = await repositories.messages.create({
      id: testId("memory-message"), threadId: thread.id, authorType: "human", authorUserId: user.id,
      contentText: "The pricing decision needs evidence.", visibility: "public", origin: "internal",
    });
    await repositories.memoryNotes.create({
      scope: "organization", title: "Pricing fact", contentText: "Pricing needs a measurable activation hypothesis.",
    });
    await repositories.decisions.create({
      threadId: thread.id, title: "Measure first", decisionText: "Run a small pricing experiment.", status: "accepted",
    });
    await repositories.threadSummaries.upsert({
      threadId: thread.id, summaryMarkdown: "The thread is deciding how to test pricing.", messageCount: 1, lastMessageId: message.id,
    });
    const pack = await new ContextPackService(repositories.database).build({
      query: "pricing", actor: { agentId: "agent-product" }, threadId: thread.id, recentMessages: [message], topK: 5, maxCharacters: 1_000,
    });
    expect(pack.items.some((item) => item.type === "thread_summary")).toBe(true);
    expect(pack.items.some((item) => item.type === "message")).toBe(true);
    expect(pack.items.some((item) => item.type === "decision")).toBe(true);
    expect(pack.items.some((item) => item.type === "memory_note")).toBe(true);
    expect(pack.totalCharacters).toBeLessThanOrEqual(1_000);
    expect(ContextPackService.toPromptText(pack)).not.toContain("chain-of-thought");
  });

  it("does not place private messages into the institutional search or context pack", async () => {
    const user = await repositories.users.create({ id: testId("private-memory-user"), displayName: "Private Memory Human" });
    const thread = await repositories.threads.create({ id: testId("private-memory-thread"), title: "Private memory test", createdByUserId: user.id });
    const privateMessage = await repositories.messages.create({
      id: testId("private-memory-message"), threadId: thread.id, authorType: "human", authorUserId: user.id,
      contentText: "private operational credential-shaped text", visibility: "private", origin: "internal",
    });
    const search = new InstitutionalMemorySearch(repositories.database);
    expect(await search.search("credential-shaped", { agentId: "agent-product", topK: 5 })).toEqual([]);
    const pack = await new ContextPackService(repositories.database).build({
      query: "credential-shaped", actor: { agentId: "agent-product" }, threadId: thread.id, recentMessages: [privateMessage],
    });
    expect(pack.items.some((item) => item.sourceId === privateMessage.id)).toBe(false);
  });
});

describe("Phase 04 official knowledge synchronization", () => {
  it("chunks Markdown around headings and splits oversized sections sensibly", () => {
    const chunks = chunkMarkdown("# Pricing\n\nFirst paragraph.\n\n## Details\n\n" + "جزئیات قیمت. ".repeat(500));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.heading).toBe("Pricing");
    expect(chunks.some((chunk) => chunk.headingPath?.includes("Details"))).toBe(true);
    expect(chunks.every((chunk) => chunk.contentText.length <= 2_800)).toBe(true);
  });

  it("updates, skips unchanged content, and preserves the last good cache on failure", async () => {
    const definition = OFFICIAL_LUMA_SOURCES[0]!;
    let body = "# LUMA\n\n## Pricing\n\nقیمت و اشتراک باید با داده واقعی سنجیده شود.";
    let redirectMode: RequestRedirect | undefined;
    const sync = new KnowledgeSyncService(repositories, {
      now: () => "2026-08-15T12:00:00.000Z",
      fetcher: async (_input, init) => {
        redirectMode = init?.redirect;
        return new Response(body, { status: 200, headers: { etag: `etag-${body.length}` } });
      },
    });
    const first = await sync.syncSource(definition.key);
    expect(first.status).toBe("updated");
    expect(redirectMode).toBe("manual");
    expect(first.chunksCreated).toBeGreaterThan(0);
    const sourceAfterFirst = await repositories.knowledgeSources.getByKey(definition.canonicalKey);
    expect(sourceAfterFirst?.contentHash).toBe(first.contentHash);
    const chunksAfterFirst = await repositories.knowledgeSources.listChunks(sourceAfterFirst!.id, 50);

    const unchanged = await sync.syncSource(definition.key);
    expect(unchanged.status).toBe("unchanged");
    expect((await repositories.knowledgeSources.listChunks(sourceAfterFirst!.id, 50))).toHaveLength(chunksAfterFirst.length);

    body = "# LUMA\n\n## Workflow\n\nورک‌فلو جدید باید قابل مشاهده و قابل آزمون باشد.";
    const changed = await sync.syncSource(definition.key);
    expect(changed.status).toBe("updated");
    expect((await repositories.knowledgeSources.getByKey(definition.canonicalKey))?.contentVersion).toBe(2);

    const cachedHash = (await repositories.knowledgeSources.getByKey(definition.canonicalKey))?.contentHash;
    const failed = new KnowledgeSyncService(repositories, {
      now: () => "2026-08-15T12:01:00.000Z",
      fetcher: async () => new Response("unavailable", { status: 503 }),
    });
    expect((await failed.syncSource(definition.key)).status).toBe("failed");
    const sourceAfterFailure = await repositories.knowledgeSources.getByKey(definition.canonicalKey);
    expect(sourceAfterFailure?.contentHash).toBe(cachedHash);
    expect(sourceAfterFailure?.normalizedContent).toContain("ورک");
  });
});

describe("Phase 04 summary compaction and FILE_WORK boundary", () => {
  it("compacts only after the configured message threshold and preserves summary versions", async () => {
    const user = await repositories.users.create({ id: testId("summary-user"), displayName: "Summary Human" });
    const thread = await repositories.threads.create({ id: testId("summary-thread"), title: "Summary threshold test", createdByUserId: user.id });
    const makeMessage = async (content: string) => repositories.messages.create({
      id: testId("summary-message"), threadId: thread.id, authorType: "human", authorUserId: user.id,
      contentText: content, visibility: "public", origin: "internal",
    });
    await makeMessage("First fact.");
    await makeMessage("Second fact.");
    const provider = new FakeProvider().enqueueJson({ summary_markdown: "## Objective\nCapture the two facts." });
    const service = new ThreadSummaryService(repositories, { provider, modelKey: "fake", minimumNewMessages: 2 });
    const first = await service.maybeCompact({ threadId: thread.id });
    expect(first?.currentVersion).toBe(1);
    expect(await service.maybeCompact({ threadId: thread.id })).toBeNull();
    await makeMessage("Third fact.");
    await makeMessage("Fourth fact.");
    provider.enqueueJson({ summary_markdown: "## Objective\nCapture four facts." });
    const second = await service.maybeCompact({ threadId: thread.id });
    expect(second?.currentVersion).toBe(2);
    expect(await repositories.threadSummaries.listVersions(first!.id, 10)).toHaveLength(2);
  });

  it("executes one validated FILE_WORK operation through the application service", async () => {
    const user = await repositories.users.create({ id: testId("filework-user"), displayName: "File Work Human" });
    const thread = await repositories.threads.create({ id: testId("filework-thread"), title: "File work test", createdByUserId: user.id, summary: "Create a product note" });
    const message = await repositories.messages.create({
      id: testId("filework-message"), threadId: thread.id, authorType: "human", authorUserId: user.id,
      contentText: "Create the product note", visibility: "public", origin: "internal",
    });
    const job = await repositories.jobs.create({
      id: testId("filework-job"), jobType: "telegram.interactive_message", payload: { messageId: message.id, threadId: thread.id, addressedAgentId: "agent-product" },
      idempotencyKey: testId("filework-key"), dueAt: "2026-08-15T00:00:00.000Z", maxAttempts: 2,
    });
    const path = `/agents/product/${testId("runtime-note")}.md`;
    const action = (operation: string, content: string, extra: Record<string, unknown> = {}) => JSON.stringify({
      intent: "FILE_WORK", content, confidence: 0.9, reason_summary: "A bounded document operation is useful now.",
      target_agent_id: null, target_thread_id: null, metadata: { fileWork: { operation, path, ...extra } },
    });
    const provider = new FakeProvider().enqueueJson(action("create_document", "A product experiment note.")).enqueueJson({
      intent: "WAIT", content: null, confidence: 0.5, reason_summary: "No second contribution is needed.", target_agent_id: null, target_thread_id: null, metadata: {},
    });
    const memory = createMemoryServices(repositories);
    const runtime = new AgentRuntimeService({ repositories, provider, memory, modelKey: "fake", now: () => "2026-08-15T12:00:00.000Z", rng: () => 0 });
    const result = await runtime.runInteractiveBurst({
      job, messageId: message.id, threadId: thread.id, addressedAgentId: "agent-product", wakeReason: "human_message",
    });
    expect(result.turns).toBeGreaterThanOrEqual(1);
    expect(await documents.read(path, { agentId: "agent-product" })).toMatchObject({ document: { currentVersion: 1 } });
    const event = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM events WHERE event_type = 'runtime.file_work_completed' AND job_id = ?",
    ).bind(job.id).first<{ count: number }>();
    expect(event?.count).toBe(1);
  });
});
