import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createRepositories } from "../src/database";
import { ReputationService } from "../src/reputation/service";
import { OperatorOutcomeService } from "../src/reputation/operator";
import {
  boundedRankAfter,
  combinedReputationScore,
  epistemicSignal,
  rankTargetFromScore,
} from "../src/reputation/model";
import { GodReviewService } from "../src/god/service";
import { GodReviewOutputValidationError, parseGodReviewOutput } from "../src/god/schema";
import { FakeProvider } from "../src/llm/fake";
import { createMemoryServices } from "../src/memory";
import { ReputationScheduler } from "../src/reputation/scheduler";
import { GodScheduler } from "../src/god/scheduler";
import type { AgentJobMessage } from "../src/jobs";
import {
  createTelegramApplication,
  getTelegramBot,
  parseTelegramConfig,
  type TelegramSendTextInput,
  type TelegramSentMessage,
  type TelegramTransport,
} from "../src/telegram";

const repositories = createRepositories(env.DB);

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

class TestTelegramTransport implements TelegramTransport {
  readonly calls: TelegramSendTextInput[] = [];

  async sendTextMessage(input: TelegramSendTextInput): Promise<TelegramSentMessage> {
    this.calls.push(input);
    return { telegramChatId: input.telegramChatId, telegramMessageId: String(70_000 + this.calls.length) };
  }
}

class TestAgentQueue {
  readonly messages: AgentJobMessage[] = [];

  async send(message: AgentJobMessage): Promise<void> {
    this.messages.push(message);
  }
}

function godOutput(overrides: Record<string, unknown> = {}) {
  return {
    executive_summary: "یک مرور محدود و مبتنی بر شواهد انجام شد.",
    important_findings: ["یک تصمیم نیازمند آزمایش کوچک‌تر است."],
    weak_reasoning: [],
    unsupported_assumptions: [],
    high_value_work: ["پیشنهاد آزمایش قابل‌اندازه‌گیری است."],
    unresolved_risks: ["داده کافی برای تعمیم نداریم."],
    missing_perspectives: [],
    thread_recommendations: [],
    agent_evaluations: [{
      agent_id: "agent-product",
      domain: "product_strategy",
      dimension: "contribution",
      signal: 0.3,
      rationale: "پیشنهاد به یک فرضیه قابل‌آزمون تبدیل شد.",
    }],
    human_required: [],
    directives: [{
      target_agent_id: "agent-heretic",
      directive: "فرض اصلی را با یک ریسک مشخص به چالش بکش.",
      priority: 60,
    }],
    public_summary: "مرور انجام شد و یک فرضیه برای آزمایش کوچک‌تر مشخص شد.",
    ...overrides,
  };
}

