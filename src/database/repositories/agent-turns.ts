import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireNonEmpty } from "../validation";
import type { AgentTurnRecord } from "../types";
import type { JsonObject } from "../validation";

export interface AgentSelectionActivityRow {
  readonly agent_id: string;
  readonly last_turn_at: string | null;
  readonly last_thread_turn_at: string | null;
  readonly last_ambient_opportunity_at: string | null;
  readonly recent_opportunity_count: number;
  readonly recent_meaningful_count: number;
  readonly recent_thread_opportunity_count: number;
  readonly recent_thread_meaningful_count: number;
}

interface AgentTurnRow {
  id: string;
  job_id: string | null;
  thread_id: string;
  agent_id: string;
  sequence_number: number;
  status: AgentTurnRecord["status"];
  input_message_id: string | null;
  output_message_id: string | null;
  wake_reason: string | null;
  budget_units: number;
  idempotency_key: string | null;
  metadata_json: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function mapTurn(row: AgentTurnRow): AgentTurnRecord {
  return {
    id: row.id,
    jobId: toNullableString(row.job_id),
    threadId: row.thread_id,
    agentId: row.agent_id,
    sequenceNumber: toNumber(row.sequence_number, "agent_turns.sequence_number"),
    status: row.status,
    inputMessageId: toNullableString(row.input_message_id),
    outputMessageId: toNullableString(row.output_message_id),
    wakeReason: toNullableString(row.wake_reason),
    budgetUnits: toNumber(row.budget_units, "agent_turns.budget_units"),
    idempotencyKey: toNullableString(row.idempotency_key),
    metadata: toJsonObject(row.metadata_json, "agent_turns.metadata_json"),
    createdAt: row.created_at,
    startedAt: toNullableString(row.started_at),
    finishedAt: toNullableString(row.finished_at),
  };
}

export interface CreateAgentTurnInput {
  readonly id?: string;
  readonly jobId?: string;
  readonly threadId: string;
  readonly agentId: string;
  readonly sequenceNumber: number;
  readonly inputMessageId?: string;
  readonly wakeReason?: string;
  readonly budgetUnits?: number;
  readonly idempotencyKey?: string;
  readonly metadata?: JsonObject;
}

export class AgentTurnRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(input: CreateAgentTurnInput): Promise<AgentTurnRecord> {
    if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 1) {
      throw new ValidationError("agent turn sequenceNumber must be a positive integer");
    }

    const budgetUnits = input.budgetUnits ?? 1;
    if (!Number.isInteger(budgetUnits) || budgetUnits < 1) {
      throw new ValidationError("agent turn budgetUnits must be a positive integer");
    }

    const id = input.id ?? createId("agent-turn");
    const timestamp = nowIso();
    await this.database
      .prepare(
        `INSERT INTO agent_turns (
          id, job_id, thread_id, agent_id, sequence_number, input_message_id,
          wake_reason, budget_units, idempotency_key, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING`,
      )
      .bind(
        id,
        input.jobId ?? null,
        requireNonEmpty(input.threadId, "agentTurn.threadId"),
        requireNonEmpty(input.agentId, "agentTurn.agentId"),
        input.sequenceNumber,
        input.inputMessageId ?? null,
        input.wakeReason ?? null,
        budgetUnits,
        input.idempotencyKey ?? null,
        encodeObject(input.metadata, "agentTurn.metadata"),
        timestamp,
      )
      .run();

