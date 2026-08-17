import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";

import {
  AgentRuntimeService,
  chooseCandidateFromScores,
  scoreCandidates,
  type AgentCandidateProfile,
  type AgentSelectionActivity,
} from "../src/agents";
import { createRepositories } from "../src/database";
import type { AgentRecord, ThreadRecord } from "../src/database/types";
import { FakeProvider } from "../src/llm";

const repositories = createRepositories(env.DB);

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function profile(agentId: string, specialty: string, description = specialty): AgentCandidateProfile {
  const agent: AgentRecord = {
    id: agentId,
    slug: agentId.replace(/^agent-/u, ""),
    displayName: agentId,
    specialty,
    specialtyDescription: description,
    soul: "evidence first",
    personality: "direct",
    rank: 10,
    isSupervisor: false,
    isActive: true,
    config: {},
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
  return {
    agent,
    specialties: [{ agentId, domain: specialty, description, priority: 100, isPrimary: true }],
    interests: [],
  };
}

function thread(state: string = "open"): ThreadRecord {
  return { state, priority: 60 } as ThreadRecord;
}

function activity(overrides: Partial<AgentSelectionActivity> = {}): AgentSelectionActivity {
  return {
    lastTurnAt: null,
    lastThreadTurnAt: null,
    lastAmbientOpportunityAt: null,
    recentOpportunityCount: 0,
    recentMeaningfulContributionCount: 0,
    recentThreadOpportunityCount: 0,
    recentThreadMeaningfulContributionCount: 0,
    ...overrides,
  };
}

describe("post-v1 Agent diversity and autonomy policy", () => {
  it("uses candidate-specific exploration and remains reproducible", () => {
    const profiles = [profile("agent-a", "shared_topic"), profile("agent-b", "shared_topic")];
    const constant = scoreCandidates({ profiles, messageText: "shared topic", thread: thread("unknown"), turnIndex: 0, rng: () => 0 });
    const sequence = [0, 1];
    const varied = scoreCandidates({ profiles, messageText: "shared topic", thread: thread("unknown"), turnIndex: 0, rng: () => sequence.shift() ?? 0 });
    const replayValues = [0, 1];
    const replay = scoreCandidates({ profiles, messageText: "shared topic", thread: thread("unknown"), turnIndex: 0, rng: () => replayValues.shift() ?? 0 });

    expect(constant[0]?.agentId).toBe("agent-a");
    expect(varied[0]?.agentId).toBe("agent-b");
    expect(replay.map((candidate) => candidate.agentId)).toEqual(varied.map((candidate) => candidate.agentId));
    expect(varied[0]?.explorationValue).toBeGreaterThan(constant[0]?.explorationValue ?? 0);
  });

  it("never randomizes away an explicit first-turn address", () => {
    const profiles = [profile("agent-product", "product_strategy"), profile("agent-technical", "engineering_architecture")];
    const scored = scoreCandidates({
      profiles,
      messageText: "product architecture",
      thread: thread("open"),
      addressedAgentId: "agent-technical",
      turnIndex: 0,
      rng: () => 1,
    });
    const decision = chooseCandidateFromScores(scored, { addressedAgentId: "agent-technical", turnIndex: 0, rng: () => 1 });
    expect(decision.candidate?.agentId).toBe("agent-technical");
    expect(decision.reason).toBe("explicit_address");
  });

  it("explores only within relevant candidates", () => {
    const profiles = [
      profile("agent-product", "product_strategy"),
      profile("agent-technical", "engineering_architecture"),
      profile("agent-finance", "finance_pricing"),
    ];
    const scored = scoreCandidates({
      profiles,
      messageText: "product API architecture",
      thread: thread("unknown"),
      turnIndex: 0,
      rng: () => 0,
      activityByAgentId: { "agent-finance": activity({ recentOpportunityCount: 0 }) },
    });
    const decision = chooseCandidateFromScores(scored, { turnIndex: 0, rng: () => 1 });
    expect(["agent-product", "agent-technical"]).toContain(decision.candidate?.agentId);
    expect(decision.candidate?.agentId).not.toBe("agent-finance");
  });

  it("uses same-thread and cross-job recency without fixed rotation", () => {
    const profiles = [profile("agent-product", "shared_topic"), profile("agent-technical", "shared_topic")];
    const scored = scoreCandidates({
      profiles,
      messageText: "shared topic",
      thread: thread("unknown"),
      turnIndex: 0,
      rng: () => 0,
      activityByAgentId: {
        "agent-product": activity({ recentOpportunityCount: 3, recentThreadOpportunityCount: 3 }),
        "agent-technical": activity(),
      },
    });
    expect(scored[0]?.agentId).toBe("agent-technical");
    expect(scored.find((candidate) => candidate.agentId === "agent-product")?.reasons).toContain("cross-job thread recency penalty");
  });

  it("prefers a neglected relevant specialist but not an irrelevant quiet Agent", () => {
    const customer = profile("agent-customer", "customer_experience", "customer support escalation and onboarding");
    const creative = profile("agent-creative", "ux_creative", "UX onboarding flows");
    const finance = profile("agent-finance", "finance_pricing", "pricing and unit economics");
    const onboarding = scoreCandidates({
      profiles: [customer, creative],
      messageText: "customer onboarding UX",
      thread: thread("open"),
      turnIndex: 0,
      rng: () => 0,
      activityByAgentId: {
        "agent-customer": activity({ recentOpportunityCount: 6 }),
        "agent-creative": activity(),
      },
    });
    expect(onboarding[0]?.agentId).toBe("agent-creative");

    const technical = scoreCandidates({
      profiles: [profile("agent-technical", "engineering_architecture", "API architecture and reliability"), finance],
      messageText: "API architecture reliability",
      thread: thread("evidence_gathering"),
      turnIndex: 0,
      rng: () => 0,
      activityByAgentId: { "agent-finance": activity() },
    });
    expect(technical[0]?.agentId).toBe("agent-technical");
  });

  it("keeps WAIT and failed turns as opportunities in the bounded activity aggregate", async () => {
    const chat = await repositories.chats.create({ id: id("diversity-chat"), chatType: "internal", isWorkspace: true });
    const testThread = await repositories.threads.create({ id: id("diversity-thread"), chatId: chat.id, title: "Opportunity aggregate" });
    const waitJob = await repositories.jobs.create({ id: id("diversity-wait-job"), jobType: "agent.ambient", payload: { threadId: testThread.id }, idempotencyKey: id("diversity-wait-key"), dueAt: new Date().toISOString() });
    const failedJob = await repositories.jobs.create({ id: id("diversity-failed-job"), jobType: "agent.ambient", payload: { threadId: testThread.id }, idempotencyKey: id("diversity-failed-key"), dueAt: new Date().toISOString() });
    const waitTurn = await repositories.agentTurns.create({ id: id("diversity-wait-turn"), jobId: waitJob.id, threadId: testThread.id, agentId: "agent-creative", sequenceNumber: 1, metadata: { mode: "ambient" } });
    await repositories.agentTurns.updateStatus(waitTurn.id, "completed", undefined, { intent: "WAIT" });
    const failedTurn = await repositories.agentTurns.create({ id: id("diversity-failed-turn"), jobId: failedJob.id, threadId: testThread.id, agentId: "agent-finance", sequenceNumber: 2, metadata: { mode: "ambient" } });
    await repositories.agentTurns.updateStatus(failedTurn.id, "failed", undefined, { failure: "structured_output" });

    const aggregate = await repositories.agentTurns.getSelectionActivity(["agent-creative", "agent-finance"], testThread.id, new Date().toISOString(), 72);
    expect(aggregate["agent-creative"]?.recent_opportunity_count).toBe(1);
    expect(aggregate["agent-creative"]?.recent_meaningful_count).toBe(0);
    expect(aggregate["agent-finance"]?.recent_opportunity_count).toBe(1);
  });

  it("persists bounded selection telemetry without changing the public action contract", async () => {
    const user = await repositories.users.create({ id: id("diversity-user"), displayName: "Diversity fixture" });
    const chat = await repositories.chats.create({ id: id("telemetry-chat"), chatType: "internal", isWorkspace: true });
    const testThread = await repositories.threads.create({ id: id("telemetry-thread"), chatId: chat.id, title: "Telemetry question", summary: "product strategy" });
    const message = await repositories.messages.create({ id: id("telemetry-message"), threadId: testThread.id, chatId: chat.id, authorType: "human", authorUserId: user.id, contentText: "product strategy", origin: "internal" });
    const job = await repositories.jobs.create({ id: id("telemetry-job"), jobType: "telegram.interactive_message", payload: { threadId: testThread.id, messageId: message.id }, idempotencyKey: id("telemetry-key"), dueAt: new Date().toISOString() });
    const provider = new FakeProvider().enqueueJson(JSON.stringify({ intent: "SPEAK", content: "A bounded contribution.", confidence: 0.8, reason_summary: "Useful fixture contribution.", target_agent_id: null, target_thread_id: null, metadata: {} }));
    const runtime = new AgentRuntimeService({ repositories, provider, modelKey: "diversity-test", now: () => "2026-08-17T12:00:00.000Z", rng: () => 0 });
    await runtime.runInteractiveBurst({ job, messageId: message.id, threadId: testThread.id, addressedAgentId: "agent-product", wakeReason: "diversity-test" });

    const turn = (await repositories.agentTurns.listByJob(job.id))[0];
    expect(turn?.metadata.selection).toBeDefined();
    const selectedEvent = await repositories.events.getByIdempotencyKey(`agent-turn-selected:${turn?.id}`);
    expect(selectedEvent.payload.selectedAgentId).toBe(turn?.agentId);
    expect(Array.isArray(selectedEvent.payload.topCandidates)).toBe(true);
  });
});