describe("Phase 05 reputation model", () => {
  it("keeps the weighted score and rank mapping monotonic", () => {
    const neutral = combinedReputationScore({ epistemic: 0, contribution: 0, outcome: 0, collaboration: 0 });
    const positive = combinedReputationScore({ epistemic: 0.4, contribution: 0.4, outcome: 0.4, collaboration: 0.4 });
    const negative = combinedReputationScore({ epistemic: -0.4, contribution: -0.4, outcome: -0.4, collaboration: -0.4 });
    expect(neutral).toBe(0);
    expect(rankTargetFromScore(negative)).toBeLessThan(rankTargetFromScore(neutral));
    expect(rankTargetFromScore(positive)).toBeGreaterThan(rankTargetFromScore(neutral));
    expect(boundedRankAfter(10, 19, 0.5)).toBe(10.5);
    expect(boundedRankAfter(10, 1, 0.5)).toBe(9.5);
  });

  it("uses a proper bounded prediction signal with neutral 50% forecasts", () => {
    expect(epistemicSignal(0.5, true)).toBe(0);
    expect(epistemicSignal(0.99, true)).toBeGreaterThan(0.9);
    expect(epistemicSignal(0.99, false)).toBeLessThan(-0.9);
  });

  it("processes durable evidence without rewarding activity volume", async () => {
    const reputation = new ReputationService({ repositories, now: () => "2026-08-16T04:00:00.000Z" });
    const productStateBefore = await repositories.reputation.getDomainState("agent-product", "product_strategy");
    expect(ReputationService.isNeutral(productStateBefore)).toBe(true);

    const first = await reputation.addEvidence({
      agentId: "agent-product", domain: "product_strategy", dimension: "contribution", eventType: "proposal",
      sourceType: "decision", sourceId: id("decision"), signal: 0.8, evidenceSummary: "A useful proposal was accepted for testing.",
      idempotencyKey: id("evidence"),
    });
    const duplicate = await reputation.addEvidence({
      agentId: "agent-product", domain: "product_strategy", dimension: "contribution", eventType: "proposal",
      sourceType: "decision", sourceId: first.sourceId ?? "source", signal: 0.8, evidenceSummary: "duplicate delivery",
      idempotencyKey: first.idempotencyKey,
    });
    expect(duplicate.id).toBe(first.id);

    const result = await reputation.calculateDaily("2026-08-16");
    const productSnapshot = result.snapshots.find((snapshot) => snapshot.agentId === "agent-product" && snapshot.domain === "product_strategy");
    const generalSnapshot = result.snapshots.find((snapshot) => snapshot.agentId === "agent-product" && snapshot.domain === "general");
    expect(productSnapshot?.contribution).toBeGreaterThan(0);
    expect(productSnapshot?.epistemicBefore).toBe(0);
    expect(productSnapshot?.contributionBefore).toBe(0);
    expect(productSnapshot?.rankDelta).toBeLessThanOrEqual(0.5);
    expect(productSnapshot?.rankDelta).toBeGreaterThan(0);
    expect(generalSnapshot?.contribution).toBe(0);
    expect((await repositories.agents.getById("agent-product")).rank).toBeLessThanOrEqual(10.5);
    expect(result.processedEvidence).toBe(1);

    const secondRun = await reputation.calculateDaily("2026-08-16");
    expect(secondRun.run.id).toBe(result.run.id);
    expect(secondRun.snapshots).toHaveLength(result.snapshots.length);
  });

  it("validates delayed outcomes against durable sources and keeps duplicate recording idempotent", async () => {
    const reputation = new ReputationService({ repositories, now: () => "2026-08-16T06:00:00.000Z" });
    const thread = await repositories.threads.create({ id: id("outcome-thread"), title: "Outcome source" });
    const outcomeKey = id("outcome");
    const outcome = await reputation.recordOutcome({
      agentId: "agent-growth", domain: "growth", sourceType: "thread", sourceId: thread.id,
      signal: 0.7, summary: "Operator-confirmed synthetic outcome smoke.", idempotencyKey: outcomeKey,
    });
    const duplicate = await reputation.recordOutcome({
      agentId: "agent-growth", domain: "growth", sourceType: "thread", sourceId: thread.id,
      signal: 0.7, summary: "Duplicate delivery.", idempotencyKey: outcomeKey,
    });
    expect(duplicate.id).toBe(outcome.id);
    await expect(reputation.recordOutcome({
      agentId: "agent-growth", domain: "growth", sourceType: "thread", sourceId: id("missing-thread"),
      signal: 0.7, summary: "Invalid source.", idempotencyKey: id("invalid-outcome"),
    })).rejects.toThrow();
    const result = await reputation.calculateOffCycle(id("off-cycle"), "2026-08-16");
    expect(result.processedEvidence).toBeGreaterThanOrEqual(1);
    expect(result.snapshots.some((snapshot) => snapshot.agentId === "agent-growth" && snapshot.domain === "growth")).toBe(true);
  });

  it("exposes verified outcomes through a trusted operator boundary", async () => {
    const reputation = new ReputationService({ repositories, now: () => "2026-08-16T07:00:00.000Z" });
    const operator = new OperatorOutcomeService(reputation);
    const thread = await repositories.threads.create({ id: id("operator-outcome-thread"), title: "Operator outcome" });
    const result = await operator.record({
      agentId: "agent-technical", domain: "engineering_architecture", sourceType: "thread", sourceId: thread.id,
      signal: -0.4, summary: "Synthetic operator smoke only; not a real business result.", idempotencyKey: id("operator-outcome"),
      scoringDay: "2026-08-16",
    });
    expect(result.event.dimension).toBe("outcome");
    expect(result.calculation.run.status).toBe("completed");
    await expect(operator.record({
      agentId: "agent-technical", domain: "not-a-domain" as never, sourceType: "thread", sourceId: thread.id,
      signal: 0, summary: "invalid", idempotencyKey: id("operator-invalid"), scoringDay: "2026-08-16",
    })).rejects.toThrow("unknown outcome reputation domain");
  });

  it("keeps domain evidence separate and rejects self-feedback", async () => {
    const reputation = new ReputationService({ repositories, now: () => "2026-08-17T04:00:00.000Z" });
    await expect(reputation.recordPeerFeedback({
      targetAgentId: "agent-product", reviewerAgentId: "agent-product", domain: "product_strategy",
      tags: ["useful_refinement"], idempotencyKey: id("self-feedback"),
    })).rejects.toThrow("self-feedback");
    const event = await reputation.recordPeerFeedback({
      targetAgentId: "agent-product", reviewerAgentId: "agent-heretic", domain: "product_strategy",
      tags: ["useful_refinement", "missed_constraint"], score: 0.2, rationale: "A specific refinement and risk were identified.",
      idempotencyKey: id("peer-feedback"),
    });
    expect(event.feedback.reviewerWeight).toBe(1);
    expect(event.evidence.dimension).toBe("collaboration");
    const productState = await repositories.reputation.getDomainState("agent-product", "product_strategy");
    const financeState = await repositories.reputation.getDomainState("agent-product", "finance_pricing");
    expect(productState.domain).toBe("product_strategy");
    expect(financeState.contribution).toBe(0);
  });
});

