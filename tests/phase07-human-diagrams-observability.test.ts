import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createRepositories } from "../src/database";
import { HumanTaskService } from "../src/human-tasks";
import { DiagramService } from "../src/diagrams";
import type { DiagramRenderResult, DiagramRenderer } from "../src/diagrams";
import { createTelegramApplication, parseTelegramConfig } from "../src/telegram";

const repositories = createRepositories(env.DB);

function testId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function telegramForTests() {
  const config = parseTelegramConfig({
    TELEGRAM_GROUP_ID: "-1007000000000",
    TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({
      customer: { telegramUserId: "7001", username: "LumaSaraBot" },
    }),
    TELEGRAM_CUSTOMER_BOT_TOKEN: "test-token",
  });
  return createTelegramApplication({
    repositories,
    config,
    transport: {
      async sendTextMessage() {
        return { telegramMessageId: String(7000 + Math.floor(Math.random() * 1000)), telegramChatId: "-1007000000000" };
      },
    },
  });
}

describe("Phase 07 human task lifecycle", () => {
  it("projects one blocking task, resolves it once, and creates one wake job", async () => {
    const chat = await repositories.chats.create({
      id: testId("phase07-chat"),
      telegramChatId: "-1007000000000",
      chatType: "supergroup",
      isWorkspace: true,
    });
    const thread = await repositories.threads.create({
      id: testId("phase07-thread"),
      chatId: chat.id,
      title: "Phase 07 human task lifecycle",
      createdByAgentId: "agent-customer",
    });
    const service = new HumanTaskService({ repositories, telegram: telegramForTests() });
    const created = await service.createFromAgent({
      threadId: thread.id,
      chatId: chat.id,
      requestedByAgentId: "agent-customer",
      title: "Owner approval",
      description: "Confirm whether the onboarding experiment may proceed.",
      reason: "The Agent cannot responsibly choose the launch constraint without owner approval.",
      priority: 85,
      blocking: true,
      requestKey: testId("approval"),
      idempotencyKey: testId("task"),
    });
    expect(created.reused).toBe(false);
    expect(created.task.blocking).toBe(true);
    expect(created.task.projectionStatus).toBe("sent");
    expect(created.task.requestMessageId).toBeTruthy();
    expect((await repositories.threads.getById(thread.id)).state).toBe("human_required");

    const user = await repositories.users.create({ id: testId("phase07-user"), displayName: "Phase 07 Owner" });
    const first = await service.resolveFromResponse({
      taskId: created.task.id,
      responseText: "Approved. Run the smallest safe experiment.",
      responderUserId: user.id,
      responseSource: "telegram",
    });
    expect(first.alreadyResolved).toBe(false);
    expect(first.wakeJob?.jobType).toBe("human_task.wake");
    expect(first.task.responseSource).toBe("telegram");
    expect(first.task.responseMessageId).toBe(first.responseMessageId);
    expect((await repositories.threads.getById(thread.id)).state).toBe("reopened");

    const replay = await service.resolveFromResponse({
      taskId: created.task.id,
      responseText: "The same Telegram update was replayed.",
      responderUserId: user.id,
      responseSource: "telegram",
    });
    expect(replay.alreadyResolved).toBe(true);
    expect(replay.wakeJob?.id).toBe(first.wakeJob?.id);
    const wakeJobs = await env.DB.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'human_task.wake' AND idempotency_key = ?").bind(`human-task-wake:${created.task.id}`).first<{ count: number }>();
    expect(Number(wakeJobs?.count ?? 0)).toBe(1);
  });
});

describe("Phase 07 diagrams", () => {
  const spec = {
    diagram_type: "architecture",
    title: "معماری ساده لوما",
    direction: "rtl",
    nodes: [
      { id: "human", label: "انسان" },
      { id: "gateway", label: "درگاه تلگرام <script>alert(1)</script>" },
      { id: "runtime", label: "Agent Runtime" },
    ],
    edges: [
      { from: "human", to: "gateway", label: "پیام" },
      { from: "gateway", to: "runtime", label: "ورودی" },
    ],
    notes: ["منبع اصلی در D1 نگهداری می‌شود."],
  };

  it("stores a safe RTL source and immutable revisions with source-only fallback", async () => {
    const service = new DiagramService(repositories);
    const created = await service.create({ spec, actor: { agentId: "agent-technical" }, idempotencyKey: testId("diagram") });
    expect(created.artifact.artifactType).toBe("diagram");
    expect(created.artifact.sourceText).not.toContain("<script>");
    expect(created.artifact.sourceText).not.toContain("https://");
    expect(created.artifact.sourceText).toContain("Content-Security-Policy");
    expect(created.artifact.renderStatus).toBe("not_requested");

    const revised = await service.revise({
      artifactId: created.artifact.id,
      spec: { ...spec, title: "معماری بازبینی‌شده" },
      actor: { agentId: "agent-technical" },
      changeSummary: "Clarified the runtime node",
    });
    const detail = await service.detail(revised.id);
    expect(detail.revisions.map((item) => item.revisionNumber)).toEqual([2, 1]);

    const fallback = await service.render(revised.id);
    expect(fallback.renderStatus).toBe("unavailable");
    expect(fallback.sourceText).toContain("معماری بازبینی‌شده");
    expect(fallback.deliveryStatus).toBe("not_available");
  });

  it("accepts a rendered adapter without storing image bytes", async () => {
    const renderer: DiagramRenderer = {
      async render(): Promise<DiagramRenderResult> {
        return { status: "rendered", telegramFileId: "telegram-file-id" };
      },
    };
    const service = new DiagramService(repositories, { renderer });
    const created = await service.create({ spec: { ...spec, title: "Rendered adapter" }, actor: { agentId: "agent-technical" }, idempotencyKey: testId("rendered-diagram") });
    const rendered = await service.render(created.artifact.id);
    expect(rendered.renderStatus).toBe("rendered");
    expect(rendered.deliveryStatus).toBe("sent");
    expect(rendered.telegramFileId).toBe("telegram-file-id");
    expect(rendered.sourceText).not.toContain("data:image");
  });
});

describe("Phase 07 bounded job recovery", () => {
  it("retries failed work and refuses an active lease", async () => {
    const failed = await repositories.jobs.create({
      id: testId("phase07-failed-job"),
      jobType: "diagram.render",
      idempotencyKey: testId("phase07-failed-key"),
      dueAt: "2026-08-15T00:00:00.000Z",
      maxAttempts: 3,
    });
    await env.DB.prepare("UPDATE jobs SET status = 'failed', attempt_count = 1, last_error = 'renderer unavailable' WHERE id = ?").bind(failed.id).run();
    expect((await repositories.jobs.retryFailed(failed.id)).status).toBe("retry_scheduled");

    const active = await repositories.jobs.create({
      id: testId("phase07-active-job"),
      jobType: "agent.ambient",
      idempotencyKey: testId("phase07-active-key"),
      dueAt: "2026-08-15T00:00:00.000Z",
    });
    await repositories.jobs.claim(active.id, "phase07-worker", 120, "2026-08-16T00:00:00.000Z");
    await expect(repositories.jobs.recoverStaleById(active.id, "2026-08-16T00:00:30.000Z")).rejects.toThrow("active lease");
    const recovered = await repositories.jobs.recoverStaleById(active.id, "2026-08-16T00:03:00.000Z");
    expect(recovered.status).toBe("retry_scheduled");
  });
});
