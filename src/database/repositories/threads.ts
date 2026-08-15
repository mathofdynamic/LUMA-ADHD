import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { InvalidTransitionError, NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireLimit, requireNonEmpty } from "../validation";
import type {
  ActorRef,
  CreateThreadInput,
  ThreadId,
  ThreadParticipantRole,
  ThreadRecord,
  ThreadState,
} from "../types";

interface ThreadRow {
  id: string;
  chat_id: string | null;
  title: string;
  state: ThreadState;
  priority: number;
  summary: string | null;
  turn_budget: number;
  turns_used: number;
  phase_budget: number;
  phase_turns_used: number;
  cycle_budget: number;
  cycle_depth: number;
  created_by_user_id: string | null;
  created_by_agent_id: string | null;
  telegram_topic_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  closed_at: string | null;
  deleted_at: string | null;
}

function mapThread(row: ThreadRow): ThreadRecord {
  return {
    id: row.id,
    chatId: toNullableString(row.chat_id),
    title: row.title,
    state: row.state,
    priority: toNumber(row.priority, "threads.priority"),
    summary: toNullableString(row.summary),
    turnBudget: toNumber(row.turn_budget, "threads.turn_budget"),
    turnsUsed: toNumber(row.turns_used, "threads.turns_used"),
    phaseBudget: toNumber(row.phase_budget, "threads.phase_budget"),
    phaseTurnsUsed: toNumber(row.phase_turns_used, "threads.phase_turns_used"),
    cycleBudget: toNumber(row.cycle_budget, "threads.cycle_budget"),
    cycleDepth: toNumber(row.cycle_depth, "threads.cycle_depth"),
    createdByUserId: toNullableString(row.created_by_user_id),
    createdByAgentId: toNullableString(row.created_by_agent_id),
    telegramTopicId: toNullableString(row.telegram_topic_id),
    metadata: toJsonObject(row.metadata_json, "threads.metadata_json"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    closedAt: toNullableString(row.closed_at),
    deletedAt: toNullableString(row.deleted_at),
  };
}

export const ALLOWED_THREAD_TRANSITIONS: Readonly<Record<ThreadState, readonly ThreadState[]>> = {
  open: ["exploring", "blocked", "human_required", "parked", "rejected"],
  exploring: ["debating", "evidence_gathering", "developing", "synthesizing", "human_required", "blocked", "parked"],
  debating: ["exploring", "evidence_gathering", "developing", "synthesizing", "human_required", "blocked", "parked"],
  evidence_gathering: ["debating", "developing", "synthesizing", "human_required", "blocked", "parked"],
  developing: ["evidence_gathering", "synthesizing", "human_required", "blocked", "parked"],
  synthesizing: ["developing", "evidence_gathering", "decided", "rejected", "human_required", "blocked", "parked"],
  human_required: ["reopened", "blocked", "parked"],
  blocked: ["human_required", "reopened", "parked"],
  decided: ["reopened", "parked"],
  rejected: ["reopened", "parked"],
  parked: ["reopened", "open"],
  reopened: ["exploring", "debating", "evidence_gathering", "developing", "synthesizing", "human_required", "blocked", "parked"],
};

function validateActor(actor: ActorRef | undefined): ActorRef {
  const resolved = actor ?? { type: "system" as const };
  const hasUser = resolved.userId !== undefined;
  const hasAgent = resolved.agentId !== undefined;

  if (resolved.type === "human" && (!hasUser || hasAgent)) {
    throw new ValidationError("human thread events require only actor.userId");
  }

  if (resolved.type === "agent" && (!hasAgent || hasUser)) {
    throw new ValidationError("agent thread events require only actor.agentId");
  }

  if (resolved.type === "system" && (hasUser || hasAgent)) {
    throw new ValidationError("system thread events cannot include an actor id");
  }

  return resolved;
}

export interface ThreadTransitionInput {
  readonly threadId: ThreadId;
  readonly from: ThreadState;
  readonly to: ThreadState;
  readonly actor?: ActorRef;
  readonly reason?: string;
}

export class ThreadRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateThreadInput): Promise<ThreadRecord> {
    const id = input.id ?? createId("thread");
    const title = requireNonEmpty(input.title, "thread.title");
    const priority = input.priority ?? 50;
    const turnBudget = input.turnBudget ?? 12;
    const phaseBudget = input.phaseBudget ?? 6;
    const cycleBudget = input.cycleBudget ?? 3;

    for (const [value, field] of [
      [priority, "thread.priority"],
      [turnBudget, "thread.turnBudget"],
      [phaseBudget, "thread.phaseBudget"],
      [cycleBudget, "thread.cycleBudget"],
    ] as const) {
      if (!Number.isInteger(value) || value < 0 || (field === "thread.priority" && value > 100)) {
        throw new ValidationError(`${field} is out of range`);
      }
    }

    if (input.createdByUserId !== undefined && input.createdByAgentId !== undefined) {
      throw new ValidationError("thread creator must be a user or an agent, not both");
    }