describe("Phase 05 GOD provider-neutral review", () => {
  it("keeps daily reputation and twelve-hour GOD scheduling coarse and idempotent", async () => {
    const queue = new TestAgentQueue();
    const asOf = "2026-08-21T00:05:00.000Z";
    const reputationScheduler = new ReputationScheduler({ repositories, queue, now: () => asOf });
    expect((await reputationScheduler.tick()).jobsCreated).toBe(1);
    expect((await reputationScheduler.tick()).jobsCreated).toBe(0);

    const godAsOf = "2026-08-21T06:00:00.000Z";
    const godScheduler = new GodScheduler({ repositories, queue, enabled: true, now: () => godAsOf });
    expect((await godScheduler.tick()).jobsCreated).toBe(1);
    expect((await godScheduler.tick()).jobsCreated).toBe(0);
    const schedule = await repositories.reputation.getSchedule("god-review-12-hour");
    expect(schedule?.nextDueAt).toBe("2026-08-21T18:00:00.000Z");
    expect(queue.messages).toHaveLength(2);
  });

  it("validates structured output and permits only one repair attempt", () => {
    expect(() => parseGodReviewOutput("not-json")).toThrow(GodReviewOutputValidationError);
    const parsed = parseGodReviewOutput(JSON.stringify(godOutput()));
    expect(parsed.agentEvaluations[0]?.agentId).toBe("agent-product");
    expect(parsed.directives[0]?.targetAgentId).toBe("agent-heretic");
    expect(() => parseGodReviewOutput(JSON.stringify(godOutput({
      agent_evaluations: [{ ...godOutput().agent_evaluations[0], domain: "unknown_domain" }],
    })))).toThrow(GodReviewOutputValidationError);
  });

  it("persists a bounded review, directives, evaluations, evidence, and review memory", async () => {
    const provider = new FakeProvider().enqueueJson(godOutput({
      thread_recommendations: [{ recommendation: "این موضوع را با یک آزمایش کوچک ادامه دهید." }],
    }));
    const memory = createMemoryServices(repositories, { provider, modelKey: "fake-god" });
    const reputation = new ReputationService({ repositories, now: () => "2026-08-18T12:00:00.000Z" });
    const rankBeforeReview = (await repositories.agents.getById("agent-product")).rank;
    const service = new GodReviewService({ repositories, provider, modelKey: "fake-god", reputation, memory, now: () => "2026-08-18T12:00:00.000Z" });
    const result = await service.run({ idempotencyKey: id("god-review") });
    expect(result.review.status).toBe("completed");
    expect(result.directives).toHaveLength(2);
    expect(result.evaluations).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.messages.at(-1)?.content).not.toContain("agent-product");
    expect((await repositories.agents.getById("agent-product")).rank).toBe(rankBeforeReview);
    const reviewDocument = await memory.documents.read(`/god/reviews/2026-08-18-${result.review.id}.md`, { agentId: "agent-god" });
    expect(reviewDocument.currentVersion?.contentMarkdown).toContain("Executive summary");

    const replay = await service.run({ idempotencyKey: result.review.idempotencyKey as string });
    expect(replay.review.id).toBe(result.review.id);
    expect(provider.calls).toHaveLength(1);
  });

  it("fails safely after a malformed response and one failed repair", async () => {
    const provider = new FakeProvider()
      .enqueueJson({ nope: true })
      .enqueueJson({ still_invalid: true });
    const reputation = new ReputationService({ repositories, now: () => "2026-08-19T12:00:00.000Z" });
    const service = new GodReviewService({ repositories, provider, modelKey: "fake-god", reputation, now: () => "2026-08-19T12:00:00.000Z" });
    const result = await service.run({ idempotencyKey: id("god-invalid") });
    expect(result.review.status).toBe("failed");
    expect(result.review.repairAttempts).toBe(1);
    expect(provider.calls).toHaveLength(2);
    expect(result.evidence).toHaveLength(0);
  });

  it("projects GOD through gateway while preserving canonical authorship and reply mapping", async () => {
    const user = await repositories.users.create({ id: id("god-user"), displayName: "Operator" });
    const telegramChatId = "-1005550001";
    const chat = await repositories.chats.create({ id: id("god-chat"), telegramChatId, chatType: "supergroup", isWorkspace: true });
    const thread = await repositories.threads.create({ id: id("god-thread"), chatId: chat.id, title: "GOD projection test", createdByUserId: user.id });
    const transport = new TestTelegramTransport();
    const app = createTelegramApplication({
      repositories,
      config: parseTelegramConfig({
        TELEGRAM_GROUP_ID: telegramChatId,
        TELEGRAM_WEBHOOK_SECRET: "test-secret",
        TELEGRAM_BOT_IDENTITIES_JSON: JSON.stringify({ gateway: { telegramUserId: "9900", username: "luma_center" } }),
      }),
      transport,
      now: () => "2026-08-20T12:00:00.000Z",
    });
    expect(getTelegramBot(parseTelegramConfig({ TELEGRAM_BOT_IDENTITIES_JSON: "{}" }), "god")).toBeNull();
    const provider = new FakeProvider().enqueueJson(godOutput());
    const reputation = new ReputationService({ repositories, now: () => "2026-08-20T12:00:00.000Z" });
    const service = new GodReviewService({ repositories, provider, modelKey: "fake-god", reputation, telegram: app, now: () => "2026-08-20T12:00:00.000Z" });
    const result = await service.run({
      idempotencyKey: id("god-project-review"), publishTelegram: true,
      telegramChatId: chat.id, telegramThreadId: thread.id,
    });
    expect(result.publicMessageId).toBeDefined();
    const publicMessage = await repositories.messages.getById(result.publicMessageId as string);
    expect(publicMessage.authorAgentId).toBe("agent-god");
    const outbound = await repositories.telegramOutbound.getByIdempotencyKey(`${result.review.id}:public-summary`);
    expect(outbound.agentId).toBe("agent-god");
    expect(outbound.botAlias).toBe("gateway");
    expect(transport.calls[0]?.botAlias).toBe("gateway");

    const reply = await app.ingest({
      botAlias: "gateway",
      receivedAt: "2026-08-20T12:01:00.000Z",
      payload: {
        update_id: 910001,
        message: {
          message_id: 910002,
          from: { id: 42, is_bot: false, first_name: "Operator" },
          chat: { id: chat.telegramChatId, type: "supergroup", title: "LUMA ADHD" },
          date: 1_723_000_000,
          text: "این مرور را پیگیری می‌کنیم.",
          reply_to_message: {
            message_id: 70001,
            from: { id: 9900, is_bot: true, first_name: "Center", username: "luma_center" },
            chat: { id: chat.telegramChatId, type: "supergroup", title: "LUMA ADHD" },
            date: 1_723_000_000,
            text: transport.calls[0]?.text,
          },
        },
      },
    });
    expect(reply.addressedAgentId).toBe("agent-god");

    const ordinary = await repositories.messages.create({
      threadId: thread.id, chatId: chat.id, authorType: "system", contentText: "System notice", origin: "system",
      idempotencyKey: id("ordinary-gateway-message"),
    });
    await repositories.messages.attachTelegramProjection({ messageId: ordinary.id, telegramChatId, telegramMessageId: "79999", telegramBotAlias: "gateway" });
    const ordinaryReply = await app.ingest({
      botAlias: "gateway", receivedAt: "2026-08-20T12:02:00.000Z",
      payload: {
        update_id: 910003,
        message: {
          message_id: 910004,
          from: { id: 42, is_bot: false, first_name: "Operator" },
          chat: { id: chat.telegramChatId, type: "supergroup", title: "LUMA ADHD" },
          date: 1_723_000_001,
          text: "متوجه شدم.",
          reply_to_message: {
            message_id: 79999,
            from: { id: 9900, is_bot: true, first_name: "Center", username: "luma_center" },
            chat: { id: chat.telegramChatId, type: "supergroup", title: "LUMA ADHD" },
            date: 1_723_000_000,
            text: "System notice",
          },
        },
      },
    });
    expect(ordinaryReply.addressedAgentId).toBeNull();
  });
});