    return input.idempotencyKey === undefined
      ? this.getById(id)
      : this.getByIdempotencyKey(input.idempotencyKey);
  }

  async getById(id: string): Promise<AgentTurnRecord> {
    const row = await this.database
      .prepare("SELECT * FROM agent_turns WHERE id = ?")
      .bind(id)
      .first<AgentTurnRow>();

    if (!row) {
      throw new NotFoundError("agent turn", id);
    }

    return mapTurn(row);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<AgentTurnRecord> {
    const row = await this.database
      .prepare("SELECT * FROM agent_turns WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<AgentTurnRow>();

    if (!row) {
      throw new NotFoundError("agent turn idempotency key", idempotencyKey);
    }

    return mapTurn(row);
  }

  async listByJob(jobId: string, limit = 50): Promise<readonly AgentTurnRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new ValidationError("agent turn list limit must be between 1 and 200");
    }
    const result = await this.database
      .prepare(
        `SELECT * FROM agent_turns
         WHERE job_id = ?
         ORDER BY sequence_number ASC
         LIMIT ?`,
      )
      .bind(jobId, limit)
      .all<AgentTurnRow>();

    return result.results.map(mapTurn);
  }

  async nextSequence(threadId: string): Promise<number> {
    const row = await this.database
      .prepare(
        "SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence FROM agent_turns WHERE thread_id = ?",
      )
      .bind(threadId)
      .first<{ next_sequence: number }>();

    return Number(row?.next_sequence ?? 1);
  }

  /**
   * Returns bounded opportunity history for all supplied normal Agents in one
   * indexed query. A selected turn is an opportunity even when it later WAITs
   * or fails; only completed non-WAIT turns count as meaningful contribution.
   */
  async getSelectionActivity(
    agentIds: readonly string[],
    threadId: string,
    asOf = nowIso(),
    windowHours = 72,
  ): Promise<Readonly<Record<string, AgentSelectionActivityRow>>> {
    if (agentIds.length > 20) throw new ValidationError("selection activity agent limit must not exceed 20");
    if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168) {
      throw new ValidationError("selection activity window must be between 1 and 168 hours");
    }
    const asOfMs = Date.parse(asOf);
    if (!Number.isFinite(asOfMs)) throw new ValidationError("selection activity asOf must be valid ISO");
    const cutoff = new Date(asOfMs - windowHours * 3_600_000).toISOString();
    const result: Readonly<Record<string, AgentSelectionActivityRow>> = Object.fromEntries(agentIds.map((id) => [id, {
      agent_id: id,
      last_turn_at: null,
      last_thread_turn_at: null,
      last_ambient_opportunity_at: null,
      recent_opportunity_count: 0,
      recent_meaningful_count: 0,
      recent_thread_opportunity_count: 0,
      recent_thread_meaningful_count: 0,
    }]));
    if (agentIds.length === 0) return result;

    const placeholders = agentIds.map(() => "?").join(", ");
    const rows = await this.database.prepare(
      `SELECT at.agent_id,
              MAX(at.created_at) AS last_turn_at,
              MAX(CASE WHEN at.thread_id = ? THEN at.created_at END) AS last_thread_turn_at,
              MAX(CASE WHEN j.job_type = 'agent.ambient' THEN at.created_at END) AS last_ambient_opportunity_at,
              COUNT(*) AS recent_opportunity_count,
              SUM(CASE WHEN at.status = 'completed' AND COALESCE(json_extract(at.metadata_json, '$.intent'), '') <> 'WAIT' THEN 1 ELSE 0 END) AS recent_meaningful_count,
              SUM(CASE WHEN at.thread_id = ? THEN 1 ELSE 0 END) AS recent_thread_opportunity_count,
              SUM(CASE WHEN at.thread_id = ? AND at.status = 'completed' AND COALESCE(json_extract(at.metadata_json, '$.intent'), '') <> 'WAIT' THEN 1 ELSE 0 END) AS recent_thread_meaningful_count
       FROM agent_turns at
       LEFT JOIN jobs j ON j.id = at.job_id
       WHERE at.created_at >= ? AND at.agent_id IN (${placeholders})
       GROUP BY at.agent_id`,
    ).bind(threadId, threadId, threadId, cutoff, ...agentIds).all<AgentSelectionActivityRow>();

    const mutable = { ...result } as Record<string, AgentSelectionActivityRow>;
    for (const row of rows.results) mutable[row.agent_id] = {
      agent_id: row.agent_id,
      last_turn_at: row.last_turn_at ?? null,
      last_thread_turn_at: row.last_thread_turn_at ?? null,
      last_ambient_opportunity_at: row.last_ambient_opportunity_at ?? null,
      recent_opportunity_count: Number(row.recent_opportunity_count ?? 0),
      recent_meaningful_count: Number(row.recent_meaningful_count ?? 0),
      recent_thread_opportunity_count: Number(row.recent_thread_opportunity_count ?? 0),
      recent_thread_meaningful_count: Number(row.recent_thread_meaningful_count ?? 0),
    };
    return mutable;
  }

  async updateStatus(
    id: string,
    status: AgentTurnRecord["status"],
    outputMessageId?: string,
    metadata?: JsonObject,
  ): Promise<AgentTurnRecord> {
    const existing = metadata === undefined ? null : await this.getById(id);
    const timestamp = nowIso();
    const startedAt = status === "running" ? timestamp : null;
    const finishedAt = ["completed", "failed", "skipped"].includes(status) ? timestamp : null;
    const mergedMetadata = metadata === undefined
      ? undefined
      : { ...(existing?.metadata ?? {}), ...metadata };
    const result = await this.database
      .prepare(
        `UPDATE agent_turns SET
          status = ?,
          output_message_id = COALESCE(?, output_message_id),
          started_at = COALESCE(?, started_at),
          finished_at = COALESCE(?, finished_at),
          metadata_json = COALESCE(?, metadata_json)
         WHERE id = ?`,
      )
      .bind(
        status,
        outputMessageId ?? null,
        startedAt,
        finishedAt,
        mergedMetadata === undefined ? null : encodeObject(mergedMetadata, "agentTurn.metadata"),
        id,
      )
      .run();

    if (result.meta.changes !== 1) {
      throw new NotFoundError("agent turn", id);
    }

    return this.getById(id);
  }
}
