import type { DatabaseClient } from "../client";
import { createId, nowIso } from "../ids";
import { NotFoundError, ValidationError } from "../errors";
import { toJsonObject, toNullableString, toNumber } from "../rows";
import { encodeObject, requireNonEmpty } from "../validation";
import type { AgentTurnRecord } from "../types";
import type { JsonObject } from "../validation";

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
          wake_reason, budget_units, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        encodeObject(input.metadata, "agentTurn.metadata"),
        timestamp,
      )
      .run();

    return this.getById(id);
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

  async updateStatus(
    id: string,
    status: AgentTurnRecord["status"],
    outputMessageId?: string,
  ): Promise<AgentTurnRecord> {
    const timestamp = nowIso();
    const startedAt = status === "running" ? timestamp : null;
    const finishedAt = ["completed", "failed", "skipped"].includes(status) ? timestamp : null;
    const result = await this.database
      .prepare(
        `UPDATE agent_turns SET
          status = ?,
          output_message_id = COALESCE(?, output_message_id),
          started_at = COALESCE(?, started_at),
          finished_at = COALESCE(?, finished_at)
         WHERE id = ?`,
      )
      .bind(status, outputMessageId ?? null, startedAt, finishedAt, id)
      .run();

    if (result.meta.changes !== 1) {
      throw new NotFoundError("agent turn", id);
    }

    return this.getById(id);
  }
}