    const timestamp = nowIso();
    await this.database
      .prepare(
        `INSERT INTO threads (
          id, chat_id, title, state, priority, summary, turn_budget,
          phase_budget, cycle_budget, created_by_user_id, created_by_agent_id,
          telegram_topic_id, metadata_json, created_at, updated_at, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.chatId ?? null,
        title,
        input.state ?? "open",
        priority,
        input.summary ?? null,
        turnBudget,
        phaseBudget,
        cycleBudget,
        input.createdByUserId ?? null,
        input.createdByAgentId ?? null,
        input.telegramTopicId ?? null,
        encodeObject(input.metadata, "thread.metadata"),
        timestamp,
        timestamp,
        timestamp,
      )
      .run();

    return this.getById(id);
  }

  async getById(id: ThreadId): Promise<ThreadRecord> {
    const row = await this.database
      .prepare("SELECT * FROM threads WHERE id = ?")
      .bind(id)
      .first<ThreadRow>();

    if (!row) {
      throw new NotFoundError("thread", id);
    }

    return mapThread(row);
  }

  async listActive(limit = 50): Promise<readonly ThreadRecord[]> {
    const safeLimit = requireLimit(limit, "thread list limit", 200);
    const result = await this.database
      .prepare(
        `SELECT * FROM threads
         WHERE deleted_at IS NULL AND state NOT IN ('decided', 'rejected', 'parked')
         ORDER BY priority DESC, last_activity_at DESC
         LIMIT ?`,
      )
      .bind(safeLimit)
      .all<ThreadRow>();

    return result.results.map(mapThread);
  }

  async findMostRecentActiveByChat(chatId: string): Promise<ThreadRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT * FROM threads
         WHERE chat_id = ? AND deleted_at IS NULL
           AND state NOT IN ('decided', 'rejected', 'parked')
         ORDER BY last_activity_at DESC, created_at DESC, id DESC
         LIMIT 1`,
      )
      .bind(chatId)
      .first<ThreadRow>();

    return row ? mapThread(row) : null;
  }

  async findByTelegramTopic(chatId: string, telegramTopicId: string): Promise<ThreadRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT * FROM threads
         WHERE chat_id = ? AND telegram_topic_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(chatId, telegramTopicId)
      .first<ThreadRow>();

    return row ? mapThread(row) : null;
  }

  async touchActivity(threadId: ThreadId, asOf = nowIso()): Promise<ThreadRecord> {
    const result = await this.database
      .prepare(
        `UPDATE threads
         SET updated_at = ?, last_activity_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(asOf, asOf, threadId)
      .run();

    if (result.meta.changes !== 1) {
      throw new NotFoundError("thread", threadId);
    }

    return this.getById(threadId);
  }

  async addParticipant(
    threadId: ThreadId,
    participant: { readonly userId?: string; readonly agentId?: string; readonly role?: ThreadParticipantRole },
  ): Promise<string> {
    const hasUser = participant.userId !== undefined;
    const hasAgent = participant.agentId !== undefined;
    if (hasUser === hasAgent) {
      throw new ValidationError("thread participant must be exactly one user or agent");
    }

    const id = createId("thread-participant");
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO thread_participants (
          id, thread_id, user_id, agent_id, role
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        threadId,
        participant.userId ?? null,
        participant.agentId ?? null,
        participant.role ?? "contributor",
      )
      .run();

    const row = await this.database
      .prepare(
        `SELECT id FROM thread_participants
         WHERE thread_id = ? AND ((user_id = ? AND ? IS NOT NULL) OR (agent_id = ? AND ? IS NOT NULL))`,
      )
      .bind(
        threadId,
        participant.userId ?? null,
        participant.userId ?? null,
        participant.agentId ?? null,
        participant.agentId ?? null,
      )
      .first<{ id: string }>();

    if (!row) {
      throw new NotFoundError("thread participant", `${threadId}`);
    }

    return row.id;
  }

  async transitionAndRecordEvent(input: ThreadTransitionInput): Promise<ThreadRecord | null> {
    const actor = validateActor(input.actor);
    const eventId = createId("event");
    const eventKey = `thread-transition:${input.threadId}:${eventId}`;
    const timestamp = nowIso();
    const payload = encodeObject(
      {
        from: input.from,
        to: input.to,
        reason: input.reason ?? "",
      },
      "thread transition payload",
    );

    const results = await this.database.batch<ThreadRow>([
      this.database
        .prepare(
          `UPDATE threads SET
            state = ?,
            updated_at = ?,
            last_activity_at = ?,
            closed_at = CASE WHEN ? IN ('decided', 'rejected', 'parked') THEN ? ELSE closed_at END
           WHERE id = ? AND state = ? AND deleted_at IS NULL`,
        )
        .bind(input.to, timestamp, timestamp, input.to, timestamp, input.threadId, input.from),
      this.database
        .prepare(
          `INSERT INTO events (
            id, event_type, aggregate_type, aggregate_id, thread_id,
            actor_type, actor_user_id, actor_agent_id, idempotency_key,
            payload_json, occurred_at
          )
          SELECT ?, 'thread.transitioned', 'thread', ?, ?, ?, ?, ?, ?, ?, ?
          WHERE changes() = 1`,
        )
        .bind(
          eventId,
          input.threadId,
          input.threadId,
          actor.type,
          actor.userId ?? null,
          actor.agentId ?? null,
          eventKey,
          payload,
          timestamp,
        ),
      this.database.prepare("SELECT * FROM threads WHERE id = ?").bind(input.threadId),
    ]);

    const row = results[2]?.results[0];
    return row ? mapThread(row) : null;
  }
}

export class ThreadLifecycleService {
  constructor(private readonly threads: ThreadRepository) {}

  async transition(input: Omit<ThreadTransitionInput, "from"> & { readonly to: ThreadState }): Promise<ThreadRecord> {
    const current = await this.threads.getById(input.threadId);
    const allowed = ALLOWED_THREAD_TRANSITIONS[current.state];

    if (!allowed.includes(input.to)) {
      throw new InvalidTransitionError(current.state, input.to);
    }

    const updated = await this.threads.transitionAndRecordEvent({
      ...input,
      from: current.state,
    });

    if (!updated) {
      const latest = await this.threads.getById(input.threadId);
      throw new InvalidTransitionError(latest.state, input.to);
    }

    return updated;
  }
}
