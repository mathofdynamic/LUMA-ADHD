import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { AgentRuntimeService } from "../src/agents/runtime";
import { isObviousRepeatedContent } from "../src/agents/repetition";
import { FOUNDATION_GUARDRAILS } from "../src/guardrails";
import { createRepositories } from "../src/database";
import { validateSettingValue } from "../src/admin/settings";
import { DEFAULT_RUNTIME_SETTINGS } from "../src/admin/settings";
import { DiagramService } from "../src/diagrams";
import type { DiagramRenderResult, DiagramRenderer } from "../src/diagrams";
import { FakeProvider } from "../src/llm";

const repositories = createRepositories(env.DB);

function testId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function runtimeFixture(text: string): Promise<{ readonly threadId: string; readonly jobId: string; readonly messageId: string }> {
  const user = await repositories.users.create({ id: testId("phase08-user"), displayName: "Phase 08 operator" });
  const chat = await repositories.chats.create({
    id: testId("phase08-chat"),
    telegramChatId: testId("phase08-telegram-chat"),
    chatType: "supergroup",
    isWorkspace: true,
  });
  const thread = await repositories.threads.create({
    id: testId("phase08-thread"),
    chatId: chat.id,
    title: "Phase 08 deterministic hardening fixture",
    summary: text,
    createdByUserId: user.id,
  });
  const message = await repositories.messages.create({
    id: testId("phase08-message"),
    threadId: thread.id,
    chatId: chat.id,
    authorType: "human",
    authorUserId: user.id,
    contentText: text,
    origin: "internal",
  });
  const job = await repositories.jobs.create({
    id: testId("phase08-job"),
    jobType: "telegram.interactive_message",
    payload: { threadId: thread.id, messageId: message.id },
    idempotencyKey: testId("phase08-job-key"),
    dueAt: new Date().toISOString(),
  });
  return { threadId: thread.id, jobId: job.id, messageId: message.id };
}

