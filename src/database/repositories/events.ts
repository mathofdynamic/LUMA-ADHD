import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString } from "../rows";
import { encodeObject, requireLimit, requireNonEmpty } from "../validation";
import type { CreateEventInput, StoredEvent } from "../types";

interface EventRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  thread_id: string | null;
  job_id: string | null;
  actor_type: StoredEvent["actorType"];
  actor_user_id: string | null;
  actor_agent_id: string | null;
  idempotency_key: string;
  payload_json: string;
  occurred_at: string;
  processed_at: string | null;
}

function mapEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    threadId: toNullableString(row.thread_id),
    jobId: toNullableString(row.job_id),
    actorType: row.actor_type,
    actorUserId: toNullableString(row.actor_user_id),
    actorAgentId: toNullableString(row.actor_agent_id),
    idempotencyKey: row.idempotency_key,
    payload: toJsonObject(row.payload_json, "events.payload_json"),
    occurredAt: row.occurred_at,
    processedAt: toNullableString(row.processed_at),
  };
}

function validateActor(input: CreateEventInput): NonNullable<CreateEventInput["actor"]> {
  const actor = input.actor ?? { type: "system" as const };
  const hasUser = actor.userId !== undefined;
  const hasAgent = actor.agentId !== undefined;

  if (actor.type === "human" && (!hasUser || hasAgent)) {
    throw new ValidationError("human events require only actor.userId");
  }

  if (actor.type === "agent" && (!hasAgent || hasUser)) {
    throw new ValidationError("agent events require only actor.agentId");
  }

  if (actor.type === "system" && (hasUser || hasAgent)) {
    throw new ValidationError("system events cannot include an actor id");
  }

  return actor;
}

export class EventRepository {
  constructor(private readonly database: DatabaseClient) {}

  async append(input: CreateEventInput): Promise<StoredEvent> {
    const actor = validateActor(input);
    const id = input.id ?? createId("event");
    const eventType = requireNonEmpty(input.eventType, "event.eventType");
    const aggregateType = requireNonEmpty(input.aggregateType, "event.aggregateType");
    const aggregateId = requireNonEmpty(input.aggregateId, "event.aggregateId");
    const idempotencyKey = requireNonEmpty(input.idempotencyKey, "event.idempotencyKey");
    const occurredAt = input.occurredAt ?? nowIso();

    await this.database
      .prepare(
        `INSERT INTO events (
          id, event_type, aggregate_type, aggregate_id, thread_id, job_id,
          actor_type, actor_user_id, actor_agent_id, idempotency_key,
          payload_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(
        id,
        eventType,
        aggregateType,
        aggregateId,
        input.threadId ?? null,
        input.jobId ?? null,
        actor.type,
        actor.userId ?? null,
        actor.agentId ?? null,
        idempotencyKey,
        encodeObject(input.payload, "event.payload"),
        occurredAt,
      )
      .run();

    return this.getByIdempotencyKey(idempotencyKey);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<StoredEvent> {
    const row = await this.database
      .prepare("SELECT * FROM events WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<EventRow>();

    if (!row) {
      throw new NotFoundError("event idempotency key", idempotencyKey);
    }

    return mapEvent(row);
  }

  async listForThread(threadId: string, limit = 100): Promise<readonly StoredEvent[]> {
    const safeLimit = requireLimit(limit, "event list limit", 500);
    const result = await this.database
      .prepare(
        `SELECT * FROM events
         WHERE thread_id = ?
         ORDER BY occurred_at ASC, id ASC
         LIMIT ?`,
      )
      .bind(threadId, safeLimit)
      .all<EventRow>();

    return result.results.map(mapEvent);
  }

  async listRecentByTypeForChat(chatId: string, eventType: string, limit = 5): Promise<readonly StoredEvent[]> {
    const safeLimit = requireLimit(limit, "chat event list limit", 20);
    const result = await this.database
      .prepare(
        `SELECT e.* FROM events e
         INNER JOIN threads t ON t.id = e.thread_id
         WHERE t.chat_id = ? AND e.event_type = ?
         ORDER BY e.occurred_at DESC, e.id DESC
         LIMIT ?`,
      )
      .bind(chatId, eventType, safeLimit)
      .all<EventRow>();

    return result.results.map(mapEvent);
  }
}
