import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createRepositories,
  InvalidTransitionError,
  type JobRecord,
} from "../src/database";

const repositories = createRepositories(env.DB);

function testId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const migrationTables = [
  "agents",
  "users",
  "chats",
  "threads",
  "messages",
  "jobs",
  "scheduled_jobs",
  "job_runs",
  "agent_turns",
  "events",
  "human_tasks",
  "documents",
  "document_versions",
  "knowledge_sources",
  "knowledge_chunks",
  "memory_notes",
  "decision_records",
  "evaluations",
  "peer_feedback",
  "reputation_events",
  "reputation_snapshots",
  "god_reviews",
  "god_directives",
  "provider_usage",
  "telegram_outbound",
  "telegram_outbound_parts",
  "artifacts",
  "artifact_revisions",
  "audit_log",
] as const;

describe("Phase 01 D1 migration and seeds", () => {
  it("creates the durable core tables and deterministic roster", async () => {
    const result = await env.DB
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN (${migrationTables.map(() => "?").join(", ")})
         ORDER BY name`,
      )
      .bind(...migrationTables)
      .all<{ name: string }>();

    expect(result.results.map((row) => row.name)).toEqual([...migrationTables].sort());

    const agents = await repositories.agents.listActive(20);
    expect(agents).toHaveLength(9);
    expect(agents.find((agent) => agent.slug === "product")?.rank).toBe(10);
    expect(agents.find((agent) => agent.slug === "god")?.isSupervisor).toBe(true);
  });
});

describe("core identity, threads, messages, and events", () => {
  it("creates users, chats, participants, replies, and idempotent messages", async () => {
    const user = await repositories.users.create({
      id: testId("user"),
      externalKey: testId("telegram-user"),
      displayName: "Test Human",
    });
    const agent = await repositories.agents.findBySlug("product");
    expect(agent).not.toBeNull();

    const chat = await repositories.chats.create({
      id: testId("chat"),
      telegramChatId: testId("telegram-chat"),
      chatType: "supergroup",
      isWorkspace: true,
    });
    const thread = await repositories.threads.create({
      id: testId("thread"),
      chatId: chat.id,
      title: "A durable product question",
      createdByUserId: user.id,
      turnBudget: 8,
      phaseBudget: 4,
    });

    await repositories.threads.addParticipant(thread.id, { userId: user.id, role: "owner" });
    await repositories.threads.addParticipant(thread.id, { agentId: agent!.id, role: "contributor" });

    const humanMessage = await repositories.messages.create({
      id: testId("message"),
      threadId: thread.id,
      chatId: chat.id,
      authorType: "human",
      authorUserId: user.id,
      contentText: "What should we test first?",
      origin: "telegram",
      telegramChatId: chat.telegramChatId ?? undefined,
      telegramMessageId: "1001",
      telegramBotAlias: "gateway",
      telegramUpdateId: "update-1001",
    });
    const agentMessage = await repositories.messages.create({
      id: testId("message"),
      threadId: thread.id,
      chatId: chat.id,
      authorType: "agent",
      authorAgentId: agent!.id,
      contentText: "Start with the smallest falsifiable experiment.",
      replyToMessageId: humanMessage.id,
    });

    const duplicate = await repositories.messages.create({
      id: testId("duplicate-message"),
      threadId: thread.id,
      authorType: "human",
      authorUserId: user.id,
      contentText: "This body must not create a second row.",
      idempotencyKey: "telegram-message:gateway:update-1001",
    });
    expect(duplicate.id).toBe(humanMessage.id);

    const recent = await repositories.messages.listRecentByThread(thread.id, 10);
    expect(recent.map((message) => message.id)).toEqual([humanMessage.id, agentMessage.id]);
    expect(agentMessage.replyToMessageId).toBe(humanMessage.id);

    const event = await repositories.events.append({
      threadId: thread.id,
      eventType: "test.recorded",
      aggregateType: "thread",
      aggregateId: thread.id,
      idempotencyKey: `test-event:${thread.id}`,
      payload: { source: "test" },
    });
    const duplicateEvent = await repositories.events.append({
      id: testId("duplicate-event"),
      threadId: thread.id,
      eventType: "test.recorded.changed-body",
      aggregateType: "thread",
      aggregateId: thread.id,
      idempotencyKey: `test-event:${thread.id}`,
      payload: { source: "duplicate" },
    });
    expect(duplicateEvent.id).toBe(event.id);
  });

  it("validates lifecycle transitions and records every accepted transition", async () => {
    const thread = await repositories.threads.create({
      id: testId("lifecycle-thread"),
      title: "Lifecycle contract",
    });

    await expect(
      repositories.threadLifecycle.transition({ threadId: thread.id, to: "decided" }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);

    const path = [
      "exploring",
      "debating",
      "evidence_gathering",
      "developing",
      "synthesizing",
      "human_required",
      "reopened",
      "blocked",
      "parked",
      "open",
      "rejected",
      "reopened",
      "exploring",
      "synthesizing",
      "decided",
      "reopened",
      "exploring",
    ] as const;

    let current = thread;
    for (const state of path) {
      current = await repositories.threadLifecycle.transition({ threadId: thread.id, to: state });
      expect(current.state).toBe(state);
    }

    const events = await repositories.events.listForThread(thread.id, 100);
    expect(events).toHaveLength(path.length);
    expect(events.every((event) => event.eventType === "thread.transitioned")).toBe(true);
  });
});

describe("durable jobs and recoverability", () => {
  it("deduplicates jobs, claims leases, completes work, and recovers stale work", async () => {
    const now = "2026-08-14T00:00:00.000Z";
    const job = await repositories.jobs.create({
      id: testId("job"),
      jobType: "test.coarse_job",
      payload: { threadId: "thread-test" },
      idempotencyKey: testId("job-key"),
      dueAt: "2026-08-13T23:59:00.000Z",
      maxAttempts: 2,
    });
    const duplicate = await repositories.jobs.create({
      id: testId("duplicate-job"),
      jobType: "test.other_type",
      idempotencyKey: job.idempotencyKey,
      dueAt: now,
    });
    expect(duplicate.id).toBe(job.id);

    const claimed = await repositories.jobs.claim(job.id, "worker-a", 60, now);
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.attemptCount).toBe(1);
    const completed = await repositories.jobs.complete(job.id, "worker-a", now);
    expect(completed.status).toBe("completed");

    const staleJob = await repositories.jobs.create({
      id: testId("stale-job"),
      jobType: "test.retryable_job",
      idempotencyKey: testId("stale-key"),
      dueAt: "2026-08-13T23:59:00.000Z",
      maxAttempts: 2,
    });
    const staleClaim = await repositories.jobs.claim(staleJob.id, "worker-b", 1, now);
    expect(staleClaim).not.toBeNull();
    const recovered = await repositories.jobs.recoverStale(
      "2026-08-14T00:00:02.000Z",
      "2026-08-14T00:00:03.000Z",
    );
    expect(recovered).toBe(1);
    expect((await repositories.jobs.getById(staleJob.id)).status).toBe("retry_scheduled");
    const staleRun = await env.DB
      .prepare("SELECT status, error_summary FROM job_runs WHERE job_id = ?")
      .bind(staleJob.id)
      .first<{ status: string; error_summary: string | null }>();
    expect(staleRun).toEqual({ status: "abandoned", error_summary: "stale lease recovered" });

    const secondClaim = await repositories.jobs.claim(
      staleJob.id,
      "worker-c",
      60,
      "2026-08-14T00:00:04.000Z",
    );
    expect(secondClaim?.attemptCount).toBe(2);
    const failed = await repositories.jobs.fail(
      staleJob.id,
      "worker-c",
      "provider unavailable",
      true,
      "2026-08-14T00:01:00.000Z",
      "2026-08-14T00:00:05.000Z",
    );
    expect(failed.status).toBe("failed");

    const due = await repositories.jobs.listDue("2026-08-14T00:10:00.000Z", 20);
    expect(due.some((candidate: JobRecord) => candidate.id === job.id)).toBe(false);
  });
});

describe("human tasks and versioned documents", () => {
  it("keeps task state explicit and preserves document revisions after soft deletion", async () => {
    const agent = await repositories.agents.findBySlug("technical");
    expect(agent).not.toBeNull();
    const thread = await repositories.threads.create({ id: testId("artifact-thread"), title: "Artifacts" });
    const task = await repositories.humanTasks.create({
      id: testId("task"),
      threadId: thread.id,
      requestedByAgentId: agent!.id,
      title: "Confirm the assumption",
      description: "Provide the missing business constraint.",
      priority: 80,
    });
    expect((await repositories.humanTasks.listOpen()).some((item) => item.id === task.id)).toBe(true);
    const completed = await repositories.humanTasks.updateStatus(task.id, "completed", "Confirmed by test");
    expect(completed.status).toBe("completed");
    expect(completed.resolution).toBe("Confirmed by test");

    const document = await repositories.documents.create({
      id: testId("document"),
      scope: "shared",
      title: "Decision notes",
      initialContent: "First version",
      createdByAgentId: agent!.id,
    });
    expect(document.document.currentVersion).toBe(1);
    expect(document.currentVersion?.contentMarkdown).toBe("First version");
    const revision = await repositories.documents.appendRevision({
      documentId: document.document.id,
      contentMarkdown: "Second version",
      changeSummary: "Clarified the conclusion",
      createdByAgentId: agent!.id,
    });
    expect(revision.versionNumber).toBe(2);
    expect((await repositories.documents.getWithCurrentVersion(document.document.id)).currentVersion?.contentMarkdown).toBe("Second version");

    await repositories.documents.softDelete(document.document.id);
    expect((await repositories.documents.listByOwner(null)).some((item) => item.id === document.document.id)).toBe(false);
    expect((await repositories.documents.getWithCurrentVersion(document.document.id)).currentVersion?.versionNumber).toBe(2);
  });
});

describe("constraints", () => {
  it("enforces foreign keys for institutional records", async () => {
    await expect(
      env.DB
        .prepare("INSERT INTO threads (id, chat_id, title) VALUES (?, ?, ?)")
        .bind(testId("orphan-thread"), "missing-chat", "This must fail")
        .run(),
    ).rejects.toThrow();
  });
});