describe("Phase 08 hardening", () => {
  it("enforces hard ceilings before work reaches Queue", async () => {
    expect(FOUNDATION_GUARDRAILS.interactiveBurstMaxTurns).toBe(6);
    expect(FOUNDATION_GUARDRAILS.deepWorkMaxTurns).toBe(12);
    expect(FOUNDATION_GUARDRAILS.acquisitionMaxOperations).toBe(3);
    expect(FOUNDATION_GUARDRAILS.queueChainMaxDepth).toBe(3);
    await expect(repositories.jobs.create({
      id: testId("phase08-depth"),
      jobType: "agent.ambient",
      idempotencyKey: testId("phase08-depth-key"),
      dueAt: new Date().toISOString(),
      chainDepth: FOUNDATION_GUARDRAILS.queueChainMaxDepth + 1,
    })).rejects.toThrow("chainDepth");
    await expect(repositories.jobs.create({
      id: testId("phase08-retry-cap"),
      jobType: "agent.ambient",
      idempotencyKey: testId("phase08-retry-cap-key"),
      dueAt: new Date().toISOString(),
      maxAttempts: FOUNDATION_GUARDRAILS.maxRetries + 1,
    })).rejects.toThrow("maxAttempts");
  });

  it("rejects admin values that would bypass hard ceilings", () => {
    expect(() => validateSettingValue("interactive_burst_turns", 100)).toThrow();
    expect(() => validateSettingValue("deep_work_turns", 100)).toThrow();
    expect(() => validateSettingValue("rag_max_acquisition_steps", 4)).toThrow();
    expect(() => validateSettingValue("ambient_daily_job_budget", 25)).toThrow();
    expect(validateSettingValue("ambient_daily_job_budget", 0)).toBe(0);
  });

  it("detects obvious repeated content without suppressing short identifiers", () => {
    const repeated = "پیشنهاد من این است که یک آزمایش محدود با کاربران جدید اجرا کنیم و نتیجه را اندازه بگیریم.";
    expect(isObviousRepeatedContent(repeated, [repeated])).toBe(true);
    expect(isObviousRepeatedContent("Activation Rate", ["Activation Rate"])).toBe(false);
  });

  it("reproduces the Heretic invalid-output failure safely", async () => {
    const fixture = await runtimeFixture("A bounded Heretic continuation failure.");
    const provider = new FakeProvider().enqueueJson("not-json").enqueueJson("still-not-json");
    const runtime = new AgentRuntimeService({
      repositories,
      provider,
      modelKey: "phase08-fake",
      now: () => "2026-08-17T12:00:00.000Z",
      rng: () => 0,
    });

    const result = await runtime.runInteractiveBurst({
      job: await repositories.jobs.getById(fixture.jobId),
      messageId: fixture.messageId,
      threadId: fixture.threadId,
      addressedAgentId: "agent-heretic",
      wakeReason: "phase08-heretic-regression",
    });

    expect(result.stoppedReason).toBe("turn_stopped_after_safe_failure");
    expect(result.publicMessages).toBe(0);
    expect(provider.calls).toHaveLength(2);
    const turn = await env.DB.prepare(
      "SELECT status, output_message_id, json_extract(metadata_json, '$.repairAttempts') AS repair_attempts FROM agent_turns WHERE job_id = ? LIMIT 1",
    ).bind(fixture.jobId).first<{ status: string; output_message_id: string | null; repair_attempts: number }>();
    expect(turn?.status).toBe("failed");
    expect(turn?.output_message_id).toBeNull();
    expect(Number(turn?.repair_attempts ?? 0)).toBe(1);
  });

  it("suppresses a repeated SPEAK before creating a second public message", async () => {
    const repeated = "پیشنهاد من این است که یک آزمایش محدود با کاربران جدید اجرا کنیم و نتیجه را اندازه بگیریم.";
    const fixture = await runtimeFixture("Continue the existing proposal.");
    await repositories.messages.create({
      id: testId("phase08-prior-agent-message"),
      threadId: fixture.threadId,
      authorType: "agent",
      authorAgentId: "agent-product",
      contentText: repeated,
      origin: "internal",
      visibility: "public",
    });
    const provider = new FakeProvider().enqueueJson({
      intent: "SPEAK",
      content: repeated,
      confidence: 0.8,
      reason_summary: "The same proposal was returned by the fixture.",
      target_agent_id: null,
      target_thread_id: null,
      metadata: {},
    });
    const runtime = new AgentRuntimeService({
      repositories,
      provider,
      modelKey: "phase08-fake",
      now: () => "2026-08-17T12:00:00.000Z",
      rng: () => 0,
    });

    const result = await runtime.runInteractiveBurst({
      job: await repositories.jobs.getById(fixture.jobId),
      messageId: fixture.messageId,
      threadId: fixture.threadId,
      addressedAgentId: "agent-product",
      wakeReason: "phase08-repetition-regression",
    });

    expect(result.stoppedReason).toBe("repeated_content_suppressed");
    expect(result.publicMessages).toBe(0);
    const suppressed = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM events WHERE event_type = 'runtime.repeated_content_suppressed' AND job_id = ?",
    ).bind(fixture.jobId).first<{ count: number }>();
    expect(Number(suppressed?.count ?? 0)).toBe(1);
    const agentMessages = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM messages WHERE thread_id = ? AND author_type = 'agent'",
    ).bind(fixture.threadId).first<{ count: number }>();
    expect(Number(agentMessages?.count ?? 0)).toBe(1);
  });

  it("defers over-budget deep work to the next UTC day without a provider call", async () => {
    const fixture = await runtimeFixture("Defer this optional deep-work opportunity safely.");
    const job = await repositories.jobs.create({
      id: testId("phase08-deep-budget-job"),
      jobType: "agent.deep_work",
      payload: { threadId: fixture.threadId, messageId: fixture.messageId, eligible: true, trigger: "phase08_budget" },
      idempotencyKey: testId("phase08-deep-budget-key"),
      dueAt: "2026-08-17T12:00:00.000Z",
    });
    const provider = new FakeProvider();
    const runtime = new AgentRuntimeService({
      repositories,
      provider,
      modelKey: "phase08-fake",
      runtimeSettings: { ...DEFAULT_RUNTIME_SETTINGS, deepWorkDailyJobBudget: 0 },
      now: () => "2026-08-17T12:00:00.000Z",
      rng: () => 0,
    });

    const result = await runtime.runDeepWork(job, fixture.threadId, "phase08_budget");

    expect(result.stoppedReason).toBe("daily_safety_budget_exhausted");
    expect(provider.calls).toHaveLength(0);
    const deferred = await repositories.jobs.getByIdempotencyKey(
      `deep-work-budget:${job.id}:2026-08-18T00:00:00.000Z`,
    );
    expect(deferred.status).toBe("pending");
    expect(deferred.dueAt).toBe("2026-08-18T00:00:00.000Z");
    expect(deferred.payload.deferredFromJobId).toBe(job.id);
  });

  it("caps diagram renderer retries while retaining the source artifact", async () => {
    let calls = 0;
    const renderer: DiagramRenderer = {
      async render(): Promise<DiagramRenderResult> {
        calls += 1;
        return { status: "unavailable", reason: "phase08 deterministic renderer unavailable" };
      },
    };
    const service = new DiagramService(repositories, { renderer });
    const created = await service.create({
      spec: {
        diagram_type: "flow",
        title: "Phase 08 renderer retry cap",
        direction: "ltr",
        nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        edges: [{ from: "a", to: "b" }],
        groups: [],
        notes: [],
      },
      actor: { agentId: "agent-technical" },
      idempotencyKey: testId("phase08-render-cap"),
    });
    await service.render(created.artifact.id);
    await service.render(created.artifact.id);
    await service.render(created.artifact.id);
    const capped = await service.render(created.artifact.id);

    expect(calls).toBe(3);
    expect(capped.renderAttemptCount).toBe(3);
    expect(capped.sourceText).toContain("Phase 08 renderer retry cap");
  });
});
